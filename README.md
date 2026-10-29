# Café Central, Viseu — site

A single-page site for **Café Central**, Rua 21 de Agosto, 3, Viseu — a café trading
since 1955. Built as a sales demo: warm editorial layout, cream paper, big Fraunces
serif, terracotta accent, and four hand-built SVG illustrations.

Nothing here is a template. Every illustration, icon and layout is bespoke.

**Language:** the site is in **English (en-GB)**. The Portuguese original is kept
at `src/index.pt-PT.template.html` — `build.py` does not build it, but it is the
source if the café asks for a Portuguese version (swap the two filenames, or add
a second build step).

**Live:** <https://cafecentral.antideploy.app> — account
`bhaskarz01022011@gmail.com`, application `cafe-central`
(`2064eec3-2d5e-4ac7-9d89-e3d43a5899dc`). Redeploy with
`POST https://antideploy.com/api/v1/deploy?applicationId=2064eec3-2d5e-4ac7-9d89-e3d43a5899dc`
after `python3 build.py`, sending only `index.html` + `assets/`.

---

## What to send the client

| File | Use it for |
|---|---|
| **`cafe-central-standalone.html`** (~330 KB) | **Send this one.** One file, fonts and images inlined. Opens on any machine with no internet, no server, no setup. Email it or WhatsApp it. |
| `index.html` + `assets/` | The deployable version. Upload the folder to any static host. |

Both are generated from the same source, so they always match.

---

## Preview it

```bash
cd /home/bhaskar/Projects/viseu-leads/cafe-central-v2
python3 -m http.server 8123
```

Then open <http://127.0.0.1:8123/index.html>.

> Use a local server, not `file://`. The fonts and the scroll animations expect HTTP.

