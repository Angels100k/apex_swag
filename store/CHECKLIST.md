# Overwolf Store Submission Checklist

Work top to bottom. Deploy the backend first, then build and submit the app.

## 0. Backend (must be live before submitting)
- [ ] Create a MySQL database in cPanel; import `server-php/schema.sql` via phpMyAdmin.
- [ ] Upload `server-php/` to `public_html/apex/` (so endpoints are `https://YOURDOMAIN/apex/api.php`).
- [ ] Copy `config.sample.php` → `config.php`; fill DB creds, your apexlegendsapi.com key, and a long random `app_secret`.
- [ ] Verify HTTPS works and `config.php` is not directly downloadable (the `.htaccess` denies it).
- [ ] Smoke test (replace SECRET):
      `curl "https://YOURDOMAIN/apex/api.php?action=leaderboard&window=all" -H "X-App-Token: SECRET"` → `{"window":"all","players":[]}`

## 1. App config
- [ ] In `config.js`, set `API_BASE_URL` to `https://YOURDOMAIN/apex/api.php` and `APP_TOKEN` to the same `app_secret`.
- [ ] Load unpacked (Overwolf dev mode: Ctrl+Alt+D → Load unpacked) and confirm a session loads RP with NO local proxy/.exe running.

## 2. Build the package
- [ ] Run `powershell -ExecutionPolicy Bypass -File build-opk.ps1` → produces `dist/apex-swag.opk`.
- [ ] Confirm the .opk contains only manifest.json, config.js, windows/, css/, img/ (no server-php, server.js, *.exe, *.bat).

## 3. Store assets (uploaded in the Overwolf Developer Console, not in the manifest)
- [ ] App icon (square, 256×256 PNG) — larger/cleaner than `img/icon.png`.
- [ ] Store tile / thumbnail image.
- [ ] 3–5 screenshots: desktop dashboard, in-game overlay, leaderboard. (Capture notes in `store/screenshots/`.)
- [ ] Optional short gameplay video.
- [ ] Short + long description from `store/description.md`.
- [ ] Category set to a stats/utility category; supported game = Apex Legends.

## 4. Developer Console submission
- [ ] Create the app in https://console.overwolf.com (if not already).
- [ ] Upload `dist/apex-swag.opk`.
- [ ] Fill metadata, descriptions, screenshots, category.
- [ ] Confirm declared permissions match the manifest (`GamesEventsData`, `GameInfo`, `Extensions`).
- [ ] Submit for review.

## 5. Review readiness sanity checks
- [ ] App runs with no external software required (no `.exe`/`.bat`).
- [ ] Overlay opens/closes cleanly and is draggable; hotkey toggle works.
- [ ] Desktop window closes/minimizes correctly.
- [ ] No console errors on launch.
