# CHANGES — frontend, split-deploy edition

Baseline = the earlier single-package `smartmelt_dt/frontend/`. The UI, 3-D furnace,
charts and playback are unchanged; only cross-origin API wiring was added.

## ☆ New files
| File | Purpose |
|---|---|
| `config.js` | Sets `window.SMARTMELT_API_BASE` = your backend (Render) URL. Loaded before `app.js`. The single line you edit per deployment. |
| `.github/workflows/pages.yml` | Publishes the repo root to GitHub Pages on push to `main` (Source = GitHub Actions). |
| `render.yaml` | Render **Static Site** blueprint — host this frontend on Render instead of/in addition to Pages. |
| `.nojekyll` | Tells Pages to serve files verbatim (so `vendor/` and dotfiles aren’t Jekyll-processed). |
| `.gitignore` | Editor/OS ignores. |
| `README.md` | Frontend + GitHub Pages deployment guide. |

## ★ Changed files
### `app.js`
- Added `const API_BASE = (window.SMARTMELT_API_BASE || '').replace(/\/+$/, '')`.
- Every `fetch('/api/…')` is now `fetch(API_BASE + '/api/…')` (9 call sites) so the
  static Pages site can reach the backend on Render. Empty `API_BASE` ⇒ same-origin
  (unchanged local behaviour). No other logic changed — playback, furnace, charts,
  charge-mix, EKF/ML/drift rendering are identical.

### `index.html`
- Added `<script src="./config.js"></script>` immediately before the module
  `<script type="module" src="./app.js">` so the API base is defined before the app runs.

## · Unchanged
`style.css`, `vendor/three.module.js`, `vendor/OrbitControls.js`, `vendor/lil-gui.esm.js`.

## Note on the real-time playback fix
The wall-clock playback speeds (Real-time 1× / 10× / 100× / 1000×) from the previous
update are already baked into this `app.js`; nothing further changed there.
