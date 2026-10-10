// Spotify Web API for the playlist panel and album art: Authorization Code + PKCE (no client secret), a one-time
// login in the browser, tokens kept encrypted with Electron safeStorage. Only reads playlists / now-playing and
// starts a playlist; nothing is posted or changed on the account.
const http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const { app, shell, safeStorage } = require('electron');

const REDIRECT_PORT = 8888, REDIRECT = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const LIKED = 'spotify:collection:tracks';
const SCOPES = 'user-library-read playlist-read-private playlist-read-collaborative user-read-currently-playing user-read-playback-state user-modify-playback-state';

function create(dataDir) {
  const tokenFile = path.join(dataDir, 'spotify-token.bin');
  let token = null, loaded = false;   // token: { access, refresh, expires, clientId }

  // safeStorage only works once the app is ready, so the saved login is read lazily (not at startup)
  function load() {
    if (loaded || !app.isReady()) return;
    loaded = true;
    try { token = JSON.parse(safeStorage.decryptString(fs.readFileSync(tokenFile))); } catch (e) { token = null; }
  }
  function save() { fs.writeFileSync(tokenFile, safeStorage.encryptString(JSON.stringify(token))); }
  load();

  const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // One-time login: open the Spotify consent page, catch the redirect on 127.0.0.1, swap the code for tokens.
  function login(clientId) {
    return new Promise((resolve, reject) => {
      const verifier = b64url(crypto.randomBytes(64)), state = b64url(crypto.randomBytes(16));
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, REDIRECT);
        if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
        const done = (msg) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<body style="font:16px system-ui;background:#111;color:#eee;padding:40px">${msg}</body>`); server.close(); };
        if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) { done('Login was cancelled or failed. You can close this tab.'); reject(new Error(u.searchParams.get('error') || 'login failed')); return; }
        try {
          const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }) });
          const j = await r.json(); if (!r.ok) throw new Error(j.error_description || j.error || 'token exchange failed');
          token = { access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in - 60) * 1000, clientId }; save();
          done('Spotify Overlay is connected. You can close this tab and press F8 in game.'); resolve();
        } catch (e) { done('Login failed: ' + e.message); reject(e); }
      });
      server.on('error', reject);
      server.listen(REDIRECT_PORT, '127.0.0.1', () => {
        shell.openExternal('https://accounts.spotify.com/authorize?' + new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: REDIRECT,
          code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state }));
      });
      setTimeout(() => { server.close(); reject(new Error('login timed out')); }, 5 * 60 * 1000);
    });
  }

  async function access() {
    load();
    if (!token) return null;
    if (Date.now() < token.expires) return token.access;
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh, client_id: token.clientId }) });
    const j = await r.json();
    if (!r.ok) { if (j.error === 'invalid_grant') { token = null; try { fs.unlinkSync(tokenFile); } catch (_) {} } return null; }
    token.access = j.access_token; token.expires = Date.now() + (j.expires_in - 60) * 1000; if (j.refresh_token) token.refresh = j.refresh_token; save();
    return token.access;
  }

  async function api(method, endpoint, body) {
    const a = await access(); if (!a) return { status: 401 };
    const r = await fetch('https://api.spotify.com/v1' + endpoint, { method, headers: { Authorization: 'Bearer ' + a, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = r.status === 204 ? null : await r.json(); } catch (_) {}
    return { status: r.status, json };
  }

  return {
    get connected() { load(); return !!token; },
    login,
    logout() { token = null; try { fs.unlinkSync(tokenFile); } catch (_) {} },
    async playlists() {
      const out = [{ id: 'liked', uri: LIKED, name: 'Liked Songs', liked: true }]; let url = '/me/playlists?limit=50';
      for (let page = 0; url && page < 4; page++) {
        const r = await api('GET', url); if (r.status !== 200) break;
        for (const p of r.json.items || []) if (p) out.push({ id: p.id, uri: p.uri, name: p.name, image: (p.images && p.images.length ? p.images[p.images.length - 1].url : '') });
        url = r.json.next ? r.json.next.replace('https://api.spotify.com/v1', '') : null;
      }
      return out;
    },
    async nowPlayingArt() {
      const r = await api('GET', '/me/player/currently-playing'); if (r.status !== 200 || !r.json || !r.json.item) return '';
      const imgs = (r.json.item.album && r.json.item.album.images) || []; return imgs.length ? imgs[Math.min(1, imgs.length - 1)].url : '';
    },
    // Starting playback through the API needs Spotify Premium; otherwise the caller falls back to the spotify: link.
    async playPlaylist(uri) {
      if (uri === LIKED) {   // Liked Songs is the user's "collection" context
        const me = await api('GET', '/me'); if (me.status !== 200) return false;
        uri = `spotify:user:${me.json.id}:collection`;
      }
      const r = await api('PUT', '/me/player/play', { context_uri: uri }); return r.status === 204 || r.status === 202;
    },
    // Voice requests: find the best match and play it. type: track | artist | album | playlist | liked
    async searchAndPlay(type, query) {
      if (type === 'liked') return (await this.playPlaylist(LIKED)) ? { ok: true, name: 'Liked Songs' } : { ok: false };
      const t = ['track', 'artist', 'album', 'playlist'].includes(type) ? type : 'track';
      const r = await api('GET', '/search?' + new URLSearchParams({ q: query, type: t, limit: '5' }));
      const items = (r.json && r.json[t + 's'] && r.json[t + 's'].items || []).filter(Boolean);
      if (!items.length) return { ok: false, error: `couldn't find "${query}"` };
      const hit = items[0], label = hit.name + (hit.artists ? ' - ' + hit.artists.map((a) => a.name).join(', ') : '');
      const body = t === 'track' ? { uris: [hit.uri] } : { context_uri: hit.uri };
      const p = await api('PUT', '/me/player/play', body);
      return { ok: p.status === 204 || p.status === 202, name: label, uri: hit.uri };
    },
    async setVolume(pct) { const r = await api('PUT', '/me/player/volume?volume_percent=' + Math.round(pct)); return r.status === 204; },
    REDIRECT,
  };
}
module.exports = { create };
