# Media helper for the overlay: talks to Windows' media controls (the same "now playing" the volume flyout shows).
# Reads commands on stdin, one per line: state | play | pause | toggle | next | prev | seek <seconds> | quit
# Answers each "state" with one JSON line on stdout. Prefers the Spotify session when several apps play media.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($op, [Type]$type) { $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op)); [void]$t.Wait(5000); $t.Result }

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
