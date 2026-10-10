// Spotify Overlay: F8 (configurable) drops a small always-on-top panel at the top of the screen over any game running
// in borderless/windowed mode. It is a separate window - nothing is injected into the game - so it is anti-cheat safe.
// Gaming-first: while hidden nothing runs (the media helper is stopped, no timers, the window is not painted).
const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, screen, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');

if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.setAppUserModelId('com.collin.spotifyoverlay');

const DATA = app.getPath('userData'), CFG_FILE = path.join(DATA, 'settings.json');
const cfg = Object.assign({ hotkey: 'F8', clientId: '', autoHideSeconds: 8 }, (() => { try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (_) { return {}; } })());
const saveCfg = () => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2)); };
const spotify = require('./spotify-api').create(DATA);
const HELPER = app.isPackaged ? path.join(process.resourcesPath, 'media-helper.ps1') : path.join(__dirname, 'media-helper.ps1');

let win = null, setupWin = null, tray = null, visible = false;
const W = 990, H = 200;

// ---------------------------------------------------------------- media helper (Windows media controls)
let helper = null, helperBuf = '', pending = [], stopTimer = null, pollTimer = null, lastState = null, artCache = { key: '', url: '' };
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
      if (msg.m) { if (win && visible) win.webContents.send('meter', msg.m); continue; }
      if ('active' in msg) onState(msg);
    }
  });
  helper.on('exit', () => { helper = null; });
  try { helper.stdin.write('state\n'); } catch (_) {}
}
function stopHelper() { if (helper) { try { helper.stdin.write('quit\n'); } catch (_) {} setTimeout(() => { if (helper) helper.kill(); }, 1500); } }
function send(cmd) { startHelper(); try { helper.stdin.write(cmd + '\n'); } catch (_) {} setTimeout(() => { if (helper) helper.stdin.write('state\n'); }, 450); }

async function onState(s) {
  lastState = s;
  if (s.active && spotify.connected) {
    const key = s.title + '|' + s.artist;
    if (artCache.key !== key) { artCache = { key, url: '' }; spotify.nowPlayingArt().then((url) => { if (artCache.key === key) { artCache.url = url; push(); } }).catch(() => {}); }
  }
  push();
}
function push() { if (win && lastState) win.webContents.send('state', Object.assign({}, lastState, { art: artCache.url, connected: spotify.connected })); }

// ---------------------------------------------------------------- the overlay window
function createWindow() {
  win = new BrowserWindow({ width: W, height: H, frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
    alwaysOnTop: true, show: false, focusable: true, hasShadow: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: true } });
  // 'screen-saver' is the level that really sets WS_EX_TOPMOST over borderless games ('floating' does not on Windows)
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile('overlay.html');
  win.on('blur', () => { if (visible) win.webContents.send('blur'); });
}
function place() {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  win.setBounds({ x: Math.round(d.bounds.x + (d.bounds.width - W) / 2), y: d.bounds.y + 10, width: W, height: H });
}
function show() {
  if (!win) return;
  clearTimeout(stopTimer); place(); startHelper();
  clearInterval(pollTimer); pollTimer = setInterval(() => { if (helper) helper.stdin.write('state\n'); }, 1000);
  visible = true; win.showInactive();            // don't steal focus from the game
  try { helper.stdin.write('meter on\n'); } catch (_) {}
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.send('show', { autoHide: cfg.autoHideSeconds });
  if (spotify.connected) refreshPlaylists();
}
function hide() {
  if (!win || !visible) return;
  visible = false; clearInterval(pollTimer);
  if (helper) { try { helper.stdin.write('meter off\n'); } catch (_) {} }
  win.webContents.send('hide');
  setTimeout(() => { if (!visible) win.hide(); }, 170);       // let the exit animation finish
  stopTimer = setTimeout(stopHelper, 60000);                  // helper exits a minute after the last use
}
function toggle() { visible ? hide() : show(); }

