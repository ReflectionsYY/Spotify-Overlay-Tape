// Spotify Overlay: a hotkey (F8 by default) drops a small always-on-top panel at the top of the screen over any game in
// borderless/windowed mode. It is a separate window - nothing is injected into the game - so it is anti-cheat safe.
// Gaming-first: while hidden nothing runs unless the optional corner globe is on (then only the meter + one small canvas).
const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, screen, shell, session } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

if (!app.requestSingleInstanceLock()) { app.quit(); return; }
if (process.argv.includes('quit-now')) { app.quit(); return; }   // the watcher saying Spotify closed, with no overlay to close
app.setAppUserModelId('com.collin.spotifyoverlay');

const DATA = app.getPath('userData'), CFG_FILE = path.join(DATA, 'settings.json');
const DEFAULTS = { hotkey: 'F8', clientId: '', autoHideSeconds: 8, position: 'top-center', showPlaylists: true, intensity: 1, claudeVoice: true,
  corner: { enabled: false, corner: 'top-right', size: 180, opacity: 0.9, onlyWhilePlaying: true } };
const cfg = (() => { let saved = {}; try { saved = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (_) {}
  return Object.assign({}, DEFAULTS, saved, { corner: Object.assign({}, DEFAULTS.corner, saved.corner || {}) }); })();
const saveCfg = () => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2)); };
const spotify = require('./spotify-api').create(DATA);
const HELPER = app.isPackaged ? path.join(process.resourcesPath, 'media-helper.ps1') : path.join(__dirname, 'media-helper.ps1');

let win = null, setWin = null, cornerWin = null, tray = null, visible = false;
const W = 990, H = 200;

// ---------------------------------------------------------------- media helper (Windows media controls + Spotify meter)
let helper = null, helperBuf = '', stopTimer = null, pollTimer = null, cornerPoll = null, lastState = null, artCache = { key: '', url: '' }, volume = null;
function startHelper() {
  if (helper) return;
  helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER], { windowsHide: true });
  helperBuf = '';
  helper.stdout.on('data', (d) => {
    helperBuf += d; let i;
    while ((i = helperBuf.indexOf('\n')) >= 0) {
      const line = helperBuf.slice(0, i).trim(); helperBuf = helperBuf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch (_) { continue; }
      if (msg.ready) continue;
      if (msg.m) { if (win && visible) win.webContents.send('meter', msg.m); if (cornerWin) cornerWin.webContents.send('meter', msg.m); continue; }
      if ('vol' in msg) { volume = msg.vol; if (win) win.webContents.send('volume', volume); continue; }
      if ('active' in msg) onState(msg);
    }
  });
  helper.on('exit', () => { helper = null; });
  write('state'); write('vol get');
  if (needMeter()) write('meter on');
}
function write(cmd) { try { if (helper) helper.stdin.write(cmd + '\n'); } catch (_) {} }
function stopHelper() { if (helper && !cornerWin) { write('quit'); setTimeout(() => { if (helper && !cornerWin) helper.kill(); }, 1500); } }
function send(cmd) { startHelper(); write(cmd); setTimeout(() => write('state'), 450); }
const needMeter = () => visible || !!cornerWin;

async function onState(s) {
  lastState = s;
  if (s.active && spotify.connected) {
    const key = s.title + '|' + s.artist;
    if (artCache.key !== key) { artCache = { key, url: '' }; spotify.nowPlayingArt().then((url) => { if (artCache.key === key) { artCache.url = url; push(); } }).catch(() => {}); }
  }
  push();
}
function push() {
  if (!lastState) return;
  const s = Object.assign({}, lastState, { art: artCache.url, connected: spotify.connected });
  if (win) win.webContents.send('state', s);
  if (cornerWin) cornerWin.webContents.send('state', s);
}

