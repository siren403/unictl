using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using Object = UnityEngine.Object;

namespace Unictl.Tools
{
    [UnictlTool(Name = "ugui_input", Description = "Inspect and simulate UGUI (UnityEngine.UI) interactions. Requires Play mode.")]
    public static class UguiInputTool
    {
        public class Parameters
        {
            [ToolParameter("Action: inspect, click, set_text, set_toggle, set_slider, set_dropdown, scroll, find", Required = true)]
            public string Action { get; set; }
        }

        public static object HandleCommand(JObject parameters)
        {
            var p = new ToolParams(parameters);
            var (ok, action, err) = p.GetRequired("action");
            if (!ok) return new ErrorResponse(err);

            if (!Application.isPlaying)
                return new ErrorResponse("UGUI input simulation requires Play mode.");

            if (EventSystem.current == null)
                return new ErrorResponse("No active EventSystem found in the scene.");

            switch (action)
            {
                case "inspect": return DoInspect(p);
                case "find": return DoFind(p);
                case "click": return DoClick(p);
                case "set_text": return DoSetText(p);
                case "set_toggle": return DoSetToggle(p);
                case "set_slider": return DoSetSlider(p);
                case "set_dropdown": return DoSetDropdown(p);
                case "scroll": return DoScroll(p);
                default:
                    return new ErrorResponse($"Unknown action: {action}");
            }
        }

        private static object DoInspect(ToolParams p)
        {
            var maxElements = p.GetInt("max_elements", 200).Value;
            var canvases = Object.FindObjectsByType<Canvas>()
                .Where(c => c.isRootCanvas)
                .ToArray();

            if (canvases.Length == 0)
                return new ErrorResponse("No active Canvas found.");

            var result = new List<object>();
            foreach (var canvas in canvases)
            {
                var elements = new List<object>();
                CollectSelectables(canvas.transform, elements, maxElements, 0);
                result.Add(new
                {
                    canvas = canvas.gameObject.name,
                    render_mode = canvas.renderMode.ToString(),
                    sort_order = canvas.sortingOrder,
                    elements
                });
            }

            return new SuccessResponse("UGUI inspect", new { canvases = result });
        }

        private static void CollectSelectables(Transform parent, List<object> elements, int max, int depth)
        {
            if (elements.Count >= max) return;

            var selectable = parent.GetComponent<Selectable>();
            if (selectable != null && selectable.gameObject.activeInHierarchy)
            {
                elements.Add(DescribeSelectable(selectable, depth));
            }

            for (int i = 0; i < parent.childCount; i++)
                CollectSelectables(parent.GetChild(i), elements, max, depth + 1);
        }

        private static object DescribeSelectable(Selectable selectable, int depth)
        {
            var go = selectable.gameObject;
            var rt = go.GetComponent<RectTransform>();

            var info = new Dictionary<string, object>
            {
                ["path"] = GetHierarchyPath(go),
                ["name"] = go.name,
                ["type"] = GetSelectableType(selectable),
                ["interactable"] = selectable.interactable,
                ["active"] = go.activeInHierarchy,
                ["depth"] = depth,
            };

            if (rt != null)
            {
                info["position"] = new { x = rt.position.x, y = rt.position.y };
                info["size"] = new { width = rt.rect.width, height = rt.rect.height };
            }

            var text = GetDisplayText(selectable);
            if (text != null)
                info["text"] = text;

            AddTypeSpecificInfo(selectable, info);

            return info;
        }

        private static object DoFind(ToolParams p)
        {
            var name = p.Get("name");
            var type = p.Get("type");
            var text = p.Get("text");
            var contains = p.GetBool("contains");

            if (name == null && type == null && text == null)
                return new ErrorResponse("Provide at least one filter: name, type, or text");

            var selectables = Object.FindObjectsByType<Selectable>()
                .Where(s => s.gameObject.activeInHierarchy);

            if (name != null)
                selectables = selectables.Where(s => MatchString(s.gameObject.name, name, contains));

            if (type != null)
                selectables = selectables.Where(s => MatchString(GetSelectableType(s), type, contains));

            if (text != null)
                selectables = selectables.Where(s =>
                {
                    var t = GetDisplayText(s);
                    return t != null && MatchString(t, text, contains);
                });

            var results = selectables.Select(s => DescribeSelectable(s, 0)).ToArray();

            return new SuccessResponse($"Found {results.Length} elements", new { elements = results });
        }

        private static object DoClick(ToolParams p)
        {
            var (found, selectable, error) = ResolveTarget(p);
            if (!found) return error;

            if (!selectable.interactable)
                return new ErrorResponse($"Element '{selectable.gameObject.name}' is not interactable.");

            var pointerData = new PointerEventData(EventSystem.current)
            {
                position = GetScreenPosition(selectable)
            };

            ExecuteEvents.Execute(selectable.gameObject, pointerData, ExecuteEvents.pointerEnterHandler);
            ExecuteEvents.Execute(selectable.gameObject, pointerData, ExecuteEvents.pointerDownHandler);
            ExecuteEvents.Execute(selectable.gameObject, pointerData, ExecuteEvents.pointerUpHandler);
            ExecuteEvents.Execute(selectable.gameObject, pointerData, ExecuteEvents.pointerClickHandler);

