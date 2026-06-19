# Clarity

A low-friction, **local-first** iPhone health tracker (PWA). v1 tracks cognitive
activeness after meals: a quick check-in rates sleepiness on the validated
**Karolinska Sleepiness Scale (1–9)** plus mental energy (1–5), links it to your
last meal, and shows patterns over time.

- **No backend, no login, no tracking.** All data lives in your phone's browser
  (`localStorage`) and never leaves the device unless you export it.
- **Installable.** Add to Home Screen on iOS for a full-screen, offline app.
- **Zero dependencies.** Plain HTML/CSS/JS — nothing to build.
- **Compass tab.** A low-friction *good-time journal* (rate absorption/energy/flow,
  and note when the perfectionist "pinch" fires) plus an *experiment bank* — things to
  try so the journal has signal — for finding your "specific knowledge." Export the
  journal as CSV for analysis; everything is included in the JSON backup.

## Run locally

```bash
python3 serve.py 8000
```

Then open `http://localhost:8000` on the Mac, or `http://<your-Mac-LAN-IP>:8000`
on a phone on the same Wi-Fi.

## Hosting

Served as static files from the repository root — works with **GitHub Pages**
(Settings → Pages → Deploy from branch → `main` / root).

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell + PWA/Apple meta tags |
| `styles.css` | Design system (dark/light, safe areas, scales, slider) |
| `app.js` | All logic — storage, check-in stepper, meals, insights, export |
| `manifest.webmanifest`, `service-worker.js` | Installable + offline |
| `icons/` | App icons |
| `serve.py` | Tiny local dev server |

## Backup

Insights tab → **Backup (JSON)** exports everything; **Restore from backup** imports it.
Because data is tied to the site's URL, keep one stable URL once you start tracking.