// ---------------------------------------------------------------- the overlay window
function createWindow() {
  win = new BrowserWindow({ width: W, height: H, frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
    alwaysOnTop: true, show: false, focusable: true, hasShadow: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: true } });
  // 'screen-saver' is the level that really sets WS_EX_TOPMOST over borderless games ('floating' does not on Windows)
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile('overlay.html');
}
function place() {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds, m = 10;
  const x = cfg.position === 'top-left' ? d.x + m : cfg.position === 'top-right' ? d.x + d.width - W - m : Math.round(d.x + (d.width - W) / 2);
  win.setBounds({ x, y: d.y + m, width: W, height: H });
}
function show() {
  if (!win) return;
  clearTimeout(stopTimer); place(); startHelper();
  clearInterval(pollTimer); pollTimer = setInterval(() => write('state'), 1000);
  visible = true; win.showInactive();             // don't steal focus from the game
  write('meter on'); write('vol get');
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.send('show', { autoHide: cfg.autoHideSeconds, intensity: cfg.intensity, showPlaylists: cfg.showPlaylists, hotkey: cfg.hotkey, voice: cfg.claudeVoice });
  if (spotify.connected) { refreshPlaylists(); spotify.shuffle().then((s) => { if (win && s !== null) win.webContents.send('shuffle', s); }).catch(() => {}); }
}
function hide() {
  if (!win || !visible) return;
  visible = false; clearInterval(pollTimer);
  if (!cornerWin) write('meter off');
  win.webContents.send('hide');
  setTimeout(() => { if (!visible) win.hide(); }, 170);        // let the exit animation finish
  if (!cornerWin) stopTimer = setTimeout(stopHelper, 60000);   // helper exits a minute after the last use
}
function toggle() { visible ? hide() : show(); }

let playlistCache = null, playlistAt = 0;
async function refreshPlaylists() {
  if (playlistCache && Date.now() - playlistAt < 5 * 60000) { win.webContents.send('playlists', playlistCache); return; }
  try { playlistCache = await spotify.playlists(); playlistAt = Date.now(); win.webContents.send('playlists', playlistCache); } catch (_) {}
}

// ---------------------------------------------------------------- corner globe (optional, click-through)
function applyCorner() {
  const c = cfg.corner;
  if (!c.enabled) {
    if (cornerWin) { cornerWin.destroy(); cornerWin = null; }
    clearInterval(cornerPoll); cornerPoll = null;
    if (!visible) { write('meter off'); stopTimer = setTimeout(stopHelper, 60000); }
    return;
  }
  // The window sits flush in the screen corner and reaches well past the globe toward the middle of the screen, so the
  // ripples and bulges have room to finish (fading out softly) instead of being cut off by a square.
  const d = screen.getPrimaryDisplay().bounds, globeSize = Math.max(100, Math.min(320, c.size | 0)), m = 12;
  const size = Math.round(m + globeSize * 1.7), right = !c.corner.endsWith('left'), bottom = c.corner.startsWith('bottom');
  const x = right ? d.x + d.width - size : d.x, y = bottom ? d.y + d.height - size : d.y;
  const mid = m + globeSize / 2;
  cornerLayout = { cx: (right ? size - mid : mid) / size, cy: (bottom ? size - mid : mid) / size, base: 0.36 * globeSize / size, right, bottom };
  if (!cornerWin) {
    cornerWin = new BrowserWindow({ width: size, height: size, x, y, frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
      alwaysOnTop: true, focusable: false, hasShadow: false, show: false, fullscreenable: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: true } });
    cornerWin.setIgnoreMouseEvents(true);                 // clicks go straight through to the game
    cornerWin.setAlwaysOnTop(true, 'screen-saver');
    cornerWin.loadFile('corner.html');
    cornerWin.webContents.once('did-finish-load', () => { sendCorner(); cornerWin.showInactive(); cornerWin.webContents.send('show'); push(); });
  } else { cornerWin.setBounds({ x, y, width: size, height: size }); sendCorner(); }
  clearTimeout(stopTimer); startHelper(); write('meter on');
  clearInterval(cornerPoll); cornerPoll = setInterval(() => write('state'), 2000);
}
let cornerLayout = null;
function sendCorner() { if (cornerWin) cornerWin.webContents.send('corner', { intensity: cfg.intensity, opacity: cfg.corner.opacity, onlyWhilePlaying: cfg.corner.onlyWhilePlaying, layout: cornerLayout }); }

