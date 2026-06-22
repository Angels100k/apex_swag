# Apex Swag — Ranked RP Tracker

An Overwolf overlay for Apex Legends that tracks your ranked RP live: per-session gains, your last
games, rank-up progress, **cloud match history**, and a **global leaderboard**.

The app talks to a small **PHP + MySQL** backend that you host. The backend holds a single
apexlegendsapi.com key server-side, so players install the app and it just works — no per-user API
key, and no local proxy `.exe` to run.

```
Overwolf app  ──HTTPS──▶  your PHP backend (api.php)  ──▶  api.mozambiquehe.re
                                  │
                                  └──▶  MySQL (players / sessions / matches)
```

---

## For players (once it's published)
1. Install **Apex Swag RP Tracker** from the Overwolf app store.
2. Open the dashboard, enter your Apex player name + platform, click **Start Session**.
3. Play ranked — matches and RP are tracked automatically. Toggle the overlay with **Ctrl+Shift+A**.

That's it. No API key, no extra program.

---

## For the developer — deploying the backend (cPanel)

The backend lives in [`server-php/`](server-php/).

1. **Database:** in cPanel → *MySQL Databases*, create a database + user and grant it access.
   Then in *phpMyAdmin*, import [`server-php/schema.sql`](server-php/schema.sql).
2. **Upload:** copy the contents of `server-php/` to `public_html/apex/` so the endpoint is
   `https://YOURDOMAIN/apex/api.php`.
3. **Configure:** copy `config.sample.php` → `config.php` and fill in:
   - DB host / name / user / password
   - `apex_api_key` — your key from <https://apexlegendsapi.com/>
   - `app_secret` — a long random string (the app sends it as the `X-App-Token` header)
4. **Verify** (replace `SECRET`):
   ```
   curl "https://YOURDOMAIN/apex/api.php?action=leaderboard&window=all" -H "X-App-Token: SECRET"
   ```
   should return `{"window":"all","players":[]}`.

### Backend endpoints (`api.php?action=…`)
| action | method | purpose |
|--------|--------|---------|
| `rp` | GET `&player=&platform=` | proxy player RP/rank from the Apex API |
| `predator` | GET | proxy the global Predator cutoff |
| `save` | POST `{player,platform,sessions,current}` | upsert sessions + matches (idempotent) |
| `history` | GET `&player=&platform=` | this player's full cloud history |
| `leaderboard` | GET `&window=24h\|7d\|all` | top players by net RP |

Every request must send the `X-App-Token` header matching `app_secret`.

---

## For the developer — building & loading the app

1. **Point the app at your backend:** copy `config.js.template` → `config.js` and set:
   ```js
   API_BASE_URL: 'https://YOURDOMAIN/apex/api.php',
   APP_TOKEN:    '<same value as app_secret>',
   ```
2. **Load unpacked:** in Overwolf, enable developer mode (**Ctrl+Alt+D**) → *Load unpacked* → pick
   this folder. Start a session and confirm RP loads with **no** local proxy running.
3. **Package for the store:**
   ```
   powershell -ExecutionPolicy Bypass -File build-opk.ps1
   ```
   produces `dist/apex-swag.opk` containing only `manifest.json`, `config.js`, `windows/`, `css/`,
   `img/`.
4. **Submit:** follow [`store/CHECKLIST.md`](store/CHECKLIST.md) in the Overwolf Developer Console.

---

## Project layout
```
manifest.json          Overwolf app manifest (windows, game events, hotkey)
config.js(.template)    app config — backend URL + shared token (no secrets)
windows/
  background/           controller: GEP events, RP polling, backend calls
  desktop/              dashboard: session, match log, past sessions, leaderboard
  in_game/              overlay widget
css/                    styles
img/                    icons
server-php/             PHP + MySQL backend (deploy to cPanel; not shipped in the .opk)
store/                  store listing copy + submission checklist
build-opk.ps1           packages the app into dist/apex-swag.opk
server.js               legacy local proxy — dev reference only, not used or shipped
```

> The old local proxy (`server.js`, `proxy*.exe`, `start-proxy.bat`) and the offline
> `apex-history.html/json` report are no longer part of the app — history now lives in the cloud
> backend. They remain in the repo only as historical reference and are excluded from the build.
