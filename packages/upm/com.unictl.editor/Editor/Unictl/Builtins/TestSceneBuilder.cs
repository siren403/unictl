using System;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Unictl.Tools
{
    public static class TestSceneBuilder
    {
        [MenuItem("Unictl/Create UGUI Test Scene")]
        public static void CreateTestScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

            var canvasGo = new GameObject("TestCanvas");
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvasGo.AddComponent<CanvasScaler>();
            canvasGo.AddComponent<GraphicRaycaster>();

            var esGo = new GameObject("EventSystem");
            esGo.AddComponent<EventSystem>();
            AddInputModule(esGo);

            CreateButton(canvasGo.transform, "TestButton", "Click Me", new Vector2(0, 200));
            CreateToggle(canvasGo.transform, "TestToggle", "Toggle Option", new Vector2(0, 120));
            CreateSlider(canvasGo.transform, "TestSlider", 0, 100, 50, new Vector2(0, 40));
            CreateInputField(canvasGo.transform, "TestInputField", "Enter text...", new Vector2(0, -40));
            CreateDropdown(canvasGo.transform, "TestDropdown", new[] { "Option A", "Option B", "Option C" }, new Vector2(0, -120));
            CreateScrollRect(canvasGo.transform, "TestScrollView", new Vector2(0, -220));

            var scenePath = "Assets/Scenes/UguiTestScene.unity";
            EditorSceneManager.SaveScene(scene, scenePath);
            AssetDatabase.Refresh();
            Debug.Log($"[unictl] Created UGUI test scene at {scenePath}");
        }

        private static void AddInputModule(GameObject esGo)
        {
            var inputSystemType = AppDomain.CurrentDomain.GetAssemblies()
                .SelectMany(a => { try { return a.GetTypes(); } catch { return Type.EmptyTypes; } })
                .FirstOrDefault(t => t.FullName == "UnityEngine.InputSystem.UI.InputSystemUIInputModule");

            if (inputSystemType != null)
                esGo.AddComponent(inputSystemType);
            else
                esGo.AddComponent<StandaloneInputModule>();
        }

        private static Font GetDefaultFont()
        {
            return Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        }

        private static Text AddText(Transform parent, string name, string content)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var text = go.AddComponent<Text>();
            text.text = content;
            text.font = GetDefaultFont();
            text.color = Color.black;
            text.alignment = TextAnchor.MiddleCenter;
            var rt = text.rectTransform;
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.sizeDelta = Vector2.zero;
            return text;
        }

        private static RectTransform CreateBase(Transform parent, string name, Vector2 position, Vector2? size = null)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchoredPosition = position;
            rt.sizeDelta = size ?? new Vector2(300, 40);
            return rt;
        }

        private static void CreateButton(Transform parent, string name, string label, Vector2 pos)
        {
            var rt = CreateBase(parent, name, pos);
            rt.gameObject.AddComponent<Image>().color = new Color(0.85f, 0.85f, 0.85f);
            rt.gameObject.AddComponent<Button>();
            AddText(rt.transform, "Text", label);
        }

        private static void CreateToggle(Transform parent, string name, string label, Vector2 pos)
        {
            var rt = CreateBase(parent, name, pos);
            rt.gameObject.AddComponent<Toggle>();
            AddText(rt.transform, "Label", label).rectTransform.anchoredPosition = new Vector2(40, 0);
        }

        private static void CreateSlider(Transform parent, string name, float min, float max, float value, Vector2 pos)
        {
            var rt = CreateBase(parent, name, pos);
            var slider = rt.gameObject.AddComponent<Slider>();
            slider.minValue = min;
            slider.maxValue = max;
            slider.value = value;

            var bg = new GameObject("Background");
            bg.transform.SetParent(rt.transform, false);
            bg.AddComponent<Image>().color = Color.gray;
            var bgRt = bg.GetComponent<RectTransform>();
            bgRt.anchorMin = Vector2.zero;
            bgRt.anchorMax = Vector2.one;
            bgRt.sizeDelta = Vector2.zero;

            var fillArea = new GameObject("Fill Area");
            fillArea.AddComponent<RectTransform>();
            fillArea.transform.SetParent(rt.transform, false);
            var fill = new GameObject("Fill");
            fill.transform.SetParent(fillArea.transform, false);
            fill.AddComponent<Image>().color = Color.green;
            slider.fillRect = fill.GetComponent<RectTransform>();
        }

        private static void CreateInputField(Transform parent, string name, string placeholder, Vector2 pos)
        {
            var rt = CreateBase(parent, name, pos);
            rt.gameObject.AddComponent<Image>().color = new Color(0.95f, 0.95f, 0.95f);
            var field = rt.gameObject.AddComponent<InputField>();
            field.textComponent = AddText(rt.transform, "Text", "");
            var ph = AddText(rt.transform, "Placeholder", placeholder);
            ph.color = Color.gray;
            field.placeholder = ph;
        }

        private static void CreateDropdown(Transform parent, string name, string[] options, Vector2 pos)
        {
            var rt = CreateBase(parent, name, pos);
            rt.gameObject.AddComponent<Image>().color = Color.white;
            var dropdown = rt.gameObject.AddComponent<Dropdown>();
            dropdown.captionText = AddText(rt.transform, "Label", "");
            dropdown.options.Clear();
            foreach (var opt in options)
                dropdown.options.Add(new Dropdown.OptionData(opt));
            dropdown.RefreshShownValue();
        }

        private static void CreateScrollRect(Transform parent, string name, Vector2 pos)
        {
            var rt = CreateBase(parent, name, pos, new Vector2(300, 100));
            rt.gameObject.AddComponent<Image>().color = new Color(0.8f, 0.8f, 0.8f);
            var scrollRect = rt.gameObject.AddComponent<ScrollRect>();

            var content = new GameObject("Content");
            content.transform.SetParent(rt.transform, false);
            var contentRt = content.AddComponent<RectTransform>();
            contentRt.anchorMin = new Vector2(0, 1);
            contentRt.anchorMax = new Vector2(1, 1);
            contentRt.pivot = new Vector2(0.5f, 1);
            contentRt.sizeDelta = new Vector2(0, 500);
            scrollRect.content = contentRt;
        }
    }
}
