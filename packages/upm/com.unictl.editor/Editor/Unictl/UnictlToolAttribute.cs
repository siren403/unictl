using System;
using Newtonsoft.Json.Linq;

namespace Unictl
{
    [AttributeUsage(AttributeTargets.Class)]
    public class UnictlToolAttribute : Attribute
    {
        public string Name { get; set; }
        public string Description { get; set; } = "";
        public string Group { get; set; } = "";
    }

    [AttributeUsage(AttributeTargets.Property | AttributeTargets.Field)]
    public class ToolParameterAttribute : Attribute
    {
        public string Description { get; set; }
        public bool Required { get; set; } = false;
        public string DefaultValue { get; set; }
        /// <summary>쉼표로 구분된 허용 값 목록. 지정 시 schema에 enum 필드로 노출된다.</summary>
        public string Enum { get; set; }

        public ToolParameterAttribute(string description)
        {
            Description = description;
        }
    }

    public class SuccessResponse
    {
        public bool success = true;
        public string message;
        public object data;

        public SuccessResponse(string message, object data = null)
        {
            this.message = message;
            this.data = data;
        }
    }

    public class ErrorResponse
    {
        public bool success = false;
        public string message;
        public object data;

        public ErrorResponse(string message, object data = null)
        {
            this.message = message;
            this.data = data;
        }
    }

    public class ToolParams
    {
        private readonly JObject _params;

        public ToolParams(JObject parameters)
        {
            _params = parameters ?? new JObject();
        }

        public string Get(string key, string defaultValue = null)
        {
            var token = _params[key];
            return token != null ? token.ToString() : defaultValue;
        }

        public (bool ok, string value, string error) GetRequired(string key, string errorMessage = null)
        {
            var token = _params[key];
            if (token == null || string.IsNullOrEmpty(token.ToString()))
                return (false, null, errorMessage ?? $"Missing required parameter: {key}");
            return (true, token.ToString(), null);
        }

        public int? GetInt(string key, int? defaultValue = null)
        {
            var token = _params[key];
            if (token == null) return defaultValue;
            if (token.Type == JTokenType.Integer) return token.Value<int>();
            if (token.Type == JTokenType.String && int.TryParse(token.ToString(), out var parsed))
                return parsed;
            return defaultValue;
        }

        public float? GetFloat(string key, float? defaultValue = null)
        {
            var token = _params[key];
            if (token == null) return defaultValue;
            if (token.Type == JTokenType.Float || token.Type == JTokenType.Integer)
                return token.Value<float>();
            if (token.Type == JTokenType.String && float.TryParse(token.ToString(),
                System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed))
                return parsed;
            return defaultValue;
        }

        public bool GetBool(string key, bool defaultValue = false)
        {
            var token = _params[key];
            if (token == null) return defaultValue;
            if (token.Type == JTokenType.Boolean) return token.Value<bool>();
            var s = token.ToString().ToLowerInvariant();
            return s == "true" || s == "1" || s == "yes" || s == "on";
        }

        public JToken GetRaw(string key)
        {
            return _params[key];
        }
    }

    public static class StringCaseUtility
    {
        public static string ToSnakeCase(string input)
        {
            if (string.IsNullOrEmpty(input)) return input;
            var result = System.Text.RegularExpressions.Regex.Replace(input, "([a-z0-9])([A-Z])", "$1_$2");
            result = System.Text.RegularExpressions.Regex.Replace(result, "([A-Z]+)([A-Z][a-z])", "$1_$2");
            return result.ToLowerInvariant();
        }
    }
}
