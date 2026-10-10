// Narrow bridge between the overlay / corner / settings pages and the main process.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overlay', {
  cmd: (c) => ipcRenderer.send('cmd', c),
  seek: (s) => ipcRenderer.send('seek', s),
  volume: (v) => ipcRenderer.send('volume', v),
  hide: () => ipcRenderer.send('hide'),
  focus: () => ipcRenderer.send('focus'),
  settings: () => ipcRenderer.send('settings'),
  playPlaylist: (uri, pos) => ipcRenderer.invoke('play-playlist', uri, pos),
  tracks: (uri, offset) => ipcRenderer.invoke('tracks', uri, offset),
  search: (query, offset) => ipcRenderer.invoke('search', query, offset),
  playTrack: (uri) => ipcRenderer.invoke('play-track', uri),
  shuffle: (on) => ipcRenderer.invoke('shuffle', on),
  voice: (bytes) => ipcRenderer.invoke('voice', bytes),
  on: (ch, fn) => { if (['state', 'show', 'hide', 'playlists', 'meter', 'volume', 'voice-status', 'corner', 'shuffle'].includes(ch)) ipcRenderer.on(ch, (_e, d) => fn(d)); },
  prefs: {
    get: () => ipcRenderer.invoke('settings-get'),
    set: (patch) => ipcRenderer.invoke('settings-set', patch),
    connect: (id) => ipcRenderer.invoke('settings-connect', id),
    disconnect: () => ipcRenderer.invoke('settings-disconnect'),
  },
});
