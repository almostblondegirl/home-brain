(() => {
  'use strict';

  const PRESETS = [3, 5, 10, 15, 20, 30];
  const EXACT_OPTIONS = [1,2,3,4,5,6,7,8,9,10,12,15,18,20,25,30,35,40,45,50,55,60,75,90,120,180];
  const DIAL_MAX = 60;
  const MAX_MINUTES = 480;
  const STORE_KEY = 'focus-timer-v1';
  const RING_R = 104;
  const RING_C = 2 * Math.PI * RING_R;

  const state = {
    durationMs: 10 * 60 * 1000,
    remainingMs: 10 * 60 * 1000,
    endsAt: null,
    running: false,
    finished: false,
    sound: true
  };

  let rafId = null;
  let endTimeoutId = null;
  let wakeLock = null;
  let dragging = false;
  let audioCtx = null;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (s.durationMs > 0) { state.durationMs = state.remainingMs = s.durationMs; }
      if (typeof s.sound === 'boolean') state.sound = s.sound;
    } catch (e) {}
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ durationMs: state.durationMs, sound: state.sound })); } catch (e) {}
  }

  function formatOption(m) {
    if (m < 60) return m + ' min';
    const h = m / 60;
    return (Number.isInteger(h) ? h : h.toFixed(1)) + (h === 1 ? ' hour' : ' hours');
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  function currentRemaining() {
    if (!state.running) return state.remainingMs;
    return Math.max(0, state.endsAt - Date.now());
  }

  // --- Build DOM ---
  const mount = document.getElementById('app');
  if (!mount) { console.error('No #app element'); return; }

  const style = document.createElement('style');
  style.textContent = `
    :root{--bg:#12131a;--panel:#1b1d27;--ink:#edeef2;--muted:#9aa0b0;--accent:#6ee7b7;--warn:#fbbf24;--radius:14px;color-scheme:dark}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px 16px}
    .ft-wrap{width:100%;max-width:420px;text-align:center}
    .ft-dial{position:relative;width:100%;max-width:300px;margin:0 auto;touch-action:none}
    .ft-dial svg{display:block;width:100%;height:auto}
    .ft-track{fill:none;stroke:#272a37;stroke-width:16}
    .ft-prog{fill:none;stroke:var(--accent);stroke-width:16;stroke-linecap:round;transform:rotate(-90deg);transform-origin:120px 120px;transition:stroke .2s}
    .ft-knob{fill:var(--ink);stroke:var(--bg);stroke-width:3;cursor:grab}
    .ft-dial[data-locked="true"] .ft-knob{display:none}
    .ft-readout{position:absolute;inset:0;display:grid;place-content:center;gap:2px;pointer-events:none}
    .ft-time{font-size:clamp(38px,13vw,56px);font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
    .ft-status{font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.09em}
    .ft-wrap[data-finished="true"] .ft-prog{stroke:var(--warn)}
    .ft-wrap[data-finished="true"] .ft-time{color:var(--warn);animation:ft-pulse 1.1s ease-in-out infinite}
    @keyframes ft-pulse{50%{opacity:.35}}
    @media(prefers-reduced-motion:reduce){.ft-time{animation:none!important}}
    .ft-row{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
    .ft-presets{margin:20px 0 14px}
    button{font:inherit;color:var(--ink);background:var(--panel);border:1px solid #2c2f3d;border-radius:var(--radius);padding:12px 14px;min-height:46px;min-width:62px;cursor:pointer;transition:background .15s,border-color .15s,transform .05s}
    button:hover{background:#23263280;border-color:#3a3e50}
    button:active{transform:translateY(1px)}
    button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);background:#14251f}
    .ft-primary{flex:1 1 150px;background:var(--accent);color:#08130f;border-color:var(--accent);font-weight:650;min-height:56px;font-size:17px}
    .ft-primary:hover{background:#8af0c6;border-color:#8af0c6}
    .ft-ghost{flex:0 1 auto}
    .ft-controls{margin:16px 0}
    .ft-exact{background:var(--panel);border:1px solid #2c2f3d;border-radius:var(--radius);padding:12px;margin-top:6px;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap}
    .ft-exact label{font-size:13px;color:var(--muted)}
    select,input[type="number"]{font:inherit;color:var(--ink);background:#14161f;border:1px solid #2c2f3d;border-radius:10px;padding:9px 10px;min-height:42px}
    input[type="number"]{width:78px;text-align:center}
    .ft-hint{margin-top:14px;font-size:12.5px;color:var(--muted)}
    .ft-hint kbd{background:#22252f;border:1px solid #343849;border-bottom-width:2px;border-radius:5px;padding:1px 5px;font-size:11.5px}
  `;
  document.head.appendChild(style);

  let presetsHTML = '';
  PRESETS.forEach(function(m) {
    presetsHTML += '<button type="button" data-preset="' + m + '" aria-pressed="false">' + m + ' min</button>';
  });

  let optionsHTML = '<option value="">choose...</option>';
  EXACT_OPTIONS.forEach(function(m) {
    optionsHTML += '<option value="' + m + '">' + formatOption(m) + '</option>';
  });

  mount.innerHTML = '<div class="ft-wrap" data-finished="false">'
    + '<div class="ft-dial" data-locked="false" role="slider" tabindex="0" aria-label="Session length" aria-valuemin="1" aria-valuemax="' + DIAL_MAX + '" aria-valuenow="10">'
    + '<svg viewBox="0 0 240 240" aria-hidden="true">'
    + '<circle class="ft-track" cx="120" cy="120" r="' + RING_R + '"></circle>'
    + '<circle class="ft-prog" cx="120" cy="120" r="' + RING_R + '" stroke-dasharray="' + RING_C.toFixed(2) + '" stroke-dashoffset="0"></circle>'
    + '<circle class="ft-knob" cx="120" cy="16" r="11"></circle>'
    + '</svg>'
    + '<div class="ft-readout"><div class="ft-time">10:00</div><div class="ft-status">drag ring to set</div></div>'
    + '</div>'
    + '<div class="ft-row ft-presets" role="group" aria-label="Quick presets">' + presetsHTML + '</div>'
    + '<div class="ft-row ft-controls">'
    + '<button type="button" class="ft-primary" data-action="toggle">Start</button>'
    + '<button type="button" class="ft-ghost" data-action="reset">Reset</button>'
    + '<button type="button" class="ft-ghost" data-action="add" data-min="5">+5</button>'
    + '<button type="button" class="ft-ghost" data-action="sound" aria-pressed="true">&#128266;</button>'
    + '</div>'
    + '<div class="ft-exact">'
    + '<label for="ft-select">Other:</label>'
    + '<select id="ft-select">' + optionsHTML + '</select>'
    + '<label for="ft-custom">or</label>'
    + '<input id="ft-custom" type="number" min="1" max="' + MAX_MINUTES + '" step="1" placeholder="min" aria-label="Custom minutes">'
    + '<button type="button" data-action="apply-custom">Set</button>'
    + '</div>'
    + '<p class="ft-hint"><kbd>Space</kbd> start/pause · <kbd>R</kbd> reset · <kbd>1</kbd>-<kbd>6</kbd> presets · <kbd>↑</kbd><kbd>↓</kbd> ±1 min</p>'
    + '</div>';

  function $(sel) { return mount.querySelector(sel); }
  const el = {
    wrap: $('.ft-wrap'),
    dial: $('.ft-dial'),
    svg: $('.ft-dial svg'),
    prog: $('.ft-prog'),
    knob: $('.ft-knob'),
    time: $('.ft-time'),
    status: $('.ft-status'),
    toggle: $('[data-action="toggle"]'),
    soundBtn: $('[data-action="sound"]'),
    select: $('#ft-select'),
    custom: $('#ft-custom'),
    presets: Array.from(mount.querySelectorAll('[data-preset]'))
  };

  // --- Render ---
  function render() {
    var remaining = currentRemaining();
    var minutes = state.durationMs / 60000;

    el.time.textContent = formatClock(remaining);

    var frac = state.durationMs > 0 ? Math.min(1, Math.max(0, remaining / state.durationMs)) : 0;
    el.prog.setAttribute('stroke-dashoffset', (RING_C * (1 - frac)).toFixed(2));

    var knobMin = (state.running || state.finished) ? remaining / 60000 : minutes;
    var angle = (Math.min(knobMin, DIAL_MAX) / DIAL_MAX) * 360 - 90;
    var rad = angle * Math.PI / 180;
    el.knob.setAttribute('cx', (120 + RING_R * Math.cos(rad)).toFixed(2));
    el.knob.setAttribute('cy', (120 + RING_R * Math.sin(rad)).toFixed(2));

    el.dial.dataset.locked = String(state.running);
    el.wrap.dataset.finished = String(state.finished);

    el.status.textContent = state.finished ? 'done - nice work'
      : state.running ? 'focusing'
      : remaining !== state.durationMs ? 'paused'
      : 'drag ring to set';

    el.toggle.textContent = state.finished ? 'Go again'
      : state.running ? 'Pause'
      : remaining !== state.durationMs ? 'Resume'
      : 'Start';

    el.soundBtn.setAttribute('aria-pressed', String(state.sound));
    el.soundBtn.innerHTML = state.sound ? '&#128266;' : '&#128263;';

    el.presets.forEach(function(b) {
      b.setAttribute('aria-pressed', String(!state.running && Number(b.dataset.preset) === minutes));
    });

    document.title = (state.running || state.finished)
      ? formatClock(remaining) + ' - Focus'
      : 'Focus Timer';
  }

  // --- Engine ---
  function loop() {
    if (!state.running) return;
    if (Date.now() >= state.endsAt) { finish(); return; }
    render();
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (state.finished) reset();
    if (state.remainingMs <= 0) return;
    state.running = true;
    state.endsAt = Date.now() + state.remainingMs;
    requestWL();
    scheduleEnd();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
    render();
  }

  function pause() {
    if (!state.running) return;
    state.remainingMs = currentRemaining();
    state.running = false;
    cancelAnimationFrame(rafId);
    clearTimeout(endTimeoutId);
    releaseWL();
    render();
  }

  function toggle() { state.running ? pause() : start(); }

  function reset() {
    state.running = false;
    state.finished = false;
    state.remainingMs = state.durationMs;
    state.endsAt = null;
    cancelAnimationFrame(rafId);
    clearTimeout(endTimeoutId);
    releaseWL();
    render();
  }

  function finish() {
    state.running = false;
    state.finished = true;
    state.remainingMs = 0;
    cancelAnimationFrame(rafId);
    clearTimeout(endTimeoutId);
    releaseWL();
    chime();
    if (navigator.vibrate) navigator.vibrate([220, 120, 220, 120, 320]);
    render();
  }

  function scheduleEnd() {
    clearTimeout(endTimeoutId);
    endTimeoutId = setTimeout(function() {
      if (state.running && Date.now() >= state.endsAt - 50) finish();
    }, Math.max(0, state.endsAt - Date.now()));
  }

  // --- Duration ---
  function setMinutes(min) {
    var m = Math.min(MAX_MINUTES, Math.max(1, Math.round(min)));
    state.durationMs = m * 60000;
    state.finished = false;
    pause();
    state.remainingMs = state.durationMs;
    save();
    render();
  }

  function addMinutes(delta) {
    if (state.finished) { setMinutes(Math.abs(delta)); return; }
    if (state.running) {
      state.endsAt = Math.max(Date.now() + 1000, state.endsAt + delta * 60000);
      state.durationMs = Math.max(state.durationMs, state.endsAt - Date.now());
      scheduleEnd();
      render();
    } else {
      setMinutes(state.durationMs / 60000 + delta);
    }
  }

  // --- Dial Drag ---
  function pointToMinutes(cx, cy) {
    var r = el.svg.getBoundingClientRect();
    var dx = cx - (r.left + r.width / 2);
    var dy = cy - (r.top + r.height / 2);
    var deg = Math.atan2(dx, -dy) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    var m = Math.round(deg / (360 / DIAL_MAX));
    if (m === 0) m = (state.durationMs / 60000 > DIAL_MAX / 2) ? DIAL_MAX : 1;
    return Math.min(DIAL_MAX, Math.max(1, m));
  }

  el.svg.addEventListener('pointerdown', function(e) {
    if (state.running) return;
    dragging = true;
    if (el.svg.setPointerCapture) el.svg.setPointerCapture(e.pointerId);
    setMinutes(pointToMinutes(e.clientX, e.clientY));
  });
  el.svg.addEventListener('pointermove', function(e) {
    if (!dragging) return;
    e.preventDefault();
    setMinutes(pointToMinutes(e.clientX, e.clientY));
  });
  el.svg.addEventListener('pointerup', function() { dragging = false; });
  el.svg.addEventListener('pointercancel', function() { dragging = false; });

  el.dial.addEventListener('keydown', function(e) {
    var step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { addMinutes(step); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { addMinutes(-step); e.preventDefault(); }
  });

  // --- Click Actions ---
  mount.addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.preset) { setMinutes(Number(btn.dataset.preset)); return; }
    switch (btn.dataset.action) {
      case 'toggle': toggle(); break;
      case 'reset': reset(); break;
      case 'add': addMinutes(Number(btn.dataset.min || 5)); break;
      case 'sound':
        state.sound = !state.sound;
        save();
        if (state.sound) chime(0.35);
        render();
        break;
      case 'apply-custom':
        var v = Number(el.custom.value);
        if (v >= 1 && v <= MAX_MINUTES) { setMinutes(v); el.select.value = ''; }
        break;
    }
  });

  el.select.addEventListener('change', function() {
    if (el.select.value) { setMinutes(Number(el.select.value)); el.custom.value = ''; }
  });

  el.custom.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var v = Number(el.custom.value);
      if (v >= 1 && v <= MAX_MINUTES) { setMinutes(v); el.select.value = ''; }
    }
  });

  document.addEventListener('keydown', function(e) {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
    if (e.key.toLowerCase() === 'r') { reset(); return; }
    if (e.key === '+' || e.key === '=') { addMinutes(1); return; }
    if (e.key === '-') { addMinutes(-1); return; }
    var n = Number(e.key);
    if (n >= 1 && n <= PRESETS.length) setMinutes(PRESETS[n - 1]);
  });

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState !== 'visible') return;
    if (state.running && Date.now() >= state.endsAt) finish();
    else { requestWL(); render(); }
  });

  // --- Audio ---
  function chime(vol) {
    if (!state.sound) return;
    var scale = vol || 1;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t0 = audioCtx.currentTime;
      [880, 1174.7, 1567.98].forEach(function(freq, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        var at = t0 + i * 0.18;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.22 * scale, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(at);
        osc.stop(at + 0.6);
      });
    } catch (e) {}
  }

  // --- Wake Lock ---
  function requestWL() {
    if (!state.running || !navigator.wakeLock || wakeLock) return;
    navigator.wakeLock.request('screen').then(function(lock) {
      wakeLock = lock;
      lock.addEventListener('release', function() { wakeLock = null; });
    }).catch(function() { wakeLock = null; });
  }
  function releaseWL() {
    try { if (wakeLock) wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }

  // --- Boot ---
  load();
  render();
})();