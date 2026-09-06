# SmartMelt Studio — Frontend (GitHub Pages) · repo 2 of 2

HTML + CSS + Plotly.js + Three.js — the 12-tab operator/manager console. Static
site; calls the backend API (repo *smartmelt-backend*, on Render) cross-origin.

## Deploy
1. Edit **`config.js`** → your Render backend URL.
2. Push to a GitHub repo (branch `main`).
3. Repo ▸ **Settings ▸ Pages ▸ Source = "GitHub Actions"** (bundled workflow deploys on push).
4. On the backend set `ALLOWED_ORIGINS=https://<user>.github.io` (or keep `*`).

Preview locally: `python3 -m http.server 5173` → http://localhost:5173/ (config.js → your API).
