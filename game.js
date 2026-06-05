const WS_URL =
  location.protocol === 'https:'
    ? `wss://${location.host}`
    : `ws://${location.host}`;

const GLYPHS = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
};

const INIT_BOARD = [
  'bR', 'bN', 'bB', 'bQ', 'bK', 'bB', 'bN', 'bR',
  'bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP',
  null, null, null, null, null, null, null, null,
  null, null, null, null, null, null, null, null,
  null, null, null, null, null, null, null, null,
  null, null, null, null, null, null, null, null,
  'wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP',
  'wR', 'wN', 'wB', 'wQ', 'wK', 'wB', 'wN', 'wR'
];

const VARIANT_NAMES = {
  normal: '일반 체스',
  chess960: '체스960',
  random: '랜덤체스'
};

let board, turn, selected, history, enPassant, castleRights, capturedW, capturedB, pendingPromo;
let myColor = null;
let ws = null;
let currentRoomId = null;
let currentVariant = 'normal';
let requestedVariant = 'normal';
let initialBoardFromServer = null;
let setupAnimating = false;

function variantLabel() {
  return VARIANT_NAMES[currentVariant] || '일반 체스';
}

function isSetupIndex(i) {
  const r = Math.floor(i / 8);

  if (currentVariant === 'chess960') {
    return r === 0 || r === 7;
  }

  if (currentVariant === 'random') {
    return r === 0 || r === 1 || r === 6 || r === 7;
  }

  return false;
}

function makeSetupPreviewBoard(finalBoard) {
  return finalBoard.map((piece, i) => {
    const r = Math.floor(i / 8);

    if (currentVariant === 'chess960') {
      if (r === 1 || r === 6) return piece;
      return null;
    }

    if (currentVariant === 'random') {
      return null;
    }

    return piece;
  });
}

function animateVariantSetup(finalBoard) {
  setupAnimating = true;
  board = makeSetupPreviewBoard(finalBoard);

  showGameMessage(currentVariant === 'random' ? '랜덤체스 배치 중...' : '체스960 배치 중...');
  render();

  setTimeout(() => {
    board = [...finalBoard];
    render();

    setTimeout(() => {
      setupAnimating = false;
      showGameMessage('');
      render();
    }, currentVariant === 'random' ? 1700 : 1300);
  }, 350);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setMainError(text) {
  const el = document.getElementById('mainError');
  if (el) el.textContent = text || '';
}

function connectWS(onOpen) {
  if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setMainError('');
    if (onOpen) onOpen();
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'created':
        currentRoomId = msg.roomId;
        requestedVariant = msg.requestedVariant || msg.variant || 'normal';
        currentVariant = msg.variant || 'normal';
        initialBoardFromServer = Array.isArray(msg.board) ? msg.board : null;

        document.getElementById('waitRoomId').textContent = msg.roomId;

        const waitVariant = document.getElementById('waitVariantName');
        if (waitVariant) waitVariant.textContent = variantLabel();

        showScreen('screenWait');
        break;

      case 'start':
        myColor = msg.color;
        currentRoomId = msg.roomId;
        requestedVariant = msg.requestedVariant || msg.variant || 'normal';
        currentVariant = msg.variant || 'normal';
        initialBoardFromServer = Array.isArray(msg.board) ? msg.board : null;

        showScreen('screenGame');
        initGame();
        break;

      case 'move':
        applyMove(msg.from, msg.to, msg.promo || null, true);
        break;

      case 'opponent_left':
        showGameMessage('상대방이 연결을 끊었습니다.');
        break;

      case 'error':
        setMainError(msg.message);
        showScreen('screenMain');
        break;
    }
  };

  ws.onerror = () => {
    setMainError('서버에 연결할 수 없습니다. node server.js로 서버를 먼저 실행하세요.');
  };

  ws.onclose = () => {
    if (document.getElementById('screenWait').classList.contains('active')) {
      showScreen('screenMain');
      setMainError('서버 연결이 끊어졌습니다.');
    }

    if (document.getElementById('screenGame').classList.contains('active')) {
      showGameMessage('서버 연결이 끊어졌습니다.');
    }
  };
}

