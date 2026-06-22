// desktop.js

function $(id) { return document.getElementById(id); }

// ─── Window chrome ────────────────────────────────────────────────────────────

overwolf.windows.getCurrentWindow(result => {
  if (!result.success) return;
  const winId = result.window.id;
  $('title-bar').addEventListener('mousedown', e => {
    if (e.target.closest('#window-controls')) return;
    overwolf.windows.dragMove(winId);
  });
  $('btn-minimize').addEventListener('click', () => overwolf.windows.minimize(winId, () => {}));
  $('btn-close').addEventListener('click', () => overwolf.windows.close(winId, () => {}));
});

// ─── Session controls ─────────────────────────────────────────────────────────

$('btn-start-session').addEventListener('click', () => {
  const name = $('input-player').value.trim();
  if (!name) { showError('Enter a player name.'); return; }
  clearError();
  const platform = $('select-platform').value;
  overwolf.windows.sendMessage('background', 'start_session', { playerName: name, platform }, () => {});
  $('btn-start-session').disabled = true;
  $('status-badge').textContent = 'Fetching...';
  $('status-badge').className = 'badge-pending';
});

$('btn-end-session').addEventListener('click', () => {
  overwolf.windows.sendMessage('background', 'end_session', {}, () => {});
  setSessionStatus(false);
});

$('btn-record-match').addEventListener('click', () => {
  $('btn-record-match').disabled = true;
  $('btn-record-match').textContent = '⏳ Fetching...';
  overwolf.windows.sendMessage('background', 'record_match', {}, () => {});
  // Re-enable after response (match_recorded or session_error will arrive)
  setTimeout(() => {
    $('btn-record-match').textContent = '⬤ Record Match';
    $('btn-record-match').disabled = !sessionActive;
  }, 12000);
});

$('btn-leaderboard').addEventListener('click', () => {
  const panel = $('leaderboard-container');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) requestLeaderboard();
});
$('leaderboard-window').addEventListener('change', requestLeaderboard);

function requestLeaderboard() {
  overwolf.windows.sendMessage('background', 'request_leaderboard',
    { window: $('leaderboard-window').value }, () => {});
}

// Ask for this player's cloud history (keyed by name + platform).
function requestHistory() {
  overwolf.windows.sendMessage('background', 'request_history', {
    playerName: $('input-player').value.trim(),
    platform: $('select-platform').value
  }, () => {});
}

// ─── Incoming messages from background ───────────────────────────────────────

overwolf.windows.onMessageReceived.addListener(msg => {
  switch (msg.id) {
    case 'session_started':
      renderSession(msg.content);
      setSessionStatus(true);
      clearError();
      break;
    case 'session_ended':
      setSessionStatus(false);
      requestHistory();
      break;
    case 'match_recorded':
      renderSession(msg.content.session);
      rebuildTable(msg.content.session.matches);
      $('btn-record-match').textContent = '⬤ Record Match';
      $('btn-record-match').disabled = false;
      break;
    case 'state_sync':
      if (msg.content.playerName) $('input-player').value = msg.content.playerName;
      if (msg.content.sessionData) renderSession(msg.content.sessionData);
      setSessionStatus(msg.content.sessionActive);
      setGepStatus(msg.content.gepConnected);
      break;
    case 'player_detected':
      if (!$('input-player').value) $('input-player').value = msg.content.playerName;
      break;
    case 'session_error':
      showError(msg.content.message);
      $('btn-start-session').disabled = false;
      $('btn-record-match').textContent = '⬤ Record Match';
      $('btn-record-match').disabled = !sessionActive;
      $('status-badge').textContent = 'No session';
      $('status-badge').className = 'badge-inactive';
      break;
    case 'match_deleted':
      renderSession(msg.content.sessionData);
      break;
    case 'gep_status':
      setGepStatus(msg.content.connected, msg.content.error);
      break;
    case 'leaderboard_data':
      renderLeaderboard(msg.content.players || []);
      break;
    case 'history_data':
      renderHistory(msg.content.sessions || []);
      break;
  }
});

$('matches-body').addEventListener('click', e => {
  const btn = e.target.closest('.btn-delete-match');
  if (!btn) return;
  overwolf.windows.sendMessage('background', 'delete_match', { index: parseInt(btn.dataset.index, 10) }, () => {});
});

// ─── UI helpers ───────────────────────────────────────────────────────────────

let sessionActive = false;

function setSessionStatus(active) {
  sessionActive = active;
  $('status-badge').textContent = active ? 'Session active' : 'No session';
  $('status-badge').className = active ? 'badge-active' : 'badge-inactive';
  $('btn-start-session').disabled = active;
  $('btn-end-session').disabled = !active;
  $('btn-record-match').disabled = !active;
}

function setGepStatus(connected, error) {
  const el = $('gep-badge');
  el.textContent = connected ? 'GEP ON' : 'GEP OFF';
  el.className   = connected ? 'badge-gep-on' : 'badge-gep-off';
  el.title       = connected
    ? 'Overwolf game events active — match end auto-detected'
    : error
      ? 'GEP not connected (' + error + ') — retrying while Apex runs. Use Record Match meanwhile.'
      : 'Overwolf game events inactive — use Record Match button after each game';
}

