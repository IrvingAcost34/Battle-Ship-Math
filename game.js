// =========================================================
// BATALLA NAVAL — Lógica del jugador
// =========================================================

const GAME_SECONDS = 600; // 10 minutos
const COLS = ['A','B','C','D','E','F','G','H','I','J'];
const ROWS = [1,2,3,4,5,6,7,8,9,10];

let state = {
  playerId: null,
  gameId: null,
  startTime: null,
  firstName: '',
  lastName: '',
  grade: '',
  points: 0,
  hits: 0,
  shots: 0,
  activeCoordinate: null,
  timerInterval: null,
  settingsChannel: null,
};

const screens = {
  register: document.getElementById('screen-register'),
  waiting: document.getElementById('screen-waiting'),
  game: document.getElementById('screen-game'),
  results: document.getElementById('screen-results'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ---------------------------------------------------------
// TABLERO — generar etiquetas y celdas
// ---------------------------------------------------------
function buildBoard() {
  const colsEl = document.getElementById('board-cols');
  const rowsEl = document.getElementById('board-rows');
  const gridEl = document.getElementById('board-grid');

  colsEl.innerHTML = '<span></span>' + COLS.map(c => `<span>${c}</span>`).join('');
  rowsEl.innerHTML = ROWS.map(r => `<span>${r}</span>`).join('');

  let cellsHtml = '';
  ROWS.forEach(r => {
    COLS.forEach(c => {
      const coord = `${c}${r}`;
      cellsHtml += `<button class="board-cell" data-coord="${coord}" aria-label="Disparar en ${coord}"></button>`;
    });
  });
  gridEl.innerHTML = cellsHtml;

  gridEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.board-cell');
    if (!cell || cell.disabled) return;
    openHitModal(cell.dataset.coord, cell);
  });
}

// ---------------------------------------------------------
// REGISTRO
// ---------------------------------------------------------
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const firstName = document.getElementById('first-name').value.trim();
  const lastName = document.getElementById('last-name').value.trim();
  const grade = document.getElementById('grade').value.trim();
  const btn = document.getElementById('register-btn');
  const errorEl = document.getElementById('register-error');
  errorEl.classList.add('hidden');

  if (!firstName || !lastName || !grade) return;

  btn.disabled = true;
  try {
    const { data, error } = await window.supabaseClient.rpc('register_and_join', {
      p_first_name: firstName,
      p_last_name: lastName,
      p_grade: grade,
    });

    if (error) throw error;

    state.playerId = data.player_id;
    state.firstName = firstName;
    state.lastName = lastName;
    state.grade = grade;

    document.getElementById('header-name').textContent = `${firstName} ${lastName}`;
    document.getElementById('header-grade').textContent = grade;
    document.getElementById('waiting-name').textContent = `${firstName} ${lastName} · ${grade}`;

    if (data.role === 'playing') {
      state.gameId = data.game_id;
      state.startTime = new Date(data.start_time);
      startGame();
    } else if (data.role === 'waiting') {
      showScreen('waiting');
      subscribeToQueue();
    } else {
      errorEl.textContent = 'La fila de espera está llena en este momento. Intenta de nuevo en unos minutos.';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'Ocurrió un error al registrarte. Intenta de nuevo.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------
// COLA DE ESPERA
// ---------------------------------------------------------
function subscribeToQueue() {
  state.settingsChannel = window.supabaseClient
    .channel('game_settings_watch_' + state.playerId)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'game_settings', filter: 'id=eq.1' },
      async (payload) => {
        const row = payload.new;
        if (row.current_player === state.playerId && !row.current_game_id) {
          await promoteToPlaying();
        }
      }
    )
    .subscribe();
}

async function promoteToPlaying() {
  if (state.settingsChannel) {
    window.supabaseClient.removeChannel(state.settingsChannel);
    state.settingsChannel = null;
  }
  const { data, error } = await window.supabaseClient.rpc('start_queued_game', {
    p_player_id: state.playerId,
  });
  if (error || data.error) {
    console.error(error || data.error);
    return;
  }
  state.gameId = data.game_id;
  state.startTime = new Date(data.start_time);
  startGame();
}

