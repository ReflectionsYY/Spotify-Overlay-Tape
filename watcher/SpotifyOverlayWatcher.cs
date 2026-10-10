// Spotify Overlay watcher: opens the overlay (quietly, in the tray) when Spotify starts and closes it once Spotify has
// exited, so the overlay only uses resources while Spotify is running. Started at login by the "Open with Spotify"
// setting. It is a few MB of memory and one process check every 4 seconds at below-normal priority.
// Usage: SpotifyOverlayWatcher.exe "<overlay exe>" ["<app folder>"]
// Build:  C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /optimize /out:SpotifyOverlayWatcher.exe SpotifyOverlayWatcher.cs
using System;
using System.Diagnostics;
using System.Text;
using System.Threading;

static class SpotifyOverlayWatcher
{
    static void Main(string[] args)
    {
        if (args.Length < 1) return;
        bool first;
        using (var only = new Mutex(true, "SpotifyOverlayWatcher", out first))
        {
            if (!first) return;   // one watcher per user session
            using (var me = Process.GetCurrentProcess()) me.PriorityClass = ProcessPriorityClass.BelowNormal;
            bool overlayOn = false; int goneChecks = 0;
            while (true)
            {
                if (SpotifyRunning()) { goneChecks = 0; if (!overlayOn) { Launch(args, "background"); overlayOn = true; } }
                else if (overlayOn && ++goneChecks >= 2) { Launch(args, "quit-now"); overlayOn = false; }   // 2 checks: ignore Spotify restarting
                Thread.Sleep(4000);
            }
        }
    }

    static bool SpotifyRunning()
    {
        var found = Process.GetProcessesByName("Spotify");
        foreach (var p in found) p.Dispose();
        return found.Length > 0;
    }

    // The overlay is single-instance: "background" starts it in the tray (or does nothing if it is already running),
    // "quit-now" asks the running one to exit cleanly.
    static void Launch(string[] args, string word)
    {
        var line = new StringBuilder();
        for (int i = 1; i < args.Length; i++) line.Append('"').Append(args[i]).Append("\" ");
        line.Append(word);
        var psi = new ProcessStartInfo(args[0], line.ToString()) { UseShellExecute = false, CreateNoWindow = true };
        psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        try { using (Process.Start(psi)) { } } catch (Exception) { }
    }
}
