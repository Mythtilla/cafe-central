/* Café Central · "walking into the café" entrance.
   Dusk on Rua 21 de Agosto → camera pushes toward the door → footsteps, latch, shop bell →
   the doors swing in → warm light floods the screen → the page appears.
   Skips for: ?intro=0, prefers-reduced-motion, repeat visits in the same session (use ?intro=1 to force). */
(function () {
  'use strict';

  var root = document.documentElement, doc = document;
  var enter = doc.getElementById('enter');
  if (!enter) return;

  function finishInstantly() {
    enter.remove();
    root.classList.remove('intro-on');
    root.classList.add('is-live');
  }
  if (!root.classList.contains('intro-on')) return finishInstantly();

  var stage = enter.querySelector('.enter__stage');
  var door = doc.getElementById('introDoor');
  var doorL = enter.querySelector('.door-l');
  var doorR = enter.querySelector('.door-r');
  var light = enter.querySelector('.enter__light');
  var ui = enter.querySelector('.enter__ui');
  var line = enter.querySelector('.enter__line');
  var btnSound = doc.getElementById('enterSound');
  var btnSilent = doc.getElementById('enterSilent');
  var btnSkip = doc.getElementById('enterSkip');
  if (!stage || !door || !doorL || !doorR || !light || !window.Element.prototype.animate) return finishInstantly();

  var timers = [], anims = [], started = false, done = false, withSound = false;
  var S = window.CafeSound;

  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function anim(el, frames, opts) { var a = el.animate(frames, opts); anims.push(a); return a; }
  function setLine(text) {
    if (!line) return;
    line.style.opacity = 0;
    later(function () { line.textContent = text; line.style.opacity = 1; }, 260);
  }

  /* keep the page behind the overlay out of reach of keyboard / screen readers */
  var hidden = [].slice.call(doc.body.children).filter(function (el) { return el !== enter; });
  hidden.forEach(function (el) { el.inert = true; });

  /* ---- geometry: where is the door on screen, and how far must we zoom? ---- */
  var origin = { x: 0, y: 0 }, target = 12;
  function measure() {
    var s = stage.getBoundingClientRect(), d = door.getBoundingClientRect();
    origin.x = d.left + d.width / 2 - s.left;
    origin.y = d.top + d.height / 2 - s.top;
    stage.style.transformOrigin = origin.x + 'px ' + origin.y + 'px';
    target = Math.min(26, Math.max(innerWidth / d.width, innerHeight / d.height) * 1.12);
  }
  measure();
  window.addEventListener('resize', function () { if (!started) measure(); });

  /* ---- scene in: fade up + slow idle push-in ---- */
  anim(stage, [{ opacity: 0 }, { opacity: 1 }], { duration: 1100, easing: 'ease-out', fill: 'forwards' });
  var idle = anim(stage, [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }], { duration: 7000, easing: 'linear', fill: 'forwards' });
  later(function () { enter.classList.add('is-ready'); if (btnSound) btnSound.focus({ preventScroll: true }); }, 900);
  var auto = later(function () { go(false); }, 5200); // nobody clicked: walk in silently

  /* ---- the walk ---- */
  function go(sound) {
    if (started) return;
    started = true; withSound = !!sound; clearTimeout(auto);
    if (withSound && S) S.unlock();          // inside the click → browsers allow audio from here on
    enter.classList.add('is-walking');
    ui.style.opacity = 0; ui.style.pointerEvents = 'none';
    setLine('Rua 21 de Agosto, 3');

    var cur = getComputedStyle(stage).transform;
    if (!cur || cur === 'none') cur = 'scale(1)';
    idle.cancel();

    /* camera: long push toward the door */
    anim(stage, [{ transform: cur }, { transform: 'scale(' + (target * 0.42).toFixed(2) + ')' }], { duration: 2400, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' });

    /* footsteps */
    if (withSound && S) [0, 0.46, 0.92, 1.38, 1.84].forEach(function (t) { S.playForced('step', t); });

    /* handle, latch, bell, doors swing in */
    later(function () { if (withSound && S) S.playForced('latch'); }, 2050);
    later(function () {
      setLine('Bem-vindo.');
      if (withSound && S) { S.playForced('bell'); S.playForced('bell', 0.62); }
      anim(doorL, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(.09)' }], { duration: 1000, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
      anim(doorR, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(.09)' }], { duration: 1000, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
    }, 2250);

    /* through the doorway */
    later(function () {
      anim(stage, [{ transform: 'scale(' + (target * 0.42).toFixed(2) + ')' }, { transform: 'scale(' + target.toFixed(2) + ')' }], { duration: 1600, easing: 'cubic-bezier(.55,0,.85,.35)', fill: 'forwards' });
      if (withSound && S) S.set(true);       // café ambience fades in as we step inside
    }, 2500);

    /* warm light floods the frame */
    later(function () { anim(light, [{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: 'ease-in', fill: 'forwards' }); }, 3250);

    /* the page appears */
    later(function () {
      root.classList.add('is-live');
      anim(enter, [{ opacity: 1 }, { opacity: 0 }], { duration: 1000, easing: 'ease-out', fill: 'forwards' });
    }, 4100);
    later(finish, 5200);
  }

  function finish() {
    if (done) return; done = true;
    timers.forEach(clearTimeout);
    hidden.forEach(function (el) { el.inert = false; });
    try { sessionStorage.setItem('cc_intro', '1'); } catch (e) { /* private mode */ }
    enter.remove();
    root.classList.remove('intro-on');
    root.classList.add('is-live');
    window.scrollTo(0, 0);
  }

  function skip() {
    if (done) return;
    timers.forEach(clearTimeout); anims.forEach(function (a) { try { a.cancel(); } catch (e) { /* noop */ } });
    clearTimeout(auto);
    root.classList.add('is-live');
    var fade = enter.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: 'ease-out', fill: 'forwards' });
    fade.onfinish = finish;
    later(finish, 600);
    if (withSound && S) S.set(true);
  }

  if (btnSound) btnSound.addEventListener('click', function () { go(true); });
  if (btnSilent) btnSilent.addEventListener('click', function () { go(false); });
  if (btnSkip) btnSkip.addEventListener('click', skip);
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !done) skip(); });

  /* a visitor who chose sound last time gets the sound button pre-focused, never auto-played */
  if (S && S.wasEnabled() && btnSound) btnSound.textContent = 'Enter with sound';
})();
