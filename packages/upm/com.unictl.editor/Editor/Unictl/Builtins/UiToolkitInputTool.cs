using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Newtonsoft.Json.Linq;
using Unictl;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;
using Object = UnityEngine.Object;

[UnictlTool(Name = "ui_toolkit_input", Description = "Inspect and manipulate runtime UI Toolkit elements. Requires Play mode.")]
public static class UiToolkitInputTool
{
    public class Parameters
    {
        [ToolParameter("Action: inspect, inspect_render, click, set_value, or scroll", Required = true, Enum = "inspect,inspect_render,click,set_value,scroll")]
        public string Action { get; set; }

        [ToolParameter("Element path from inspect output, for example: 0/1/0", Required = false)]
        public string Path { get; set; }

        [ToolParameter("Element type filter, for example: Button, Label, TextField", Required = false)]
        public string Type { get; set; }

        [ToolParameter("Element name filter", Required = false)]
        public string Name { get; set; }

        [ToolParameter("Element text filter", Required = false)]
        public string Text { get; set; }

        [ToolParameter("USS class filter", Required = false)]
        public string Class { get; set; }

        [ToolParameter("Document GameObject name filter", Required = false)]
        public string DocumentName { get; set; }

        [ToolParameter("If true, selector fields use substring matching", Required = false)]
        public bool Contains { get; set; }

        [ToolParameter("Zero-based index to disambiguate multiple matches", Required = false)]
        public int MatchIndex { get; set; }

        [ToolParameter("Value used by set_value or absolute vertical offset used by scroll", Required = false)]
        public string Value { get; set; }

        [ToolParameter("Maximum elements returned by inspect (default: 200)", Required = false)]
        public int MaxElements { get; set; }

        [ToolParameter("Maximum subtree depth returned by inspect_render (default: 6)", Required = false)]
        public int MaxDepth { get; set; }
    }

    private sealed class ElementEntry
    {
        public string Path;
        public int Depth;
        public VisualElement Element;
    }

    private sealed class RenderEntry
    {
        public string Path;
        public int RelativeDepth;
        public VisualElement Element;
        public VisualElement Parent;
        public bool IsLastSibling;
    }

    public static object HandleCommand(JObject parameters)
    {
        var p = new ToolParams(parameters ?? new JObject());
        var (ok, actionVal, err) = p.GetRequired("action");
        if (!ok)
            return new ErrorResponse(err);

        var action = actionVal.Trim().ToLowerInvariant();
        if (action != "inspect" && !EditorApplication.isPlaying)
            return new ErrorResponse("Play mode required.");

        var documentResult = GetDocument(p.Get("document_name"));
        if (!documentResult.success)
            return documentResult.error;

        var document = documentResult.document;

        switch (action)
        {
            case "inspect":
                return Inspect(document, p);
            case "inspect_render":
                return InspectRender(document, p);
            case "click":
                return Click(document, p);
            case "set_value":
                return SetValue(document, p);
            case "scroll":
                return Scroll(document, p);
            default:
                return new ErrorResponse($"Unknown action: '{action}'. Valid actions: inspect, inspect_render, click, set_value, scroll.");
        }
    }

    private static object Inspect(UIDocument document, ToolParams p)
    {
        var root = document.rootVisualElement;
        var entries = Enumerate(root).ToList();
        var limit = Mathf.Max(1, p.GetInt("max_elements", 200) ?? 200);
        var hasSelector = HasSelector(p);
        var contains = p.GetBool("contains");
        var filteredEntries = hasSelector
            ? entries.Where(entry => Matches(entry.Element, p, contains)).ToList()
            : entries;

        return new SuccessResponse("UI Toolkit tree inspected.", new
        {
            document = new
            {
                game_object = document.gameObject.name,
                root_type = root.GetType().Name,
                element_count = entries.Count,
                matched_element_count = filteredEntries.Count,
                selector_applied = hasSelector
            },
            selector = hasSelector ? BuildSelectorEcho(p) : null,
            elements = filteredEntries
                .Take(limit)
                .Select(entry => DescribeElement(entry.Path, entry.Depth, entry.Element))
                .ToList(),
            truncated = filteredEntries.Count > limit
        });
    }

