using System;
using System.Runtime.InteropServices;

namespace Unictl
{
    public static class UnictlNative
    {
        const string LIB = "unictl_native";

        [DllImport(LIB)] public static extern int unictl_ping();
        [DllImport(LIB)] public static extern int unictl_counter();
        [DllImport(LIB)] public static extern int unictl_start(string sockPath);
        [DllImport(LIB)] public static extern void unictl_register_handler(CommandHandlerDelegate handler);
        [DllImport(LIB)] public static extern void unictl_unregister_handler();
        [DllImport(LIB)] public static extern void unictl_respond(string requestId, string responseJson);
        [DllImport(LIB)] public static extern void unictl_set_internal_port(int port);

        // Rust-side main-thread queue (Domain Reload-safe)
        [DllImport(LIB)] public static extern IntPtr unictl_pop_main();
        [DllImport(LIB)] public static extern void unictl_free_string(IntPtr ptr);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        public delegate IntPtr CommandHandlerDelegate(IntPtr jsonRequest);
    }
}
