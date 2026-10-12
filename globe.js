// Music-reactive grid globe, shared by the overlay and the corner widget.
// Feed it Spotify's level ~30x/second with react.feed([l, r]); call react.step() + globe.draw(t) each frame.
// Reacts in layers: overall size breathes with loudness, each latitude ring bulges with the level from a moment
// earlier (so energy rolls pole to pole like an equalizer), beats kick the spin, flash the nodes and launch ripples.
window.MusicReact = function MusicReact() {
  const history = new Float32Array(120);
  const s = { level: 0, raw: 0, slow: 0, hi: 0, lo: 1, mean: 0, dev: 0.05, beat: 0, hue: 195, rot: 0, phase: 0, energy: 0, intensity: 1,
    history, ripples: [], shift: 0, shiftTarget: 0, beats: 0, lastSwap: 0, base: null };
  // Palette offsets added to the blue->purple swing: base, teal/cyan, magenta/pink, deep violet/indigo
  const PALETTES = [0, -35, 95, 55, -60];
  // AUTO-LEVEL. Loud, compressed songs sit at 0.5-0.9 on the meter the whole time, so reacting to the raw level pinned the
  // globe at full and starved the beat detector within ~10 s ("it stops reacting"). Instead each reading is placed inside
  // the song's own recent range (a slowly falling ceiling and slowly rising floor), and beats are peaks above the recent
  // average by more than its usual wobble - so loud and quiet songs both keep moving, and breakdowns still calm it down.
  s.feed = (m) => {
    const p = Math.max(m[0], m[1]);
    if (!s.seeded) { if (p <= 0.01) return; s.seeded = true; s.hi = s.lo = s.mean = p; }   // the range starts at the first sound, not at silence
    s.hi = Math.max(p, s.hi - 0.003); s.lo = Math.min(p, s.lo + 0.0015);
    const n = Math.min(1, Math.max(0, (p - s.lo) / Math.max(0.14, s.hi - s.lo)));
    s.mean += (p - s.mean) * 0.06; s.dev += (Math.abs(p - s.mean) - s.dev) * 0.04;
    if (p > s.mean + Math.max(0.025, s.dev * 1.4) && p - s.raw > 0.015 && s.beat < 0.5) {
      s.beat = 1; s.ripples.push({ r: 0, a: 1 }); s.beats++;
      // now and then a strong beat swaps the palette: after 24+ beats and at least 15 s on the current one
      const now = performance.now();
      if (s.beats >= 24 && now - s.lastSwap > 15000 && p > s.mean + Math.max(0.06, s.dev * 2.5)) {
        let next; do { next = PALETTES[Math.floor(Math.random() * PALETTES.length)]; } while (next === s.shiftTarget);
        s.shiftTarget = next; s.beats = 0; s.lastSwap = now;
      }
    }
    s.raw = p; s.level = 0.75 * n + 0.25 * p;
    history.copyWithin(0, 1); history[history.length - 1] = s.level;
  };
  s.step = () => {
    const k = s.intensity;
    s.slow += (s.level - s.slow) * 0.12; s.beat *= 0.84;
    s.energy = Math.min(1, s.slow * 1.25 * k);
    s.shift += (s.shiftTarget - s.shift) * 0.02;                  // palette swaps fade in over ~2 seconds
    // With an album colour (s.base) the theme sits on the cover's hue and the music only nudges it either side;
    // without one it's the original light blue (195) -> purple (280) swing, beats push further.
    const target = s.base != null
      ? s.base + (s.energy - 0.35) * 28 + s.beat * 10 * k
      : 195 + 85 * s.energy + s.beat * 22 * k + s.shift;
    s.hue += ((((target - s.hue) % 360) + 540) % 360 - 180) * 0.08;  // the short way round the colour wheel
    s.hue = (s.hue + 360) % 360;
    s.rot += 0.005 + s.energy * 0.03 + s.beat * 0.05 * k;
    s.phase += 0.08 + s.slow * 0.7;
    for (const r of s.ripples) { r.r += 0.035 + s.energy * 0.02; r.a *= 0.93; }
    s.ripples = s.ripples.filter((r) => r.a > 0.04);
  };
  return s;
};