    private static object Click(UIDocument document, ToolParams p)
    {
        var selection = SelectElement(document, p, promoteToClickableAncestor: true);
        if (!selection.success)
            return selection.error;

        var entry = selection.entry;
        var element = entry.Element;

        if (element is Toggle toggle)
        {
            var previous = toggle.value;
            toggle.value = !toggle.value;
            EditorApplication.QueuePlayerLoopUpdate();
            return new SuccessResponse("Toggle clicked.", new
            {
                path = entry.Path,
                previous_value = previous,
                new_value = toggle.value,
                element = DescribeElement(entry.Path, entry.Depth, toggle)
            });
        }

        if (TryInvokeClickable(element))
        {
            EditorApplication.QueuePlayerLoopUpdate();
            return new SuccessResponse("Element clicked.", new
            {
                path = entry.Path,
                element = DescribeElement(entry.Path, entry.Depth, element)
            });
        }

        DispatchClickSequence(element);
        EditorApplication.QueuePlayerLoopUpdate();
        return new SuccessResponse(
            "Click event dispatched.",
            new
            {
                path = entry.Path,
                element = DescribeElement(entry.Path, entry.Depth, element)
            });
    }

    private static object InspectRender(UIDocument document, ToolParams p)
    {
        var selection = SelectElement(document, p, promoteToClickableAncestor: false);
        if (!selection.success)
            return selection.error;

        var maxDepth = Mathf.Max(0, p.GetInt("max_depth") ?? 6);
        var entries = new List<RenderEntry>();
        CollectRenderEntries(selection.entry.Element, selection.entry.Path, 0, maxDepth, null, entries);

        return new SuccessResponse("UI Toolkit render tree inspected.", new
        {
            document = new
            {
                game_object = document.gameObject.name,
                root_type = document.rootVisualElement.GetType().Name
            },
            selector = BuildSelectorEcho(p),
            subtree_root = DescribeRenderElement(entries[0]),
            node_count = entries.Count,
            nodes = entries.Select(DescribeRenderElement).ToList()
        });
    }

    private static object SetValue(UIDocument document, ToolParams p)
    {
        var rawValue = p.Get("value");
        if (rawValue == null)
            return new ErrorResponse("'value' parameter is required for set_value.");

        var selection = SelectElement(document, p, promoteToClickableAncestor: false);
        if (!selection.success)
            return selection.error;

        var entry = selection.entry;
        var element = entry.Element;
        var valueProperty = element.GetType().GetProperty("value");
        if (valueProperty == null || !valueProperty.CanRead || !valueProperty.CanWrite)
        {
            return new ErrorResponse(
                $"Element at '{entry.Path}' does not expose a writable 'value' property.",
                new
                {
                    element = DescribeElement(entry.Path, entry.Depth, element)
                });
        }

        try
        {
            var previousValue = valueProperty.GetValue(element);
            var coercedValue = CoerceValue(rawValue, valueProperty.PropertyType);
            valueProperty.SetValue(element, coercedValue);
            EditorApplication.QueuePlayerLoopUpdate();

            return new SuccessResponse("Element value updated.", new
            {
                path = entry.Path,
                previous_value = previousValue,
                new_value = valueProperty.GetValue(element),
                element = DescribeElement(entry.Path, entry.Depth, element)
            });
        }
        catch (Exception ex)
        {
            return new ErrorResponse(
                $"Failed to set value on '{entry.Path}': {ex.GetType().Name}: {ex.Message}",
                new
                {
                    element = DescribeElement(entry.Path, entry.Depth, element)
                });
        }
    }

    private static object Scroll(UIDocument document, ToolParams p)
    {
        var rawValue = p.Get("value");
        if (rawValue == null)
            return new ErrorResponse("'value' parameter is required for scroll.");

        var selection = SelectElement(document, p, promoteToClickableAncestor: false);
        if (!selection.success)
            return selection.error;

        if (selection.entry.Element is not ScrollView scrollView)
        {
            return new ErrorResponse(
                $"Element at '{selection.entry.Path}' is not a ScrollView.",
                new
                {
                    element = DescribeElement(selection.entry.Path, selection.entry.Depth, selection.entry.Element)
                });
        }