function createRoom() {
  const select = document.getElementById('variantSelect');

  if (!select || !select.value) {
    setMainError('먼저 체스 종류를 선택하세요.');
    return;
  }

  const variant = select.value;

  setMainError('');
  currentRoomId = null;
  currentVariant = variant;
  requestedVariant = variant;
  initialBoardFromServer = null;

  document.getElementById('waitRoomId').textContent = '——';

  const waitVariant = document.getElementById('waitVariantName');
  if (waitVariant) waitVariant.textContent = '';

  connectWS(() => {
    ws.send(JSON.stringify({
      type: 'create',
      variant
    }));
  });
}

function joinRoom() {
  const input = document.getElementById('joinInput').value.trim().toUpperCase();

  if (input.length !== 6) {
    setMainError('방 코드는 6자리입니다.');
    return;
  }

  setMainError('');

  connectWS(() => {
    ws.send(JSON.stringify({
      type: 'join',
      roomId: input
    }));
  });
}

function leaveRoom() {
  if (ws) {
    ws.send(JSON.stringify({ type: 'leave' }));
    ws.close();
    ws = null;
  }

  currentRoomId = null;
  myColor = null;
  initialBoardFromServer = null;
  setupAnimating = false;

  document.getElementById('joinInput').value = '';
  showScreen('screenMain');
}

function copyRoomId() {
  if (!currentRoomId || currentRoomId === '——') return;

  navigator.clipboard.writeText(currentRoomId).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = '복사됨 ✓';

    setTimeout(() => {
      btn.textContent = '코드 복사';
    }, 1500);
  });
}

const col = p => p ? p[0] : null;
const type = p => p ? p.slice(1) : null;
const idx = (r, f) => r * 8 + f;
const pos = i => [Math.floor(i / 8), i % 8];

const isEnemy = (p1, p2) => p1 && p2 && col(p1) !== col(p2);
const isAlly = (p1, p2) => p1 && p2 && col(p1) === col(p2);

const FILES = 'abcdefgh';

const toAlg = i => {
  const [r, f] = pos(i);
  return FILES[f] + (8 - r);
};

function rawMoves(b, from, ep, cr) {
  const p = b[from];
  if (!p) return [];

  const [r, f] = pos(from);
  const c = col(p);
  const t = type(p);
  const dir = c === 'w' ? -1 : 1;
  const moves = [];

  if (t === 'P') {
    const nextRow = r + dir;

    if (nextRow >= 0 && nextRow < 8 && !b[idx(nextRow, f)]) {
      moves.push(idx(nextRow, f));

      if (((c === 'w' && r === 6) || (c === 'b' && r === 1)) && !b[idx(r + 2 * dir, f)]) {
        moves.push(idx(r + 2 * dir, f));
      }
    }

    [-1, 1].forEach(df => {
      const nf = f + df;

      if (nf >= 0 && nf < 8) {
        const target = idx(nextRow, nf);

        if (isEnemy(p, b[target]) || (ep !== null && target === ep)) {
          moves.push(target);
        }
      }
    });
  }

  if (t === 'N') {
    const jumps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];

    jumps.forEach(([dr, df]) => {
      const nr = r + dr;
      const nf = f + df;

      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8 && !isAlly(p, b[idx(nr, nf)])) {
        moves.push(idx(nr, nf));
      }
    });
  }

  const rays = [];

  if (t === 'B' || t === 'Q') rays.push([-1,-1],[-1,1],[1,-1],[1,1]);
  if (t === 'R' || t === 'Q') rays.push([-1,0],[1,0],[0,-1],[0,1]);

  for (const [dr, df] of rays) {
    for (let step = 1; step < 8; step++) {
      const nr = r + dr * step;
      const nf = f + df * step;

      if (nr < 0 || nr >= 8 || nf < 0 || nf >= 8) break;

      const target = idx(nr, nf);

      if (isAlly(p, b[target])) break;

      moves.push(target);

      if (b[target]) break;
    }
  }

  if (t === 'K') {
    const steps = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

    steps.forEach(([dr, df]) => {
      const nr = r + dr;
      const nf = f + df;

      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8 && !isAlly(p, b[idx(nr, nf)])) {
        moves.push(idx(nr, nf));
      }
    });

    const baseRow = c === 'w' ? 7 : 0;

    if (r === baseRow) {
      if (cr[c + 'K'] && !b[idx(baseRow, 5)] && !b[idx(baseRow, 6)]) {
        moves.push(idx(baseRow, 6));
      }

      if (cr[c + 'Q'] && !b[idx(baseRow, 3)] && !b[idx(baseRow, 2)] && !b[idx(baseRow, 1)]) {
        moves.push(idx(baseRow, 2));
      }
    }
  }

  return moves;
}

