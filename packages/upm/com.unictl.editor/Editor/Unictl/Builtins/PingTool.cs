using Newtonsoft.Json.Linq;

namespace Unictl
{
    [UnictlTool(Name = "ping", Description = "Test tool for verifying unictl routing")]
    public static class PingTool
    {
        public static object HandleCommand(JObject parameters)
        {
            return new SuccessResponse("pong", new
            {
                unity_version = UnictlServer.UnityVersion,
                is_playing = UnictlServer.IsPlaying,
                platform = UnictlServer.Platform
            });
        }
    }
}
