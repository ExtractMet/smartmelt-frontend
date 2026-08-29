# SmartMelt — Frontend (GitHub Pages)

The **HTML + CSS + Three.js** operator console: a live 3-D induction furnace and 12
tabs. It is a static site published on **GitHub Pages** and calls the SmartMelt
**backend API** (deployed on Render) cross-origin. This is **Repository 2 of 2**.

```
   GitHub Pages (this frontend)  ──HTTPS / CORS──►  Render (smartmelt-backend)
   https://<user>.github.io/smartmelt-frontend           https://smartmelt-api.onrender.com
```

The browser is a thin client — all physics, advisories, charge-mix, EKF, ML and
drift are computed by the backend engine; this app renders the furnace and plays
back the engine's frames.

---

## Differences from the earlier single-package version

The UI is the same; only the API wiring changed so it can reach a backend on a
different host. Full detail in **[CHANGES.md](CHANGES.md)**. Marked file tree
(`☆` new · `★` changed · `·` unchanged):

```
smartmelt-frontend/
├── ☆ config.js                     NEW — set your backend (Render) URL here (one line)
├── ★ app.js                        CHANGED — API calls now use the absolute API_BASE from config.js
├── ★ index.html                    CHANGED — loads config.js before app.js
├── ☆ .github/workflows/pages.yml   NEW — GitHub Pages deploy from main
├── ☆ render.yaml                    NEW — Render Static Site blueprint (host frontend on Render)
├── ☆ .nojekyll                     NEW — serve vendor/ & dotfiles verbatim (no Jekyll)
├── ☆ .gitignore                    NEW
├── ☆ README.md                     NEW — this frontend/Pages guide
├── · style.css                     unchanged — dark operator theme
└── · vendor/                       unchanged — three.module.js, OrbitControls.js, lil-gui.esm.js
```

The one change that makes the split work: **`app.js` now prefixes every request
with `API_BASE`** (read from `window.SMARTMELT_API_BASE` in `config.js`) instead of
a same-origin relative path. Empty base still means same-origin (local combined mode).

---

## Deploy to GitHub Pages

1. **Set the backend URL.** Edit **`config.js`**:
   ```js
   window.SMARTMELT_API_BASE = "https://smartmelt-api.onrender.com"; // your Render URL
   ```
2. Push this folder to a GitHub repo named `smartmelt-frontend` (branch `main`).
3. Repo ▸ **Settings ▸ Pages ▸ Build and deployment ▸ Source = "GitHub Actions"**.
   The included workflow (`.github/workflows/pages.yml`) publishes on every push to
   `main`. Your site goes live at `https://<your-username>.github.io/smartmelt-frontend/`.

   *Alternative (no Actions):* Source = **Deploy from a branch** ▸ `main` ▸ `/ (root)`.
   Delete the workflow file if you use this path.

4. **Allow this origin on the backend.** In Render set
   `ALLOWED_ORIGINS = https://<your-username>.github.io` and redeploy (optional but
   recommended; the default `*` also works).

Open the Pages URL. If the top-right status says "connecting…" for up to a minute,
the Render free tier is waking from cold start — it will connect once the API responds.

## Alternative: host the frontend on Render (both repos on Render)

The frontend is plain static files, so instead of GitHub Pages you can host it on
**Render as a Static Site** — giving you *both* repos on Render (backend = Web Service,
frontend = Static Site). The connection mechanism is identical: `config.js` points at
the backend URL and the backend's CORS allows this origin.

1. Set the backend URL in **`config.js`** (same as step 1 above).
2. Render ▸ **New ▸ Blueprint** and pick this repo (it reads the included `render.yaml`),
   **or** New ▸ **Static Site** manually: **Build Command** empty, **Publish Directory** `.`,
   **Branch** `main`. Live at `https://smartmelt-frontend.onrender.com`.
3. On the backend service set `ALLOWED_ORIGINS` to this static-site URL (or keep `*`).

So the two ways to publish this repo are interchangeable — pick one:
- **GitHub Pages** (`.github/workflows/pages.yml`) → `https://<user>.github.io/smartmelt-frontend/`
- **Render Static Site** (`render.yaml`) → `https://smartmelt-frontend.onrender.com`

## Preview locally
```bash
python3 -m http.server 5173      # then open http://localhost:5173/
```
Point `config.js` at your Render URL (or a local backend at `http://localhost:8000`).
Because ES-module import maps need HTTP, use a server — don't open `index.html` via `file://`.

---
© Extractmet Pvt Ltd — advisory-only digital twin. Plant data anonymised as *Industry-X*.
