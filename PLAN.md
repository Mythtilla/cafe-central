# Plan — dynamic Café Central

## What exists
No framework. `src/index.template.html` + `assets/` are built into a static
`index.html` by `build.py` (inlines 14 SVGs). Vanilla CSS with design tokens,
vanilla JS for drawer/reveal/nav-spy/map hover.

## What gets added
A zero-dependency Node 22 backend using the built-in `node:sqlite`, serving the
existing static page plus JSON API, SSE, uploads and an admin SPA. No build step
is introduced for the frontend; `build.py` keeps working.

## Files

| File | Status | Purpose |
|---|---|---|
| `package.json` | new | scripts: `start`, `dev`, `test`, `seed:demo`; `"type":"module"` |
| `.env.example` | new | every env var, documented |
| `.gitignore` | new | `data/`, `.env`, `node_modules/` |
| `server/index.js` | new | HTTP server, router, static, startup, graceful shutdown |
| `server/db.js` | new | schema (create-if-not-exists), seed, query helpers |
| `server/auth.js` | new | scrypt hashing, HMAC session cookie, CSRF, rate limiters |
| `server/events.js` | new | SSE hub, broadcast, keep-alive, viewer count |
| `server/uploads.js` | new | magic-byte sniffing, random filenames, safe delete |
| `server/validate.js` | new | input validation shared by both route files |
| `server/routes/public.js` | new | `/api/menu`, `/gallery`, `/settings`, `/reviews`, `/events` |
| `server/routes/admin.js` | new | auth, stats, CRUD, upload, reviews moderation, settings |
| `server/seed-demo.js` | new | optional illustrative dishes (no prices) for demos |
| `admin/index.html` | new | admin shell, 5 tabs |
| `admin/admin.css` | new | admin styles, reuses the site's palette, light/dark |
| `admin/admin.js` | new | admin SPA: auth, CRUD, upload, moderation, toasts |
| `src/index.template.html` | edit | menu becomes a mount point; gallery + reviews sections; settings bindings |
| `assets/css/style.css` | edit | styles for gallery, reviews, skeleton, announcement (existing tokens) |
| `assets/js/live.js` | new | public data layer: fetch, render, EventSource, review form |
| `tests/api.test.js` | new | the full Definition-of-Done suite |
| `README.md` | edit | setup, env, backup, Docker, deploy |

## Order
1. DB + API + SSE, run `curl` checks.
2. Security, re-check every gate with the test suite.
3. Admin SPA, drive it in a real browser.
4. Public integration, verify live updates with two browser tabs.
5. Optional Google reviews.
6. Full test run + docs.

## Data decisions
- `/data` (env `DATA_DIR`) holds `cafe.sqlite`, `.session-secret`, `uploads/`.
- Seed: three empty categories, settings with `hours=""`, no items, no photos.
- Prices are cents or `NULL` ("sob consulta"); the API never formats.
