using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace Unictl.Tools
{
    [UnictlTool(Name = "hierarchy_tree", Description = "List live or static Unity scene/prefab hierarchies for GameObject path discovery.")]
    public static class HierarchyTreeTool
    {
        private const string TargetLive = "live";
        private const string TargetSceneAsset = "scene_asset";
        private const string TargetPrefabAsset = "prefab_asset";
        private const string ProbeName = "__unictl_hierarchy_tree_ddol_probe";

        public class Parameters
        {
            [ToolParameter("Target hierarchy source: live, scene_asset, or prefab_asset. Default: live.", Required = false, DefaultValue = "live", Enum = "live,scene_asset,prefab_asset")]
            public string Target { get; set; }

            [ToolParameter("Static asset path for target=scene_asset or target=prefab_asset.", Required = false)]
            public string Asset { get; set; }

            [ToolParameter("Scene asset path alias. Equivalent to target=scene_asset + asset=<path>.", Required = false)]
            public string Scene { get; set; }

            [ToolParameter("Prefab asset path alias. Equivalent to target=prefab_asset + asset=<path>.", Required = false)]
            public string Prefab { get; set; }

            [ToolParameter("Maximum child depth to include. 0 returns roots only. Default: 3.", Required = false, DefaultValue = "3")]
            public int Depth { get; set; }

            [ToolParameter("Maximum nodes to return before truncating. Default: 1000.", Required = false, DefaultValue = "1000")]
            public int MaxNodes { get; set; }

            [ToolParameter("Include component type names for each GameObject. Default: false.", Required = false, DefaultValue = "false")]
            public bool IncludeComponents { get; set; }

            [ToolParameter("Include inactive GameObjects. Default: true.", Required = false, DefaultValue = "true")]
            public bool IncludeInactive { get; set; }

            [ToolParameter("Include Play Mode DontDestroyOnLoad roots through a temporary probe object. Default: true.", Required = false, DefaultValue = "true")]
            public bool IncludeDontDestroyOnLoad { get; set; }

            [ToolParameter("Name filter. Supports case-insensitive substring or *wildcard* patterns.", Required = false)]
            public string FilterName { get; set; }

            [ToolParameter("Component type filter. Case-insensitive substring or *wildcard* patterns.", Required = false)]
            public string FilterComponent { get; set; }

            [ToolParameter("Include Unity/editor internal roots such as [Debug Updater]. Default: false.", Required = false, DefaultValue = "false")]
            public bool IncludeInternal { get; set; }
        }

        public static object HandleCommand(JObject parameters)
        {
            var p = new ToolParams(parameters);
            var target = ResolveTarget(p);

            var depth = p.GetInt("depth", 3).Value;
            if (depth < 0)
                return new ErrorResponse("depth must be >= 0", new { depth });

            var maxNodes = p.GetInt("max_nodes", 1000).Value;
            if (maxNodes <= 0)
                return new ErrorResponse("max_nodes must be > 0", new { max_nodes = maxNodes });

            var options = new Options
            {
                Target = target,
                MaxDepth = depth,
                MaxNodes = maxNodes,
                IncludeComponents = p.GetBool("include_components", false),
                IncludeInactive = p.GetBool("include_inactive", true),
                IncludeDontDestroyOnLoad = p.GetBool("include_dont_destroy_on_load", true),
                IncludeInternal = p.GetBool("include_internal", false),
                FilterName = p.Get("filter_name"),
                FilterComponent = p.Get("filter_component")
            };

            if (string.Equals(target, TargetSceneAsset, StringComparison.OrdinalIgnoreCase))
                return HandleSceneAsset(p, options);
            if (string.Equals(target, TargetPrefabAsset, StringComparison.OrdinalIgnoreCase))
                return HandlePrefabAsset(p, options);
            if (!string.Equals(target, TargetLive, StringComparison.OrdinalIgnoreCase))
            {
                return new ErrorResponse($"Unsupported hierarchy_tree target: {target}", new
                {
                    error_kind = "invalid_param",
                    reason = "invalid_hierarchy_tree_target",
                    valid_targets = new[] { TargetLive, TargetSceneAsset, TargetPrefabAsset },
                    requested_target = target
                });
            }

            var nodes = new List<NodeInfo>();
            var sceneSummaries = new List<object>();
            var state = new CollectionState();

            CollectLoadedScenes(options, nodes, sceneSummaries, state);
            var ddol = CollectDontDestroyOnLoad(options, nodes, state);

            return new SuccessResponse("Live hierarchy listed.", new
            {
                target = options.Target,
                is_playing = Application.isPlaying,
                depth = options.MaxDepth,
                max_nodes = options.MaxNodes,
                include_components = options.IncludeComponents,
                include_inactive = options.IncludeInactive,
                include_dont_destroy_on_load = options.IncludeDontDestroyOnLoad,
                include_internal = options.IncludeInternal,
                filter_name = options.FilterName,
                filter_component = options.FilterComponent,
                scenes = sceneSummaries,
                dont_destroy_on_load = ddol,
                nodes,
                total_visited_nodes = state.TotalVisited,
                returned_nodes = nodes.Count,
                truncated = state.Truncated
            });
        }

        private static object HandleSceneAsset(ToolParams p, Options options)
        {
            if (Application.isPlaying)
            {
                return new ErrorResponse("scene_asset hierarchy inspection is only supported in Edit Mode.", new
                {
                    error_kind = "invalid_param",
                    reason = "scene_asset_requires_edit_mode",
                    target = TargetSceneAsset,
                    is_playing = true
                });
            }

            var assetPath = ResolveAssetPath(p, "scene");
            var invalid = ValidateAssetPath(assetPath, ".unity", TargetSceneAsset);
            if (invalid != null)
                return invalid;

            if (IsSceneLoaded(assetPath))
            {
                return new ErrorResponse("Scene asset is already loaded; use target=live or close it before static asset inspection.", new
                {
                    error_kind = "invalid_param",
                    reason = "scene_asset_already_loaded",
                    target = TargetSceneAsset,
                    asset_path = assetPath,
                    recommended_command = "unictl command hierarchy_tree -p target=live"
                });
            }

            var activeBefore = SceneManager.GetActiveScene();
            var sceneCountBefore = SceneManager.sceneCount;
            var loadedBefore = LoadedScenePaths();
            var nodes = new List<NodeInfo>();
            var state = new CollectionState();
            var opened = default(Scene);
            var closed = false;
            var activeRestored = false;

            try
            {
                opened = EditorSceneManager.OpenScene(assetPath, OpenSceneMode.Additive);
                foreach (var root in opened.GetRootGameObjects())
                    CollectNode(root, opened.name, opened.path, TargetSceneAsset, 0, root.name, options, nodes, state);
            }
            catch (Exception ex)
            {
                return new ErrorResponse($"Failed to inspect scene asset hierarchy: {ex.Message}", new
                {
                    error_kind = "invalid_param",
                    reason = "scene_asset_inspection_failed",
                    target = TargetSceneAsset,
                    asset_path = assetPath,
                    exception_type = ex.GetType().Name
                });
            }
            finally
            {
                if (opened.IsValid() && opened.isLoaded)
                    closed = EditorSceneManager.CloseScene(opened, true);
                activeRestored = IsActiveSceneEquivalent(activeBefore) ||
                    RestoreActiveScene(activeBefore) ||
                    IsActiveSceneEquivalent(activeBefore);
            }

            return new SuccessResponse("Scene asset hierarchy listed.", new
            {
                target = TargetSceneAsset,
                asset_path = assetPath,
                asset_type = "scene",
                loaded_temporarily = true,
                closed,
                active_scene_restored = activeRestored,
                scene_count_before = sceneCountBefore,
                scene_count_after = SceneManager.sceneCount,
                loaded_scenes_before = loadedBefore,
                depth = options.MaxDepth,
                max_nodes = options.MaxNodes,
                include_components = options.IncludeComponents,
                include_inactive = options.IncludeInactive,
                include_internal = options.IncludeInternal,
                filter_name = options.FilterName,
                filter_component = options.FilterComponent,
                nodes,
                total_visited_nodes = state.TotalVisited,
                returned_nodes = nodes.Count,
                truncated = state.Truncated
            });
        }

        private static object HandlePrefabAsset(ToolParams p, Options options)
        {
            if (Application.isPlaying)
            {
                return new ErrorResponse("prefab_asset hierarchy inspection is only supported in Edit Mode.", new
                {
                    error_kind = "invalid_param",
                    reason = "prefab_asset_requires_edit_mode",
                    target = TargetPrefabAsset,
                    is_playing = true
                });
            }

            var assetPath = ResolveAssetPath(p, "prefab");
            var invalid = ValidateAssetPath(assetPath, ".prefab", TargetPrefabAsset);
            if (invalid != null)
                return invalid;

            var nodes = new List<NodeInfo>();
            var state = new CollectionState();
            GameObject root = null;
            var unloaded = false;

            try
            {
                root = PrefabUtility.LoadPrefabContents(assetPath);
                if (root == null)
                {
                    return new ErrorResponse("Failed to load prefab asset contents.", new
                    {
                        error_kind = "invalid_param",
                        reason = "prefab_asset_load_failed",
                        target = TargetPrefabAsset,
                        asset_path = assetPath
                    });
                }

                CollectNode(root, root.scene.name, assetPath, TargetPrefabAsset, 0, root.name, options, nodes, state);
            }
            catch (Exception ex)
            {
                return new ErrorResponse($"Failed to inspect prefab asset hierarchy: {ex.Message}", new
                {
                    error_kind = "invalid_param",
                    reason = "prefab_asset_inspection_failed",
                    target = TargetPrefabAsset,
                    asset_path = assetPath,
                    exception_type = ex.GetType().Name
                });
            }
            finally
            {
                if (root != null)
                {
                    PrefabUtility.UnloadPrefabContents(root);
                    unloaded = true;
                }
            }

            return new SuccessResponse("Prefab asset hierarchy listed.", new
            {
                target = TargetPrefabAsset,
                asset_path = assetPath,
                asset_type = "prefab",
                loaded_temporarily = true,
                unloaded,
                depth = options.MaxDepth,
                max_nodes = options.MaxNodes,
                include_components = options.IncludeComponents,
                include_inactive = options.IncludeInactive,
                include_internal = options.IncludeInternal,
                filter_name = options.FilterName,
                filter_component = options.FilterComponent,
                nodes,
                total_visited_nodes = state.TotalVisited,
                returned_nodes = nodes.Count,
                truncated = state.Truncated
            });
        }

        private static void CollectLoadedScenes(
            Options options,
            List<NodeInfo> nodes,
            List<object> sceneSummaries,
            CollectionState state)
        {
            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.IsValid() || !scene.isLoaded)
                    continue;

                sceneSummaries.Add(new
                {
                    index = i,
                    name = scene.name,
                    path = scene.path,
                    hierarchy_source = "scene",
                    is_active = scene == SceneManager.GetActiveScene(),
                    is_loaded = scene.isLoaded,
                    root_count = scene.rootCount
                });

                foreach (var root in scene.GetRootGameObjects())
                    CollectNode(root, scene.name, scene.path, "scene", 0, root.name, options, nodes, state);
            }
        }

        private static object CollectDontDestroyOnLoad(
            Options options,
            List<NodeInfo> nodes,
            CollectionState state)
        {
            if (!options.IncludeDontDestroyOnLoad)
            {
                return new
                {
                    requested = false,
                    available = false,
                    probe_used = false,
                    root_count = 0
                };
            }

            if (!Application.isPlaying)
            {
                return new
                {
                    requested = true,
                    available = false,
                    reason = "not_playing",
                    probe_used = false,
                    root_count = 0
                };
            }

            GameObject probe = null;
            try
            {
                probe = new GameObject(ProbeName);
                Object.DontDestroyOnLoad(probe);
                var scene = probe.scene;
                var roots = scene.GetRootGameObjects()
                    .Where(root => root != probe && root.name != ProbeName)
                    .ToArray();

                foreach (var root in roots)
                    CollectNode(root, scene.name, scene.path, "dont_destroy_on_load", 0, root.name, options, nodes, state);

                return new
                {
                    requested = true,
                    available = true,
                    probe_used = true,
                    probe_excluded = true,
                    scene_name = scene.name,
                    scene_path = scene.path,
                    root_count = roots.Length
                };
            }
            finally
            {
                if (probe != null)
                    Object.DestroyImmediate(probe);
            }
        }

        private static void CollectNode(
            GameObject go,
            string sceneName,
            string scenePath,
            string hierarchySource,
            int depth,
            string path,
            Options options,
            List<NodeInfo> nodes,
            CollectionState state)
        {
            if (state.Truncated)
                return;

            state.TotalVisited++;

            var components = options.IncludeComponents || !string.IsNullOrEmpty(options.FilterComponent)
                ? ComponentNames(go)
                : Array.Empty<string>();

            var includeChildren = depth < options.MaxDepth;
            var isInternal = IsInternal(go);
            var matches = options.IncludeInactive || go.activeInHierarchy;
            matches = matches && (options.IncludeInternal || !isInternal);
            matches = matches && MatchesName(go.name, options.FilterName);
            matches = matches && MatchesComponent(components, options.FilterComponent);

            if (matches)
            {
                if (nodes.Count >= options.MaxNodes)
                {
                    state.Truncated = true;
                    return;
                }

                nodes.Add(new NodeInfo
                {
                    Scene = sceneName,
                    ScenePath = scenePath,
                    HierarchySource = hierarchySource,
                    Path = path,
                    Name = go.name,
                    Depth = depth,
                    ActiveSelf = go.activeSelf,
                    ActiveInHierarchy = go.activeInHierarchy,
                    ChildCount = go.transform.childCount,
                    IsInternal = isInternal,
                    Components = options.IncludeComponents ? components : null
                });
            }

            if (!includeChildren)
                return;

            for (var i = 0; i < go.transform.childCount; i++)
            {
                var child = go.transform.GetChild(i).gameObject;
                CollectNode(
                    child,
                    sceneName,
                    scenePath,
                    hierarchySource,
                    depth + 1,
                    $"{path}/{child.name}",
                    options,
                    nodes,
                    state);
                if (state.Truncated)
                    return;
            }
        }

        private static bool IsInternal(GameObject go)
        {
            if (go == null)
                return true;
            if (go.name.StartsWith("[", StringComparison.Ordinal) && go.name.EndsWith("]", StringComparison.Ordinal))
                return true;
            if (go.hideFlags != HideFlags.None)
                return true;
            return EditorUtility.IsPersistent(go.transform.root.gameObject);
        }

        private static bool MatchesName(string name, string pattern)
        {
            if (string.IsNullOrWhiteSpace(pattern))
                return true;
            return WildcardMatch(name ?? "", pattern);
        }

        private static bool MatchesComponent(string[] components, string pattern)
        {
            if (string.IsNullOrWhiteSpace(pattern))
                return true;
            return components.Any(component => WildcardMatch(component, pattern));
        }

        private static bool WildcardMatch(string value, string pattern)
        {
            if (string.IsNullOrEmpty(pattern))
                return true;

            var parts = pattern
                .Split(new[] { '*' }, StringSplitOptions.None)
                .Where(part => part.Length > 0)
                .ToArray();
            if (parts.Length == 0)
                return true;

            var comparison = StringComparison.OrdinalIgnoreCase;
            var index = 0;
            foreach (var part in parts)
            {
                var found = value.IndexOf(part, index, comparison);
                if (found < 0)
                    return false;
                index = found + part.Length;
            }

            if (!pattern.StartsWith("*", StringComparison.Ordinal) &&
                !value.StartsWith(parts[0], comparison))
                return false;
            if (!pattern.EndsWith("*", StringComparison.Ordinal) &&
                !value.EndsWith(parts[parts.Length - 1], comparison))
                return false;
            return true;
        }

        private static string[] ComponentNames(GameObject go)
        {
            return go.GetComponents<Component>()
                .Where(component => component != null)
                .Select(component => component.GetType().Name)
                .ToArray();
        }

        private static string ResolveTarget(ToolParams p)
        {
            var explicitTarget = p.Get("target");
            if (!string.IsNullOrWhiteSpace(explicitTarget))
                return explicitTarget;
            if (!string.IsNullOrWhiteSpace(p.Get("scene")))
                return TargetSceneAsset;
            if (!string.IsNullOrWhiteSpace(p.Get("prefab")))
                return TargetPrefabAsset;
            return TargetLive;
        }

        private static string ResolveAssetPath(ToolParams p, string alias)
        {
            var value = p.Get("asset");
            if (!string.IsNullOrWhiteSpace(value))
                return NormalizeAssetPath(value);
            return NormalizeAssetPath(p.Get(alias));
        }

        private static string NormalizeAssetPath(string path)
        {
            return string.IsNullOrWhiteSpace(path)
                ? path
                : path.Replace('\\', '/').Trim();
        }

        private static ErrorResponse ValidateAssetPath(string assetPath, string extension, string target)
        {
            if (string.IsNullOrWhiteSpace(assetPath))
            {
                return new ErrorResponse("Missing required parameter: asset", new
                {
                    error_kind = "invalid_param",
                    reason = "missing_asset_path",
                    target,
                    expected_extension = extension
                });
            }

            if (!assetPath.StartsWith("Assets/", StringComparison.Ordinal) &&
                !assetPath.StartsWith("Packages/", StringComparison.Ordinal))
            {
                return new ErrorResponse("asset must be a Unity project asset path under Assets/ or Packages/.", new
                {
                    error_kind = "invalid_param",
                    reason = "invalid_asset_path",
                    target,
                    asset_path = assetPath
                });
            }

            if (!assetPath.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
            {
                return new ErrorResponse($"asset must end with {extension} for target={target}.", new
                {
                    error_kind = "invalid_param",
                    reason = "invalid_asset_extension",
                    target,
                    asset_path = assetPath,
                    expected_extension = extension
                });
            }

            if (string.IsNullOrEmpty(AssetDatabase.AssetPathToGUID(assetPath)))
            {
                return new ErrorResponse($"Asset does not exist: {assetPath}", new
                {
                    error_kind = "invalid_param",
                    reason = "asset_not_found",
                    target,
                    asset_path = assetPath
                });
            }

            return null;
        }

        private static bool IsSceneLoaded(string assetPath)
        {
            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (scene.IsValid() && scene.isLoaded && scene.path == assetPath)
                    return true;
            }
            return false;
        }

        private static string[] LoadedScenePaths()
        {
            var paths = new List<string>();
            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (scene.IsValid() && scene.isLoaded)
                    paths.Add(scene.path);
            }
            return paths.ToArray();
        }

        private static bool RestoreActiveScene(Scene scene)
        {
            if (!scene.IsValid() || !scene.isLoaded)
                return false;
            return EditorSceneManager.SetActiveScene(scene);
        }

        private static bool IsActiveSceneEquivalent(Scene expected)
        {
            if (!expected.IsValid())
                return true;
            var active = SceneManager.GetActiveScene();
            return active.IsValid() &&
                active.path == expected.path &&
                active.name == expected.name;
        }

        private sealed class Options
        {
            public string Target;
            public int MaxDepth;
            public int MaxNodes;
            public bool IncludeComponents;
            public bool IncludeInactive;
            public bool IncludeDontDestroyOnLoad;
            public bool IncludeInternal;
            public string FilterName;
            public string FilterComponent;
        }

        private sealed class CollectionState
        {
            public int TotalVisited;
            public bool Truncated;
        }

        private sealed class NodeInfo
        {
            [Newtonsoft.Json.JsonProperty("scene")]
            public string Scene;
            [Newtonsoft.Json.JsonProperty("scene_path")]
            public string ScenePath;
            [Newtonsoft.Json.JsonProperty("hierarchy_source")]
            public string HierarchySource;
            [Newtonsoft.Json.JsonProperty("path")]
            public string Path;
            [Newtonsoft.Json.JsonProperty("name")]
            public string Name;
            [Newtonsoft.Json.JsonProperty("depth")]
            public int Depth;
            [Newtonsoft.Json.JsonProperty("active_self")]
            public bool ActiveSelf;
            [Newtonsoft.Json.JsonProperty("active_in_hierarchy")]
            public bool ActiveInHierarchy;
            [Newtonsoft.Json.JsonProperty("child_count")]
            public int ChildCount;
            [Newtonsoft.Json.JsonProperty("is_internal")]
            public bool IsInternal;
            [Newtonsoft.Json.JsonProperty("components", NullValueHandling = Newtonsoft.Json.NullValueHandling.Ignore)]
            public string[] Components;
        }
    }
}
