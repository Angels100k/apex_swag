// background.js — main controller for Apex Swag RP Tracker

const APEX_GAME_ID = 21566;
// Online backend (PHP). Configured in config.js — no local proxy/.exe needed.
const API_BASE  = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE_URL) || '';
const APP_TOKEN = (typeof CONFIG !== 'undefined' && CONFIG.APP_TOKEN) || '';
function apiHeaders(extra) { return Object.assign({ 'X-App-Token': APP_TOKEN }, extra || {}); }
const REQUIRED_FEATURES = ['me', 'rank', 'match_state', 'match_info', 'match_summary'];
const STORAGE = overwolf.extensions.io.enums.StorageSpace.appData;

let listenersRegistered = false;
let matchEndPending  = false;
let currentMatchId   = null;
let sessionActive    = false;
let playerName       = null;
let platform         = 'PC';
let currentRP        = null;
let sessionData      = null;
let gameIsRunning    = false;
let gepConnected     = false;
let gepRegistering   = false;   // guards against parallel retry loops

// ─── DB helpers ─────────────────────────────────────────────────────────────

function dbRead(filename, cb) {
  overwolf.extensions.io.readTextFile(STORAGE, filename, result => {
    if (result.success && result.content) {
      try { cb(null, JSON.parse(result.content)); }
      catch (e) { cb(e, null); }
    } else {
      cb(new Error(result.error || 'read failed'), null);
    }
  });
}

function dbWrite(filename, data, cb) {
  overwolf.extensions.io.writeTextFile(STORAGE, filename, JSON.stringify(data, null, 2), result => {
    if (cb) cb(result.success ? null : new Error(result.error));
  });
}

// ─── Apex API (via local CORS proxy — run start-proxy.bat first) ─────────────

async function fetchPlayerRP(name, plat) {
  const url = `${API_BASE}?action=rp&player=${encodeURIComponent(name)}&platform=${encodeURIComponent(plat)}`;
  let resp;
  try {
    resp = await fetch(url, { headers: apiHeaders() });
  } catch (e) {
    throw new Error('Server unreachable — check your connection (' + e.message + ')');
  }
  const text = await resp.text();
  if (!resp.ok) {
    // Show the actual API error body so we know what went wrong
    let msg = 'HTTP ' + resp.status;
    try { msg += ': ' + JSON.stringify(JSON.parse(text)); } catch (_) { msg += ': ' + text; }
    throw new Error(msg);
  }
  const data = JSON.parse(text);
  // API returns {"Error":"..."} on failure even with 200
  if (data && data.Error) throw new Error('API: ' + data.Error);
  const g = data && data.global;
  if (!g || !g.rank) throw new Error('Player not found or no ranked data');
  return {
    rankScore: g.rank.rankScore,
    rankName:  g.rank.rankName,
    rankDiv:   g.rank.rankDiv,
    ladderPos: g.rank.ladderPosPlatform
  };
}

// Predator cutoff — only the auth key is needed. Called at match end, never polled.
async function fetchPredatorRP(plat) {
  const url = `${API_BASE}?action=predator`;
  const resp = await fetch(url, { headers: apiHeaders() });
  const text = await resp.text();
  if (!resp.ok) throw new Error('Predator HTTP ' + resp.status);
  const data = JSON.parse(text);
  if (data && data.Error) throw new Error('API: ' + data.Error);
  const key = (plat || 'PC').toUpperCase();          // Switch → SWITCH
  const slot = data && data.RP && data.RP[key];
  if (!slot || typeof slot.val !== 'number') throw new Error('No predator data for ' + key);
  return slot.val;
}

// Fetch + cache the predator cutoff without ever blocking match recording.
async function refreshPredatorRP() {
  try {
    const cutoff = await fetchPredatorRP(platform);
    if (sessionData) sessionData.predatorRP = cutoff;
    return cutoff;
  } catch (e) {
    console.error('[bg] Predator fetch failed:', e.message);
    return sessionData ? sessionData.predatorRP : null;
  }
}

// ─── Streak ──────────────────────────────────────────────────────────────────

function calculateStreak(matches) {
  if (!matches || matches.length === 0) return 0;
  const last = matches[matches.length - 1];
  const dir = last.delta >= 0 ? 1 : -1;
  let streak = 0;
  for (let i = matches.length - 1; i >= 0; i--) {
    if ((matches[i].delta >= 0 ? 1 : -1) === dir) streak += dir;
    else break;
  }
  return streak;
}

