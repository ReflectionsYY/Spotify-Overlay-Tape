// Narrow bridge between the overlay/setup pages and the main process.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overlay', {
  cmd: (c) => ipcRenderer.send('cmd', c),
  seek: (s) => ipcRenderer.send('seek', s),
  hide: () => ipcRenderer.send('hide'),
  focus: () => ipcRenderer.send('focus-overlay'),
  playPlaylist: (uri) => ipcRenderer.invoke('play-playlist', uri),
  on: (ch, fn) => { if (['state', 'show', 'hide', 'blur', 'playlists'].includes(ch)) ipcRenderer.on(ch, (_e, d) => fn(d)); },
  setup: {
    get: () => ipcRenderer.invoke('setup-get'),
    connect: (id) => ipcRenderer.invoke('setup-connect', id),
    disconnect: () => ipcRenderer.invoke('setup-disconnect'),
    hotkey: (k) => ipcRenderer.invoke('setup-hotkey', k),
    autoHide: (n) => ipcRenderer.invoke('setup-autohide', n),
  },
});
