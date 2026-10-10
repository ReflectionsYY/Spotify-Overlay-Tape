# Media helper for the overlay: talks to Windows' media controls (the same "now playing" the volume flyout shows).
# Reads commands on stdin, one per line: state | play | pause | toggle | next | prev | seek <seconds> | quit
# Answers each "state" with one JSON line on stdout. Prefers the Spotify session when several apps play media.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($op, [Type]$type) { $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op)); [void]$t.Wait(5000); $t.Result }

# Spotify's own output level, read from the Windows audio mixer (the bouncing meter in Volume Mixer). Only the Spotify
# session is metered, so game sounds don't move the visuals. Runs on its own thread only while the overlay is open.
Add-Type -Language CSharp -TypeDefinition @'
using System; using System.Collections.Generic; using System.Diagnostics; using System.Globalization;
using System.Runtime.InteropServices; using System.Threading;
namespace SpotMeter {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { int EnumAudioEndpoints(); [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 { int GetAudioSessionControl(); int GetSimpleAudioVolume(); [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e); }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator { [PreserveSig] int GetCount(out int n); [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s); }
  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(); int GetDisplayName(); int SetDisplayName(); int GetIconPath(); int SetIconPath(); int GetGroupingParam();
    int SetGroupingParam(); int RegisterAudioSessionNotification(); int UnregisterAudioSessionNotification();
    int GetSessionIdentifier(); int GetSessionInstanceIdentifier(); [PreserveSig] int GetProcessId(out uint pid);
  }
  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation { [PreserveSig] int GetPeakValue(out float p); [PreserveSig] int GetMeteringChannelCount(out int n);
    [PreserveSig] int GetChannelsPeakValues(int n, [Out, MarshalAs(UnmanagedType.LPArray)] float[] peaks); }

  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume { [PreserveSig] int SetMasterVolume(float v, ref Guid ctx); [PreserveSig] int GetMasterVolume(out float v);
    [PreserveSig] int SetMute(bool m, ref Guid ctx); [PreserveSig] int GetMute(out bool m); }

  public static class Meter {
    static volatile bool run; static Thread thread;
    // Spotify's own volume slider in the Windows mixer (0..1) - leaves game and system volume alone
    public static float GetVolume(string proc) {
      float best = -1;
      foreach (var s in Sessions(proc)) { try { float v; ((ISimpleAudioVolume)s).GetMasterVolume(out v); best = Math.Max(best, v); } catch { } }
      return best;
    }
    public static int SetVolume(string proc, float v) {
      v = Math.Max(0f, Math.Min(1f, v)); var g = Guid.Empty; int n = 0;
      foreach (var s in Sessions(proc)) { try { ((ISimpleAudioVolume)s).SetMasterVolume(v, ref g); n++; } catch { } }
      return n;
    }
    static List<object> Sessions(string proc) {
      var found = new List<object>();
      var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); IMMDevice dev;
      if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0) return found;
      Guid g = typeof(IAudioSessionManager2).GUID; object o; dev.Activate(ref g, 23, IntPtr.Zero, out o);
      IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se); int n; se.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IAudioSessionControl2 s; se.GetSession(i, out s); uint pid; s.GetProcessId(out pid);
        try { if (Process.GetProcessById((int)pid).ProcessName.Equals(proc, StringComparison.OrdinalIgnoreCase)) found.Add(s); } catch { }
      }
      return found;
    }
    public static void Start(string proc) {
      if (run) return; run = true;
      thread = new Thread(() => Loop(proc)); thread.IsBackground = true; thread.SetApartmentState(ApartmentState.MTA); thread.Start();
    }
    public static void Stop() { run = false; }
    static List<IAudioMeterInformation> Find(string proc) {
      var found = new List<IAudioMeterInformation>();
      var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); IMMDevice dev;
      if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0) return found;
      Guid g = typeof(IAudioSessionManager2).GUID; object o; dev.Activate(ref g, 23, IntPtr.Zero, out o);
      IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se); int n; se.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IAudioSessionControl2 s; se.GetSession(i, out s); uint pid; s.GetProcessId(out pid);
        try { if (Process.GetProcessById((int)pid).ProcessName.Equals(proc, StringComparison.OrdinalIgnoreCase)) found.Add((IAudioMeterInformation)s); } catch { }
      }
      return found;
    }
    static void Loop(string proc) {
      List<IAudioMeterInformation> meters = null; int tick = 0; var ci = CultureInfo.InvariantCulture;
      while (run) {
        try {
          if (meters == null || meters.Count == 0) { if (tick % 30 == 0) meters = Find(proc); }
          float l = 0, r = 0;
          if (meters != null) foreach (var m in meters) {
            int c; m.GetMeteringChannelCount(out c);
            if (c >= 2) { var a = new float[c]; m.GetChannelsPeakValues(c, a); l = Math.Max(l, a[0]); r = Math.Max(r, a[1]); }
            else { float p; m.GetPeakValue(out p); l = Math.Max(l, p); r = Math.Max(r, p); }
          }
          Console.Out.WriteLine("{\"m\":[" + l.ToString("0.000", ci) + "," + r.ToString("0.000", ci) + "]}"); Console.Out.Flush();
        } catch { meters = null; }
        tick++; Thread.Sleep(33);
      }
    }
  }
}
'@