        try
        {
            var targetY = float.Parse(rawValue, NumberStyles.Float, CultureInfo.InvariantCulture);
            var previousOffset = scrollView.scrollOffset;
            scrollView.scrollOffset = new Vector2(previousOffset.x, Mathf.Max(0f, targetY));
            EditorApplication.QueuePlayerLoopUpdate();

            return new SuccessResponse("ScrollView offset updated.", new
            {
                path = selection.entry.Path,
                previous_offset = new { x = previousOffset.x, y = previousOffset.y },
                new_offset = new { x = scrollView.scrollOffset.x, y = scrollView.scrollOffset.y },
                element = DescribeElement(selection.entry.Path, selection.entry.Depth, scrollView)
            });
        }
        catch (Exception ex)
        {
            return new ErrorResponse(
                $"Failed to scroll '{selection.entry.Path}': {ex.GetType().Name}: {ex.Message}",
                new
                {
                    element = DescribeElement(selection.entry.Path, selection.entry.Depth, scrollView)
                });
        }
    }

    private static (bool success, UIDocument document, ErrorResponse error) GetDocument(string documentName)
    {
        var documents = Object.FindObjectsByType<UIDocument>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
        if (documents == null || documents.Length == 0)
            return (false, null, new ErrorResponse("No active UIDocument found."));

        if (string.IsNullOrWhiteSpace(documentName))
        {
            if (documents.Length == 1)
                return (true, documents[0], null);

            return (false, null, new ErrorResponse(
                "Multiple UIDocuments are active. Pass 'document_name' to disambiguate.",
                new
                {
                    documents = documents.Select(d => d.gameObject.name).ToArray()
                }));
        }

        var match = documents.FirstOrDefault(d => string.Equals(d.gameObject.name, documentName, StringComparison.Ordinal));
        if (match != null)
            return (true, match, null);

        match = documents.FirstOrDefault(d => d.gameObject.name.IndexOf(documentName, StringComparison.OrdinalIgnoreCase) >= 0);
        if (match != null)
            return (true, match, null);

        return (false, null, new ErrorResponse(
            $"No UIDocument matched document_name '{documentName}'.",
            new
            {
                documents = documents.Select(d => d.gameObject.name).ToArray()
            }));
    }

    private static (bool success, ElementEntry entry, ErrorResponse error) SelectElement(
        UIDocument document,
        ToolParams p,
        bool promoteToClickableAncestor)
    {
        var root = document.rootVisualElement;
        var entries = Enumerate(root).ToList();
        var requestedPath = NormalizePath(p.Get("path"));

        if (!string.IsNullOrEmpty(requestedPath))
        {
            var direct = entries.FirstOrDefault(entry => entry.Path == requestedPath);
            if (direct == null)
                return (false, null, new ErrorResponse($"No element found at path '{requestedPath}'."));

            if (promoteToClickableAncestor)
                direct = PromoteToClickableAncestor(direct, entries) ?? direct;

            return (true, direct, null);
        }

        if (!HasSelector(p))
        {
            return (false, null, new ErrorResponse(
                "Provide either 'path' or at least one selector field: type, name, text, class."));
        }

        var contains = p.GetBool("contains");
        var matches = entries.Where(entry => Matches(entry.Element, p, contains)).ToList();

        if (promoteToClickableAncestor)
        {
            var promoted = new List<ElementEntry>();
            var seen = new HashSet<VisualElement>();

            foreach (var match in matches)
            {
                // OneJS often wires click handlers onto plain VisualElements without exposing a
                // public `clickable` property. Keep the original element as a fallback so we can
                // still dispatch pointer/mouse events directly.
                var actionable = PromoteToClickableAncestor(match, entries) ?? match;

                if (seen.Add(actionable.Element))
                    promoted.Add(actionable);
            }

            matches = promoted;
        }

        if (matches.Count == 0)
        {
            return (false, null, new ErrorResponse(
                "No UI Toolkit element matched the selector.",
                new
                {
                    selector = BuildSelectorEcho(p)
                }));
        }

        var requestedIndex = p.GetInt("match_index");
        if (requestedIndex.HasValue)
        {
            if (requestedIndex.Value < 0 || requestedIndex.Value >= matches.Count)
            {
                return (false, null, new ErrorResponse(
                    $"match_index {requestedIndex.Value} is out of range for {matches.Count} matches."));
            }

            return (true, matches[requestedIndex.Value], null);
        }

        if (matches.Count > 1)
        {
            return (false, null, new ErrorResponse(
                $"Selector matched {matches.Count} elements. Add 'match_index' or use 'path' to disambiguate.",
                new
                {
                    matches = matches.Take(10).Select(entry => DescribeElement(entry.Path, entry.Depth, entry.Element)).ToList()
                }));
        }

        return (true, matches[0], null);
    }

