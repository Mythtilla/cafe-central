/* Café Central · live data layer.
   Progressive enhancement: the page ships with static content. If the API answers, we replace it with
   live data and open one EventSource so edits in /admin and new reviews appear without a reload.
   If the API is unreachable (file://, offline, standalone build) nothing changes. */
(function () {
  'use strict';

  var doc = document;
  var meta = doc.querySelector('meta[name="cc-api"]');
  var API = meta ? meta.content.replace(/\/$/, '') : '';
  if (!API && location.protocol === 'file:') return;

  var pt = /^pt/i.test(doc.documentElement.lang || '');
  var T = pt ? {
    outOf: 'em 5', reviewsN: function (n) { return n === 1 ? '1 opinião' : n + ' opiniões'; }, noReviews: 'Seja o primeiro a deixar uma opinião.',
    askPrice: 'sob consulta', allergens: 'Alergénios', thanksPending: 'Obrigado! A sua opinião será publicada após revisão.', thanksLive: 'Obrigado! A sua opinião já está publicada.',
    err: 'Não foi possível enviar. Tente de novo.', unavailable: 'Opiniões indisponíveis de momento.', reply: 'Resposta do Café Central', sending: 'A enviar…', send: 'Enviar opinião',
    fromGoogle: 'Do Google', close: 'Fechar', justNow: 'agora mesmo'
  } : {
    outOf: 'out of 5', reviewsN: function (n) { return n === 1 ? '1 review' : n + ' reviews'; }, noReviews: 'Be the first to leave a review.',
    askPrice: 'at the counter', allergens: 'Allergens', thanksPending: 'Thank you! Your review will appear once it has been checked.', thanksLive: 'Thank you! Your review is now live.',
    err: 'Could not send. Please try again.', unavailable: 'Reviews are unavailable right now.', reply: 'Reply from Café Central', sending: 'Sending…', send: 'Send review',
    fromGoogle: 'From Google', close: 'Close', justNow: 'just now'
  };

  /* ---------- helpers ---------- */
  function $(id) { return doc.getElementById(id); }
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function get(path) { return fetch(API + path, { headers: { Accept: 'application/json' } }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  var money = new Intl.NumberFormat(pt ? 'pt-PT' : 'en-GB', { style: 'currency', currency: 'EUR' });
  var rtf = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(pt ? 'pt-PT' : 'en-GB', { numeric: 'auto' }) : null;
  function ago(s) {
    var d = new Date(String(s).replace(' ', 'T') + 'Z'); if (isNaN(d)) return '';
    var sec = Math.round((d - Date.now()) / 1000), a = Math.abs(sec);
    if (a < 60) return T.justNow; if (!rtf) return d.toLocaleDateString();
    if (a < 3600) return rtf.format(Math.round(sec / 60), 'minute'); if (a < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
    if (a < 86400 * 30) return rtf.format(Math.round(sec / 86400), 'day'); return rtf.format(Math.round(sec / (86400 * 30)), 'month');
  }
  var starTpl = $('tplStar');
  function stars(n) {
    var wrap = el('span', 'stars'); wrap.setAttribute('role', 'img'); wrap.setAttribute('aria-label', n + ' ' + T.outOf);
    for (var i = 1; i <= 5; i++) {
      var s = starTpl ? starTpl.content.firstElementChild.cloneNode(true) : el('i', null, '★');
      s.classList.add(i <= Math.round(n) ? 'on' : 'off'); s.setAttribute('aria-hidden', 'true'); wrap.appendChild(s);
    }
    return wrap;
  }
  function reveal(node) { node.classList.add('is-in'); return node; }

  /* ---------- menu ---------- */
  var menuMount = $('menuMount'), iconClones = [];
  if (menuMount) iconClones = [].map.call(menuMount.querySelectorAll('.menu__icon'), function (n) { return n.cloneNode(true); });
  function iconFor(name, i) {
    var idx = /caf|coffee|bebid|drink/i.test(name) ? 0 : /past|doce|pastry|sweet|bolo/i.test(name) ? 1 : /sal|savour|sandes|snack/i.test(name) ? 2 : i % 3;
    return (iconClones[idx % (iconClones.length || 1)] || el('div', 'menu__icon')).cloneNode(true);
  }
  function renderMenu(cats) {
    if (!menuMount || !cats.length) return;                        // nothing published yet → keep the static menu
    menuMount.classList.add('is-live-data');
    menuMount.replaceChildren.apply(menuMount, cats.map(function (c, i) {
      var col = reveal(el('div', 'menu__col reveal')); col.setAttribute('data-delay', String(Math.min(i, 3)));
      col.appendChild(iconFor(c.name, i)); col.appendChild(el('h3', null, c.name));
      col.appendChild(el('p', 'menu__kicker', c.description || ''));
      var ul = el('ul');
      c.items.forEach(function (it) {
        var li = el('li', 'menu__item menu__item--live');
        if (it.photo_url) { var img = el('img', 'menu__photo'); img.src = API + it.photo_url; img.alt = ''; img.loading = 'lazy'; img.width = 64; img.height = 64; li.appendChild(img); }
        var txt = el('div', 'menu__txt'); txt.appendChild(el('b', null, it.name));
        if (it.description) txt.appendChild(el('p', 'menu__desc', it.description));
        if (it.tags.length || it.allergens.length) {
          var meta = el('div', 'menu__meta');
          it.tags.forEach(function (t) { meta.appendChild(el('span', 'chip', t)); });
          if (it.allergens.length) meta.appendChild(el('small', null, T.allergens + ': ' + it.allergens.join(', ')));
          txt.appendChild(meta);
        }
        li.appendChild(txt);
        li.appendChild(el('span', 'menu__price' + (it.price_cents == null ? ' is-ask' : ''), it.price_cents == null ? T.askPrice : money.format(it.price_cents / 100)));
        ul.appendChild(li);
      });
      col.appendChild(ul); return col;
    }));
    menuMount.style.setProperty('--cols', Math.min(cats.length, 3));
    var note = doc.querySelector('.menu__note'); if (note) note.hidden = false;
  }
  function loadMenu() { return get('/api/menu').then(function (d) { renderMenu(d.categories || []); }).catch(function () {}); }

  /* ---------- gallery + lightbox ---------- */
  var galSection = $('galeria'), galMount = $('galleryMount'), box = $('lightbox');
  function renderGallery(photos) {
    if (!galSection || !galMount) return;
    galSection.hidden = !photos.length; if (!photos.length) return;
    galMount.setAttribute('data-n', photos.length < 5 ? String(photos.length) : 'many');
    galMount.replaceChildren.apply(galMount, photos.map(function (p, i) {
      var b = el('button', 'gallery__item'); b.type = 'button'; b.setAttribute('aria-label', p.caption || 'Photo ' + (i + 1));
      var img = el('img'); img.src = API + p.url; img.alt = p.caption || ''; img.loading = 'lazy'; b.appendChild(img);
      if (p.caption) b.appendChild(el('span', null, p.caption));
      b.addEventListener('click', function () {
        if (!box || !box.showModal) return;
        $('lightboxImg').src = API + p.url; $('lightboxImg').alt = p.caption || ''; $('lightboxCap').textContent = p.caption || ''; box.showModal();
        if (window.CafeSound) window.CafeSound.play('tick');
      });
      return b;
    }));
  }
  if (box) { box.addEventListener('click', function (e) { if (e.target === box || e.target.closest('[data-close]')) box.close(); }); }
  function loadGallery() { return get('/api/gallery').then(function (d) { renderGallery(d.photos || []); }).catch(function () {}); }

  /* ---------- settings: hours, announcement, phone, address ---------- */
  function renderSettings(s) {
    var notice = $('notice');
    if (notice) { var a = (s.announcement || '').trim(); notice.hidden = !a; var t = notice.querySelector('[data-bind="announcement"]'); if (t) t.textContent = a; }
    var hours = (s.hours || '').trim(), box = doc.querySelector('[data-bind="hours"]');
    if (box && hours) {
      box.replaceChildren.apply(box, hours.split(/\r?\n/).filter(Boolean).map(function (line) {
        var parts = line.split('|'), row = el('div', 'visit__hours');
        row.appendChild(el('span', null, parts[0].trim())); if (parts[1]) row.appendChild(el('span', null, parts.slice(1).join('|').trim()));
        return row;
      }));
      doc.querySelectorAll('[data-hide-when-hours]').forEach(function (n) { n.hidden = true; });
    }
    var phone = doc.querySelector('a[data-bind="phone"]');
    if (phone && s.phone) { phone.textContent = s.phone; phone.href = 'tel:' + s.phone.replace(/[^\d+]/g, ''); }
    var addr = doc.querySelector('[data-bind="address"]');
    if (addr && s.address) { var parts = s.address.split(/\s·\s|\n/); addr.replaceChildren.apply(addr, parts.reduce(function (acc, p, i) { if (i) acc.push(doc.createElement('br')); acc.push(doc.createTextNode(p)); return acc; }, [])); }
  }
  function loadSettings() { return get('/api/settings').then(renderSettings).catch(function () {}); }

  /* ---------- reviews ---------- */
  var list = $('revList'), form = $('revForm');
  function renderSummary(s) {
    var avg = $('revAvg'), st = $('revStars'), cnt = $('revCount'); if (!avg) return;
    avg.textContent = s.count ? s.average.toFixed(1) : '—';
    st.replaceChildren(stars(s.average || 0)); cnt.textContent = s.count ? T.reviewsN(s.count) : T.noReviews;
    var ld = doc.querySelector('script[type="application/ld+json"]');
    if (ld) { try { var j = JSON.parse(ld.textContent); if (s.count) j.aggregateRating = { '@type': 'AggregateRating', ratingValue: s.average, reviewCount: s.count, bestRating: 5, worstRating: 1 }; else delete j.aggregateRating; ld.textContent = JSON.stringify(j); } catch (e) { /* leave as is */ } }
  }
  function reviewCard(r, fresh) {
    var c = el('article', 'review' + (fresh ? ' is-new' : ''));
    var top = el('div', 'review__top'); top.appendChild(stars(r.rating)); top.appendChild(el('time', null, ago(r.created_at))); c.appendChild(top);
    c.appendChild(el('p', 'review__text', r.text)); c.appendChild(el('p', 'review__by', r.name));
    if (r.reply) { var rp = el('div', 'review__reply'); rp.appendChild(el('b', null, T.reply)); rp.appendChild(el('p', null, r.reply)); c.appendChild(rp); }
    return c;
  }
  function loadReviews() {
    return get('/api/reviews?limit=12').then(function (d) {
      renderSummary(d.summary);
      var sec = $('opinioes'); if (sec) sec.hidden = false;
      doc.querySelectorAll('[data-needs="opinioes"]').forEach(function (n) { n.hidden = false; });
      if (!list) return;
      list.classList.remove('is-loading');
      list.replaceChildren.apply(list, d.reviews.length ? d.reviews.map(function (r) { return reviewCard(r, false); }) : [el('p', 'reviews__empty', T.noReviews)]);
    }).catch(function () { if (list) { list.classList.remove('is-loading'); list.replaceChildren(el('p', 'reviews__empty', T.unavailable)); } });
  }
  var quietUntil = 0;
  function addLive(review, summary) {
    quietUntil = Date.now() + 1800;                                // the 'review:update' that follows must not wipe the new card's animation
    renderSummary(summary); if (!list) return;
    var empty = list.querySelector('.reviews__empty'); if (empty) empty.remove();
    list.insertBefore(reviewCard(review, true), list.firstChild);
    if (window.CafeSound) window.CafeSound.play('ding');
  }

  if (form) {
    var msg = $('revMsg'), btn = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = new FormData(form), rating = data.get('rating');
      if (!rating) { msg.textContent = pt ? 'Escolha uma classificação.' : 'Please choose a rating.'; msg.className = 'form__msg is-bad'; return; }
      btn.disabled = true; btn.textContent = T.sending; msg.textContent = '';
      fetch(API + '/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: data.get('name'), rating: Number(rating), text: data.get('text'), website: data.get('website') }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.j.message || '');
          msg.className = 'form__msg is-ok'; msg.textContent = res.j.status === 'approved' ? T.thanksLive : T.thanksPending; form.reset();
          if (window.CafeSound) window.CafeSound.play('clink');
        })
        .catch(function (err) { msg.className = 'form__msg is-bad'; msg.textContent = err.message || T.err; })
        .then(function () { btn.disabled = false; btn.textContent = T.send; });
    });
  }

  /* optional Google block */
  function loadGoogle() {
    var box = $('googleReviews'); if (!box) return;
    get('/api/google-reviews').then(function (g) {
      if (!g.configured || !g.reviews || !g.reviews.length) return;
      box.hidden = false; var l = $('googleList'); l.replaceChildren();
      $('googleHead').textContent = T.fromGoogle + (g.rating ? ' · ' + g.rating.toFixed(1) + ' ★ (' + g.count + ')' : '');
      g.reviews.forEach(function (r) { var c = el('article', 'review'); var top = el('div', 'review__top'); top.appendChild(stars(r.rating)); top.appendChild(el('time', null, r.when)); c.appendChild(top); c.appendChild(el('p', 'review__text', r.text)); c.appendChild(el('p', 'review__by', r.author + ' · Google')); l.appendChild(c); });
      if (g.url) { var a = el('a', 'arrow-link', 'Google Maps'); a.href = g.url; a.target = '_blank'; a.rel = 'noopener'; box.appendChild(a); }
    }).catch(function () {});
  }

  /* ---------- go ---------- */
  loadMenu(); loadGallery(); loadSettings(); loadReviews(); loadGoogle();

  if ('EventSource' in window) {
    var es = new EventSource(API + '/api/events');
    es.addEventListener('review', function (e) { var d = JSON.parse(e.data); addLive(d.review, d.summary); });
    es.addEventListener('review:update', function (e) { if (Date.now() < quietUntil) { try { renderSummary(JSON.parse(e.data).summary); } catch (x) { /* ignore */ } } else loadReviews(); });
    es.addEventListener('menu', loadMenu);
    es.addEventListener('gallery', loadGallery);
    es.addEventListener('settings', loadSettings);
    window.addEventListener('pagehide', function () { es.close(); });
  }
})();
