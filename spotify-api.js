// Spotify Web API for the playlist panel and album art: Authorization Code + PKCE (no client secret), a one-time
// login in the browser, tokens kept encrypted with Electron safeStorage. Only reads playlists / now-playing and
// starts a playlist; nothing is posted or changed on the account.
const http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const { app, shell, safeStorage } = require('electron');

const REDIRECT_PORT = 8888, REDIRECT = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const LIKED = 'spotify:collection:tracks';
const SCOPES = 'user-library-read user-library-modify playlist-read-private playlist-read-collaborative user-read-currently-playing user-read-playback-state user-modify-playback-state';

// the ~300 px album image (Spotify lists 640 / 300 / 64)
const artOf = (t) => { const imgs = (t && t.album && t.album.images) || []; return imgs.length ? imgs[Math.min(1, imgs.length - 1)].url : ''; };

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
    // The playing track's name + album art. The Web API lags the desktop app by up to a second after a
    // change, so the caller checks `name` against what Windows reports before trusting the art.
    async nowPlayingArt() {
      const r = await api('GET', '/me/player/currently-playing'); if (r.status !== 200 || !r.json || !r.json.item) return null;
      return { name: r.json.item.name, url: artOf(r.json.item) };
    },
    // The next few queued songs with their art, so a skip can show the cover instantly.
    async queueArt() {
      const r = await api('GET', '/me/player/queue'); if (r.status !== 200 || !r.json) return [];
      return (r.json.queue || []).filter(Boolean).slice(0, 3).map((t) => ({ name: t.name, url: artOf(t) })).filter((x) => x.url);
    },
    // LIKE: is the playing song in Liked Songs, and toggle it. Needs user-library-modify (one reconnect for
    // logins made before it was added: a 403 comes back as { error: 'reconnect' }).
    // Spotify moved these in 2026: /me/library/contains?uris= and /me/library?uris= (PUT/DELETE) answer, while
    // /me/tracks/contains now returns 403. The old /me/tracks write is kept only as a fallback.
    async likeState() {
      const cur = await api('GET', '/me/player/currently-playing');
      const it = cur.json && cur.json.item; if (!it || !it.id) return { id: null };
      const r = await api('GET', '/me/library/contains?uris=' + encodeURIComponent('spotify:track:' + it.id));
      return { id: it.id, name: it.name, liked: r.status === 200 && Array.isArray(r.json) ? !!r.json[0] : null };
    },
    async setLiked(id, on) {
      let r = await api(on ? 'PUT' : 'DELETE', '/me/library?uris=' + encodeURIComponent('spotify:track:' + id));
      if (!(r.status === 200 || r.status === 204)) r = await api(on ? 'PUT' : 'DELETE', '/me/tracks?ids=' + encodeURIComponent(id));
      if (r.status === 200 || r.status === 204) return { ok: true, liked: on };
      return { ok: false, error: r.status === 403 || r.status === 401 ? 'reconnect' : 'failed' };
    },
    // One page (50) of a playlist's songs for the browse view. Playlists use the newer /items endpoint (/tracks is 403 now).
    // pos is the song's place in the list (skipped rows included), which is what "play from here" needs.
    async tracks(uri, offset) {
      const liked = uri === LIKED;
      const r = await api('GET', liked ? `/me/tracks?limit=50&offset=${offset}` : `/playlists/${uri.split(':')[2]}/items?limit=50&offset=${offset}`);
      if (r.status !== 200 || !r.json) return { items: [], next: null, error: liked && r.status === 403 ? 'reconnect' : 'failed' };
      const items = (r.json.items || []).map((x, i) => {
        const t = x && (x.item || x.track); if (!t || !t.uri) return null;
        return { pos: offset + i, name: t.name, artist: (t.artists || []).map((a) => a.name).join(', '), img: artOf(t) };
      }).filter(Boolean);
      return { items, next: r.json.next ? offset + 50 : null, total: r.json.total };
    },
    // Song search for the search box: 10 at a time (paged as the list scrolls), up to 200 results.
    async search(query, offset) {
      const r = await api('GET', '/search?' + new URLSearchParams({ q: query, type: 'track', limit: '10', offset: String(offset) }));
      if (r.status !== 200 || !r.json || !r.json.tracks) return { items: [], next: null, error: 'failed' };
      const items = (r.json.tracks.items || []).filter((t) => t && t.uri).map((t) => ({ uri: t.uri, album: t.album && t.album.uri, name: t.name, artist: (t.artists || []).map((a) => a.name).join(', '), img: artOf(t) }));
      return { items, next: r.json.tracks.next && offset + 10 < 200 ? offset + 10 : null };
    },
    // An artist's top songs for the browse view, from the artist name shown in the overlay. The artist
    // comes from what is playing (exact id) or else a search; top tracks come from /artists/{id}/top-tracks,
    // or - if that endpoint is closed to this app - a popularity-ordered track search for the artist.
    async artistTop(name) {
      let id = null, label = name;
      const cur = await api('GET', '/me/player/currently-playing');
      const artists = (cur.json && cur.json.item && cur.json.item.artists) || [];
      const hit = artists.find((a) => a.name.toLowerCase() === String(name).toLowerCase()) || artists.find((a) => String(name).toLowerCase().includes(a.name.toLowerCase()));
      if (hit) { id = hit.id; label = hit.name; }
      if (!id) {
        const s = await api('GET', '/search?' + new URLSearchParams({ q: name, type: 'artist', limit: '1' }));
        const a = s.json && s.json.artists && s.json.artists.items && s.json.artists.items[0];
        if (!a) return { items: [], next: null, error: 'failed' };
        id = a.id; label = a.name;
      }
      const map = (t) => ({ uri: t.uri, album: t.album && t.album.uri, name: t.name, artist: (t.artists || []).map((a) => a.name).join(', '), img: artOf(t) });
      const top = await api('GET', `/artists/${id}/top-tracks?market=US`);
      let items = top.status === 200 && top.json && top.json.tracks ? top.json.tracks.filter(Boolean).map(map) : null;
      if (!items || !items.length) {
        items = [];
        for (const offset of [0, 10]) {
          const s = await api('GET', '/search?' + new URLSearchParams({ q: `artist:"${label}"`, type: 'track', limit: '10', offset: String(offset) }));
          for (const t of ((s.json && s.json.tracks && s.json.tracks.items) || []).filter(Boolean)) {
            if ((t.artists || []).some((a) => a.id === id) && !items.some((x) => x.name === t.name)) items.push(map(t));
          }
        }
      }
      return { name: label, uri: 'spotify:artist:' + id, items, next: null };
    },
    // One song: played inside its album (like clicking a search result in Spotify), because a bare { uris: [song] }
    // request is accepted but often never starts on the desktop app. Then confirm it really started; if not, retry
    // once as a bare song before giving up.
    async playTrack(uri, albumUri) {
      const started = async () => {
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 700));
          const p = await api('GET', '/me/player'); const it = p.json && p.json.item;
          if (it && p.json.is_playing && (it.uri === uri || (it.linked_from && it.linked_from.uri === uri))) return true;
        }
        return false;
      };
      const attempts = albumUri ? [{ context_uri: albumUri, offset: { uri } }, { uris: [uri] }] : [{ uris: [uri] }];
      for (const body of attempts) {
        const r = await api('PUT', '/me/player/play', body);
        if ((r.status === 204 || r.status === 202) && await started()) return true;
      }
      return false;
    },
    // Starting playback through the API needs Spotify Premium; otherwise the caller falls back to the spotify: link.
    async playPlaylist(uri, pos) {
      if (uri === LIKED) {   // Liked Songs is the user's "collection" context
        const me = await api('GET', '/me'); if (me.status !== 200) return false;
        uri = `spotify:user:${me.json.id}:collection`;
      }
      const body = { context_uri: uri }; if (Number.isInteger(pos)) body.offset = { position: pos };
      const r = await api('PUT', '/me/player/play', body); return r.status === 204 || r.status === 202;
    },
    // Shuffle: read it (on = undefined) or set it; returns the state, or null when there is no active player.
    async shuffle(on) {
      if (typeof on === 'boolean') { const r = await api('PUT', '/me/player/shuffle?state=' + on); return r.status === 204 || r.status === 202 ? on : null; }
      const r = await api('GET', '/me/player'); return r.status === 200 && r.json ? !!r.json.shuffle_state : null;
    },
    // Voice requests: find the best match and play it. type: track | artist | album | playlist | liked
    async searchAndPlay(type, query) {
      if (type === 'liked') return (await this.playPlaylist(LIKED)) ? { ok: true, name: 'Liked Songs' } : { ok: false };
      const t = ['track', 'artist', 'album', 'playlist'].includes(type) ? type : 'track';
      const r = await api('GET', '/search?' + new URLSearchParams({ q: query, type: t, limit: '5' }));
      const items = (r.json && r.json[t + 's'] && r.json[t + 's'].items || []).filter(Boolean);
      if (!items.length) return { ok: false, error: `couldn't find "${query}"` };
      const hit = items[0], label = hit.name + (hit.artists ? ' - ' + hit.artists.map((a) => a.name).join(', ') : '');
      if (t === 'track') return { ok: await this.playTrack(hit.uri, hit.album && hit.album.uri), name: label, uri: hit.uri };
      const p = await api('PUT', '/me/player/play', { context_uri: hit.uri });
      return { ok: p.status === 204 || p.status === 202, name: label, uri: hit.uri };
    },
    async setVolume(pct) { const r = await api('PUT', '/me/player/volume?volume_percent=' + Math.round(pct)); return r.status === 204; },
    REDIRECT,
  };
}
module.exports = { create };
