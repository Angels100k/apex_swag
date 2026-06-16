// in_game.js

function $(id) { return document.getElementById(id); }

// Tier floors mirror background.js — used only to draw the progress bar segment.
const TIER_FLOORS = [1000, 3000, 5250, 8250, 12000, 16000];

function fmt(n) {
  return (n == null) ? '—' : Number(n).toLocaleString('en-US');
}

// ─── Update widget display ────────────────────────────────────────────────────

function updateWidget(data) {
  // Rank header
  if (data.rankName != null) {
    const div = data.rankDiv ? ' ' + data.rankDiv : '';
    $('rank-name').textContent = ((data.rankName || 'APEX') + div).toUpperCase();
  }
  if ('ladderPos' in data) {
    $('ladder-pos').textContent = data.ladderPos ? '#' + data.ladderPos : '';
  }

  // Current RP
  if (data.currentRP != null) $('current-rp').textContent = fmt(data.currentRP);

  // Session change
  if (data.sessionDelta != null) {
    const d  = data.sessionDelta;
    const el = $('session-delta');
    el.textContent = (d >= 0 ? '+' : '−') + Number(Math.abs(d)).toLocaleString('en-US');
    el.className   = 'stat-val ' + (d > 0 ? 'positive' : d < 0 ? 'negative' : '');
  }

  // Last 4 games
  if (data.last4) renderGames(data.last4);

  // Next rank-up
  renderRankup(data.currentRP, data.nextRankup, data.isPred);
}

function renderGames(last4) {
  const pills = $('games-row').children;   // exactly 4
  // Newest on the right; pad the left with empties when < 4 games.
  const padded = new Array(4 - last4.length).fill(null).concat(last4.slice(-4));
  for (let i = 0; i < 4; i++) {
    const pill = pills[i];
    const v = padded[i];
    if (v == null) {
      pill.className = 'game-pill empty';
      pill.textContent = '';
    } else {
      pill.className = 'game-pill ' + (v >= 0 ? 'positive' : 'negative');
      pill.textContent = (v >= 0 ? '+' : '−') + Math.abs(v);
    }
  }
}

function renderRankup(currentRP, nextRankup, isPred) {
  const widget = $('widget');
  if (!nextRankup) {
    // Already at the top (true Predator) or no data.
    widget.classList.toggle('is-pred', !!isPred);
    $('rankup-remaining').textContent = isPred ? '★' : '—';
    $('rankup-target').textContent = isPred ? 'APEX PREDATOR' : 'TO NEXT RANK';
    $('rankup-fill').style.width = isPred ? '100%' : '0%';
    return;
  }
  widget.classList.remove('is-pred');
  $('rankup-remaining').textContent = Number(nextRankup.remaining).toLocaleString('en-US') + ' RP';
  $('rankup-target').textContent = 'TO ' + nextRankup.name;

  // Fill = progress through the current segment [lowerFloor, target].
  const target = (currentRP || 0) + nextRankup.remaining;
  const lower  = TIER_FLOORS.filter(f => f <= (currentRP || 0)).slice(-1)[0] || 0;
  const span   = target - lower;
  const pct    = span > 0 ? Math.max(0, Math.min(100, ((currentRP - lower) / span) * 100)) : 0;
  $('rankup-fill').style.width = pct + '%';
}

// ─── Incoming messages from background ───────────────────────────────────────

overwolf.windows.onMessageReceived.addListener(msg => {
  if (msg.id === 'rp_update') {
    updateWidget(msg.content);
  }
  if (msg.id === 'match_started') {
    const widget = $('widget');
    widget.classList.add('match-flash');
    setTimeout(() => widget.classList.remove('match-flash'), 600);
  }
});

// ─── Drag ─────────────────────────────────────────────────────────────────────

overwolf.windows.getCurrentWindow(result => {
  if (!result.success) return;
  const winId = result.window.id;
  $('widget').addEventListener('mousedown', () => overwolf.windows.dragMove(winId));
});
