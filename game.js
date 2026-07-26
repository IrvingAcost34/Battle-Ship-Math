// =========================================================
// BATALLA NAVAL — Asistente de mesa (1 vs 1)
// =========================================================

const EQUATION_DECK = [
  { eq: "x + 5 = 2",  ans: "-3" },
  { eq: "2x = 10",    ans: "5" },
  { eq: "x - 4 = -8", ans: "-4" },
  { eq: "3x + 1 = 7", ans: "2" },
  { eq: "x / 2 = -6", ans: "-12" },
  { eq: "-x = 9",     ans: "-9" },
  { eq: "x + 10 = 13",ans: "3" },
  { eq: "5 - x = 8",  ans: "-3" },
  { eq: "2x - 3 = 11",ans: "7" },
  { eq: "x / 3 = -2", ans: "-6" },
  { eq: "x + 7 = 0",  ans: "-7" },
  { eq: "4x = -16",   ans: "-4" },
];

const EVENT_CARDS = [
  { id: 'bomba_racimo',   title: '💥 Bomba de Racimo',  description: '¡Tienes derecho a cantar 2 disparos seguidos en tu hoja de papel!', shots: 2 },
  { id: 'torpedo_certero',title: '🎯 Torpedo Certero',   description: 'Disparo directo garantizado. ¡Canta un disparo sin resolver ecuación!', shots: 1 },
];

const EVENT_CHANCE = 0.25; // 25% de probabilidad de tarjeta de evento