    private static bool HasSelector(ToolParams p)
    {
        return
            !string.IsNullOrWhiteSpace(p.Get("type")) ||
            !string.IsNullOrWhiteSpace(p.Get("name")) ||
            !string.IsNullOrWhiteSpace(p.Get("text")) ||
            !string.IsNullOrWhiteSpace(p.Get("class"));
    }

    private static ElementEntry PromoteToClickableAncestor(ElementEntry entry, IReadOnlyList<ElementEntry> allEntries)
    {
        for (var current = entry.Element; current != null; current = current.parent)
        {
            if (!IsClickable(current))
                continue;

            var promoted = allEntries.FirstOrDefault(candidate => ReferenceEquals(candidate.Element, current));
            if (promoted != null)
                return promoted;
        }

        return null;
    }

    private static bool Matches(VisualElement element, ToolParams p, bool contains)
    {
        if (!MatchesString(element.GetType().Name, p.Get("type"), contains))
            return false;

        if (!MatchesString(element.name, p.Get("name"), contains))
            return false;

        if (!MatchesString(GetElementText(element), p.Get("text"), contains))
            return false;

        var classFilter = p.Get("class");
        if (!string.IsNullOrWhiteSpace(classFilter))
        {
            var classes = element.GetClasses().ToArray();
            var classMatch = contains
                ? classes.Any(cssClass => cssClass.IndexOf(classFilter, StringComparison.OrdinalIgnoreCase) >= 0)
                : classes.Any(cssClass => string.Equals(cssClass, classFilter, StringComparison.Ordinal));

            if (!classMatch)
                return false;
        }

        return true;
    }

    private static bool MatchesString(string actual, string expected, bool contains)
    {
        if (string.IsNullOrWhiteSpace(expected))
            return true;

        actual ??= string.Empty;
        return contains
            ? actual.IndexOf(expected, StringComparison.OrdinalIgnoreCase) >= 0
            : string.Equals(actual, expected, StringComparison.Ordinal);
    }

    private static bool IsClickable(VisualElement element)
    {
        return element is Toggle || GetClickable(element) != null;
    }

    private static bool TryInvokeClickable(VisualElement element)
    {
        DispatchClickSequence(element);
        return true;
    }

    private static void DispatchClickSequence(VisualElement element)
    {
        var center = element.worldBound.center;

        var mouseDown = new Event
        {
            type = EventType.MouseDown,
            button = 0,
            clickCount = 1,
            mousePosition = center
        };

        var mouseUp = new Event
        {
            type = EventType.MouseUp,
            button = 0,
            clickCount = 1,
            mousePosition = center
        };

        var pointerDownEvent = PointerDownEvent.GetPooled(mouseDown);
        var mouseDownEvent = MouseDownEvent.GetPooled(mouseDown);
        var pointerUpEvent = PointerUpEvent.GetPooled(mouseUp);
        var mouseUpEvent = MouseUpEvent.GetPooled(mouseUp);

        try
        {
            element.SendEvent(pointerDownEvent);
            element.SendEvent(mouseDownEvent);
            element.SendEvent(pointerUpEvent);
            element.SendEvent(mouseUpEvent);
        }
        finally
        {
            pointerDownEvent.Dispose();
            mouseDownEvent.Dispose();
            pointerUpEvent.Dispose();
            mouseUpEvent.Dispose();
        }
    }

