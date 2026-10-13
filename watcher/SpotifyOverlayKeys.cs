// Spotify Overlay key listener: catches the overlay hotkey even inside games like League of Legends, which tell
// Windows to stop delivering normal hotkeys (RegisterHotKey / Electron globalShortcut) while the game has focus.
// A low-level keyboard hook still sees the key. It never blocks or changes a keystroke - the game gets every key as
// usual - and the hook does nothing but compare one number, so it adds no input lag. Prints "hotkey" on each press.
// Usage: SpotifyOverlayKeys.exe <virtual-key code> [ctrl] [alt] [shift]      (exits when the overlay closes its stdin)
// Build: C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /optimize /out:SpotifyOverlayKeys.exe SpotifyOverlayKeys.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

static class SpotifyOverlayKeys
{
    const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x100, WM_SYSKEYDOWN = 0x104, WM_QUIT = 0x12;
    const int VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;

    [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    static uint key; static bool ctrl, alt, shift;
    static bool wasDown;                      // ignore key-repeat while the key is held
    static HookProc proc = Hook;              // kept alive so the GC never collects the callback
    static AutoResetEvent pressed = new AutoResetEvent(false);

    static bool Held(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

    static IntPtr Hook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            var k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            if (k.vkCode == key)
            {
                int m = wParam.ToInt32();
                bool down = m == WM_KEYDOWN || m == WM_SYSKEYDOWN;
                if (down && !wasDown && Held(VK_CONTROL) == ctrl && Held(VK_MENU) == alt && Held(VK_SHIFT) == shift) pressed.Set();
                wasDown = down;
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);   // always pass the key on untouched
    }

    static void Main(string[] args)
    {
        if (args.Length < 1 || !uint.TryParse(args[0], out key)) return;
        foreach (var a in args) { if (a == "ctrl") ctrl = true; else if (a == "alt") alt = true; else if (a == "shift") shift = true; }
        uint hookThread = GetCurrentThreadId();

        // writing to stdout happens off the hook thread, so a slow pipe can never stall the keyboard
        new Thread(() => { var o = Console.Out; while (true) { pressed.WaitOne(); try { o.WriteLine("hotkey"); o.Flush(); } catch (IOException) { PostThreadMessage(hookThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero); return; } } }) { IsBackground = true }.Start();
        // the overlay closing (stdin hits end-of-file) ends the listener, so it can never outlive the app
        new Thread(() => { try { while (Console.In.ReadLine() != null) { } } catch (IOException) { } PostThreadMessage(hookThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero); }) { IsBackground = true }.Start();

        using (var me = Process.GetCurrentProcess())
        {
            if (SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(me.MainModule.ModuleName), 0) == IntPtr.Zero) return;
        }
        MSG msg; while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
    }
}