            return new SuccessResponse($"Clicked '{selectable.gameObject.name}'", new
            {
                path = GetHierarchyPath(selectable.gameObject),
                type = GetSelectableType(selectable)
            });
        }

        private static object DoSetText(ToolParams p)
        {
            var (found, selectable, error) = ResolveTarget(p);
            if (!found) return error;

            var (vok, value, verr) = p.GetRequired("value");
            if (!vok) return new ErrorResponse(verr);

            var inputField = selectable.GetComponent<InputField>();
            if (inputField != null)
            {
                inputField.text = value;
                inputField.onValueChanged?.Invoke(value);
                inputField.onEndEdit?.Invoke(value);
                return new SuccessResponse($"Set text on '{selectable.gameObject.name}'", new { text = value });
            }

            var tmpInput = selectable.GetComponent("TMP_InputField");
            if (tmpInput != null)
            {
                var textProp = tmpInput.GetType().GetProperty("text");
                if (textProp != null)
                {
                    textProp.SetValue(tmpInput, value);
                    return new SuccessResponse($"Set TMP text on '{selectable.gameObject.name}'", new { text = value });
                }
            }

            return new ErrorResponse($"'{selectable.gameObject.name}' has no InputField or TMP_InputField component.");
        }

        private static object DoSetToggle(ToolParams p)
        {
            var (found, selectable, error) = ResolveTarget(p);
            if (!found) return error;

            var toggle = selectable.GetComponent<Toggle>();
            if (toggle == null)
                return new ErrorResponse($"'{selectable.gameObject.name}' is not a Toggle.");

            var value = p.GetBool("value", !toggle.isOn);
            toggle.isOn = value;

            return new SuccessResponse($"Set toggle '{selectable.gameObject.name}' to {value}", new
            {
                is_on = toggle.isOn
            });
        }

        private static object DoSetSlider(ToolParams p)
        {
            var (found, selectable, error) = ResolveTarget(p);
            if (!found) return error;

            var slider = selectable.GetComponent<Slider>();
            if (slider == null)
                return new ErrorResponse($"'{selectable.gameObject.name}' is not a Slider.");

            var value = p.GetFloat("value");
            if (value == null)
                return new ErrorResponse("Missing required parameter: value");

            slider.value = Mathf.Clamp(value.Value, slider.minValue, slider.maxValue);

            return new SuccessResponse($"Set slider '{selectable.gameObject.name}' to {slider.value}", new
            {
                value = slider.value,
                min = slider.minValue,
                max = slider.maxValue
            });
        }

        private static object DoSetDropdown(ToolParams p)
        {
            var (found, selectable, error) = ResolveTarget(p);
            if (!found) return error;

            var dropdown = selectable.GetComponent<Dropdown>();
            if (dropdown != null)
            {
                var index = p.GetInt("value");
                if (index == null)
                    return new ErrorResponse("Missing required parameter: value (dropdown index)");

                if (index.Value < 0 || index.Value >= dropdown.options.Count)
                    return new ErrorResponse($"Index {index.Value} out of range (0-{dropdown.options.Count - 1})");

                dropdown.value = index.Value;
                return new SuccessResponse($"Set dropdown '{selectable.gameObject.name}' to index {index.Value}", new
                {
                    index = dropdown.value,
                    text = dropdown.options[dropdown.value].text,
                    options = dropdown.options.Select(o => o.text).ToArray()
                });
            }

            var tmpDropdown = selectable.GetComponent("TMP_Dropdown");
            if (tmpDropdown != null)
            {
                var valueProp = tmpDropdown.GetType().GetProperty("value");
                if (valueProp != null)
                {
                    var index = p.GetInt("value");
                    if (index == null)
                        return new ErrorResponse("Missing required parameter: value (dropdown index)");

                    valueProp.SetValue(tmpDropdown, index.Value);
                    return new SuccessResponse($"Set TMP dropdown '{selectable.gameObject.name}' to index {index.Value}");
                }
            }

            return new ErrorResponse($"'{selectable.gameObject.name}' is not a Dropdown.");
        }

        private static object DoScroll(ToolParams p)
        {
            var path = p.Get("path");
            var name = p.Get("name");
            var contains = p.GetBool("contains");
            var matchIndex = p.GetInt("match_index", 0).Value;

            ScrollRect scrollRect = null;

            if (path != null)
            {
                var go = GameObject.Find(path);
                if (go == null)
                    return new ErrorResponse($"GameObject not found at path: {path}");
                scrollRect = go.GetComponent<ScrollRect>();
            }
            else if (name != null)
            {
                var all = Object.FindObjectsByType<ScrollRect>()
                    .Where(s => s.gameObject.activeInHierarchy && MatchString(s.gameObject.name, name, contains))
                    .ToArray();
                if (matchIndex < all.Length)
                    scrollRect = all[matchIndex];
            }

