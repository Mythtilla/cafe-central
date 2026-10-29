/* Café Central · admin SPA. No innerHTML anywhere: every string goes through textContent. */
const app = document.getElementById('app');
const toasts = document.getElementById('toasts');

/* ---------- tiny DOM helper ---------- */
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(9).forEach((c) => { if (c !== false && c != null) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return el;
};

const toast = (msg, bad) => {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  toasts.append(t); setTimeout(() => t.remove(), 2600);
};

/* ---------- api ---------- */
class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function api(path, { method = 'GET', body, raw, quiet } = {}) {
  const headers = { 'X-Requested-With': 'cafe-admin' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api/admin' + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), credentials: 'same-origin' });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { showLogin(); throw new ApiError(401, 'auth'); }
  if (!res.ok) { if (!quiet) toast(json.message || 'Erro', true); throw new ApiError(res.status, json.message || json.error); }
  return json;
}
const eur = (cents) => (cents == null ? 'sob consulta' : (cents / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }));
const toCents = (text) => {
  const t = String(text).trim().replace(',', '.'); if (t === '') return null;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) throw new Error('Preço inválido (ex.: 1,30)');
  return Math.round(parseFloat(t) * 100);
};
const fmtDate = (s) => { const d = new Date(String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? s : d.toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }); };

/* ---------- state ---------- */
let tab = 'dash', pending = 0, es = null, reviewFilter = 'pending';

/* ---------- login ---------- */
function showLogin() {
  const u = h('input', { autocomplete: 'username', autofocus: true }), p = h('input', { type: 'password', autocomplete: 'current-password' }), err = h('div', { class: 'err' });
  const go = async () => {
    err.textContent = '';
    try { await api('/login', { method: 'POST', body: { username: u.value, password: p.value }, quiet: true }); boot(); }
    catch (e) { err.textContent = e.message === 'auth' ? '' : e.message; }
  };
  p.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  app.replaceChildren(h('div', { class: 'login card' }, h('h1', {}, 'Café Central'), h('p', {}, 'Área de administração'),
    h('label', {}, 'Utilizador'), u, h('label', {}, 'Palavra-passe'), p, err, h('button', { class: 'primary', onclick: go, style: 'margin-top:8px' }, 'Entrar')));
}

/* ---------- shell ---------- */
async function boot() {
  try { await api('/me', { quiet: true }); } catch { return showLogin(); }
  pending = (await api('/stats')).reviews.pending;
  if (!es) {
    es = new EventSource('/api/events');
    es.addEventListener('review:update', async () => {
      const before = pending; pending = (await api('/stats', { quiet: true }).catch(() => ({ reviews: { pending } }))).reviews.pending;
      if (pending > before) toast('Nova opinião para aprovar');
      renderTop(); if (tab === 'rev' || tab === 'dash') render();
    });
  }
  render();
}
const TABS = [['dash', 'Resumo'], ['menu', 'Menu'], ['gal', 'Fotos'], ['rev', 'Opiniões'], ['set', 'Definições']];
function renderTop() {
  const old = document.getElementById('top'); const bar = h('div', { class: 'top', id: 'top' },
    h('div', { class: 'brand' }, 'Café Central', h('small', {}, 'Administração')),
    TABS.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; render(); } }, l, k === 'rev' && pending ? h('span', { class: 'dot' }, pending) : false)),
    h('span', { class: 'sp' }), h('button', { onclick: () => window.open('/', '_blank') }, 'Ver site ↗'),
    h('button', { onclick: async () => { await api('/logout', { method: 'POST' }); es?.close(); es = null; showLogin(); } }, 'Sair'));
  old ? old.replaceWith(bar) : app.prepend(bar);
}
async function render() {
  const main = h('main'); app.replaceChildren(h('div', { id: 'top' }), main); renderTop();
  try { await ({ dash, menu, gal, rev, set })[tab](main); } catch (e) { if (e.status !== 401) main.append(h('div', { class: 'card empty' }, 'Não foi possível carregar. ', h('button', { onclick: render }, 'Tentar de novo'))); }
}
const head = (title, ...actions) => h('div', { class: 'page-h' }, h('h2', {}, title), h('div', { class: 'row' }, actions));

/* ---------- dialog helper ---------- */
function dialog(title, body, onSave, { extra } = {}) {
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary', onclick: async () => {
    err.textContent = ''; save.disabled = true;
    try { await onSave(); d.close(); render(); } catch (e) { err.textContent = e.message || 'Erro'; } finally { save.disabled = false; }
  } }, 'Guardar');
  const d = h('dialog', {}, h('h3', { style: 'margin-bottom:6px' }, title), body, err, h('div', { class: 'row end', style: 'margin-top:18px' }, extra, h('span', { class: 'grow' }), h('button', { onclick: () => d.close() }, 'Cancelar'), save));
  d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal();
}

