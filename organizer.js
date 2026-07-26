// =========================================================
// BATALLA NAVAL — Panel de organizadores (partidas 1 vs 1)
// =========================================================

const players = new Map(); // id -> {first_name, last_name, grade}
const matches = new Map(); // id -> match row

const statusLabel = { waiting: 'Esperando rival', playing: 'Jugando', finished: 'Finalizado' };

async function loadInitialData() {
  const [{ data: p }, { data: m }] = await Promise.all([
    window.supabaseClient.from('players').select('*'),
    window.supabaseClient.from('matches').select('*'),
  ]);

  (p || []).forEach(row => players.set(row.id, row));
  (m || []).forEach(row => matches.set(row.id, row));

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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
      if (payload.eventType === 'DELETE') matches.delete(payload.old.id);
      else matches.set(payload.new.id, payload.new);
      render();
    })
    .subscribe();
}

function playerLabel(id) {
  const p = players.get(id);
  return p ? `${p.first_name} ${p.last_name}` : '—';
}
function playerGrade(id) {
  const p = players.get(id);
  return p ? p.grade : '—';
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(startIso, endIso) {
  if (!startIso || !endIso) return '—';
  const seconds = Math.max(0, Math.floor((new Date(endIso) - new Date(startIso)) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function resultFor(match, playerId) {
  if (match.status !== 'finished') {
    return match.status === 'playing'
      ? '<span class="result-pill result-pill--live">En curso</span>'
      : '<span class="result-pill result-pill--tie">—</span>';
  }
  if (!match.winner_id) return '<span class="result-pill result-pill--tie">Empató</span>';
  return match.winner_id === playerId
    ? '<span class="result-pill result-pill--win">Ganó</span>'
    : '<span class="result-pill result-pill--lose">Perdió</span>';
}

function render() {
  renderSummary();
  renderTable();
}

function renderSummary() {
  const rows = Array.from(matches.values());
  document.getElementById('summary-playing').textContent = rows.filter(m => m.status === 'playing').length;
  document.getElementById('summary-waiting').textContent = rows.filter(m => m.status === 'waiting').length;
  document.getElementById('summary-finished').textContent = rows.filter(m => m.status === 'finished').length;
}

function renderTable() {
  const tbody = document.getElementById('org-table-body');
  const rows = Array.from(matches.values()).filter(m => m.player2_id); // solo partidas ya emparejadas

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="org-empty">Esperando partidas&hellip;</td></tr>';
    return;
  }

  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  let html = '';
  rows.forEach(m => {
    const pairs = [
      { id: m.player1_id, opp: m.player2_id, points: m.player1_points },
      { id: m.player2_id, opp: m.player1_id, points: m.player2_points },
    ];
    pairs.forEach((row, i) => {
      const isTurnPlayer = m.current_turn_player_id === row.id && m.status === 'playing';
      html += `
        <tr class="${i === 1 ? 'org-row-pair-end' : ''}">
          <td>${playerLabel(row.id)}${isTurnPlayer ? ' 🎯' : ''}</td>
          <td>${playerGrade(row.id)}</td>
          <td>${playerLabel(row.opp)}</td>
          <td>${row.points || 0}</td>
          <td>${resultFor(m, row.id)}</td>
          <td>${m.turn_number || 1}</td>
          <td>${fmtTime(m.start_time)}</td>
          <td>${fmtTime(m.end_time)}</td>
          <td>${fmtDuration(m.start_time, m.end_time)}</td>
          <td><span class="status-pill status-pill--${m.status}">${statusLabel[m.status] || m.status}</span></td>
        </tr>
      `;
    });
  });
  tbody.innerHTML = html;
}

// ---------------------------------------------------------
// FINALIZAR EVENTO (cierra todas las partidas activas)
// ---------------------------------------------------------
const forceEndModal = document.getElementById('modal-force-end');

document.getElementById('force-end-btn').addEventListener('click', () => {
  forceEndModal.classList.remove('hidden');
});
document.getElementById('cancel-force-end').addEventListener('click', () => {
  forceEndModal.classList.add('hidden');
});
document.getElementById('confirm-force-end').addEventListener('click', async () => {
  forceEndModal.classList.add('hidden');
  try {
    const { data, error } = await window.supabaseClient.rpc('force_end_all_matches');
    if (error) throw error;
    showToast(`Evento finalizado — se cerraron ${data.closed_matches} partida(s).`);
  } catch (err) {
    console.error(err);
    showToast('Ocurrió un error al finalizar el evento.');
  }
});

function showToast(message) {
  const toast = document.getElementById('force-end-toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 6000);
}

loadInitialData();
subscribeRealtime();