// ---------------------------------------------------------------- "Open with Spotify": a tiny watcher started at login
// opens the overlay when Spotify starts and closes it when Spotify exits (watcher/SpotifyOverlayWatcher.cs)
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', RUN_NAME = 'Spotify Overlay (with Spotify)';
const WATCHER = path.join(DATA, 'SpotifyOverlayWatcher.exe');
const overlayCommand = () => process.env.PORTABLE_EXECUTABLE_FILE ? [process.env.PORTABLE_EXECUTABLE_FILE] : app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];
function withSpotifyEnabled() { try { require('child_process').execFileSync('reg', ['query', RUN_KEY, '/v', RUN_NAME], { windowsHide: true, stdio: 'ignore' }); return true; } catch (_) { return false; } }
function setWithSpotify(on) {
  app.setLoginItemSettings({ openAtLogin: false });     // the old "start with Windows" entry is replaced by the watcher
  execFile('taskkill', ['/IM', 'SpotifyOverlayWatcher.exe', '/F'], { windowsHide: true }, () => setTimeout(() => {
    if (!on) { execFile('reg', ['delete', RUN_KEY, '/v', RUN_NAME, '/f'], { windowsHide: true }, () => {}); return; }
    try { fs.copyFileSync(path.join(__dirname, 'watcher', 'SpotifyOverlayWatcher.exe'), WATCHER); } catch (_) { return; }
    const argv = overlayCommand();
    execFile('reg', ['add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', [WATCHER, ...argv].map((a) => `"${a}"`).join(' '), '/f'], { windowsHide: true }, () => {});
    spawn(WATCHER, argv, { detached: true, stdio: 'ignore', windowsHide: true }).unref();   // start watching now, not just from next login
  }, 600));
}

// ---------------------------------------------------------------- voice: mic clip -> offline Whisper -> Claude Haiku -> Spotify
const FFMPEG = [path.join(os.homedir(), 'AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.1-full_build/bin/ffmpeg.exe'), 'ffmpeg'].find((p) => p === 'ffmpeg' || fs.existsSync(p));
const MODELS = path.join(process.env.LOCALAPPDATA || '', 'whisper-models');
function claudeExe() {
  const ext = path.join(os.homedir(), '.vscode', 'extensions');
  const dirs = fs.existsSync(ext) ? fs.readdirSync(ext).filter((d) => d.startsWith('anthropic.claude-code-')) : [];
  dirs.sort((a, b) => fs.statSync(path.join(ext, b)).mtimeMs - fs.statSync(path.join(ext, a)).mtimeMs);
  for (const d of dirs) { const p = path.join(ext, d, 'resources', 'native-binary', 'claude.exe'); if (fs.existsSync(p)) return p; }
  return 'claude';
}
function transcribe(file) {
  return new Promise((resolve) => {
    const out = 'voice-' + process.pid + '.txt';
    try { fs.unlinkSync(path.join(MODELS, out)); } catch (_) {}
    execFile(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-af', `aresample=16000,whisper=model=ggml-small.en.bin:language=en:queue=8:destination=${out}:format=text`, '-f', 'null', '-'],
      { cwd: MODELS, windowsHide: true, timeout: 60000 }, () => {
        let text = ''; try { text = fs.readFileSync(path.join(MODELS, out), 'utf8'); fs.unlinkSync(path.join(MODELS, out)); } catch (_) {}
        resolve(text.replace(/\s+/g, ' ').trim());
      });
  });
}
const SYSTEM = 'You turn a spoken music request into a Spotify search. Ignore wake words like "hey claude". Reply with ONLY one line of JSON, no code fences: '
  + '{"type":"track|artist|album|playlist|liked","query":"search text"}. For "play my liked songs" use type liked.';