// ---------------------------------------------------------
// JUEGO
// ---------------------------------------------------------
function startGame() {
  state.points = 0;
  state.hits = 0;
  state.shots = 0;
  updateStats();
  buildBoard();
  showScreen('game');

  state.timerInterval = setInterval(tickTimer, 1000);
  tickTimer();
}

function tickTimer() {
  const elapsed = Math.floor((Date.now() - state.startTime.getTime()) / 1000);
  const remaining = Math.max(0, GAME_SECONDS - elapsed);
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const timerEl = document.getElementById('timer-value');
  timerEl.textContent = `${mm}:${ss}`;
  timerEl.classList.toggle('timer-warning', remaining <= 30 && remaining > 0);

  if (remaining <= 0) {
    clearInterval(state.timerInterval);
    finishGame();
  }
}

function updateStats() {
  document.getElementById('points-value').textContent = state.points;
  document.getElementById('hits-value').textContent = state.hits;
}

// ---------------------------------------------------------
// MODALES DE DISPARO
// ---------------------------------------------------------
const modalHit = document.getElementById('modal-hit');
const modalRange = document.getElementById('modal-range');
let activeCellEl = null;

function openHitModal(coord, cellEl) {
  state.activeCoordinate = coord;
  activeCellEl = cellEl;
  document.getElementById('modal-coordinate').textContent = `Coordenada ${coord}`;
  modalHit.classList.remove('hidden');
}

function closeModals() {
  modalHit.classList.add('hidden');
  modalRange.classList.add('hidden');
}

document.getElementById('btn-hit-no').addEventListener('click', async () => {
  await submitShot(false, null);
});

document.getElementById('btn-hit-yes').addEventListener('click', () => {
  modalHit.classList.add('hidden');
  buildRangeGrid();
  modalRange.classList.remove('hidden');
});

function buildRangeGrid() {
  const rangeGrid = document.getElementById('range-grid');
  rangeGrid.innerHTML = '';
  for (let n = 1; n <= 15; n++) {
    const btn = document.createElement('button');
    btn.className = 'range-btn';
    btn.textContent = n;
    btn.addEventListener('click', () => submitShot(true, n));
    rangeGrid.appendChild(btn);
  }
}

async function submitShot(hit, range) {
  const coord = state.activeCoordinate;
  const cellEl = activeCellEl;
  closeModals();

  if (cellEl) cellEl.disabled = true;

  try {
    const { data, error } = await window.supabaseClient.rpc('record_shot', {
      p_game_id: state.gameId,
      p_coordinate: coord,
      p_hit: hit,
      p_range: range,
    });
    if (error || data.error) throw (error || new Error(data.error));

    state.points = data.total_points;
    state.hits = data.total_hits;
    state.shots = data.total_shots;
    updateStats();

    if (cellEl) cellEl.classList.add(hit ? 'cell-hit' : 'cell-miss');
  } catch (err) {
    console.error(err);
    if (cellEl) cellEl.disabled = false; // permitir reintentar si falló el registro
  }
}

// ---------------------------------------------------------
// FINALIZAR PARTIDA
// ---------------------------------------------------------
async function finishGame() {
  document.querySelectorAll('.board-cell').forEach(c => c.disabled = true);

  try {
    const { data, error } = await window.supabaseClient.rpc('finish_game', {
      p_game_id: state.gameId,
    });
    if (error || (data && data.error)) throw (error || new Error(data.error));

    const { data: lbRow } = await window.supabaseClient
      .from('leaderboard')
      .select('position')
      .eq('player_id', state.playerId)
      .single();

    document.getElementById('results-name').textContent = `${state.firstName} ${state.lastName}`;
    document.getElementById('results-points').textContent = state.points;
    document.getElementById('results-hits').textContent = state.hits;
    document.getElementById('results-shots').textContent = state.shots;
    document.getElementById('results-position').textContent = lbRow ? `#${lbRow.position}` : '—';

    showScreen('results');
  } catch (err) {
    console.error(err);
  }
}