function kingIdx(b, side) {
  return b.indexOf(side === 'w' ? 'wK' : 'bK');
}

function isInCheck(b, side) {
  const k = kingIdx(b, side);
  const opp = side === 'w' ? 'b' : 'w';
  const dummyCR = { wK: false, wQ: false, bK: false, bQ: false };

  for (let i = 0; i < 64; i++) {
    if (b[i] && col(b[i]) === opp) {
      if (rawMoves(b, i, null, dummyCR).includes(k)) return true;
    }
  }

  return false;
}

function legalMoves(b, from, ep, cr) {
  const p = b[from];
  if (!p) return [];

  const side = col(p);
  const t = type(p);
  const raw = rawMoves(b, from, ep, cr);

  return raw.filter(to => {
    const nextB = [...b];
    const [fr, ff] = pos(from);
    const [tr, tf] = pos(to);

    if (t === 'P' && ff !== tf && !b[to] && to === ep) {
      const epPieceIdx = idx(fr, tf);
      nextB[epPieceIdx] = null;
    }

    if (t === 'K') {
      const baseRow = side === 'w' ? 7 : 0;

      if (to === idx(baseRow, 6)) {
        if (isInCheck(nextB, side)) return false;

        const testB = [...nextB];
        testB[idx(baseRow, 5)] = testB[from];
        testB[from] = null;

        if (isInCheck(testB, side)) return false;
      }

      if (to === idx(baseRow, 2)) {
        if (isInCheck(nextB, side)) return false;

        const testB = [...nextB];
        testB[idx(baseRow, 3)] = testB[from];
        testB[from] = null;

        if (isInCheck(testB, side)) return false;
      }
    }

    nextB[to] = nextB[from];
    nextB[from] = null;

    return !isInCheck(nextB, side);
  });
}

function allLegalMoves(b, side, ep, cr) {
  const res = [];

  for (let i = 0; i < 64; i++) {
    if (b[i] && col(b[i]) === side) {
      legalMoves(b, i, ep, cr).forEach(to => {
        res.push({ from: i, to });
      });
    }
  }

  return res;
}

function initGame() {
  const finalBoard = initialBoardFromServer ? [...initialBoardFromServer] : [...INIT_BOARD];

  board = [...finalBoard];
  turn = 'w';
  selected = null;
  history = [];
  enPassant = null;

  castleRights = currentVariant === 'normal'
    ? { wK: true, wQ: true, bK: true, bQ: true }
    : { wK: false, wQ: false, bK: false, bQ: false };

  capturedW = [];
  capturedB = [];
  pendingPromo = null;

  document.getElementById('promoOverlay').classList.remove('show');

  if (currentVariant === 'chess960' || currentVariant === 'random') {
    animateVariantSetup(finalBoard);
  } else {
    setupAnimating = false;
    showGameMessage('');
    render();
  }
}

