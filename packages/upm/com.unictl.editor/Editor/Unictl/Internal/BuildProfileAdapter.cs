#if UNITY_6000_0_OR_NEWER
using UnityEditor.Build.Profile;
#endif
using UnityEditor;
using UnityEngine;
using System.IO;

namespace Unictl.Internal
{
    /// <summary>
    /// Unity 6+ BuildProfile feature probe and active-profile introspection.
    /// Gated by UNITY_6000_0_OR_NEWER (canonical macro; verified 2026-04-23).
    /// Ver-M / Ver-B / Ver-C in plan v4.3.
    /// </summary>
    public static class BuildProfileAdapter
    {
        public static bool Supported
        {
            get
            {
#if UNITY_6000_0_OR_NEWER
                return true;
#else
                return false;
#endif
            }
        }

        /// <summary>Returns the active BuildProfile asset path (relative to project), or null if none/unsupported.</summary>
        public static string GetActiveProfilePath()
        {
#if UNITY_6000_0_OR_NEWER
            try
            {
                var active = BuildProfile.GetActiveBuildProfile();
                if (active == null) return null;
                return AssetDatabase.GetAssetPath(active);
            }
            catch { return null; }
#else
            return null;
#endif
        }

        /// <summary>Verifies the asset at path is a valid BuildProfile asset.</summary>
        public static bool IsValidProfileAsset(string assetPath)
        {
#if UNITY_6000_0_OR_NEWER
            if (string.IsNullOrEmpty(assetPath)) return false;
            if (!assetPath.EndsWith(".asset")) return false;
            var loaded = AssetDatabase.LoadAssetAtPath<BuildProfile>(assetPath);
            return loaded != null;
#else
            return false;
#endif
        }
    }
}