// Cumulative RP floor to ENTER each tier (2026 ranked system).
const TIER_FLOORS = [
  { name: 'BRONZE',   rp: 1000 },
  { name: 'SILVER',   rp: 3000 },
  { name: 'GOLD',     rp: 5250 },
  { name: 'PLATINUM', rp: 8250 },
  { name: 'DIAMOND',  rp: 12000 },
  { name: 'MASTER',   rp: 16000 }
];

// Points to the next major rank-up. Above Master, the target is the live
// predator cutoff; already past it (true Predator) → null.
function nextBigRankup(rp, predatorRP) {
  if (rp == null) return null;
  for (const tier of TIER_FLOORS) {
    if (rp < tier.rp) return { name: tier.name, remaining: tier.rp - rp };
  }
  if (predatorRP && rp < predatorRP) {
    return { name: 'PREDATOR', remaining: predatorRP - rp };
  }
  return null;
}

function buildInGamePayload() {
  if (!sessionData) return {};
  const matches      = sessionData.matches || [];
  const sessionDelta = (sessionData.currentRP || 0) - (sessionData.startRP || 0);
  const lastMatch    = matches.slice(-1)[0];
  const last4        = matches.slice(-4).map(m => m.delta);
  return {
    currentRP:   sessionData.currentRP,
    rankName:    lastMatch ? lastMatch.rankName : '',
    rankDiv:     lastMatch ? lastMatch.rankDiv : '',
    ladderPos:   lastMatch ? lastMatch.ladderPos : null,
    isPred:      !!(lastMatch && /pred/i.test(lastMatch.rankName || '')),
    sessionDelta,
    matchCount:  matches.length,
    last4,
    nextRankup:  nextBigRankup(sessionData.currentRP, sessionData.predatorRP)
  };
}

// ─── Messaging ───────────────────────────────────────────────────────────────

function sendToDesktop(msgId, content) {
  overwolf.windows.sendMessage('desktop', msgId, content, () => {});
}

function sendToInGame(msgId, content) {
  overwolf.windows.sendMessage('in_game', msgId, content, () => {});
}

// ─── History persistence (offline report via proxy) ──────────────────────────


// Build {sessions: pastSessions, current} from disk + memory, POST to the proxy
// which writes apex-history.json + apex-history.html. Best-effort, never blocks.
function pushHistory() {
  dbRead('history.json', async (err, history) => {
    const sessions = (!err && Array.isArray(history)) ? history : [];
    try {
      const resp = await fetch(`${API_BASE}?action=save`, {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          player: playerName,
          platform,
          sessions,
          current: sessionData || null
        })
      });
      await resp.json().catch(() => {});
    } catch (e) {
      console.error('[bg] pushHistory failed:', e.message);
    }
  });
}

// Pull this player's full history from the cloud backend.
async function fetchHistory(name, plat) {
  if (!name || !API_BASE) return [];
  const url = `${API_BASE}?action=history&player=${encodeURIComponent(name)}&platform=${encodeURIComponent(plat || 'PC')}`;
  try {
    const resp = await fetch(url, { headers: apiHeaders() });
    const data = await resp.json();
    return (data && Array.isArray(data.sessions)) ? data.sessions : [];
  } catch (e) {
    console.error('[bg] fetchHistory failed:', e.message);
    return [];
  }
}

// Pull the global leaderboard for a time window (24h | 7d | all).
async function fetchLeaderboard(win) {
  if (!API_BASE) return [];
  const url = `${API_BASE}?action=leaderboard&window=${encodeURIComponent(win || '24h')}`;
  try {
    const resp = await fetch(url, { headers: apiHeaders() });
    const data = await resp.json();
    return (data && Array.isArray(data.players)) ? data.players : [];
  } catch (e) {
    console.error('[bg] fetchLeaderboard failed:', e.message);
    return [];
  }
}

// ─── Session management ──────────────────────────────────────────────────────