    private static Clickable GetClickable(VisualElement element)
    {
        switch (element)
        {
            case Button button:
                return button.clickable;
        }

        var property = element.GetType().GetProperty("clickable");
        return property?.GetValue(element) as Clickable;
    }

    private static object CoerceValue(string rawValue, Type targetType)
    {
        if (targetType == typeof(string))
            return rawValue;

        if (targetType == typeof(bool))
        {
            if (bool.TryParse(rawValue, out var boolValue))
                return boolValue;

            if (rawValue == "0") return false;
            if (rawValue == "1") return true;
            throw new FormatException($"'{rawValue}' is not a valid bool.");
        }

        if (targetType == typeof(int))
            return int.Parse(rawValue, NumberStyles.Integer, CultureInfo.InvariantCulture);

        if (targetType == typeof(float))
            return float.Parse(rawValue, NumberStyles.Float, CultureInfo.InvariantCulture);

        if (targetType == typeof(double))
            return double.Parse(rawValue, NumberStyles.Float, CultureInfo.InvariantCulture);

        if (targetType.IsEnum)
            return Enum.Parse(targetType, rawValue, ignoreCase: true);

        throw new NotSupportedException($"Unsupported value type: {targetType.Name}.");
    }

    private static IEnumerable<ElementEntry> Enumerate(VisualElement root)
    {
        var stack = new Stack<(VisualElement element, string path, int depth)>();
        stack.Push((root, "root", 0));

        while (stack.Count > 0)
        {
            var current = stack.Pop();
            yield return new ElementEntry
            {
                Element = current.element,
                Path = current.path,
                Depth = current.depth
            };

            for (var i = current.element.childCount - 1; i >= 0; i--)
            {
                var child = current.element[i];
                var childPath = current.path == "root"
                    ? i.ToString()
                    : $"{current.path}/{i}";
                stack.Push((child, childPath, current.depth + 1));
            }
        }
    }

    private static void CollectRenderEntries(
        VisualElement element,
        string path,
        int relativeDepth,
        int maxDepth,
        VisualElement parent,
        List<RenderEntry> entries,
        bool isLastSibling = true)
    {
        entries.Add(new RenderEntry
        {
            Path = path,
            RelativeDepth = relativeDepth,
            Element = element,
            Parent = parent,
            IsLastSibling = isLastSibling
        });

        if (relativeDepth >= maxDepth)
            return;

        for (var index = 0; index < element.childCount; index += 1)
        {
            var child = element[index];
            var childPath = path == "root"
                ? index.ToString()
                : $"{path}/{index}";
            CollectRenderEntries(
                child,
                childPath,
                relativeDepth + 1,
                maxDepth,
                element,
                entries,
                isLastSibling: index == element.childCount - 1);
        }
    }

    private static string NormalizePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return null;