let playlistCache = null, playlistAt = 0;
async function refreshPlaylists() {
  if (playlistCache && Date.now() - playlistAt < 5 * 60000) { win.webContents.send('playlists', playlistCache); return; }
  try { playlistCache = await spotify.playlists(); playlistAt = Date.now(); win.webContents.send('playlists', playlistCache); } catch (_) {}
}

// ---------------------------------------------------------------- setup window (Spotify connection + hotkey)
function openSetup() {
  if (setupWin) { setupWin.focus(); return; }
  setupWin = new BrowserWindow({ width: 560, height: 640, title: 'Spotify Overlay - Setup', autoHideMenuBar: true, backgroundColor: '#121212',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  setupWin.loadFile('setup.html');
  setupWin.on('closed', () => { setupWin = null; });
}

function registerHotkey(key) {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(key, toggle);
  if (!ok && key !== 'F8') globalShortcut.register('F8', toggle);
  return ok;
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(`Spotify Overlay - press ${cfg.hotkey}`);
  const startup = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Show overlay (${cfg.hotkey})`, click: show },
    { label: spotify.connected ? 'Spotify connected - settings...' : 'Connect Spotify for playlists...', click: openSetup },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: startup, click: (m) => app.setLoginItemSettings({ openAtLogin: m.checked }) },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', toggle);
}

// ---------------------------------------------------------------- IPC
ipcMain.on('cmd', (_e, c) => { if (['toggle', 'next', 'prev', 'play', 'pause'].includes(c)) send(c); });
ipcMain.on('seek', (_e, s) => { if (Number.isFinite(s) && s >= 0) send('seek ' + s.toFixed(2)); });
ipcMain.on('hide', hide);
ipcMain.on('focus-overlay', () => { if (win && visible) win.focus(); });
ipcMain.handle('play-playlist', async (_e, uri) => {
  if (!/^spotify:playlist:[A-Za-z0-9]+$/.test(uri)) return false;
  let ok = false; try { ok = await spotify.playPlaylist(uri); } catch (_) {}
  if (!ok) { shell.openExternal(uri); setTimeout(() => send('play'), 2500); }   // no Premium: open it in the Spotify app, then press play
  return true;
});
ipcMain.handle('setup-get', () => ({ clientId: cfg.clientId, hotkey: cfg.hotkey, connected: spotify.connected, redirect: spotify.REDIRECT, autoHide: cfg.autoHideSeconds }));
ipcMain.handle('setup-connect', async (_e, clientId) => {
  if (!/^[0-9a-f]{32}$/i.test(clientId || '')) return { ok: false, error: 'That doesn\'t look like a Client ID (32 letters and numbers).' };
  cfg.clientId = clientId; saveCfg();
  try { await spotify.login(clientId); playlistCache = null; buildTrayMenu(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('setup-disconnect', () => { spotify.logout(); playlistCache = null; buildTrayMenu(); return true; });
ipcMain.handle('setup-hotkey', (_e, key) => { const ok = registerHotkey(key); if (ok) { cfg.hotkey = key; saveCfg(); buildTrayMenu(); } return ok; });
ipcMain.handle('setup-autohide', (_e, n) => { cfg.autoHideSeconds = Math.max(0, Math.min(60, n | 0)); saveCfg(); return true; });
function buildTrayMenu() { if (tray) { tray.destroy(); tray = null; } buildTray(); }

app.whenReady().then(() => {
  createWindow(); buildTray();
  if (!registerHotkey(cfg.hotkey)) console.error('hotkey taken: ' + cfg.hotkey);
  if (!cfg.clientId && !spotify.connected) openSetup();
});
app.on('second-instance', (_e, argv) => { if (argv.includes('--setup')) openSetup(); else show(); });
app.on('window-all-closed', (e) => e.preventDefault?.());
app.on('will-quit', () => { globalShortcut.unregisterAll(); stopHelper(); });