async function startSession(name, plat) {
  playerName = name;
  platform = plat || 'PC';
  try {
    const rankData = await fetchPlayerRP(playerName, platform);
    currentRP = rankData.rankScore;
    sessionActive = true;
    sessionData = {
      sessionActive: true,
      sessionStart: new Date().toISOString(),
      playerName,
      platform,
      startRP: currentRP,
      currentRP,
      hasPositionedOverlay: false,
      matches: []
    };
    dbWrite('session.json', sessionData);
    sendToDesktop('session_started', { ...sessionData });
    sendToInGame('rp_update', buildInGamePayload());
    pushHistory();

    // Open in-game overlay if game is already running
    if (gameIsRunning) openInGameWindow();
  } catch (e) {
    sendToDesktop('session_error', { message: e.message });
  }
}

function endSession() {
  if (!sessionData) return;
  sessionData.sessionActive = false;
  sessionActive = false;

  dbRead('history.json', (err, history) => {
    const arr = (!err && history) ? history : [];
    arr.push({ ...sessionData, sessionEnd: new Date().toISOString() });
    dbWrite('history.json', arr);
  });
  dbWrite('session.json', sessionData);
  sendToDesktop('session_ended', sessionData);
  pushHistory();
}

// ─── Match end handler ───────────────────────────────────────────────────────

function onMatchEnd() {
  if (!sessionActive || !playerName || matchEndPending) return;
  matchEndPending = true;

  setTimeout(async () => {
    try {
      const rankData = await fetchPlayerRP(playerName, platform);
      const rpBefore = currentRP;
      const rpAfter = rankData.rankScore;
      const delta = rpAfter - rpBefore;
      currentRP = rpAfter;

      const matchEntry = {
        timestamp: new Date().toISOString(),
        rpBefore,
        rpAfter,
        delta,
        rankName: rankData.rankName,
        rankDiv: rankData.rankDiv,
        ladderPos: rankData.ladderPos
      };

      sessionData.currentRP = currentRP;
      sessionData.matches.push(matchEntry);

      // Refresh the predator cutoff once per match end (never on a timer).
      await refreshPredatorRP();
      dbWrite('session.json', sessionData);

      sendToDesktop('match_recorded', { match: matchEntry, session: sessionData });
      sendToInGame('rp_update', buildInGamePayload());
      pushHistory();
    } catch (e) {
      console.error('[bg] Post-match RP fetch failed:', e.message);
    } finally {
      matchEndPending = false;
    }
  }, 4000);
}

// Manual record — no delay, no dedup guard, notifies in_game button state
async function manualRecordMatch() {
  if (!sessionActive || !playerName) {
    sendToDesktop('session_error', { message: 'No active session — start one first.' });
    sendToInGame('record_done', {});
    return;
  }
  sendToInGame('record_pending', {});
  try {
    const rankData = await fetchPlayerRP(playerName, platform);
    const rpBefore = currentRP;
    const rpAfter  = rankData.rankScore;
    const delta    = rpAfter - rpBefore;
    currentRP      = rpAfter;

    const matchEntry = {
      timestamp: new Date().toISOString(),
      rpBefore,
      rpAfter,
      delta,
      rankName: rankData.rankName,
      rankDiv:  rankData.rankDiv,
      ladderPos: rankData.ladderPos
    };

    sessionData.currentRP = currentRP;
    sessionData.matches.push(matchEntry);

    // Refresh the predator cutoff once per match end (never on a timer).
    await refreshPredatorRP();
    dbWrite('session.json', sessionData);

    sendToDesktop('match_recorded', { match: matchEntry, session: sessionData });
    sendToInGame('rp_update', buildInGamePayload());
    pushHistory();
  } catch (e) {
    sendToDesktop('session_error', { message: e.message });
  } finally {
    sendToInGame('record_done', {});
  }
}

// ─── GEP ─────────────────────────────────────────────────────────────────────