        path = path.Trim();
        return string.Equals(path, "/", StringComparison.Ordinal) ? "root" : path;
    }

    private static object DescribeElement(string path, int depth, VisualElement element)
    {
        var valueProperty = element.GetType().GetProperty("value");
        var value = valueProperty != null && valueProperty.CanRead
            ? valueProperty.GetValue(element)
            : null;

        return new
        {
            path,
            depth,
            type = element.GetType().Name,
            name = element.name,
            text = GetElementText(element),
            value,
            classes = element.GetClasses().ToArray(),
            child_count = element.childCount,
            enabled = element.enabledInHierarchy,
            picking_mode = element.pickingMode.ToString(),
            world_bound = new
            {
                x = element.worldBound.x,
                y = element.worldBound.y,
                width = element.worldBound.width,
                height = element.worldBound.height
            }
        };
    }

    private static object DescribeRenderElement(RenderEntry entry)
    {
        var element = entry.Element;
        var parent = entry.Parent;
        var valueProperty = element.GetType().GetProperty("value");
        var value = valueProperty != null && valueProperty.CanRead
            ? valueProperty.GetValue(element)
            : null;
        var worldBound = element.worldBound;
        var layout = element.layout;
        var contentRect = element.contentRect;

        return new
        {
            path = entry.Path,
            depth = entry.RelativeDepth,
            type = element.GetType().Name,
            name = element.name,
            text = GetElementText(element),
            value,
            classes = element.GetClasses().ToArray(),
            child_count = element.childCount,
            enabled = element.enabledInHierarchy,
            picking_mode = element.pickingMode.ToString(),
            layout = DescribeRect(layout),
            world_bound = DescribeRect(worldBound),
            content_rect = DescribeRect(contentRect),
            center_offset_from_parent = parent == null
                ? null
                : new
                {
                    x = worldBound.center.x - parent.worldBound.center.x,
                    y = worldBound.center.y - parent.worldBound.center.y
                },
            resolved_style = new
            {
                display = element.resolvedStyle.display.ToString(),
                opacity = element.resolvedStyle.opacity,
                width = element.resolvedStyle.width,
                height = element.resolvedStyle.height,
                left = element.resolvedStyle.left.ToString(),
                top = element.resolvedStyle.top.ToString(),
                right = element.resolvedStyle.right.ToString(),
                bottom = element.resolvedStyle.bottom.ToString(),
                position = element.resolvedStyle.position.ToString(),
                border_left_width = element.resolvedStyle.borderLeftWidth,
                border_right_width = element.resolvedStyle.borderRightWidth,
                border_top_width = element.resolvedStyle.borderTopWidth,
                border_bottom_width = element.resolvedStyle.borderBottomWidth,
                border_left_color = DescribeColor(element.resolvedStyle.borderLeftColor),
                border_right_color = DescribeColor(element.resolvedStyle.borderRightColor),
                border_top_color = DescribeColor(element.resolvedStyle.borderTopColor),
                border_bottom_color = DescribeColor(element.resolvedStyle.borderBottomColor),
                translate = element.resolvedStyle.translate.ToString(),
                rotate = element.resolvedStyle.rotate.ToString(),
                scale = element.resolvedStyle.scale.ToString(),
                transform_origin = element.resolvedStyle.transformOrigin.ToString()
            },
            derived_geometry = DescribeDerivedGeometry(element, parent)
        };
    }

    private static object DescribeRect(Rect rect)
    {
        return new
        {
            x = rect.x,
            y = rect.y,
            width = rect.width,
            height = rect.height
        };
    }

    private static object DescribeColor(Color color)
    {
        return new
        {
            r = color.r,
            g = color.g,
            b = color.b,
            a = color.a
        };
    }

    private static object DescribeDerivedGeometry(VisualElement element, VisualElement parent)
    {
        if (string.Equals(element.GetType().Name, "PuzzleWarningMarkerElement", StringComparison.Ordinal))
        {
            var rect = element.contentRect;
            if (rect.width > 0.01f && rect.height > 0.01f)
            {
                var geometry = ComputeProceduralWarningGeometry(rect);
                var outerLeft = Vector2.Distance(geometry.outerApex, geometry.outerBaseLeft);
                var outerRight = Vector2.Distance(geometry.outerApex, geometry.outerBaseRight);
                var outerBase = Vector2.Distance(geometry.outerBaseLeft, geometry.outerBaseRight);

                return new
                {
                    shape = "procedural_triangle_warning",
                    orientation = "up",
                    vertices = new
                    {
                        apex = new { x = geometry.outerApex.x, y = geometry.outerApex.y },
                        base_left = new { x = geometry.outerBaseLeft.x, y = geometry.outerBaseLeft.y },
                        base_right = new { x = geometry.outerBaseRight.x, y = geometry.outerBaseRight.y }
                    },
                    edge_lengths = new
                    {
                        left = outerLeft,
                        right = outerRight,
                        @base = outerBase
                    },
                    distances_to_self = new
                    {
                        apex_to_top = geometry.outerApex.y - rect.yMin,
                        base_to_bottom = rect.yMax - geometry.outerBaseLeft.y,
                        base_left_to_left = geometry.outerBaseLeft.x - rect.xMin,
                        base_right_to_right = rect.xMax - geometry.outerBaseRight.x
                    }
                };
            }
        }

        if (string.Equals(element.GetType().Name, "PuzzleHiddenLoopMarkerElement", StringComparison.Ordinal))
        {
            var rect = element.contentRect;
            if (rect.width > 0.01f && rect.height > 0.01f)
            {
                var phaseProperty = element.GetType().GetProperty("Phase");
                var phase = phaseProperty != null ? Convert.ToSingle(phaseProperty.GetValue(element)) : 0f;
                var size = Mathf.Min(rect.width, rect.height);
                var pulse = 0.5f + (Mathf.Sin(phase * Mathf.PI * 2f) * 0.5f);
                var glowRadius = size * 0.40f;
                var coreRadius = size * 0.11f;
                var bodyScale = Mathf.Lerp(0.74f, 1.06f, pulse);

                return new
                {
                    shape = "procedural_hidden_marker",
                    phase,
                    pulse,
                    body_scale = bodyScale,
                    glow_radius = glowRadius,
                    core_radius = coreRadius,
                    center = new
                    {
                        x = rect.center.x,
                        y = rect.center.y
                    }
                };
            }
        }

        var borderLeft = element.resolvedStyle.borderLeftWidth;
        var borderRight = element.resolvedStyle.borderRightWidth;
        var borderTop = element.resolvedStyle.borderTopWidth;
        var borderBottom = element.resolvedStyle.borderBottomWidth;

        if (borderBottom > 0.01f && borderLeft > 0.01f && borderRight > 0.01f && borderTop <= 0.01f)
        {
            var bounds = element.worldBound;
            var apex = new Vector2(bounds.x + borderLeft, bounds.y);
            var baseLeft = new Vector2(bounds.x, bounds.y + borderBottom);
            var baseRight = new Vector2(bounds.x + borderLeft + borderRight, bounds.y + borderBottom);

            return new
            {
                shape = "border_triangle",
                orientation = "up",
                vertices = new
                {
                    apex = new { x = apex.x, y = apex.y },
                    base_left = new { x = baseLeft.x, y = baseLeft.y },
                    base_right = new { x = baseRight.x, y = baseRight.y }
                },
                edge_lengths = new
                {
                    left = Vector2.Distance(apex, baseLeft),
                    right = Vector2.Distance(apex, baseRight),
                    @base = Vector2.Distance(baseLeft, baseRight)
                },
                distances_to_parent = parent == null
                    ? null
                    : new
                    {
                        apex_to_top = apex.y - parent.worldBound.yMin,
                        base_to_bottom = parent.worldBound.yMax - baseLeft.y,
                        base_left_to_left = baseLeft.x - parent.worldBound.xMin,
                        base_right_to_right = parent.worldBound.xMax - baseRight.x
                    }
            };
        }

        return null;
    }

    private static (Vector2 outerApex, Vector2 outerBaseLeft, Vector2 outerBaseRight) ComputeProceduralWarningGeometry(Rect rect)
    {
        const float outerHorizontalInsetRatio = 0.0625f;
        var width = rect.width;
        var centerX = rect.center.x;
        var centerY = rect.center.y;
        var outerHorizontalInset = width * outerHorizontalInsetRatio;
        var outerSide = Mathf.Max(0f, width - (outerHorizontalInset * 2f));
        var outerHeight = outerSide * Mathf.Sqrt(3f) * 0.5f;

        var outerApex = new Vector2(centerX, centerY - outerHeight * 0.5f);
        var outerBaseLeft = new Vector2(centerX - outerSide * 0.5f, centerY + outerHeight * 0.5f);
        var outerBaseRight = new Vector2(centerX + outerSide * 0.5f, centerY + outerHeight * 0.5f);
        return (outerApex, outerBaseLeft, outerBaseRight);
    }

    private static string GetElementText(VisualElement element)
    {
        if (element is TextElement textElement)
            return textElement.text;

        var textProperty = element.GetType().GetProperty("text");
        if (textProperty?.PropertyType == typeof(string))
            return textProperty.GetValue(element) as string;

        return null;
    }

    private static object BuildSelectorEcho(ToolParams p)
    {
        return new
        {
            path = p.Get("path"),
            type = p.Get("type"),
            name = p.Get("name"),
            text = p.Get("text"),
            @class = p.Get("class"),
            contains = p.GetBool("contains")
        };
    }
}