let state = {
  playerId: null,
  matchId: null,
  isPlayer1: null,
  myName: '', myGrade: '',
  oppId: null, oppName: '', oppGrade: '',
  matchRow: null,
  channel: null,
  stopwatchInterval: null,
  currentEquationAnswer: null,
  eventShotsRemaining: 0,
  eventShotsTotal: 0,
  eventPointsAccum: 0,
  eventTitle: '',
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
// REGISTRO
// ---------------------------------------------------------
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const firstName = document.getElementById('first-name').value.trim();
  const lastName = document.getElementById('last-name').value.trim();
  const grade = document.getElementById('grade').value.trim();
  const oppFirst = document.getElementById('opp-first-name').value.trim();
  const oppLast = document.getElementById('opp-last-name').value.trim();
  const btn = document.getElementById('register-btn');
  const errorEl = document.getElementById('register-error');
  errorEl.classList.add('hidden');

  if (!firstName || !lastName || !grade || !oppFirst || !oppLast) return;

  btn.disabled = true;
  try {
    const { data, error } = await window.supabaseClient.rpc('register_or_join_match', {
      p_first_name: firstName,
      p_last_name: lastName,
      p_grade: grade,
      p_opponent_first_name: oppFirst,
      p_opponent_last_name: oppLast,
    });
    if (error) throw error;

    state.playerId = data.player_id;
    state.matchId = data.match_id;
    state.myName = `${firstName} ${lastName}`;
    state.myGrade = grade;

    subscribeToMatch();

    if (data.role === 'player1') {
      state.isPlayer1 = true;
      document.getElementById('waiting-opponent-name').textContent = `Esperando a ${oppFirst} ${oppLast}…`;
      showScreen('waiting');
    } else {
      state.isPlayer1 = false;
      const { data: matchRow } = await window.supabaseClient.from('matches').select('*').eq('id', state.matchId).single();
      await loadOpponentAndStart(matchRow);
    }
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'Ocurrió un error al registrarte. Intenta de nuevo.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

async function loadOpponentAndStart(matchRow) {
  state.matchRow = matchRow;
  state.isPlayer1 = matchRow.player1_id === state.playerId;
  const oppId = state.isPlayer1 ? matchRow.player2_id : matchRow.player1_id;
  state.oppId = oppId;

  const { data: oppRow } = await window.supabaseClient.from('players').select('*').eq('id', oppId).single();
  state.oppName = oppRow ? `${oppRow.first_name} ${oppRow.last_name}` : 'Rival';
  state.oppGrade = oppRow ? oppRow.grade : '';

  document.getElementById('me-name').textContent = state.myName;
  document.getElementById('opp-name').textContent = state.oppName;

  startStopwatch(matchRow.start_time);
  syncUI(matchRow);
  showScreen('game');
}

// ---------------------------------------------------------
// REALTIME
// ---------------------------------------------------------
function subscribeToMatch() {
  state.channel = window.supabaseClient
    .channel('match_' + state.matchId)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${state.matchId}` },
      async (payload) => {
        const row = payload.new;
        state.matchRow = row;

        if (row.status === 'playing' && screens.waiting.classList.contains('hidden') === false) {
          await loadOpponentAndStart(row);
          return;
        }
        if (row.status === 'finished') {
          if (row.force_ended) {
            resetToRegister();
          } else {
            showResults(row);
          }
          return;
        }
        syncUI(row);
      }
    )
    .subscribe();
}

function syncUI(row) {
  const myPoints = state.isPlayer1 ? row.player1_points : row.player2_points;
  const oppPoints = state.isPlayer1 ? row.player2_points : row.player1_points;
  document.getElementById('me-points').textContent = `${myPoints} pts`;
  document.getElementById('opp-points').textContent = `${oppPoints} pts`;
  document.getElementById('turn-counter').textContent = `Turno ${row.turn_number}`;

  const isMyTurn = row.current_turn_player_id === state.playerId;
  const banner = document.getElementById('turn-banner');
  const drawBtn = document.getElementById('draw-btn');

  banner.textContent = isMyTurn ? '¡Es tu turno!' : `Turno de ${state.oppName}`;
  banner.classList.toggle('turn-banner--mine', isMyTurn);
  drawBtn.disabled = !isMyTurn;
}

// ---------------------------------------------------------
// CRONÓMETRO (cuenta hacia arriba, informativo)
// ---------------------------------------------------------
function startStopwatch(startTimeIso) {
  const start = new Date(startTimeIso).getTime();
  clearInterval(state.stopwatchInterval);
  state.stopwatchInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    document.getElementById('stopwatch').textContent = `${mm}:${ss}`;
  }, 1000);
}

// ---------------------------------------------------------
// SACAR TARJETA
// ---------------------------------------------------------
const zones = {
  draw: document.getElementById('draw-zone'),
  equation: document.getElementById('equation-zone'),
  hit: document.getElementById('hit-zone'),
  event: document.getElementById('event-zone'),
};

function showZone(name) {
  Object.values(zones).forEach(z => z.classList.add('hidden'));
  zones[name].classList.remove('hidden');
}

document.getElementById('draw-btn').addEventListener('click', () => {
  if (Math.random() < EVENT_CHANCE) {
    drawEventCard();
  } else {
    drawEquationCard();
  }
});

function drawEquationCard() {
  const card = EQUATION_DECK[Math.floor(Math.random() * EQUATION_DECK.length)];
  state.currentEquationAnswer = card.ans;
  document.getElementById('equation-text').textContent = card.eq;
  document.getElementById('answer-input').value = '';
  document.getElementById('answer-input').disabled = false;
  document.getElementById('verify-btn').disabled = false;
  document.getElementById('verify-feedback').classList.add('hidden');
  showZone('equation');
  document.getElementById('answer-input').focus();
}

document.getElementById('verify-btn').addEventListener('click', verifyAnswer);
document.getElementById('answer-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') verifyAnswer();
});

async function verifyAnswer() {
  const input = document.getElementById('answer-input');
  const feedback = document.getElementById('verify-feedback');
  const given = input.value.trim();
  if (!given) return;

  input.disabled = true;
  document.getElementById('verify-btn').disabled = true;

  const correct = parseFloat(given) === parseFloat(state.currentEquationAnswer);

  if (correct) {
    feedback.textContent = '¡Correcto! Procede a cantar tu disparo.';
    feedback.className = 'verify-feedback verify-feedback--ok';
    feedback.classList.remove('hidden');
    setTimeout(() => {
      document.getElementById('hit-coordinate').textContent = `Coordenada X = ${state.currentEquationAnswer}`;
      showZone('hit');
      state._pendingEquationCorrect = true;
    }, 700);
  } else {
    feedback.textContent = 'Incorrecto. Pierdes el turno.';
    feedback.className = 'verify-feedback verify-feedback--bad';
    feedback.classList.remove('hidden');
    setTimeout(async () => {
      await submitTurn({
        cardType: 'equation',
        equation: document.getElementById('equation-text').textContent,
        correctAnswer: state.currentEquationAnswer,
        playerAnswer: given,
        answeredCorrectly: false,
        coordinate: null,
        hit: null,
        points: 0,
      });
      resetToDraw();
    }, 1200);
  }
}

document.getElementById('btn-hit-yes').addEventListener('click', () => handleHitResponse(true));
document.getElementById('btn-hit-no').addEventListener('click', () => handleHitResponse(false));

async function handleHitResponse(wasHit) {
  if (state.eventShotsTotal > 0) {
    // Disparo(s) bono de una tarjeta de evento
    if (wasHit) state.eventPointsAccum += 1;
    state.eventShotsRemaining -= 1;

    if (state.eventShotsRemaining > 0) {
      document.getElementById('hit-coordinate').textContent =
        `Disparo bono ${state.eventShotsTotal - state.eventShotsRemaining + 1} de ${state.eventShotsTotal}`;
      return;
    }

    await submitTurn({
      cardType: 'event',
      equation: null,
      correctAnswer: null,
      playerAnswer: null,
      answeredCorrectly: null,
      coordinate: null,
      hit: null,
      points: state.eventPointsAccum,
      eventCard: state.eventTitle,
    });
    state.eventShotsTotal = 0;
    state.eventShotsRemaining = 0;
    state.eventPointsAccum = 0;
    resetToDraw();
    return;
  }

  // Disparo normal de tarjeta de ecuación
  const given = document.getElementById('answer-input').value.trim();
  await submitTurn({
    cardType: 'equation',
    equation: document.getElementById('equation-text').textContent,
    correctAnswer: state.currentEquationAnswer,
    playerAnswer: given,
    answeredCorrectly: true,
    coordinate: `X = ${state.currentEquationAnswer}`,
    hit: wasHit,
    points: wasHit ? 1 : 0,
  });
  resetToDraw();
}

function drawEventCard() {
  const card = EVENT_CARDS[Math.floor(Math.random() * EVENT_CARDS.length)];
  state.eventTitle = card.title;
  state.eventShotsTotal = card.shots;
  state.eventShotsRemaining = card.shots;
  state.eventPointsAccum = 0;

  document.getElementById('event-title').textContent = card.title;
  document.getElementById('event-description').textContent = card.description;
  showZone('event');
}

document.getElementById('event-continue-btn').addEventListener('click', () => {
  document.getElementById('hit-coordinate').textContent =
    state.eventShotsTotal > 1 ? `Disparo bono 1 de ${state.eventShotsTotal}` : 'Disparo bono';
  showZone('hit');
});

function resetToDraw() {
  showZone('draw');
}

async function submitTurn(payload) {
  try {
    const { data, error } = await window.supabaseClient.rpc('submit_turn', {
      p_match_id: state.matchId,
      p_player_id: state.playerId,
      p_card_type: payload.cardType,
      p_equation: payload.equation,
      p_correct_answer: payload.correctAnswer,
      p_player_answer: payload.playerAnswer,
      p_answered_correctly: payload.answeredCorrectly,
      p_coordinate: payload.coordinate,
      p_hit: payload.hit,
      p_points: payload.points,
      p_event_card: payload.eventCard || null,
    });
    if (error || (data && data.error)) throw (error || new Error(data.error));
    // syncUI se actualizará también vía Realtime, pero lo hacemos ya
    // mismo en este cliente para que no espere el round-trip.
    state.matchRow = { ...state.matchRow, ...data };
    syncUI(state.matchRow);
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------
// FINALIZAR PARTIDA
// ---------------------------------------------------------
const modalFinish = document.getElementById('modal-finish');

document.getElementById('finish-btn').addEventListener('click', () => {
  document.getElementById('winner-me-label').textContent = state.myName;
  document.getElementById('winner-opp-label').textContent = state.oppName;
  modalFinish.classList.remove('hidden');
});

document.getElementById('btn-winner-me').addEventListener('click', () => declareWinner(state.playerId));
document.getElementById('btn-winner-opp').addEventListener('click', () => declareWinner(state.oppId));
document.getElementById('btn-winner-tie').addEventListener('click', () => declareWinner(null));

async function declareWinner(winnerId) {
  modalFinish.classList.add('hidden');
  try {
    const { data, error } = await window.supabaseClient.rpc('finish_match', {
      p_match_id: state.matchId,
      p_winner_id: winnerId,
    });
    if (error || (data && data.error)) throw (error || new Error(data.error));
    showResults({ ...state.matchRow, ...data, winner_id: winnerId, status: 'finished' });
  } catch (err) {
    console.error(err);
  }
}

function showResults(row) {
  clearInterval(state.stopwatchInterval);
  const myPoints = state.isPlayer1 ? row.player1_points : row.player2_points;
  const oppPoints = state.isPlayer1 ? row.player2_points : row.player1_points;

  let headline = 'Empate';
  let badge = '🤝';
  if (row.winner_id === state.playerId) { headline = '¡Ganaste!'; badge = '🏆'; }
  else if (row.winner_id) { headline = 'Perdiste'; badge = '🌊'; }

  document.getElementById('results-badge').textContent = badge;
  document.getElementById('results-headline').textContent = headline;
  document.getElementById('results-my-points').textContent = myPoints;
  document.getElementById('results-opp-points').textContent = oppPoints;

  showScreen('results');
}

// ---------------------------------------------------------
// CIERRE FORZADO POR EL ORGANIZADOR
// ---------------------------------------------------------
function showToast(message) {
  const toast = document.getElementById('force-end-toast');
  if (message) toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 5000);
}

function resetToRegister() {
  clearInterval(state.stopwatchInterval);
  if (state.channel) {
    window.supabaseClient.removeChannel(state.channel);
  }

  state = {
    playerId: null,
    matchId: null,
    isPlayer1: null,
    myName: '', myGrade: '',
    oppId: null, oppName: '', oppGrade: '',
    matchRow: null,
    channel: null,
    stopwatchInterval: null,
    currentEquationAnswer: null,
    eventShotsRemaining: 0,
    eventShotsTotal: 0,
    eventPointsAccum: 0,
    eventTitle: '',
  };

  document.getElementById('register-form').reset();
  document.getElementById('register-btn').disabled = false;
  showScreen('register');
  showToast();
}