window.GridGlobe = function GridGlobe(canvas, react) {
  const g = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const rain = Array.from({ length: 16 }, () => ({ lon: Math.floor(Math.random() * 18) * 20, lat: 90 - Math.random() * 180, speed: 0.6 + Math.random() * 1.4 }));
  function fit() { const r = canvas.getBoundingClientRect(); canvas.width = Math.max(1, Math.round(r.width * DPR)); canvas.height = Math.max(1, Math.round(r.height * DPR)); }
  // where the globe sits in the canvas (fractions of the canvas); the corner widget moves it off-centre to leave room
  let lay = { cx: 0.5, cy: 0.5, base: 0.36 };
  function layout(l) { if (l) lay = { cx: l.cx, cy: l.cy, base: l.base }; }

  function draw(t) {
    const s = react, k = s.intensity, W = canvas.width, H = canvas.height, cx = W * lay.cx, cy = H * lay.cy;
    const base = Math.min(W, H) * lay.base, R = base * (1 + 0.1 * s.energy + 0.12 * s.beat * k), tilt = 0.38;
    const hist = s.history, n = hist.length, light = 62 + s.beat * 16;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    // each latitude ring bulges with the level from a few frames earlier -> waves roll from pole to pole
    const bulge = (lat) => 1 + hist[Math.max(0, n - 1 - Math.round((90 - lat) / 6))] * 0.22 * k;
    const P = (lat, lon) => {
      const la = lat * Math.PI / 180, lo = lon * Math.PI / 180 + s.rot, b = bulge(lat);
      const x = Math.cos(la) * Math.sin(lo) * b, y = Math.sin(la), z = Math.cos(la) * Math.cos(lo) * b;
      const y2 = y * Math.cos(tilt) - z * Math.sin(tilt), z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
      return [cx + x * R, cy - y2 * R, Math.max(-1, Math.min(1, z2))];
    };
    const seg = (a, b, w) => {
      const z = (a[2] + b[2]) / 2, al = z > 0 ? 0.28 + 0.62 * z : 0.05 + 0.09 * (1 + z);
      g.strokeStyle = `hsla(${s.hue + (z > 0 ? 0 : 28)}, 92%, ${light}%, ${al})`; g.lineWidth = w;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    };
    const lw = (1 + s.energy * 0.9 + s.beat * 0.8 * k) * DPR;
    for (let lat = -60; lat <= 60; lat += 20) { let prev = P(lat, 0); for (let lon = 8; lon <= 360; lon += 8) { const p = P(lat, lon); seg(prev, p, lw); prev = p; } }
    for (let lon = 0; lon < 360; lon += 20) { let prev = P(-90, lon); for (let lat = -82; lat <= 90; lat += 8) { const p = P(lat, lon); seg(prev, p, lw); prev = p; } }
    // crossing nodes flash on beats
    for (let lat = -60; lat <= 60; lat += 20) for (let lon = 0; lon < 360; lon += 20) {
      const p = P(lat, lon); if (p[2] <= 0.05) continue;
      const tw = 0.5 + 0.5 * Math.sin(t * 0.004 + lat * 0.7 + lon * 1.3);
      g.fillStyle = `hsla(${s.hue + 20}, 100%, ${70 + s.beat * 25}%, ${(0.35 + 0.5 * tw) * p[2]})`;
      g.beginPath(); g.arc(p[0], p[1], (1.2 + s.beat * 2.4 * k + s.energy * 1.4) * DPR, 0, 6.283); g.fill();
    }
    // matrix rain down the longitude lines, faster when loud
    for (const d of rain) {
      d.lat -= d.speed * (1 + s.energy * 4);
      if (d.lat < -90) { d.lat = 90; d.lon = Math.floor(Math.random() * 18) * 20; d.speed = 0.6 + Math.random() * 1.4; }
      for (let i = 0; i < 7; i++) {
        const p = P(d.lat + i * 4, d.lon); if (p[2] <= 0) continue;
        g.fillStyle = `hsla(${s.hue - 15}, 100%, ${i === 0 ? 92 : 70}%, ${(1 - i / 7) * 0.9 * p[2]})`;
        g.fillRect(p[0] - 1.3 * DPR, p[1] - 1.3 * DPR, 2.6 * DPR, 2.6 * DPR);
      }
    }
    // beat ripples expanding off the sphere
    for (const r of s.ripples) {
      g.strokeStyle = `hsla(${s.hue + 30}, 100%, 70%, ${r.a * 0.7})`; g.lineWidth = 1.5 * DPR;
      g.beginPath(); g.arc(cx, cy, R * (1.02 + r.r), 0, 6.283); g.stroke();
    }
    // rim glow
    g.strokeStyle = `hsla(${s.hue}, 92%, 65%, ${0.18 + s.energy * 0.3 + s.beat * 0.3})`; g.lineWidth = (2 + s.beat * 4 * k) * DPR;
    g.beginPath(); g.arc(cx, cy, R * 1.03, 0, 6.283); g.stroke();
    g.globalCompositeOperation = 'source-over';
  }
  fit();
  return { draw, fit, layout };
};
