# Apex Swag — Ranked RP Tracker

An Overwolf overlay app for Apex Legends that tracks your ranked RP per session.  
Shows a live in-game widget and a full desktop dashboard with match history.

---

## Requirements

- [Overwolf](https://www.overwolf.com/) installed
- An Apex Legends API key from [apexlegendsapi.com](https://apexlegendsapi.com/)

> No Node.js or other software required.

---

## 1 — Download the project

**Option A — Git**
```
git clone https://github.com/YOUR_USERNAME/apex_swag.git
cd apex_swag
```

**Option B — ZIP**  
Click **Code → Download ZIP** on the GitHub page, then extract it anywhere on your PC.

---

## 2 — Get an API key

1. Go to **[apexlegendsapi.com](https://apexlegendsapi.com/)**
2. Register for a free account
3. Copy your API key from the dashboard

---

## 3 — Set your API key

Inside the project folder, create a file called **`config.js`** (it is gitignored so it won't be committed):

```js
// config.js
const CONFIG = {
  APEX_API_KEY: 'PASTE_YOUR_KEY_HERE',
  PLATFORM: 'PC'
};
```

> **Platform options:** `PC` · `PS4` · `X1` · `Switch`

---

## 4 — Enable Overwolf Developer Mode

1. Open **Overwolf**
2. Click your profile icon → **Settings**
3. Go to the **About** tab
4. Click the Overwolf version number **5 times rapidly**  
   → A **Developer Options** section appears at the bottom
5. Toggle **Developer Mode** on

---

## 5 — Load the app in Overwolf

1. In Overwolf, press **Ctrl + Alt + D** to open the **Developers** panel  
   *(or go to `overwolf://developers/` in the Overwolf browser)*
2. Click **Load unpacked extension**
3. Select the **`apex_swag`** folder (the one containing `manifest.json`)
4. The app will appear in your Overwolf dock

---

## 6 — Start the proxy server

The app uses a small local proxy to talk to the Apex API (required to bypass browser CORS restrictions).

**Double-click `start-proxy.bat`** — keep this console window open while using the app.

You should see:
```
[apex-swag] Proxy running → http://127.0.0.1:7272
[apex-swag] Keep this window open while using the Overwolf app.
```

---

## 7 — Use the app

1. **Start proxy** (`start-proxy.bat`) ← do this first every time
2. **Launch Overwolf** and open the Apex Swag app from the dock
3. In the **desktop window**:
   - Enter your **EA / Origin player name** exactly as it appears in-game
   - Select your **platform**
   - Click **▶ Start Session**
4. **Launch Apex Legends** — the in-game overlay appears top-right
5. The app polls your RP **every 3 seconds** — the moment your RP changes after a match it is automatically recorded
6. When done, click **■ End Session** to save the session to history

---

## In-game overlay

The overlay widget shows three things at a glance:

| Element | Description |
|---|---|
| **Rank pill** | Your current rank (e.g. Gold II) with a live indicator dot |
| **RP** | Your current ranked points |
| **SESSION** | Total RP gained or lost this session |
| **MATCHES** | Number of ranked matches played this session |

The widget is draggable — click and drag anywhere on it to reposition.  
Its position is saved automatically between sessions.

---

## How RP tracking works

- On **Start Session** the app fetches your current RP as a baseline
- Every **3 seconds** the proxy queries `api.mozambiquehe.re` for your live RP
- If the value **changes**, a match entry is recorded instantly with the delta
- If the value is **unchanged**, nothing is recorded — no false entries

---

## File overview

```
apex_swag/
├── manifest.json          Overwolf app config
├── config.js              Your API key — DO NOT commit (gitignored)
├── proxy.exe              Local CORS proxy (standalone — no Node.js needed)
├── server.js              Proxy source (rebuild with: npx pkg .)
├── start-proxy.bat        Double-click to start the proxy
├── .gitignore
├── img/                   App icons
├── css/
│   ├── desktop.css
│   └── in_game.css
└── windows/
    ├── background/        Hidden controller (GEP, polling, data)
    ├── desktop/           Session dashboard
    └── in_game/           Live overlay widget
```

Session data is stored in Overwolf's local app storage  
(`%LOCALAPPDATA%\Overwolf\Extensions\...\`).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Proxy unreachable` error | Start `start-proxy.bat` first |
| `Player not found` error | Check your EA/Origin name — must match exactly |
| RP not updating | Confirm the proxy console shows `← 200` responses |
| `GEP OFF` badge | Normal for dev/unpacked apps — RP still tracked via polling |
| In-game overlay not showing | Start a session before launching Apex, or relaunch Apex |
| `Port 7272 already in use` | Close the existing proxy window and restart |
| App not loading in Overwolf | Make sure Developer Mode is enabled (step 4) |

---

## Auto-start the proxy (optional)

To avoid manually starting the proxy every time, add `start-proxy.bat` to your Windows startup folder:

1. Press **Win + R** → type `shell:startup` → Enter
2. Copy a **shortcut** of `start-proxy.bat` into that folder
