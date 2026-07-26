// =========================================================
// BATALLA NAVAL — Panel de organizadores (tiempo real)
// =========================================================

const GAME_SECONDS = 600;

const players = new Map();     // id -> {first_name, last_name, grade}
const games = new Map();       // id -> game row
const leaderboard = new Map(); // player_id -> position

let settings = { current_player: null, next_player: null, game_running: false };
let clockInterval = null;

const statusLabel = { waiting: 'Esperando', playing: 'Jugando', finished: 'Finalizado' };

async function loadInitialData() {
  const [{ data: p }, { data: g }, { data: lb }, { data: s }] = await Promise.all([
    window.supabaseClient.from('players').select('*'),
    window.supabaseClient.from('games').select('*'),
    window.supabaseClient.from('leaderboard').select('*'),
    window.supabaseClient.from('game_settings').select('*').eq('id', 1).single(),
  ]);

  (p || []).forEach(row => players.set(row.id, row));
  (g || []).forEach(row => games.set(row.id, row));
  (lb || []).forEach(row => leaderboard.set(row.player_id, row.position));
  if (s) settings = s;

  render();
}

function subscribeRealtime() {
  window.supabaseClient
    .channel('organizer-dashboard')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, (payload) => {
      if (payload.eventType === 'DELETE') players.delete(payload.old.id);
      else players.set(payload.new.id, payload.new);
      render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, (payload) => {
      if (payload.eventType === 'DELETE') games.delete(payload.old.id);
      else games.set(payload.new.id, payload.new);
      render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leaderboard' }, (payload) => {
      if (payload.eventType === 'DELETE') leaderboard.delete(payload.old.player_id);
      else leaderboard.set(payload.new.player_id, payload.new.position);
      render();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_settings', filter: 'id=eq.1' }, (payload) => {
      settings = payload.new;
      render();
    })
    .subscribe();
}

function playerName(id) {
  const p = players.get(id);
  return p ? `${p.first_name} ${p.last_name} (${p.grade})` : '—';
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function render() {
  document.getElementById('current-player-name').textContent = settings.current_player ? playerName(settings.current_player) : '— Nadie —';
  document.getElementById('next-player-name').textContent = settings.next_player ? playerName(settings.next_player) : '— Nadie —';

  renderTable();
  renderClock();
}

function renderTable() {
  const tbody = document.getElementById('org-table-body');
  const rows = Array.from(games.values());

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="org-empty">Esperando partidas&hellip;</td></tr>';
    return;
  }

  rows.sort((a, b) => (b.total_points || 0) - (a.total_points || 0));

  tbody.innerHTML = rows.map(g => {
    const p = players.get(g.player_id) || {};
    const pos = leaderboard.get(g.player_id);
    return `
      <tr>
        <td>${pos ? '#' + pos : '—'}</td>
        <td>${p.first_name || '—'}</td>
        <td>${p.last_name || '—'}</td>
        <td>${p.grade || '—'}</td>
        <td>${g.total_points || 0}</td>
        <td>${g.total_shots || 0}</td>
        <td>${g.total_hits || 0}</td>
        <td>${fmtTime(g.start_time)}</td>
        <td>${fmtTime(g.end_time)}</td>
        <td>${fmtDuration(g.game_duration)}</td>
        <td><span class="status-pill status-pill--${g.status}">${statusLabel[g.status] || g.status}</span></td>
      </tr>
    `;
  }).join('');
}

function renderClock() {
  const playingGame = Array.from(games.values()).find(g => g.status === 'playing');
  const timerEl = document.getElementById('org-timer');

  clearInterval(clockInterval);

  if (!playingGame || !playingGame.start_time) {
    timerEl.textContent = '—';
    return;
  }

  const update = () => {
    const elapsed = Math.floor((Date.now() - new Date(playingGame.start_time).getTime()) / 1000);
    const remaining = Math.max(0, GAME_SECONDS - elapsed);
    timerEl.textContent = fmtDuration(remaining);
  };

  update();
  clockInterval = setInterval(update, 1000);
}

loadInitialData();
subscribeRealtime();