function registerFeatures(retries) {
  retries = retries || 0;
  // Only one retry loop at a time (init + game-launch can both call in).
  if (retries === 0) {
    if (gepRegistering) return;
    gepRegistering = true;
  }
  overwolf.games.events.setRequiredFeatures(REQUIRED_FEATURES, result => {
    if (!result.success) {
      const err = result.error || 'features not available yet';
      console.warn('[bg] GEP registration failed (try ' + (retries + 1) + '):', err);
      gepConnected = false;
      sendToDesktop('gep_status', { connected: false, error: err });
      // Apex GEP is usually unavailable at the menu/queue — keep retrying the
      // whole time the game is running instead of giving up after ~20s.
      if (gameIsRunning) {
        setTimeout(() => registerFeatures(retries + 1), 3000);
      } else {
        gepRegistering = false;
      }
      return;
    }
    gepRegistering = false;
    console.log('[bg] GEP features registered');
    gepConnected = true;
    sendToDesktop('gep_status', { connected: true });

    if (!listenersRegistered) {
      listenersRegistered = true;
      overwolf.games.events.onNewEvents.addListener(onNewEvent);
      overwolf.games.events.onInfoUpdates2.addListener(onInfoUpdate);
    }

    // Check if already mid-match (app launched while in-game)
    overwolf.games.events.getInfo(r => {
      if (!r || !r.res) return;
      // Auto-detect player name
      if (r.res.me && r.res.me.name && !playerName) {
        playerName = r.res.me.name;
        sendToDesktop('player_detected', { playerName });
      }
      // Check for active match
      const id = r.res.match_info && r.res.match_info.pseudo_match_id;
      if (id) {
        currentMatchId = id;
        console.log('[bg] Already in match:', id);
        sendToInGame('match_started', {});
      }
    });
  });
}

function onNewEvent(info) {
  if (!info || !info.events) return;
  for (const event of info.events) {
    console.log('[bg] event:', event.name, event.data);
    switch (event.name) {
      case 'match_start':
        // Backup — pseudo_match_id is primary
        sendToInGame('match_started', {});
        break;
      case 'match_end':
      case 'matchEnd':
      case 'match_summary':
        // Backup end signal — pseudo_match_id clearing is primary
        handleMatchEnd('event:' + event.name);
        break;
    }
  }
}

function onInfoUpdate(info) {
  if (!info || !info.info) return;
  const data = info.info;

  // Auto-detect player name
  if (data.me && data.me.name && !playerName) {
    playerName = data.me.name;
    sendToDesktop('player_detected', { playerName });
  }

  // ── Primary match lifecycle: pseudo_match_id ──────────────────────────────
  if (data.match_info && ('pseudo_match_id' in data.match_info)) {
    const id = data.match_info.pseudo_match_id;
    if (id && id !== currentMatchId) {
      // New match started
      currentMatchId   = id;
      matchEndPending  = false;   // reset dedup for the new match
      console.log('[bg] Match started, id:', id);
      sendToInGame('match_started', {});
    } else if (!id && currentMatchId) {
      // pseudo_match_id cleared → back in lobby
      console.log('[bg] Match ended (pseudo_match_id cleared)');
      currentMatchId = null;
      handleMatchEnd('pseudo_match_id:cleared');
    }
  }

  // ── Backup: match_summary object arrived ─────────────────────────────────
  if (data.match_summary || (data.match_info && data.match_info.match_summary)) {
    handleMatchEnd('match_summary');
  }

  // ── Backup: match_state left active ──────────────────────────────────────
  const matchState = (data.match_info && data.match_info.match_state) ||
                     (data.match_state && data.match_state.match_state);
  if (matchState) {
    const lower = matchState.toLowerCase();
    if (!lower.includes('active') && !lower.includes('in_progress') && lower !== '') {
      handleMatchEnd('match_state:' + lower);
    }
  }
}

// Deduplicated entry point for all end signals
function handleMatchEnd(source) {
  if (matchEndPending) return;
  console.log('[bg] Match end triggered by:', source);
  onMatchEnd();
}

// ─── In-game window ──────────────────────────────────────────────────────────

function openInGameWindow() {
  overwolf.windows.obtainDeclaredWindow('in_game', r => {
    if (!r.success) return;
    const winId = r.window.id;
    overwolf.windows.restore(winId, () => {
      // Only set initial position once
      if (sessionData && !sessionData.hasPositionedOverlay) {
        overwolf.games.getRunningGameInfo(gameInfo => {
          if (!gameInfo || !gameInfo.logicalWidth) return;
          const x = gameInfo.logicalWidth - 256;
          const y = 10;
          overwolf.windows.changePosition(winId, x, y, () => {
            sessionData.hasPositionedOverlay = true;
            dbWrite('session.json', sessionData);
          });
        });
      }
    });
  });
}

function closeInGameWindow() {
  overwolf.windows.obtainDeclaredWindow('in_game', r => {
    if (r.success) overwolf.windows.minimize(r.window.id, () => {});
  });
}