/* ---------- Resumo ---------- */
async function dash(m) {
  const s = await api('/stats');
  const stat = (n, l) => h('div', { class: 'card stat' }, h('b', {}, n), h('span', {}, l));
  m.append(head('Resumo'), h('div', { class: 'grid' },
    stat(s.items, `pratos (${s.available} visíveis)`), stat(s.photos, 'fotos na galeria'),
    stat(s.reviews.pending, 'opiniões por aprovar'), stat(s.summary.count ? `${s.summary.average} ★` : '—', `média (${s.summary.count} opiniões)`),
    h('div', { class: 'card stat' }, h('b', {}, h('span', { class: 'live' }), s.viewers), h('span', {}, 'visitantes ligados agora'))),
    h('div', { class: 'card' }, h('h3', {}, 'Como funciona'), h('p', {}, 'Tudo o que alterar aqui aparece no site de imediato, sem recarregar. As opiniões novas ficam por aprovar até as publicar (a aprovação automática pode ser ativada em Definições).'),
      h('div', { class: 'row' }, h('button', { onclick: () => { tab = 'menu'; render(); } }, 'Editar menu'), h('button', { onclick: () => { tab = 'rev'; render(); } }, 'Ver opiniões'),
        h('button', { onclick: async () => { const j = await api('/export'); const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' })), download: `cafe-central-backup-${j.exported_at.slice(0, 10)}.json` }); a.click(); } }, 'Descarregar cópia (JSON)'))));
}

/* ---------- Menu ---------- */
async function menu(m) {
  const { categories } = await api('/menu');
  m.append(head('Menu', h('button', { class: 'primary', onclick: () => catDialog() }, '+ Categoria')));
  if (!categories.length) m.append(h('div', { class: 'card empty' }, 'Sem categorias. Crie a primeira (ex.: Cafés).'));
  const move = async (list, i, dir, table) => { const ids = list.map((x) => x.id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await api('/reorder', { method: 'POST', body: { table, ids } }); render(); };
  categories.forEach((c, ci) => m.append(h('div', { class: 'card' },
    h('div', { class: 'row' }, h('h3', { class: 'grow' }, c.name, c.description && h('small', { class: 'tag' }, c.description)),
      h('button', { class: 'sm', 'aria-label': 'Subir categoria', onclick: () => move(categories, ci, -1, 'categories') }, '↑'), h('button', { class: 'sm', 'aria-label': 'Descer categoria', onclick: () => move(categories, ci, 1, 'categories') }, '↓'),
      h('button', { class: 'sm', onclick: () => itemDialog(null, c.id, categories) }, '+ Prato'), h('button', { class: 'sm', onclick: () => catDialog(c) }, 'Editar'),
      h('button', { class: 'sm danger', onclick: async () => { if (confirm(`Apagar "${c.name}" e todos os seus pratos?`)) { await api('/categories/' + c.id, { method: 'DELETE' }); toast('Categoria apagada'); render(); } } }, 'Apagar')),
    c.items.length ? c.items.map((i, ii) => h('div', { class: 'item' },
      i.photo_url ? h('img', { class: 'thumb', src: i.photo_url, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb' }, 'sem foto'),
      h('div', { class: 'grow' }, h('b', {}, i.name), !i.available && h('span', { class: 'tag' }, 'escondido'), h('br'), h('small', {}, `${eur(i.price_cents)}${i.description ? ' · ' + i.description.slice(0, 80) : ''}`)),
      h('button', { class: 'sm', 'aria-label': 'Subir prato', onclick: () => move(c.items, ii, -1, 'items') }, '↑'), h('button', { class: 'sm', 'aria-label': 'Descer prato', onclick: () => move(c.items, ii, 1, 'items') }, '↓'),
      h('button', { class: 'sm', onclick: () => itemDialog(i, c.id, categories) }, 'Editar'))) : h('p', { class: 'hint' }, 'Sem pratos nesta categoria.'))));
}
function catDialog(c) {
  const name = h('input', { value: c?.name || '', maxlength: 80 }), desc = h('input', { value: c?.description || '', maxlength: 300, placeholder: 'Opcional' });
  dialog(c ? 'Editar categoria' : 'Nova categoria', h('div', {}, h('label', {}, 'Nome'), name, h('label', {}, 'Descrição'), desc),
    () => api(c ? '/categories/' + c.id : '/categories', { method: c ? 'PUT' : 'POST', body: { name: name.value, description: desc.value, sort: c?.sort || 0 }, quiet: true }).then(() => toast('Guardado')));
}
function itemDialog(i, catId, cats) {
  let photo = i?.photo_url || null;
  const f = {
    name: h('input', { value: i?.name || '', maxlength: 120 }), desc: h('textarea', { rows: 3, maxlength: 800 }, i?.description || ''),
    price: h('input', { value: i?.price_cents == null ? '' : (i.price_cents / 100).toFixed(2).replace('.', ','), inputmode: 'decimal', placeholder: 'ex.: 1,30 (vazio = sob consulta)' }),
    cat: h('select', {}, cats.map((c) => h('option', { value: c.id }, c.name))), al: h('input', { value: (i?.allergens || []).join(', '), placeholder: 'glúten, leite, ovos' }),
    tg: h('input', { value: (i?.tags || []).join(', '), placeholder: 'vegetariano, novo' }), av: h('input', { type: 'checkbox', checked: i ? i.available : true }),
  };
  f.cat.value = catId;
  const prev = h('img', { class: 'preview', src: photo || '', alt: '', style: photo ? '' : 'display:none' });
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', onchange: async () => {
    const fl = file.files[0]; if (!fl) return;
    if (fl.size > 6 * 1024 * 1024) return toast('A foto tem mais de 6 MB', true);
    try { const r = await api('/upload', { method: 'POST', raw: fl }); photo = r.url; prev.src = photo; prev.style.display = 'block'; toast('Foto carregada'); } catch { /* toast shown */ }
  } });
  const body = h('div', {}, h('label', {}, 'Nome'), f.name, h('label', {}, 'Descrição'), f.desc,
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Preço (€)'), f.price), h('div', {}, h('label', {}, 'Categoria'), f.cat)),
    h('label', {}, 'Alergénios (separados por vírgula)'), f.al, h('label', {}, 'Etiquetas'), f.tg,
    h('label', {}, 'Foto (JPG, PNG ou WebP, até 6 MB)'), file, prev, h('label', { class: 'check', style: 'margin-top:16px' }, f.av, 'Visível no site'));
  const del = i && h('button', { class: 'danger', onclick: async () => { if (confirm(`Apagar "${i.name}"?`)) { await api('/items/' + i.id, { method: 'DELETE' }); document.querySelector('dialog')?.close(); toast('Prato apagado'); render(); } } }, 'Apagar');
  dialog(i ? 'Editar prato' : 'Novo prato', body, async () => {
    const payload = { name: f.name.value, description: f.desc.value, price_cents: toCents(f.price.value), category_id: +f.cat.value, allergens: f.al.value, tags: f.tg.value, photo, available: f.av.checked, sort: i?.sort || 0 };
    await api(i ? '/items/' + i.id : '/items', { method: i ? 'PUT' : 'POST', body: payload, quiet: true }); toast('Guardado');
  }, { extra: del });
}

/* ---------- Fotos ---------- */
async function gal(m) {
  const { photos } = await api('/gallery');
  const uploadMany = async (files) => {
    for (const fl of files) { if (!/^image\//.test(fl.type)) continue; try { const r = await api('/upload', { method: 'POST', raw: fl }); await api('/gallery', { method: 'POST', body: { file: r.file } }); } catch { /* toast shown */ } }
    toast('Fotos adicionadas'); render();
  };
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, onchange: () => uploadMany([...input.files]) });
  const drop = h('div', { class: 'drop' }, h('p', { style: 'margin:0 0 10px' }, 'Arraste fotos para aqui ou escolha ficheiros'), input);
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => uploadMany([...e.dataTransfer.files]));
  m.append(head('Fotos'), drop, h('div', { style: 'height:18px' }), photos.length ? h('div', { class: 'gal' }, photos.map((p, i) => h('div', { class: 'card' }, h('img', { src: p.url, alt: p.caption || '', loading: 'lazy' }),
    h('input', { value: p.caption, placeholder: 'Legenda', style: 'margin-top:8px', maxlength: 200, onchange: (e) => api('/gallery/' + p.id, { method: 'PUT', body: { caption: e.target.value } }).then(() => toast('Guardado')) }),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'sm', 'aria-label': 'Mover para trás', onclick: async () => { const ids = photos.map((x) => x.id); if (i) { [ids[i], ids[i - 1]] = [ids[i - 1], ids[i]]; await api('/reorder', { method: 'POST', body: { table: 'photos', ids } }); render(); } } }, '←'),
      h('button', { class: 'sm', 'aria-label': 'Mover para a frente', onclick: async () => { const ids = photos.map((x) => x.id); if (i < ids.length - 1) { [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]]; await api('/reorder', { method: 'POST', body: { table: 'photos', ids } }); render(); } } }, '→'),
      h('span', { class: 'grow' }), h('button', { class: 'sm danger', onclick: async () => { if (confirm('Apagar esta foto?')) { await api('/gallery/' + p.id, { method: 'DELETE' }); render(); } } }, 'Apagar'))))) : h('div', { class: 'card empty' }, 'Ainda sem fotos. A secção de galeria só aparece no site quando houver pelo menos uma.'));
}

/* ---------- Opiniões ---------- */
async function rev(m) {
  const { reviews } = await api('/reviews' + (reviewFilter === 'all' ? '' : '?status=' + reviewFilter));
  const filters = [['pending', 'Por aprovar'], ['approved', 'Publicadas'], ['rejected', 'Rejeitadas'], ['all', 'Todas']];
  m.append(head('Opiniões'), h('div', { class: 'row', style: 'margin-bottom:16px' }, filters.map(([k, l]) => h('button', { class: k === reviewFilter ? 'primary' : '', onclick: () => { reviewFilter = k; render(); } }, l))));
  if (!reviews.length) m.append(h('div', { class: 'card empty' }, 'Sem opiniões nesta lista.'));
  reviews.forEach((r) => {
    const reply = h('textarea', { rows: 2, maxlength: 600, placeholder: 'Responder em público (opcional)…' }, r.reply || '');
    const set = async (status) => { await api('/reviews/' + r.id, { method: 'PATCH', body: { status, reply: reply.value } }); pending = (await api('/stats')).reviews.pending; toast('Atualizado'); render(); };
    m.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'stars' }, '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)), h('b', {}, r.name), h('span', { class: 'tag ' + r.status }, { pending: 'por aprovar', approved: 'publicada', rejected: 'rejeitada' }[r.status]), h('small', { class: 'hint' }, fmtDate(r.created_at))),
      h('p', {}, r.text), reply, h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'primary sm', onclick: () => set('approved') }, r.status === 'approved' ? 'Guardar resposta' : 'Aprovar e publicar'),
        r.status !== 'rejected' && h('button', { class: 'sm', onclick: () => set('rejected') }, 'Rejeitar'),
        r.status !== 'pending' && h('button', { class: 'sm ghost', onclick: () => set('pending') }, 'Voltar a pendente'),
        h('span', { class: 'grow' }), h('button', { class: 'sm danger', onclick: async () => { if (confirm('Apagar para sempre?')) { await api('/reviews/' + r.id, { method: 'DELETE' }); render(); } } }, 'Apagar'))));
  });
}

