// background.js — main controller for Apex Swag RP Tracker

const APEX_GAME_ID = 21566;
const PROXY_BASE = 'http://127.0.0.1:7272';
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
let pollingInterval  = null;
let pollBusy         = false;   // prevent overlapping fetches

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

// ─── RP Polling (every 3s, records only on change) ───────────────────────────

function startPolling() {
  if (pollingInterval) return;
  console.log('[bg] Polling started');
  pollingInterval = setInterval(pollRP, 5000);
}

function stopPolling() {
  if (!pollingInterval) return;
  clearInterval(pollingInterval);
  pollingInterval = null;
  pollBusy = false;
  console.log('[bg] Polling stopped');
}

async function pollRP() {
  if (!sessionActive || !playerName || pollBusy) return;
  pollBusy = true;
  try {
    const rankData = await fetchPlayerRP(playerName, platform);
    const newRP = rankData.rankScore;

    // Only record when RP has actually changed
    if (newRP !== currentRP) {
      const rpBefore = currentRP;
      const rpAfter  = newRP;
      const delta    = rpAfter - rpBefore;
      currentRP      = newRP;

      const matchEntry = {
        timestamp: new Date().toISOString(),
        rpBefore,
        rpAfter,
        delta,
        rankName: rankData.rankName,
        rankDiv:  rankData.rankDiv
      };

      sessionData.currentRP = currentRP;
      sessionData.matches.push(matchEntry);
      dbWrite('session.json', sessionData);

      sendToDesktop('match_recorded', { match: matchEntry, session: sessionData });
      sendToInGame('rp_update', buildInGamePayload());
      console.log('[bg] RP changed:', rpBefore, '→', rpAfter, '(', delta > 0 ? '+' : '', delta, ')');
    }
  } catch (e) {
    console.error('[bg] Poll error:', e.message);
  } finally {
    pollBusy = false;
  }
}

// ─── Apex API (via local CORS proxy — run start-proxy.bat first) ─────────────

async function fetchPlayerRP(name, plat) {
  const url = `${PROXY_BASE}?auth=${CONFIG.APEX_API_KEY}&player=${encodeURIComponent(name)}&platform=${plat}`;
  let resp;
  try {
    resp = await fetch(url);
  } catch (e) {
    throw new Error('Proxy unreachable — is start-proxy.bat running? (' + e.message + ')');
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
    rankDiv:   g.rank.rankDiv
  };
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

function buildInGamePayload() {
  if (!sessionData) return {};
  const sessionDelta = (sessionData.currentRP || 0) - (sessionData.startRP || 0);
  const lastMatch = (sessionData.matches || []).slice(-1)[0];
  return {
    currentRP:   sessionData.currentRP,
    rankName:    lastMatch ? `${lastMatch.rankName} ${lastMatch.rankDiv}` : '',
    sessionDelta,
    matchCount:  (sessionData.matches || []).length
  };
}

// ─── Messaging ───────────────────────────────────────────────────────────────

function sendToDesktop(msgId, content) {
  overwolf.windows.sendMessage('desktop', msgId, content, () => {});
}

function sendToInGame(msgId, content) {
  overwolf.windows.sendMessage('in_game', msgId, content, () => {});
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

    startPolling();

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
  stopPolling();

  dbRead('history.json', (err, history) => {
    const arr = (!err && history) ? history : [];
    arr.push({ ...sessionData, sessionEnd: new Date().toISOString() });
    dbWrite('history.json', arr);
  });
  dbWrite('session.json', sessionData);
  sendToDesktop('session_ended', sessionData);
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
        rankDiv: rankData.rankDiv
      };

      sessionData.currentRP = currentRP;
      sessionData.matches.push(matchEntry);
      dbWrite('session.json', sessionData);

      sendToDesktop('match_recorded', { match: matchEntry, session: sessionData });
      sendToInGame('rp_update', buildInGamePayload());
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
      rankDiv:  rankData.rankDiv
    };

    sessionData.currentRP = currentRP;
    sessionData.matches.push(matchEntry);
    dbWrite('session.json', sessionData);

    sendToDesktop('match_recorded', { match: matchEntry, session: sessionData });
    sendToInGame('rp_update', buildInGamePayload());
  } catch (e) {
    sendToDesktop('session_error', { message: e.message });
  } finally {
    sendToInGame('record_done', {});
  }
}

// ─── GEP ─────────────────────────────────────────────────────────────────────

function registerFeatures(retries) {
  retries = retries || 0;
  overwolf.games.events.setRequiredFeatures(REQUIRED_FEATURES, result => {
    if (!result.success) {
      if (retries < 10) setTimeout(() => registerFeatures(retries + 1), 2000);
      return;
    }
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
          const x = gameInfo.logicalWidth - 220;
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
  }
});

// ─── Init: restore persisted session + check if game already running ─────────

(function init() {
  // Open desktop on first launch
  overwolf.windows.obtainDeclaredWindow('desktop', r => {
    if (r.success) overwolf.windows.restore(r.window.id, () => {});
  });

  // Restore session from disk
  dbRead('session.json', (err, saved) => {
    if (!err && saved && saved.sessionActive) {
      sessionData   = saved;
      sessionActive = true;
      playerName    = saved.playerName;
      platform      = saved.platform;
      currentRP     = saved.currentRP;
      startPolling();
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