**Screenshot mode:** add `?static=1` to the URL
(<http://127.0.0.1:8123/index.html?static=1>) to disable scroll-reveal animations so
full-page screenshots don't come out blank.

---

## Deploy it

It is plain HTML/CSS/JS with no build step at runtime and no dependencies.

- **Netlify** — drag the whole `cafe-central-v2` folder (minus `src/`, `shots/`,
  `build.py`, `README.md`) onto <https://app.netlify.com/drop>. Done in 10 seconds.
- **Cloudflare Pages** — create a project, upload the folder, no build command,
  output directory `/`.
- **Any cPanel / shared host** — upload `index.html` and `assets/` to `public_html`.

The `assets/` folder must sit next to `index.html`. That is the only rule.

---

## File map

```
cafe-central-v2/
├── cafe-central-standalone.html   ← send this (everything inlined)
├── index.html                     ← built site (GENERATED — don't hand-edit)
├── build.py                       ← renders index.html + standalone from src/
├── src/
│   ├── index.template.html        ← the real HTML source ({{SVG:name}} placeholders)
│   └── index.pt-PT.template.html  ← archived Portuguese original, not built
├── assets/
│   ├── css/style.css              ← all styling, design tokens at the top
│   ├── js/site.js                 ← drawer, reveal-on-scroll, nav spy, map hover
│   ├── fonts/                     ← Fraunces + Inter Tight, self-hosted woff2
│   │   ├── fraunces-latin.woff2
│   │   ├── fraunces-italic-latin.woff2
│   │   └── intertight-latin.woff2
│   └── svg/
│       ├── hero-still-life.svg    ← arched niche, lamp, cup, nata, glass
│       ├── facade.svg             ← storefront with azulejo frieze + calçada
│       ├── map.svg                ← walking route, 6 numbered stops
│       ├── seal.svg               ← rotating "desde 1955" seal
│       ├── mark.svg               ← the C-in-a-cup logo mark
│       └── icon-*.svg             ← cup, pastry, sandwich, phone, arrow, pin
└── shots/                         ← screenshots for the pitch (not deployed)
```

### Rebuilding

After editing **anything** in `src/`, `assets/css`, `assets/js` or `assets/svg`:

```bash
python3 build.py
```

That rewrites `index.html` and `cafe-central-standalone.html`. `index.html` is
generated — editing it directly works until the next build, then it's gone.

---

## Editing the facts

Open **`src/index.template.html`** and search for the text you want to change.
The pieces a café owner is most likely to want changed:

| What | Where |
|---|---|
| Opening hours | the `<h3>Horário</h3>` card in `#visitar` |
| Menu items | the three `.menu__col` blocks in `#carta` |
| Phone number | search `232 423 990` (appears in 3 places + the JSON-LD block at the top) |
| Address | the `<address>` in `#visitar`, plus the JSON-LD `PostalAddress` |
| Intro copy | the `<h1>` and `.hero__lede` in `#top` |
| Distances / stops | `.stops` list in `#rota` — and the matching pins in `assets/svg/map.svg` |
| Colours | the `:root` token block at the top of `assets/css/style.css` |

After any edit: `python3 build.py`.

---

## ⚠️ Before this goes live — read this

Two things on the page are **not verified** and must be confirmed with the café:

1. **Opening hours** — `Seg–Sáb 07h00–19h00, Dom encerrado` is a placeholder. It is
   footnoted on the page (`* Horário provisório`), but replace it with the real
   hours before publishing. Wrong hours on a café site is the single most damaging
   mistake you can ship.
2. **The menu** — the item names are typical for a Viseu pastelaria, not a copy of
   their actual carta. Prices are deliberately omitted (the page says they are at
   the counter), which is both honest and avoids inventing numbers.

Everything else is verified and comes from `../cafe-central/LOCATION.md`:

- Address: Rua 21 de Agosto, 3, Bairro da Balsa, 3510-120 Viseu
- Phone: +351 232 423 990
- Coordinates: 40.6587424, -7.9148947
- Founded 1955; member of Rota dos Cafés com História
- Legal entity: Rebelo & Sobrinho, Lda · NIF PT500707448
- Indoor seating only, no terrace
- Facebook: /cafecentralviseu

There is an address conflict in the public record: some Google listings show
**no. 7, 3510-042**. The site uses **no. 3, 3510-120**, which is the one backed by
the company registry and the VAT number. Worth asking about if the client replies.

---

## Design notes

**Type** — Fraunces (display, with the true italic used for emphasis) + Inter Tight
(body). Both self-hosted, latin subset, so there is no Google Fonts request and no
layout shift.

**Palette** — cream paper `#F7F2E7`, espresso ink `#171009`, terracotta `#A64226`,
brass `#9C7534`, forest `#1C2F26`. Defined once as custom properties at the top of
`style.css`; change them there and the whole page follows.

**Illustrations** — four bespoke SVGs, drawn as line-and-fill rather than traced
photos: the hero still-life (marble table, bica, pastel de nata, water glass under a
tiled arch), the storefront (azulejo frieze, brass plaque, calçada pavement), the
walking-route map, and the rotating seal. They are inline SVG, so they inherit the
palette and stay sharp at any size.

**Motion** — reveal-on-scroll, a scroll progress bar, a nav that marks the section
you're in, and a map that highlights a stop when you hover its list row. All of it
is disabled under `prefers-reduced-motion: reduce`, and the page is fully readable
with JavaScript off.

**Accessibility** — checked with Playwright at 1440 / 1180 / 834 / 390 px: no
horizontal overflow, no WCAG AA contrast failures on real text, focus states on
every interactive element, a working skip link, and a mobile drawer that traps
`inert` correctly and closes on navigation. The one low-contrast item is the huge
decorative "Central" outline word, which is `aria-hidden` and not text content.

The page also carries `CafeOrCoffeeShop` JSON-LD (address, geo, phone, founding
date, Facebook) so Google can show the right details in search and maps.

---

## Credits

- Illustrations, layout and copy: original work for this pitch.
- Fonts: [Fraunces](https://github.com/undercasetype/Fraunces) and
  [Inter Tight](https://github.com/rsms/inter), both SIL Open Font License.
- Facts: OpenStreetMap node `5862379983`, Turismo Centro de Portugal, company
  registry. See `../cafe-central/LOCATION.md` for the full source trail.

---

## v3 — what was added

### The entrance ("walking into the café")
On first visit the page opens on **Rua 21 de Agosto at dusk**. The camera pushes toward the door, the doors swing in, warm light floods the frame and the page appears. About 5 s in total.

| Choice | Behaviour |
|---|---|
| **Enter with sound** | Click = the browser permits audio. Footsteps on the calçada, door latch, shop bell, then a soft café ambience (murmur, cup clinks, steam wand). |
| **Enter silently** (or wait ~5 s) | Same sequence, no sound. |
| **Skip** / `Esc` | Jumps straight to the page. |
| Repeat visits | Skipped for the rest of the session. Force it with `?intro=1`; disable with `?intro=0`. |
| `prefers-reduced-motion` | Intro is skipped entirely. |

All sound is **synthesized with Web Audio** (`assets/js/sound.js`): no audio files, works offline. A floating toggle (bottom-right) mutes it; the choice is remembered. Sounds are also used for the "See the menu" click, the lightbox, and a soft *ding* when a new review arrives live.

New SVGs: `intro-street`, `bean`, `ornament`, `icon-star`, `icon-sound`, `icon-bell`, `icon-camera`; plus an azulejo tile band (CSS data-URI) between sections.

### The backend (complete)
```
npm start            # http://localhost:3000  (admin at /admin)
npm run seed:demo    # optional: illustrative dishes, no prices
npm test             # 25 API tests
```
`server/index.js` (entry), `router.js`, `routes/public.js`, `routes/admin.js` were added to the existing `auth/db/events/http/uploads/validate` modules.

* **Public API:** `/api/menu`, `/api/gallery`, `/api/settings`, `/api/reviews` (GET + POST), `/api/google-reviews`, `/api/events` (SSE).
* **Admin API** (`/api/admin/*`, session cookie + CSRF header): login/logout/password, stats, settings, categories, items, reorder, upload, gallery, review moderation (approve / reject / reply / delete), JSON export.
* **Admin panel** (`/admin`, Portuguese, mobile-friendly): Resumo, Menu (photo upload, allergens, tags, availability, ↑↓ ordering), Fotos (drag & drop), Opiniões (live badge + toast), Definições (hours, announcement, auto-approve, password), JSON backup download.
* **Live site:** `assets/js/live.js` swaps in the live menu, gallery, reviews, hours and announcement, and listens to the event stream, so admin edits and approved reviews show up in every open browser without a reload.
  * *Progressive enhancement:* the page ships with a static menu. If the API is unreachable (e.g. `cafe-central-standalone.html` opened from disk) nothing changes. The Reviews and Gallery sections only appear when the API answers / photos exist.
  * *Hosting the page elsewhere?* Add `<meta name="cc-api" content="https://api.your-domain">` and set `ALLOWED_ORIGIN`.
* **Hours format** (Definições): one line per day, `Day | hours`, e.g. `Segunda a sábado | 07:00 – 19:00`. Leave empty to keep the provisional hours.

### Verified
* `npm test`: 25/25 (auth, CSRF, CRUD, uploads by magic bytes, size limit, review moderation, honeypot, rate limits, SSE, CORS, path traversal, cascade delete, export).
* Real-browser run (Chromium): admin login → photo upload → hours/announcement/gallery edits appeared live on the public page; a review stayed hidden while pending and appeared live, with the owner's reply, after approval. Intro checked on desktop and phone; no horizontal overflow at 390 px; no console errors.

### Not verified
* **Audio was never heard** (no speakers in the test environment). It is synthesized and tuned by design; please listen once and tell me if anything is too loud or harsh, since volumes are single constants in `sound.js`.
* Google reviews (no API key), HTTPS / Docker deploy, Safari/Firefox (only Chromium was run).
* Opening hours, prices and the 1955 date remain **unverified**; nothing was invented.
