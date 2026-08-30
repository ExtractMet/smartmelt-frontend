# SmartMelt — Frontend (GitHub Pages)

HTML + CSS + Three.js operator console. **Repository 2 of 2.** Static site published on
GitHub Pages; calls the backend API (repo *smartmelt-backend*, on Render) cross-origin.

## Deploy
1. Edit **`config.js`** → set your Render backend URL:
   ```js
   window.SMARTMELT_API_BASE = "https://smartmelt-api.onrender.com";
   ```
2. Push to a GitHub repo (branch `main`).
3. Repo ▸ **Settings ▸ Pages ▸ Source = "GitHub Actions"** (the included workflow deploys
   on every push). Live at `https://<your-username>.github.io/<repo>/`.
   *(Alternative: Source = Deploy from a branch ▸ main ▸ /root; then delete the workflow.)*
4. On the backend, set `ALLOWED_ORIGINS=https://<your-username>.github.io` (or keep `*`).

*(Optional: host on Render as a Static Site instead — see `render.yaml`.)*

## Playback speeds
Pause · Real-time 1× · **5×** · 10× · 100× · 1000× real-time.

## Preview locally
```bash
python3 -m http.server 5173     # open http://localhost:5173/  (set config.js to your API)
```

© Extractmet Pvt Ltd — advisory-only. Plant data anonymised as *Industry-X*.
