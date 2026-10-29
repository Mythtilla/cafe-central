/* Café Central · sound. Every sound is synthesized with Web Audio: no audio files, works offline.
   Browsers only allow audio after a user gesture, so nothing plays until unlock() is called from a click. */
(function () {
  'use strict';

  var KEY = 'cc_sound';
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master = null, noiseBuf = null, ambience = null, timer = null;
  var enabled = false, listeners = [];

  function store(v) { try { if (v === undefined) return localStorage.getItem(KEY); localStorage.setItem(KEY, v); } catch (e) { return null; } }
  function emit() { listeners.forEach(function (fn) { fn(enabled); }); }

  function ensure() {
    if (!AC) return false;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.9;
      var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ctx.destination);
      var len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      noiseBuf = buf;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  /* ---- building blocks ---- */
  function noise(dest, t, dur, type, freq, q, peak, attack) {
    var src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || master);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  function tone(freq, t, dur, peak, type, dest) {
    var o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
    var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.05);
  }

  /* ---- the sounds ---- */
  var sounds = {
    /* soft step on calçada: a dull thump + a short scuff */
    step: function (t) {
      tone(95 + Math.random() * 25, t, 0.11, 0.32, 'sine');
      noise(null, t, 0.09, 'bandpass', 700 + Math.random() * 400, 0.9, 0.22, 0.004);
    },
    /* door handle + latch */
    latch: function (t) {
      noise(null, t, 0.035, 'bandpass', 2600, 4, 0.35, 0.002);
      tone(170, t + 0.01, 0.12, 0.2, 'triangle');
      noise(null, t + 0.12, 0.05, 'bandpass', 1500, 3, 0.2, 0.002);
    },
    /* the little brass bell above the door: inharmonic partials, long decay */
    bell: function (t) {
      [[1568, 0.22, 1.9], [2093, 0.16, 1.5], [3136, 0.12, 1.1], [4186, 0.07, 0.8], [5588, 0.04, 0.5]].forEach(function (p) {
        tone(p[0] * (1 + (Math.random() - 0.5) * 0.002), t, p[2], p[1], 'sine');
      });
      noise(null, t, 0.03, 'highpass', 5000, 1, 0.12, 0.001);
    },
    /* cup on saucer */
    clink: function (t) {
      tone(3520, t, 0.35, 0.07, 'sine'); tone(5274, t + 0.002, 0.22, 0.04, 'sine'); tone(2349, t, 0.18, 0.04, 'sine');
    },
    /* espresso machine steam wand */
    hiss: function (t) {
      noise(null, t, 1.9, 'highpass', 3200, 0.7, 0.05, 0.35);
      noise(null, t + 0.2, 1.5, 'bandpass', 6000, 0.6, 0.025, 0.3);
    },
    /* a new review arrives */
    ding: function (t) { tone(880, t, 0.5, 0.12, 'sine'); tone(1318.5, t + 0.12, 0.7, 0.1, 'sine'); },
    /* soft UI tick */
    tick: function (t) { noise(null, t, 0.03, 'bandpass', 1800, 2, 0.18, 0.002); tone(420, t, 0.05, 0.08, 'triangle'); }
  };

  function play(name, delay) {
    if (!enabled || !ctx || !sounds[name]) return;
    sounds[name](ctx.currentTime + 0.02 + (delay || 0));
  }

  /* intro uses these even before "enabled" is persisted, so allow a forced play */
  function playForced(name, delay) {
    if (!ensure() || !sounds[name]) return;
    sounds[name](ctx.currentTime + 0.02 + (delay || 0));
  }

  /* ---- room ambience: low murmur + occasional clinks / steam ---- */
  function startAmbience() {
    if (!enabled || !ensure() || ambience) return;
    var src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 0.6;
    var g = ctx.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.045, ctx.currentTime + 2.5);
    var lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    var lfoG = ctx.createGain(); lfoG.gain.value = 90; lfo.connect(lfoG); lfoG.connect(bp.frequency); lfo.start();
    src.connect(lp); lp.connect(bp); bp.connect(g); g.connect(master); src.start();
    ambience = { src: src, g: g, lfo: lfo };

    (function schedule() {
      timer = setTimeout(function () {
        if (!enabled || document.hidden) return schedule();
        var r = Math.random();
        if (r < 0.62) { play('clink'); if (Math.random() < 0.4) play('clink', 0.34); }
        else play('hiss');
        schedule();
      }, 5500 + Math.random() * 7500);
    })();
  }
  function stopAmbience() {
    clearTimeout(timer); timer = null;
    if (!ambience || !ctx) return;
    var a = ambience; ambience = null;
    a.g.gain.cancelScheduledValues(ctx.currentTime);
    a.g.gain.setValueAtTime(Math.max(a.g.gain.value, 0.0001), ctx.currentTime);
    a.g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    setTimeout(function () { try { a.src.stop(); a.lfo.stop(); } catch (e) { /* already stopped */ } }, 700);
  }

  /* ---- public API ---- */
  var api = {
    supported: !!AC,
    get enabled() { return enabled; },
    /* call from a click handler */
    unlock: function () { return ensure(); },
    set: function (on, persist) {
      if (!AC) return;
      enabled = !!on;
      if (enabled) { ensure(); startAmbience(); } else stopAmbience();
      if (persist !== false) store(enabled ? '1' : '0');
      emit();
    },
    toggle: function () { api.set(!enabled); if (enabled) play('tick'); },
    wasEnabled: function () { return store() === '1'; },
    play: play,
    playForced: playForced,
    onChange: function (fn) { listeners.push(fn); }
  };
  window.CafeSound = api;

  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else if (enabled) ctx.resume();
  });

  /* [data-snd="clink"] on any element → plays that sound on click (only when sound is on) */
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-snd]');
    if (el) play(el.getAttribute('data-snd'));
  });

  /* floating toggle */
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('soundToggle');
    if (!btn) return;
    if (!AC) { btn.hidden = true; return; }
    function paint() {
      btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      btn.setAttribute('aria-label', enabled ? 'Turn café sounds off' : 'Turn café sounds on');
      btn.classList.toggle('is-on', enabled);
    }
    btn.addEventListener('click', function () { api.toggle(); });
    api.onChange(paint); paint();
  });
})();
