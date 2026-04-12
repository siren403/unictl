using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Unictl
{
    public static class ToolRouter
    {
        /// <summary>
        /// 명령을 실행한다. null 반환 = 도구가 비동기로 직접 응답할 예정.
        /// </summary>
        public static string Execute(string command, JObject parameters)
        {
            if (command == "list")
                return JsonConvert.SerializeObject(GetToolSchemas());

            var handler = FindHandler(command);
            if (handler == null)
                return JsonConvert.SerializeObject(new ErrorResponse($"Unknown command: {command}"));

            try
            {
                var result = handler.Invoke(null, new object[] { parameters ?? new JObject() });
                return JsonConvert.SerializeObject(result);
            }
            catch (TargetInvocationException e)
            {
                var inner = e.InnerException ?? e;
                return JsonConvert.SerializeObject(new ErrorResponse($"{command} failed: {inner.Message}"));
            }
            catch (Exception e)
            {
                return JsonConvert.SerializeObject(new ErrorResponse($"{command} failed: {e.Message}"));
            }
        }

        private static MethodInfo FindHandler(string command)
        {
            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    foreach (var type in assembly.GetTypes())
                    {
                        var attr = type.GetCustomAttribute<UnictlToolAttribute>();
                        if (attr == null) continue;

                        var name = !string.IsNullOrEmpty(attr.Name)
                            ? attr.Name
                            : StringCaseUtility.ToSnakeCase(type.Name);

                        if (name == command)
                        {
                            var method = type.GetMethod("HandleCommand",
                                BindingFlags.Public | BindingFlags.Static,
                                null, new[] { typeof(JObject) }, null);
                            return method;
                        }
                    }
                }
                catch
                {
                    // 어셈블리 스캔 실패 무시 (동적 어셈블리 등)
                }
            }

            return null;
        }

        public static List<object> GetToolSchemas()
        {
            var tools = new List<object>();

            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    foreach (var type in assembly.GetTypes())
                    {
                        var attr = type.GetCustomAttribute<UnictlToolAttribute>();
                        if (attr == null) continue;

                        var name = !string.IsNullOrEmpty(attr.Name)
                            ? attr.Name
                            : StringCaseUtility.ToSnakeCase(type.Name);

                        var parameters = GetParameterSchema(type);

                        tools.Add(new
                        {
                            name,
                            description = attr.Description ?? "",
                            group = attr.Group ?? "",
                            parameters
                        });
                    }
                }
                catch
                {
                    // 어셈블리 스캔 실패 무시
                }
            }

            return tools;
        }

        private static List<object> GetParameterSchema(Type toolType)
        {
            var paramsType = toolType.GetNestedType("Parameters");
            if (paramsType == null) return new List<object>();

            var schema = new List<object>();
            foreach (var prop in paramsType.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                var attr = prop.GetCustomAttribute<ToolParameterAttribute>();
                if (attr == null) continue;

                schema.Add(new
                {
                    name = StringCaseUtility.ToSnakeCase(prop.Name),
                    description = attr.Description ?? "",
                    required = attr.Required,
                    @default = attr.DefaultValue
                });
            }

            foreach (var field in paramsType.GetFields(BindingFlags.Public | BindingFlags.Instance))
            {
                var attr = field.GetCustomAttribute<ToolParameterAttribute>();
                if (attr == null) continue;

                schema.Add(new
                {
                    name = StringCaseUtility.ToSnakeCase(field.Name),
                    description = attr.Description ?? "",
                    required = attr.Required,
                    @default = attr.DefaultValue
                });
            }

            return schema;
        }
    }
}