function applyMove(from, to, promo, isOpponent = false) {
  const nextB = [...board];
  const p = nextB[from];

  if (!p) return;

  const side = col(p);
  const t = type(p);
  const [fr, ff] = pos(from);
  const [tr, tf] = pos(to);

  let notation = toAlg(from) + toAlg(to);
  let capturedPiece = null;

  if (t === 'P' && ff !== tf && !nextB[to] && to === enPassant) {
    const epPieceIdx = idx(fr, tf);
    capturedPiece = nextB[epPieceIdx];
    nextB[epPieceIdx] = null;
  }

  if (nextB[to]) capturedPiece = nextB[to];

  if (t === 'K') {
    const baseRow = side === 'w' ? 7 : 0;

    if (to === idx(baseRow, 6)) {
      nextB[idx(baseRow, 5)] = nextB[idx(baseRow, 7)];
      nextB[idx(baseRow, 7)] = null;
    }

    if (to === idx(baseRow, 2)) {
      nextB[idx(baseRow, 3)] = nextB[idx(baseRow, 1)];
      nextB[idx(baseRow, 1)] = null;
    }

    castleRights[side + 'K'] = false;
    castleRights[side + 'Q'] = false;
  }

  if (t === 'R') {
    if (from === idx(7, 7)) castleRights.wK = false;
    if (from === idx(7, 0)) castleRights.wQ = false;
    if (from === idx(0, 7)) castleRights.bK = false;
    if (from === idx(0, 0)) castleRights.bQ = false;
  }

  nextB[to] = nextB[from];
  nextB[from] = null;

  if (t === 'P' && (tr === 0 || tr === 7)) {
    if (!promo) {
      pendingPromo = { from, to };
      showPromotion(side);
      return;
    }

    nextB[to] = side + promo;
    notation += promo.toLowerCase();
  }

  if (capturedPiece) {
    if (side === 'w') capturedW.push(capturedPiece);
    else capturedB.push(capturedPiece);
  }

  history.push({
    board: [...board],
    ep: enPassant,
    cr: { ...castleRights },
    cap: { w: [...capturedW], b: [...capturedB] },
    notation,
    from,
    to
  });

  board = nextB;
  enPassant = (t === 'P' && Math.abs(tr - fr) === 2) ? idx((fr + tr) / 2, ff) : null;
  turn = turn === 'w' ? 'b' : 'w';
  selected = null;

  checkGameState();
  render();
}

function showPromotion(side) {
  const box = document.getElementById('promoBox');
  const pieces = ['Q', 'R', 'B', 'N'];

  box.innerHTML = pieces.map(t => `
    <div class="promo-piece ${side === 'w' ? 'white' : 'black'}" onclick="choosePromo('${t}')">
      ${GLYPHS[side + t]}
    </div>
  `).join('');

  document.getElementById('promoOverlay').classList.add('show');
}

function choosePromo(pType) {
  document.getElementById('promoOverlay').classList.remove('show');

  if (pendingPromo) {
    const { from, to } = pendingPromo;
    pendingPromo = null;

    if (ws) {
      ws.send(JSON.stringify({
        type: 'move',
        from,
        to,
        promo: pType
      }));
    }

    applyMove(from, to, pType, false);
  }
}

function checkGameState() {
  const moves = allLegalMoves(board, turn, enPassant, castleRights);
  const check = isInCheck(board, turn);

  if (moves.length === 0) {
    if (check) {
      showGameMessage(turn === 'w' ? '체크메이트! 흑 승리' : '체크메이트! 백 승리');
    } else {
      showGameMessage('스테일메이트 — 무승부!');
    }
  } else if (check) {
    showGameMessage(turn === 'w' ? '백 체크!' : '흑 체크!');
  } else {
    showGameMessage('');
  }
}

function showGameMessage(text) {
  const card = document.getElementById('gameMessage');
  const txt = document.getElementById('gameMessageText');

  if (text) {
    card.style.display = 'block';
    txt.textContent = text;
  } else {
    card.style.display = 'none';
  }
}