function askClaude(text) {
  return new Promise((resolve) => {
    // A tiny, tool-less, one-turn call on the user's own Claude subscription (~600 tokens in, a few hundred out).
    execFile(claudeExe(), ['-p', text, '--model', 'haiku', '--system-prompt', SYSTEM, '--tools', '', '--strict-mcp-config', '--setting-sources', '',
      '--no-session-persistence', '--output-format', 'json', '--max-turns', '1'], { cwd: os.tmpdir(), windowsHide: true, timeout: 45000 }, (err, out) => {
      try { const j = JSON.parse(out); const m = /\{[^{}]*\}/.exec(j.result || ''); resolve(m ? JSON.parse(m[0]) : null); } catch (_) { resolve(null); }
    });
  });
}
ipcMain.handle('voice', async (_e, bytes) => {
  const status = (s) => { if (win) win.webContents.send('voice-status', s); };
  if (!spotify.connected) { status('Connect Spotify in Settings first'); return; }
  const file = path.join(os.tmpdir(), `spotify-overlay-voice-${Date.now()}.webm`);
  try {
    fs.writeFileSync(file, Buffer.from(bytes));
    status('Transcribing...');
    const text = await transcribe(file);
    if (!text || /^\[.*\]$/.test(text)) { status("Didn't catch that"); return; }
    status(`"${text}" - asking Claude...`);
    let ask = await askClaude(text);
    if (!ask || !ask.type) ask = { type: 'track', query: text.replace(/^(hey,? )?claude,?\s*/i, '').replace(/^(play|put on)\s+/i, '') };   // fallback: search the words
    const r = await spotify.searchAndPlay(ask.type, ask.query);
    status(r.ok ? `Playing ${r.name}` : `Couldn't play that${r.error ? ': ' + r.error : ''}`);
    setTimeout(() => write('state'), 800);
  } catch (e) { status('Voice error: ' + e.message); }
  finally { try { fs.unlinkSync(file); } catch (_) {} }
});