function renderSession(session) {
  if (!session) return;
  const delta = (session.currentRP || 0) - (session.startRP || 0);
  const streak = calcStreak(session.matches || []);
  const lastMatch = (session.matches || []).slice(-1)[0];

  $('s-current-rp').textContent = session.currentRP != null ? session.currentRP : '—';
  $('s-session-delta').textContent = formatDelta(delta);
  $('s-session-delta').className = 'card-value ' + (delta >= 0 ? 'positive' : 'negative');
  $('s-matches').textContent = (session.matches || []).length;
  $('s-streak').textContent = streak === 0 ? '—' : formatDelta(streak);
  $('s-streak').className = 'card-value ' + (streak > 0 ? 'positive' : streak < 0 ? 'negative' : '');
  $('s-rank').textContent = lastMatch ? `${lastMatch.rankName} ${lastMatch.rankDiv}` : '—';

  if (session.sessionStart) {
    $('session-time').textContent = 'Started ' + formatTime(session.sessionStart);
  }

  rebuildTable(session.matches || []);
}

function rebuildTable(matches) {
  const tbody = $('matches-body');
  tbody.innerHTML = '';
  if (matches.length === 0) {
    $('matches-table').classList.add('hidden');
    $('no-matches').classList.remove('hidden');
    return;
  }
  // Newest first
  [...matches].reverse().forEach((m, i) => {
    const num = matches.length - i;
    const originalIndex = matches.length - 1 - i;
    const tr = document.createElement('tr');
    const deltaClass = m.delta >= 0 ? 'delta-pos' : 'delta-neg';
    tr.innerHTML = `
      <td class="col-num">${num}</td>
      <td>${formatTime(m.timestamp)}</td>
      <td>${m.rpBefore}</td>
      <td>${m.rpAfter}</td>
      <td class="${deltaClass}">${formatDelta(m.delta)}</td>
      <td>${m.rankName} ${m.rankDiv}</td>
      <td><button class="btn-delete-match" data-index="${originalIndex}" title="Delete match">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
  $('matches-table').classList.remove('hidden');
  $('no-matches').classList.add('hidden');
}

function renderHistory(sessions) {
  const list = $('history-list');
  const past = sessions.filter(s => (s.matches || []).length > 0);
  if (!past.length) {
    $('no-history').classList.remove('hidden');
    list.innerHTML = '';
    $('history-meta').textContent = '';
    return;
  }
  $('no-history').classList.add('hidden');
  const totalMatches = past.reduce((a, s) => a + s.matches.length, 0);
  $('history-meta').textContent = past.length + ' sessions • ' + totalMatches + ' matches';

  // Newest session first
  list.innerHTML = past.slice().reverse().map(s => {
    const matches = s.matches || [];
    const net = (s.currentRP || 0) - (s.startRP || 0);
    const last = matches[matches.length - 1];
    const rank = last ? `${last.rankName} ${last.rankDiv}`.trim() : '—';
    const netCls = net >= 0 ? 'delta-pos' : 'delta-neg';
    const rows = matches.slice().reverse().map((m, i) => {
      const n = matches.length - i;
      const dc = m.delta >= 0 ? 'delta-pos' : 'delta-neg';
      return `<tr><td>${n}</td><td>${formatTime(m.timestamp)}</td><td>${m.rpBefore}</td><td>${m.rpAfter}</td><td class="${dc}">${formatDelta(m.delta)}</td><td>${m.rankName} ${m.rankDiv}</td></tr>`;
    }).join('');
    return `<details class="history-session">
      <summary>
        <span class="hs-date">${formatDate(s.sessionStart)}</span>
        <span class="hs-rank">${rank}</span>
        <span class="hs-matches">${matches.length} matches</span>
        <span class="hs-net ${netCls}">${formatDelta(net)}</span>
      </summary>
      <table class="history-table">
        <thead><tr><th>#</th><th>Time</th><th>Before</th><th>After</th><th>Δ</th><th>Rank</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
  }).join('');
}

function renderLeaderboard(players) {
  const body = $('leaderboard-body');
  const empty = $('no-leaderboard');
  if (!players.length) {
    empty.classList.remove('hidden');
    body.innerHTML = '';
    return;
  }
  empty.classList.add('hidden');
  body.innerHTML = players.map((p, i) => {
    const cls = p.netRP >= 0 ? 'delta-pos' : 'delta-neg';
    return `<tr><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.platform)}</td>` +
           `<td class="${cls}">${formatDelta(p.netRP)}</td><td>${p.matches}</td>` +
           `<td>${p.peakRP != null ? p.peakRP : '—'}</td></tr>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function showError(msg) {
  const el = $('api-error');
  el.textContent = '⚠ ' + msg;
  el.classList.remove('hidden');
}

function clearError() {
  $('api-error').classList.add('hidden');
}

function formatDelta(n) {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n;
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function calcStreak(matches) {
  if (!matches.length) return 0;
  const last = matches[matches.length - 1];
  const dir = last.delta >= 0 ? 1 : -1;
  let streak = 0;
  for (let i = matches.length - 1; i >= 0; i--) {
    if ((matches[i].delta >= 0 ? 1 : -1) === dir) streak += dir;
    else break;
  }
  return streak;
}

// ─── Ask background for current state on load ─────────────────────────────────

overwolf.windows.sendMessage('background', 'request_state', {}, () => {});
requestHistory();