/* ---------- Definições ---------- */
async function set(m) {
  const s = await api('/settings'), F = {};
  const field = (k, label, tag = 'input', attrs = {}) => { F[k] = h(tag, { value: s[k] || '', ...attrs }, tag === 'textarea' ? s[k] || '' : undefined); return [h('label', {}, label), F[k]]; };
  const auto = h('input', { type: 'checkbox', checked: s.auto_approve === '1' });
  m.append(head('Definições'), h('div', { class: 'card' }, h('h3', {}, 'Informação do café'),
    field('name', 'Nome'), field('phone', 'Telefone'), field('address', 'Morada'),
    field('hours', 'Horário (uma linha por dia; use | para separar dia e horas)', 'textarea', { rows: 5, placeholder: 'Segunda a sábado | 07:00 – 19:00\nDomingo | Fechado' }),
    h('p', { class: 'hint' }, 'Deixe vazio para mostrar o horário provisório do site. Só publique horários confirmados com o café.'),
    field('announcement', 'Aviso no topo do site (vazio = sem aviso)'), field('facebook', 'Facebook (https://…)'),
    h('label', { class: 'check', style: 'margin-top:18px' }, auto, 'Aprovar opiniões automaticamente (não recomendado)'),
    h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'primary', onclick: async () => { const b = Object.fromEntries(Object.entries(F).map(([k, e]) => [k, e.value])); b.auto_approve = auto.checked; await api('/settings', { method: 'PUT', body: b }); toast('Guardado'); } }, 'Guardar'))));
  const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nw = h('input', { type: 'password', autocomplete: 'new-password' });
  m.append(h('div', { class: 'card' }, h('h3', {}, 'Alterar palavra-passe'), h('label', {}, 'Atual'), cur, h('label', {}, 'Nova (mínimo 10 caracteres)'), nw,
    h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { onclick: async () => { await api('/password', { method: 'POST', body: { current: cur.value, password: nw.value } }); cur.value = nw.value = ''; toast('Palavra-passe alterada'); } }, 'Alterar'))));
}

boot();