// ---------------------------------------------------------------- settings window
function openSettings() {
  if (setWin) { setWin.show(); setWin.focus(); return; }
  setWin = new BrowserWindow({ width: 600, height: 760, title: 'Spotify Overlay - Settings', autoHideMenuBar: true, backgroundColor: '#121212',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  setWin.loadFile('settings.html');
  setWin.on('closed', () => { setWin = null; });
}
function registerHotkey(key) {
  globalShortcut.unregisterAll();
  let ok = false; try { ok = globalShortcut.register(key, toggle); } catch (_) {}
  if (!ok && key !== 'F8') globalShortcut.register('F8', toggle);
  return ok;
}
function buildTray() {
  if (tray) { tray.destroy(); tray = null; }
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(`Spotify Overlay - press ${cfg.hotkey}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Show overlay (${cfg.hotkey})`, click: show },
    { label: 'Settings...', click: openSettings },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', toggle);
}

// ---------------------------------------------------------------- IPC
ipcMain.on('cmd', (_e, c) => { if (['toggle', 'next', 'prev', 'play', 'pause'].includes(c)) send(c); });
ipcMain.on('seek', (_e, s) => { if (Number.isFinite(s) && s >= 0) send('seek ' + s.toFixed(2)); });
ipcMain.on('volume', (_e, v) => { if (Number.isFinite(v)) { startHelper(); write('vol ' + Math.max(0, Math.min(1, v)).toFixed(3)); volume = v; } });
ipcMain.on('hide', hide);
ipcMain.on('focus', () => { if (win && visible) win.focus(); });   // only for typing in the search box
ipcMain.on('settings', openSettings);
const LIST_URI = /^spotify:(playlist:[A-Za-z0-9]+|collection:tracks)$/;
ipcMain.handle('tracks', async (_e, uri, offset) => {
  if (!LIST_URI.test(uri) || !Number.isInteger(offset) || offset < 0) return { items: [], next: null, error: 'failed' };
  try { return await spotify.tracks(uri, offset); } catch (_) { return { items: [], next: null, error: 'failed' }; }
});
ipcMain.handle('search', async (_e, query, offset) => {
  if (typeof query !== 'string' || !query.trim() || query.length > 200 || !Number.isInteger(offset) || offset < 0) return { items: [], next: null };
  try { return await spotify.search(query.trim(), offset); } catch (_) { return { items: [], next: null, error: 'failed' }; }
});
ipcMain.handle('play-track', async (_e, uri, album) => {
  if (!/^spotify:track:[A-Za-z0-9]+$/.test(uri)) return false;
  if (!/^spotify:album:[A-Za-z0-9]+$/.test(album || '')) album = undefined;
  let ok = false; try { ok = await spotify.playTrack(uri, album); } catch (_) {}
  setTimeout(() => write('state'), 300);
  return ok;
});
ipcMain.handle('shuffle', async (_e, on) => {
  let s = null; try { s = await spotify.shuffle(typeof on === 'boolean' ? on : undefined); } catch (_) {}
  return s;
});
ipcMain.handle('play-playlist', async (_e, uri, pos) => {
  if (!LIST_URI.test(uri)) return false;
  let ok = false; try { ok = await spotify.playPlaylist(uri, Number.isInteger(pos) && pos >= 0 ? pos : undefined); } catch (_) {}
  if (!ok) { shell.openExternal(uri); setTimeout(() => send('play'), 2500); }   // no Premium / no device: open it in the Spotify app, then press play
  return true;
});
ipcMain.handle('settings-get', () => Object.assign({}, cfg, { connected: spotify.connected, redirect: spotify.REDIRECT, withSpotify: withSpotifyEnabled() }));
ipcMain.handle('settings-set', (_e, patch) => {
  const p = patch || {};
  if ('hotkey' in p) { if (!registerHotkey(String(p.hotkey))) { registerHotkey(cfg.hotkey); return { ok: false, error: 'That key is taken or not valid.' }; } cfg.hotkey = String(p.hotkey); }
  if ('autoHideSeconds' in p) cfg.autoHideSeconds = Math.max(0, Math.min(60, p.autoHideSeconds | 0));
  if ('position' in p && ['top-center', 'top-left', 'top-right'].includes(p.position)) cfg.position = p.position;
  if ('showPlaylists' in p) cfg.showPlaylists = !!p.showPlaylists;
  if ('claudeVoice' in p) cfg.claudeVoice = !!p.claudeVoice;
  if ('intensity' in p) cfg.intensity = Math.max(0.4, Math.min(2, +p.intensity || 1));
  if ('withSpotify' in p) setWithSpotify(!!p.withSpotify);
  if (p.corner) {
    const c = p.corner, cur = cfg.corner;
    if ('enabled' in c) cur.enabled = !!c.enabled;
    if ('corner' in c && ['top-right', 'top-left', 'bottom-right', 'bottom-left'].includes(c.corner)) cur.corner = c.corner;
    if ('size' in c) cur.size = Math.max(100, Math.min(320, c.size | 0));
    if ('opacity' in c) cur.opacity = Math.max(0.2, Math.min(1, +c.opacity || 0.9));
    if ('onlyWhilePlaying' in c) cur.onlyWhilePlaying = !!c.onlyWhilePlaying;
    applyCorner();
  }
  if ('intensity' in p) sendCorner();
  saveCfg(); buildTray();
  return { ok: true };
});
ipcMain.handle('settings-connect', async (_e, clientId) => {
  if (!/^[0-9a-f]{32}$/i.test(clientId || '')) return { ok: false, error: 'That doesn\'t look like a Client ID (32 letters and numbers).' };
  cfg.clientId = clientId; saveCfg();
  try { await spotify.login(clientId); playlistCache = null; return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('settings-disconnect', () => { spotify.logout(); playlistCache = null; return true; });

app.whenReady().then(() => {
  // the mic is only used while the voice button is held/active in the overlay
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  createWindow(); buildTray();
  if (!registerHotkey(cfg.hotkey)) console.error('hotkey taken: ' + cfg.hotkey);
  if (cfg.corner.enabled) applyCorner();
  const wantsSettings = process.argv.some((a) => a.toLowerCase().endsWith('setup'));
  if (wantsSettings || (!cfg.clientId && !spotify.connected)) openSettings();
});
app.on('second-instance', (_e, argv) => {
  if (argv.includes('quit-now')) app.quit();              // Spotify closed (from the watcher)
  else if (argv.includes('background')) {}                // Spotify opened and the overlay is already running
  else if (argv.some((a) => a.toLowerCase().endsWith('setup'))) openSettings();
  else show();
});
app.on('window-all-closed', () => {});   // keep running in the tray
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (helper) { write('quit'); } });
