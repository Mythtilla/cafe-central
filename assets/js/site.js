/* Café Central · Viseu — interactions */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- header state ---------- */
  var head = doc.getElementById('siteHead');
  var progress = doc.getElementById('progress');

  function onScroll() {
    var y = window.scrollY || 0;
    if (head) head.classList.toggle('is-scrolled', y > 8);
    if (progress) {
      var max = doc.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = max > 0 ? Math.min(100, (y / max) * 100) + '%' : '0%';
    }
    if (!reduce) {
      var art = doc.querySelector('.hero__art');
      if (art && y < window.innerHeight * 1.2) {
        art.style.setProperty('--py', Math.min(18, y * 0.05).toFixed(2));
      }
    }
  }

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(function () {
        onScroll();
        ticking = false;
      });
    }
  }, { passive: true });
  onScroll();

  /* ---------- drawer ---------- */
  var burger = doc.getElementById('burger');
  var drawer = doc.getElementById('drawer');

  function setDrawer(open) {
    if (!drawer || !burger) return;
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    drawer.inert = !open;
    doc.body.classList.toggle('no-scroll', open);
  }

  if (drawer) drawer.inert = true;

  if (burger) {
    burger.addEventListener('click', function () {
      setDrawer(burger.getAttribute('aria-expanded') !== 'true');
    });
  }

  if (drawer) {
    drawer.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { setDrawer(false); });
    });
  }

  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setDrawer(false);
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 980) setDrawer(false);
  });

  /* ---------- reveal ---------- */
  var params = new URLSearchParams(window.location.search);
  var staticMode = params.has('static') || reduce;
  var revealItems = doc.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !staticMode) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
    revealItems.forEach(function (el) { io.observe(el); });
  } else {
    revealItems.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- current section in nav ---------- */
  var navLinks = Array.prototype.slice.call(doc.querySelectorAll('.nav a'));
  var sections = ['casa', 'carta', 'rota', 'opinioes', 'visitar'].map(function (id) {
    return doc.getElementById(id);
  }).filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (a) {
          a.classList.toggle('is-current', a.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---------- route: list <-> map ---------- */
  var stops = doc.querySelectorAll('.stop[data-stop]');
  var pins = doc.querySelectorAll('.map-pin[data-stop]');

  function activate(id, on) {
    stops.forEach(function (s) {
      if (s.getAttribute('data-stop') === id) s.classList.toggle('is-active', on);
    });
    pins.forEach(function (p) {
      if (p.getAttribute('data-stop') === id) p.classList.toggle('is-active', on);
    });
  }

  stops.forEach(function (stop) {
    var id = stop.getAttribute('data-stop');
    stop.addEventListener('mouseenter', function () { activate(id, true); });
    stop.addEventListener('mouseleave', function () { activate(id, false); });
    stop.setAttribute('tabindex', '0');
    stop.addEventListener('focus', function () { activate(id, true); });
    stop.addEventListener('blur', function () { activate(id, false); });
  });

  pins.forEach(function (pin) {
    var id = pin.getAttribute('data-stop');
    pin.addEventListener('mouseenter', function () { activate(id, true); });
    pin.addEventListener('mouseleave', function () { activate(id, false); });
  });

  /* ---------- hero: pointer parallax for the drifting beans ---------- */
  var hero = doc.querySelector('.hero');
  if (hero && !reduce && window.matchMedia('(hover:hover)').matches) {
    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      hero.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });
  }
})();