function clickSquare(i) {
  if (setupAnimating) return;
  if (pendingPromo) return;
  if (!myColor) return;

  const myTurnCode = myColor === 'white' ? 'w' : 'b';
  if (turn !== myTurnCode) return;

  const p = board[i];

  if (selected === null) {
    if (p && col(p) === turn) {
      selected = i;
      render();
    }
  } else {
    const targets = legalMoves(board, selected, enPassant, castleRights);

    if (targets.includes(i)) {
      if (ws) {
        ws.send(JSON.stringify({
          type: 'move',
          from: selected,
          to: i
        }));
      }

      applyMove(selected, i, null, false);
    } else {
      if (p && col(p) === turn) selected = i;
      else selected = null;

      render();
    }
  }
}

function render() {
  const bDiv = document.getElementById('board');
  const validTargets = selected !== null ? legalMoves(board, selected, enPassant, castleRights) : [];
  const checkKingIdx = isInCheck(board, turn) ? kingIdx(board, turn) : -1;
  const invert = myColor === 'black';

  bDiv.innerHTML = '';

  for (let s = 0; s < 64; s++) {
    const i = invert ? 63 - s : s;
    const [r, f] = pos(i);

    const sq = document.createElement('div');
    sq.className = 'sq ' + ((r + f) % 2 === 0 ? 'light' : 'dark');

    if (i === selected) sq.classList.add('selected');
    if (i === checkKingIdx) sq.classList.add('in-check');

    if (validTargets.includes(i)) {
      sq.classList.add(board[i] ? 'capture-hint' : 'move-hint');
    }

    const myTurnCode = myColor === 'white' ? 'w' : 'b';
    if (!myColor || turn !== myTurnCode || setupAnimating) {
      sq.classList.add('blocked');
    }

    if (board[i]) {
      const animClass = setupAnimating && isSetupIndex(i) ? ' setup-piece' : '';
      const delay = setupAnimating && isSetupIndex(i) ? `style="animation-delay:${s * 35}ms"` : '';

      sq.innerHTML = `
        <span 
          class="piece ${col(board[i]) === 'w' ? 'white' : 'black'}${animClass}"
          data-square="${i}"
          ${delay}
        >
          ${GLYPHS[board[i]]}
        </span>
      `;
    }

    sq.addEventListener('click', () => clickSquare(i));
    bDiv.appendChild(sq);
  }

  const td = document.getElementById('turnDisplay');
  td.innerHTML = `
    <span class="dot ${turn === 'w' ? 'white' : 'black'}"></span>
    <span>${turn === 'w' ? '백 차례' : '흑 차례'}</span>
  `;

  document.getElementById('myColorBadge').textContent =
    '나: ' + (myColor === 'white' ? '백 ♔' : '흑 ♚') + ' · ' + variantLabel();

  document.getElementById('capturedWhite').textContent = capturedW.map(p => GLYPHS[p]).join('');
  document.getElementById('capturedBlack').textContent = capturedB.map(p => GLYPHS[p]).join('');

  const ml = document.getElementById('moveList');
  ml.innerHTML = '';

  for (let i = 0; i < history.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-pair';

    const num = document.createElement('span');
    num.className = 'move-num';
    num.textContent = (i / 2 + 1) + '.';

    const m1 = document.createElement('span');
    m1.textContent = history[i].notation;

    const m2 = document.createElement('span');
    if (history[i + 1]) m2.textContent = history[i + 1].notation;

    row.append(num, m1, m2);
    ml.appendChild(row);
  }

  ml.scrollTop = ml.scrollHeight;

  const rl = document.getElementById('rankLabels');
  rl.innerHTML = '';

  for (let r = 0; r < 8; r++) {
    const s = document.createElement('span');
    s.textContent = invert ? (r + 1) : (8 - r);
    rl.appendChild(s);
  }

  const fl = document.getElementById('fileLabels');
  fl.innerHTML = '';

  const fOrder = invert ? 'hgfedcba' : 'abcdefgh';

  for (let f = 0; f < 8; f++) {
    const s = document.createElement('span');
    s.textContent = fOrder[f];
    fl.appendChild(s);
  }
}