            if (scrollRect == null)
                return new ErrorResponse("No matching ScrollRect found.");

            var x = p.GetFloat("x");
            var y = p.GetFloat("y");

            if (x != null) scrollRect.horizontalNormalizedPosition = Mathf.Clamp01(x.Value);
            if (y != null) scrollRect.verticalNormalizedPosition = Mathf.Clamp01(y.Value);

            return new SuccessResponse($"Scrolled '{scrollRect.gameObject.name}'", new
            {
                horizontal = scrollRect.horizontalNormalizedPosition,
                vertical = scrollRect.verticalNormalizedPosition
            });
        }

        private static (bool found, Selectable selectable, ErrorResponse error) ResolveTarget(ToolParams p)
        {
            var path = p.Get("path");
            var name = p.Get("name");
            var text = p.Get("text");
            var contains = p.GetBool("contains");
            var matchIndex = p.GetInt("match_index", 0).Value;

            if (path != null)
            {
                var go = GameObject.Find(path);
                if (go == null)
                    return (false, null, new ErrorResponse($"GameObject not found at path: {path}"));

                var sel = go.GetComponent<Selectable>();
                if (sel == null)
                    return (false, null, new ErrorResponse($"No Selectable component on '{path}'."));

                return (true, sel, null);
            }

            if (name == null && text == null)
                return (false, null, new ErrorResponse("Provide 'path', 'name', or 'text' to identify the target element."));

            var candidates = Object.FindObjectsByType<Selectable>()
                .Where(s => s.gameObject.activeInHierarchy);

            if (name != null)
                candidates = candidates.Where(s => MatchString(s.gameObject.name, name, contains));

            if (text != null)
                candidates = candidates.Where(s =>
                {
                    var t = GetDisplayText(s);
                    return t != null && MatchString(t, text, contains);
                });

            var arr = candidates.ToArray();
            if (arr.Length == 0)
                return (false, null, new ErrorResponse("No matching element found."));

            if (matchIndex >= arr.Length)
                return (false, null, new ErrorResponse($"match_index {matchIndex} out of range ({arr.Length} matches)."));

            return (true, arr[matchIndex], null);
        }

        private static string GetSelectableType(Selectable s)
        {
            if (s is Button) return "Button";
            if (s is Toggle) return "Toggle";
            if (s is Slider) return "Slider";
            if (s is Dropdown) return "Dropdown";
            if (s is InputField) return "InputField";
            if (s is Scrollbar) return "Scrollbar";

            var typeName = s.GetType().Name;
            if (typeName == "TMP_InputField") return "TMP_InputField";
            if (typeName == "TMP_Dropdown") return "TMP_Dropdown";

            return typeName;
        }

        private static string GetDisplayText(Selectable s)
        {
            var text = s.GetComponentInChildren<Text>(true);
            if (text != null) return text.text;

            var tmp = s.GetComponentInChildren(Type.GetType("TMPro.TMP_Text, Unity.TextMeshPro") ?? typeof(MonoBehaviour), true);
            if (tmp != null)
            {
                var textProp = tmp.GetType().GetProperty("text");
                if (textProp != null)
                    return textProp.GetValue(tmp) as string;
            }

            return null;
        }

        private static void AddTypeSpecificInfo(Selectable s, Dictionary<string, object> info)
        {
            if (s is Toggle toggle)
                info["is_on"] = toggle.isOn;
            else if (s is Slider slider)
            {
                info["value"] = slider.value;
                info["min"] = slider.minValue;
                info["max"] = slider.maxValue;
            }
            else if (s is Dropdown dropdown)
            {
                info["selected_index"] = dropdown.value;
                info["options"] = dropdown.options.Select(o => o.text).ToArray();
            }
            else if (s is InputField inputField)
                info["input_text"] = inputField.text;

            var scroll = s.GetComponent<ScrollRect>();
            if (scroll != null)
            {
                info["horizontal"] = scroll.horizontalNormalizedPosition;
                info["vertical"] = scroll.verticalNormalizedPosition;
            }
        }

        private static string GetHierarchyPath(GameObject go)
        {
            var path = go.name;
            var t = go.transform.parent;
            while (t != null)
            {
                path = t.name + "/" + path;
                t = t.parent;
            }
            return path;
        }

        private static Vector2 GetScreenPosition(Selectable s)
        {
            var rt = s.GetComponent<RectTransform>();
            if (rt == null) return Vector2.zero;

            var canvas = s.GetComponentInParent<Canvas>();
            if (canvas == null) return Vector2.zero;

            if (canvas.renderMode == RenderMode.ScreenSpaceOverlay)
            {
                return RectTransformUtility.WorldToScreenPoint(null, rt.position);
            }

            var cam = canvas.worldCamera ?? Camera.main;
            return RectTransformUtility.WorldToScreenPoint(cam, rt.position);
        }

        private static bool MatchString(string source, string target, bool contains)
        {
            if (contains)
                return source.IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0;
            return string.Equals(source, target, StringComparison.OrdinalIgnoreCase);
        }
    }
}
