// Snap Vanish — runs in the page (MAIN world) so it can wrap getUserMedia.
// Meet never receives your real camera/mic: it gets a canvas video track and a gain-controlled audio track.
(() => {
  'use strict';
  if (window.__snapVanish) return;
  window.__snapVanish = true;

  const S = { enabled: true, sensitivity: 50 };
  const state = { mode: 'visible', endAt: 0, clickedMeet: false, muted: false, tipShown: false };
  const pipes = { video: [], audio: [] };
  const LIFE = 1.1;                    // seconds each dust grain lives
  const DUR = 0.9 + 0.35 + LIFE + 0.1; // total effect time
  let actx = null, plate = null, hud = null, pill = null, toastEl = null, toastTimer = null;
  let stopRender = null, stopDetect = null;

  const post = (type, payload = {}) =>
    window.postMessage({ __snapvanish: true, dir: 'out', type, ...payload }, '*');

  /* ---------- HUD (purple LIVE / MUTED box) ---------- */
  function ensureHud() {
    if (hud && hud.isConnected) return;
    if (!document.documentElement) return;
    hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;left:16px;bottom:96px;z-index:2147483647;display:flex;flex-direction:column;gap:6px;align-items:flex-start;pointer-events:none;font:600 13px/1 system-ui,sans-serif';
    pill = document.createElement('div');
    pill.style.cssText = 'padding:8px 12px;border-radius:8px;background:#6d28d9;color:#fff;box-shadow:0 4px 18px rgba(109,40,217,.45);transition:background .2s';
    toastEl = document.createElement('div');
    toastEl.style.cssText = 'padding:7px 11px;border-radius:8px;background:rgba(20,16,32,.88);color:#e9ddff;font-weight:500;max-width:260px;line-height:1.35;display:none';
    hud.append(pill, toastEl);
    document.documentElement.appendChild(hud);
    refreshPill();
  }
  function meetMicBtn() {
    return [...document.querySelectorAll('button[data-is-muted]')]
      .find((b) => /microphone/i.test(b.getAttribute('aria-label') || ''));
  }
  function refreshPill() {
    if (!pill) return;
    const b = meetMicBtn();
    const muted = state.muted || (b && b.getAttribute('data-is-muted') === 'true');
    pill.textContent = muted ? '\u{1F507} MUTED' : '\u{1F399} LIVE';
    pill.style.background = muted ? '#4c1d95' : '#7c3aed';
  }
  function toast(msg, ms = 2400) {
    ensureHud();
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, ms);
  }

  /* ---------- helpers ---------- */
  function ticker(ms, fn) {
    let w = null, id = null;
    const fallback = () => { if (id === null) id = setInterval(fn, ms); };
    try {
      const url = URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${ms})`], { type: 'text/javascript' }));
      w = new Worker(url);
      w.onmessage = fn;
      w.onerror = () => { try { w.terminate(); } catch (_) {} fallback(); };
    } catch (_) { fallback(); }
    return () => { if (w) try { w.terminate(); } catch (_) {} if (id !== null) clearInterval(id); };
  }
  function getCtx() {
    if (!actx) {
      actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      const resume = () => actx.state === 'suspended' && actx.resume();
      ['click', 'keydown', 'pointerdown'].forEach((ev) => window.addEventListener(ev, resume, true));
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  function setMuted(m) {
    state.muted = m;
    pipes.audio.forEach((a) => a.gain.gain.setTargetAtTime(m ? 0 : 1, actx.currentTime, 0.015));
    refreshPill();
  }
  function meetMute(wantMuted) {
    try {
      const b = meetMicBtn();
      if (!b) return;
      const isMuted = b.getAttribute('data-is-muted') === 'true';
      if (wantMuted && !isMuted) { b.click(); state.clickedMeet = true; }
      else if (!wantMuted) { if (state.clickedMeet && isMuted) b.click(); state.clickedMeet = false; }
    } catch (_) {}
  }
  function sample(d, W, H, x, y, B) {
    let r = 0, g = 0, b = 0;
    const pts = [[.25, .25], [.75, .25], [.25, .75], [.75, .75], [.5, .5]];
    for (const [fx, fy] of pts) {
      const px = Math.min(W - 1, Math.floor(x + B * fx)), py = Math.min(H - 1, Math.floor(y + B * fy));
      const i = (py * W + px) * 4;
      r += d[i]; g += d[i + 1]; b += d[i + 2];
    }
    return [(r / 5) | 0, (g / 5) | 0, (b / 5) | 0];
  }

  /* ---------- video pipeline: camera -> canvas (dust effect) -> track ---------- */
  function makeVideoPipeline(srcTrack) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.autoplay = true;
    v.srcObject = new MediaStream([srcTrack]);
    v.play().catch(() => {});
    const st = srcTrack.getSettings ? srcTrack.getSettings() : {};
    const W = st.width || 640, H = st.height || 360;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const track = canvas.captureStream(30).getVideoTracks()[0];
    track.applyConstraints = () => Promise.resolve();
    const P = { v, W, H, g, track, srcTrack, fx: null, stopped: false };

    function bg() {
      if (plate) g.drawImage(plate, 0, 0, W, H);
      else { g.fillStyle = '#0b0b12'; g.fillRect(0, 0, W, H); }
    }

    P.begin = (kind) => {
      const B = Math.max(3, Math.round(W / 120));
      const sc = document.createElement('canvas'); sc.width = W; sc.height = H;
      const sg = sc.getContext('2d', { willReadFrequently: true });
      sg.drawImage(v, 0, 0, W, H);
      const img = sg.getImageData(0, 0, W, H).data;
      let pd = null;
      if (plate) {
        const pc = document.createElement('canvas'); pc.width = W; pc.height = H;
        const pg = pc.getContext('2d', { willReadFrequently: true });
        pg.drawImage(plate, 0, 0, W, H);
        pd = pg.getImageData(0, 0, W, H).data;
      }
      const cells = [], diffs = [];
      for (let y = 0; y < H; y += B) for (let x = 0; x < W; x += B) {
        const c = sample(img, W, H, x, y, B);
        let d = 0;
        if (pd) { const p = sample(pd, W, H, x, y, B); d = Math.abs(c[0] - p[0]) + Math.abs(c[1] - p[1]) + Math.abs(c[2] - p[2]); }
        cells.push({ x, y, c, d }); diffs.push(d);
      }
      let thr = -1;
      if (pd) { const s = Float32Array.from(diffs).sort(); thr = s[s.length >> 1] + 55; } // median shift cancels exposure drift
      const parts = [];
      for (const cell of cells) {
        if (pd && cell.d <= thr) continue; // background block: stays as plate
        const sweep = kind === 'vanish' ? cell.x / W : 1 - cell.x / W;
        parts.push({
          x: cell.x, y: cell.y, col: `rgb(${cell.c[0]},${cell.c[1]},${cell.c[2]})`,
          delay: sweep * 0.9 + Math.random() * 0.35,
          vx: 50 + Math.random() * 150, vy: -(10 + Math.random() * 90) + (Math.random() - 0.5) * 40,
          ox: 60 + Math.random() * 200, oy: (Math.random() - 0.4) * 150,
          gone: false, landed: false,
        });
      }
      const remain = document.createElement('canvas'); remain.width = W; remain.height = H;
      const rg = remain.getContext('2d');
      if (kind === 'vanish') for (const p of parts) rg.drawImage(sc, p.x, p.y, B, B, p.x, p.y, B, B);
      P.fx = { kind, t0: performance.now(), parts, remain, rg, sc, B };
    };

    P.frame = (now) => {
      if (P.stopped || v.readyState < 2) return;
      const m = state.mode;
      if (m === 'visible') { P.fx = null; g.drawImage(v, 0, 0, W, H); return; }
      if (!P.fx) P.begin(m === 'returning' ? 'return' : 'vanish');
      bg();
      if (m === 'gone') return;
      const fx = P.fx, B = fx.B, t = (now - fx.t0) / 1000;
      if (fx.kind === 'vanish') {
        for (const p of fx.parts) if (!p.gone && t >= p.delay) { p.gone = true; fx.rg.clearRect(p.x, p.y, B, B); }
        g.drawImage(fx.remain, 0, 0);
        for (const p of fx.parts) {
          const u = t - p.delay;
          if (u < 0 || u >= LIFE) continue;
          const k = u / LIFE;
          g.globalAlpha = 1 - k * k;
          g.fillStyle = p.col;
          const s = B * (1 - 0.6 * k) + 0.5;
          g.fillRect(p.x + p.vx * u * (1 + k * 1.5) + Math.sin(u * 6 + p.x) * 3, p.y + p.vy * u * (1 + k), s, s);
        }
      } else {
        for (const p of fx.parts) if (!p.landed && t - p.delay >= LIFE) { p.landed = true; fx.rg.drawImage(fx.sc, p.x, p.y, B, B, p.x, p.y, B, B); }
        g.drawImage(fx.remain, 0, 0);
        for (const p of fx.parts) {
          const u = t - p.delay;
          if (u < 0 || u >= LIFE) continue;
          const k = u / LIFE, e = 1 - Math.pow(1 - k, 3);
          g.globalAlpha = Math.min(1, k * 2);
          g.fillStyle = p.col;
          const s = B * (0.5 + 0.5 * e) + 0.5;
          g.fillRect(p.x + p.ox * (1 - e), p.y + p.oy * (1 - e), s, s);
        }
      }
      g.globalAlpha = 1;
    };

    const origStop = track.stop.bind(track);
    track.stop = () => {
      origStop(); P.stopped = true; srcTrack.stop();
      pipes.video = pipes.video.filter((x) => x !== P);
    };
    pipes.video.push(P);
    return P;
  }

  /* ---------- audio pipeline: mic -> gain -> track, plus a never-muted analyser for snap detection ---------- */
  function makeAudioPipeline(track, rawTrack) {
    const ctx = getCtx();
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const gain = ctx.createGain();
    gain.gain.value = state.muted ? 0 : 1;
    const dest = ctx.createMediaStreamDestination();
    src.connect(gain); gain.connect(dest);
    const an = ctx.createAnalyser();
    an.fftSize = 1024; an.smoothingTimeConstant = 0;
    ctx.createMediaStreamSource(new MediaStream([rawTrack || track])).connect(an);
    const out = dest.stream.getAudioTracks()[0];
    const A = { gain, an, out };
    const origStop = out.stop.bind(out);
    out.stop = () => {
      origStop(); track.stop(); if (rawTrack) rawTrack.stop();
      pipes.audio = pipes.audio.filter((x) => x !== A);
    };
    pipes.audio.push(A);
    return A;
  }

  /* ---------- snap detection ---------- */
  const det = { floor: null, cand: null, last: 0, buf: null };
  function bandDb(fa, lo, hi, binHz) {
    let s = 0, n = 0;
    for (let i = Math.floor(lo / binHz); i <= Math.min(fa.length - 1, Math.floor(hi / binHz)); i++) { s += Math.pow(10, fa[i] / 10); n++; }
    return 10 * Math.log10(s / Math.max(1, n) + 1e-12);
  }
  function detect() {
    const a = pipes.audio[pipes.audio.length - 1];
    if (!a || !S.enabled || !actx) return;
    const n = a.an.frequencyBinCount;
    if (!det.buf || det.buf.length !== n) det.buf = new Float32Array(n);
    a.an.getFloatFrequencyData(det.buf);
    const binHz = actx.sampleRate / a.an.fftSize;
    const hi = bandDb(det.buf, 2500, 9000, binHz), lo = bandDb(det.buf, 150, 1200, binHz);
    const now = performance.now();
    if (det.floor === null) { det.floor = hi; return; }
    const thr = 22 - (S.sensitivity / 100) * 14;          // 8 dB (very sensitive) .. 22 dB
    const rise = hi - Math.max(det.floor, -85);
    if (det.cand) {
      if (now - det.cand >= 90) {                           // a snap is over in <90 ms; speech/sibilants are not
        const isSnap = rise < thr * 0.5;
        det.cand = null;
        if (isSnap) { det.last = now; toggle(); } else det.last = now - 600;
      }
      return;
    }
    if (rise > thr && hi > lo - 10 && now - det.last > 1200) { det.cand = now; return; }
    det.floor += (hi - det.floor) * (hi < det.floor ? 0.2 : 0.02);
  }

  /* ---------- state machine ---------- */
  function toggle() {
    if (!S.enabled) return;
    if (state.mode === 'visible') vanish();
    else if (state.mode === 'gone') comeBack();
  }
  function vanish() {
    state.mode = 'vanishing'; state.endAt = performance.now() + DUR * 1000;
    pipes.video.forEach((p) => p.begin('vanish'));
    setMuted(true); meetMute(true);
    toast('\u{1FAF0} Snap!');
    if (!plate && !state.tipShown) {
      state.tipShown = true;
      setTimeout(() => toast('Tip: open the Snap Vanish popup and capture an empty-room shot so only you turns to dust.', 6000), 1500);
    }
  }
  function comeBack() {
    state.mode = 'returning'; state.endAt = performance.now() + DUR * 1000;
    pipes.video.forEach((p) => p.begin('return'));
    setMuted(false); meetMute(false);
    toast('\u{1FAF0} Snap! Welcome back');
  }
  function forceVisible() { state.mode = 'visible'; pipes.video.forEach((p) => { p.fx = null; }); if (state.muted) { setMuted(false); meetMute(false); } }
  function tick() {
    const now = performance.now();
    if ((state.mode === 'vanishing' || state.mode === 'returning') && now >= state.endAt) {
      state.mode = state.mode === 'vanishing' ? 'gone' : 'visible';
    }
    pipes.video.forEach((p) => p.frame(now));
  }
  function startLoops() {
    if (stopRender) return;
    stopRender = ticker(33, tick);
    stopDetect = ticker(10, detect);
    setInterval(refreshPill, 500);
  }

  /* ---------- empty-room plate ---------- */
  function setPlate(bitmap) { plate = bitmap; }
  async function loadPlate(dataUrl) {
    try {
      const bin = atob(dataUrl.split(',')[1]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      setPlate(await createImageBitmap(new Blob([arr], { type: 'image/jpeg' })));
    } catch (e) { console.warn('[Snap Vanish] could not load saved room shot', e); }
  }
  function capturePlate() {
    const P = pipes.video[0];
    if (!P) { toast('Join or preview a call first, then capture the empty room.', 4000); return; }
    let n = 5;
    const step = () => {
      if (n > 0) { toast(`Step out of frame… ${n}`, 1200); n--; setTimeout(step, 1000); return; }
      const c = document.createElement('canvas'); c.width = P.W; c.height = P.H;
      c.getContext('2d').drawImage(P.v, 0, 0, P.W, P.H);
      createImageBitmap(c).then(setPlate);
      post('save-plate', { dataUrl: c.toDataURL('image/jpeg', 0.85) });
      toast('Empty room saved. Step back in!', 3000);
    };
    step();
  }

  /* ---------- getUserMedia wrapper ---------- */
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async function (constraints) {
      const real = await orig(constraints);
      if (!S.enabled) return real;
      try {
        const out = new MediaStream();
        const vT = real.getVideoTracks()[0], aT = real.getAudioTracks()[0];
        if (vT) out.addTrack(makeVideoPipeline(vT).track);
        if (aT) {
          let raw = null;
          try { // unprocessed copy of the mic, used only to hear snaps (never sent to Meet)
            const id = aT.getSettings && aT.getSettings().deviceId;
            const rs = await orig({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
            raw = rs.getAudioTracks()[0];
          } catch (_) {}
          out.addTrack(makeAudioPipeline(aT, raw).out);
        }
        startLoops(); ensureHud();
        return out;
      } catch (e) {
        console.warn('[Snap Vanish] falling back to the normal stream', e);
        return real;
      }
    };
  }

  /* ---------- messages & hotkey ---------- */
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.__snapvanish !== true || m.dir !== 'in') return;
    if (m.type === 'settings') { Object.assign(S, m.settings); if (!S.enabled) forceVisible(); }
    else if (m.type === 'plate') loadPlate(m.dataUrl);
    else if (m.type === 'clear-plate') plate = null;
    else if (m.type === 'capture-plate') capturePlate();
    else if (m.type === 'test-snap') toggle();
  });
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); toggle(); }
  }, true);
  document.addEventListener('DOMContentLoaded', ensureHud);
  post('hello');
})();