// Show/hide the overlay — bound to the manifest hotkey (default Ctrl+Shift+A).
function toggleInGameWindow() {
  overwolf.windows.obtainDeclaredWindow('in_game', r => {
    if (!r.success) return;
    const st = r.window.stateEx;
    if (st === 'normal' || st === 'maximized') closeInGameWindow();
    else openInGameWindow();
  });
}

function registerHotkeys() {
  if (!overwolf.settings || !overwolf.settings.hotkeys) return;
  overwolf.settings.hotkeys.onPressed.addListener(result => {
    if (result && result.name === 'apex_swag_toggle') toggleInGameWindow();
  });
}

// ─── Game detection ──────────────────────────────────────────────────────────

overwolf.games.onGameInfoUpdated.addListener(event => {
  if (!event || !event.gameInfo) return;
  const id = event.gameInfo.id;
  const isApex = id === APEX_GAME_ID || Math.floor(id / 10) === APEX_GAME_ID;
  if (!isApex) return;

  if (event.gameInfo.isRunning && !gameIsRunning) {
    console.log('[bg] Apex launched');
    gameIsRunning = true;
    setTimeout(() => registerFeatures(0), 3000);
    if (sessionActive) openInGameWindow();
  }

  if (!event.gameInfo.isRunning && gameIsRunning) {
    console.log('[bg] Apex closed');
    gameIsRunning = false;
    listenersRegistered = false;
    gepRegistering = false;
    gepConnected = false;
    sendToDesktop('gep_status', { connected: false });
    closeInGameWindow();
  }
});

// ─── Desktop window open ─────────────────────────────────────────────────────

overwolf.extensions.onAppLaunchTriggered.addListener(() => {
  overwolf.windows.obtainDeclaredWindow('desktop', r => {
    if (r.success) overwolf.windows.restore(r.window.id, () => {});
  });
});

// ─── Incoming messages from other windows ────────────────────────────────────

overwolf.windows.onMessageReceived.addListener(msg => {
  switch (msg.id) {
    case 'start_session':
      startSession(msg.content.playerName, msg.content.platform);
      break;
    case 'end_session':
      endSession();
      break;
    case 'record_match':
      // Manual trigger — same as onMatchEnd but always allowed
      manualRecordMatch();
      break;
    case 'request_state':
      sendToDesktop('state_sync', {
        sessionActive,
        sessionData,
        playerName,
        gepConnected
      });
      break;
    case 'request_history': {
      const who  = (msg.content && msg.content.playerName) || playerName;
      const plat = (msg.content && msg.content.platform)   || platform || 'PC';
      fetchHistory(who, plat).then((sessions) => {
        // The active session is shown live elsewhere — keep only completed ones here.
        const curStart = sessionData && sessionData.sessionStart;
        const past = curStart ? sessions.filter(s => s.sessionStart !== curStart) : sessions;
        sendToDesktop('history_data', { sessions: past, current: sessionData || null });
      });
      break;
    }
    case 'request_leaderboard': {
      const win = (msg.content && msg.content.window) || '24h';
      fetchLeaderboard(win).then((players) => {
        sendToDesktop('leaderboard_data', { window: win, players });
      });
      break;
    }
    case 'delete_match':
      if (sessionActive && sessionData && sessionData.matches) {
        sessionData.matches.splice(msg.content.index, 1);
        dbWrite('session.json', sessionData);
        sendToDesktop('match_deleted', { sessionData });
        pushHistory();
      }
      break;
  }
});

// ─── Init: restore persisted session + check if game already running ─────────

(function init() {
  // Open desktop on first launch
  overwolf.windows.obtainDeclaredWindow('desktop', r => {
    if (r.success) overwolf.windows.restore(r.window.id, () => {});
  });

  registerHotkeys();

  // Restore session from disk
  dbRead('session.json', (err, saved) => {
    if (!err && saved && saved.sessionActive) {
      sessionData   = saved;
      sessionActive = true;
      playerName    = saved.playerName;
      platform      = saved.platform;
      currentRP     = saved.currentRP;
    }
  });

  // Check if game already running at startup
  overwolf.games.getRunningGameInfo(result => {
    if (result && result.isRunning) {
      const id = result.id;
      const isApex = id === APEX_GAME_ID || Math.floor(id / 10) === APEX_GAME_ID;
      if (isApex) {
        gameIsRunning = true;
        registerFeatures(0);
      }
    }
  });
})();
