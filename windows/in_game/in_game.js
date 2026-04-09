// in_game.js

function $(id) { return document.getElementById(id); }

// ─── Update widget display ────────────────────────────────────────────────────

function updateWidget(data) {
  if (data.currentRP != null) $('current-rp').textContent = data.currentRP;
  if (data.rankName)          $('rank-name').textContent  = (data.rankName || 'APEX').toUpperCase();

  if (data.sessionDelta != null) {
    const d    = data.sessionDelta;
    const el   = $('session-delta');
    const chip = $('chip-session');
    el.textContent = (d >= 0 ? '+' : '') + d;
    el.className   = 'chip-val ' + (d > 0 ? 'positive' : d < 0 ? 'negative' : '');
    chip.classList.toggle('has-positive', d > 0);
    chip.classList.toggle('has-negative', d < 0);
  }

  if (data.matchCount != null) {
    $('matches-val').textContent = data.matchCount;
  }
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
  if (msg.id === 'record_pending') {
    // Show spinner state while fetching
    const btn = $('btn-record');
    btn.textContent = 'Fetching...';
    btn.disabled = true;
  }
  if (msg.id === 'record_done') {
    const btn = $('btn-record');
    btn.textContent = 'Record Match';
    btn.disabled = false;
  }
});

// ─── Drag ─────────────────────────────────────────────────────────────────────

overwolf.windows.getCurrentWindow(result => {
  if (!result.success) return;
  const winId = result.window.id;
  $('widget').addEventListener('mousedown', () => overwolf.windows.dragMove(winId));
});