$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Session {
  $all = @($manager.GetSessions())
  $spot = $all | Where-Object { $_.SourceAppUserModelId -match 'Spotify' } | Select-Object -First 1
  if ($spot) { return $spot }
  return $manager.GetCurrentSession()
}

function State {
  $s = Session
  if (-not $s) { return '{"ok":true,"active":false}' }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $tl = $s.GetTimelineProperties(); $pb = $s.GetPlaybackInfo()
  $pos = $tl.Position.TotalSeconds
  # the timeline is a snapshot taken at LastUpdatedTime; advance it while playing
  if ($pb.PlaybackStatus -eq 'Playing') { $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds }
  $o = [ordered]@{ ok = $true; active = $true; app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
    playing = ($pb.PlaybackStatus -eq 'Playing'); position = [math]::Round([math]::Max(0, [math]::Min($pos, $tl.EndTime.TotalSeconds)), 2)
    duration = [math]::Round($tl.EndTime.TotalSeconds, 2) }
  return ($o | ConvertTo-Json -Compress)
}

[Console]::Out.WriteLine('{"ok":true,"ready":true}'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'quit') { break }
  try {
    $s = Session
    switch -regex ($line) {
      '^state$'  { [Console]::Out.WriteLine((State)) }
      '^vol get$'   { [Console]::Out.WriteLine('{"vol":' + [math]::Round([SpotMeter.Meter]::GetVolume('Spotify'), 3).ToString([Globalization.CultureInfo]::InvariantCulture) + '}') }
      '^vol (\d+(\.\d+)?)$' { $null = [SpotMeter.Meter]::SetVolume('Spotify', [float][double]$Matches[1]) }
      '^meter on$'  { [SpotMeter.Meter]::Start('Spotify') }
      '^meter off$' { [SpotMeter.Meter]::Stop() }
      '^play$'   { if ($s) { $null = Await ($s.TryPlayAsync()) ([bool]) } }
      '^pause$'  { if ($s) { $null = Await ($s.TryPauseAsync()) ([bool]) } }
      '^toggle$' { if ($s) { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) } }
      '^next$'   { if ($s) { $null = Await ($s.TrySkipNextAsync()) ([bool]) } }
      '^prev$'   { if ($s) { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) } }
      '^seek (\d+(\.\d+)?)$' { if ($s) { $null = Await ($s.TryChangePlaybackPositionAsync([long]([double]$Matches[1] * 10000000))) ([bool]) } }
    }
  } catch { [Console]::Out.WriteLine(('{"ok":false,"error":' + (ConvertTo-Json ([string]$_.Exception.Message)) + '}')) }
  [Console]::Out.Flush()
}
