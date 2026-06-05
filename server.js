const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = __dirname;
const rooms = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

const INIT_BOARD = [
  'bR','bN','bB','bQ','bK','bB','bN','bR',
  'bP','bP','bP','bP','bP','bP','bP','bP',
  null,null,null,null,null,null,null,null,
  null,null,null,null,null,null,null,null,
  null,null,null,null,null,null,null,null,
  null,null,null,null,null,null,null,null,
  'wP','wP','wP','wP','wP','wP','wP','wP',
  'wR','wN','wB','wQ','wK','wB','wN','wR'
];

function serveFile(req, res) {
  const safeUrl = decodeURIComponent(req.url.split('?')[0]);
  const fileName = safeUrl === '/' ? 'index.html' : safeUrl.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, fileName);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream'
    });
    res.end(data);
  });
}

const server = http.createServer(serveFile);
const wss = new WebSocketServer({ server });

function randomId() {
  let id;
  do {
    id = crypto.randomBytes(3).toString('hex').toUpperCase();
  } while (rooms.has(id));
  return id;
}

function safeVariant(value) {
  const v = String(value || '').trim().toLowerCase();
  const allowed = new Set(['normal', 'chess960', 'random']);
  return allowed.has(v) ? v : null;
}

function shuffle(arr) {
  const a = [...arr];

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

function idx(r, f) {
  return r * 8 + f;
}

function pos(i) {
  return [Math.floor(i / 8), i % 8];
}

function col(p) {
  return p ? p[0] : null;
}

function type(p) {
  return p ? p.slice(1) : null;
}

function makeChess960BackRank(color) {
  const rank = Array(8).fill(null);
  const darkSquares = [0, 2, 4, 6];
  const lightSquares = [1, 3, 5, 7];

  const bishop1 = darkSquares[Math.floor(Math.random() * darkSquares.length)];
  const bishop2 = lightSquares[Math.floor(Math.random() * lightSquares.length)];

  rank[bishop1] = color + 'B';
  rank[bishop2] = color + 'B';

  let empty = rank.map((v, i) => v ? null : i).filter(v => v !== null);
  const queen = empty.splice(Math.floor(Math.random() * empty.length), 1)[0];
  rank[queen] = color + 'Q';

  empty = rank.map((v, i) => v ? null : i).filter(v => v !== null);
  const knight1 = empty.splice(Math.floor(Math.random() * empty.length), 1)[0];
  rank[knight1] = color + 'N';

  empty = rank.map((v, i) => v ? null : i).filter(v => v !== null);
  const knight2 = empty.splice(Math.floor(Math.random() * empty.length), 1)[0];
  rank[knight2] = color + 'N';

  empty = rank.map((v, i) => v ? null : i).filter(v => v !== null).sort((a, b) => a - b);

  rank[empty[0]] = color + 'R';
  rank[empty[1]] = color + 'K';
  rank[empty[2]] = color + 'R';

  return rank;
}

function attacksSquare(board, from, target) {
  const p = board[from];
  if (!p) return false;

  const [r, f] = pos(from);
  const [tr, tf] = pos(target);
  const c = col(p);
  const t = type(p);

  if (t === 'P') {
    const dir = c === 'w' ? -1 : 1;
    return tr === r + dir && Math.abs(tf - f) === 1;
  }

  if (t === 'N') {
    const dr = Math.abs(tr - r);
    const df = Math.abs(tf - f);
    return (dr === 2 && df === 1) || (dr === 1 && df === 2);
  }

  if (t === 'K') {
    return Math.max(Math.abs(tr - r), Math.abs(tf - f)) === 1;
  }

  const dr = tr - r;
  const df = tf - f;

  let stepR = 0;
  let stepF = 0;

  if (t === 'B') {
    if (Math.abs(dr) !== Math.abs(df)) return false;
    stepR = dr > 0 ? 1 : -1;
    stepF = df > 0 ? 1 : -1;
  }

  if (t === 'R') {
    if (dr !== 0 && df !== 0) return false;
    stepR = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
    stepF = df === 0 ? 0 : (df > 0 ? 1 : -1);
  }

  if (t === 'Q') {
    if (Math.abs(dr) === Math.abs(df)) {
      stepR = dr > 0 ? 1 : -1;
      stepF = df > 0 ? 1 : -1;
    } else if (dr === 0 || df === 0) {
      stepR = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
      stepF = df === 0 ? 0 : (df > 0 ? 1 : -1);
    } else {
      return false;
    }
  }

  let cr = r + stepR;
  let cf = f + stepF;

  while (cr !== tr || cf !== tf) {
    if (board[idx(cr, cf)]) return false;
    cr += stepR;
    cf += stepF;
  }

  return true;
}

function isInCheck(board, side) {
  const king = side + 'K';
  const kingIndex = board.indexOf(king);

  if (kingIndex === -1) return true;

  const enemy = side === 'w' ? 'b' : 'w';

  for (let i = 0; i < 64; i++) {
    if (board[i] && col(board[i]) === enemy) {
      if (attacksSquare(board, i, kingIndex)) return true;
    }
  }

  return false;
}

function makeRandomChessBoardOnce() {
  const whitePieces = shuffle([
    'wK','wQ','wR','wR','wB','wB','wN','wN',
    'wP','wP','wP','wP','wP','wP','wP','wP'
  ]);

  const blackPieces = whitePieces.map(p => 'b' + p[1]);

  return [
    ...blackPieces.slice(0, 8),
    ...blackPieces.slice(8, 16),
    null,null,null,null,null,null,null,null,
    null,null,null,null,null,null,null,null,
    null,null,null,null,null,null,null,null,
    null,null,null,null,null,null,null,null,
    ...whitePieces.slice(8, 16),
    ...whitePieces.slice(0, 8)
  ];
}

function makeValidRandomChessBoard() {
  let board;

  for (let tries = 0; tries < 10000; tries++) {
    board = makeRandomChessBoardOnce();

    if (!isInCheck(board, 'w') && !isInCheck(board, 'b')) {
      return board;
    }
  }

  return [...INIT_BOARD];
}

function createBoardByVariant(variant) {
  if (variant === 'normal') {
    return {
      variant: 'normal',
      board: [...INIT_BOARD]
    };
  }

  if (variant === 'chess960') {
    const whiteBack = makeChess960BackRank('w');
    const blackBack = whiteBack.map(p => 'b' + p[1]);

    return {
      variant: 'chess960',
      board: [
        ...blackBack,
        'bP','bP','bP','bP','bP','bP','bP','bP',
        null,null,null,null,null,null,null,null,
        null,null,null,null,null,null,null,null,
        null,null,null,null,null,null,null,null,
        null,null,null,null,null,null,null,null,
        'wP','wP','wP','wP','wP','wP','wP','wP',
        ...whiteBack
      ]
    };
  }

  if (variant === 'random') {
    return {
      variant: 'random',
      board: makeValidRandomChessBoard()
    };
  }

  return {
    variant: 'normal',
    board: [...INIT_BOARD]
  };
}

function send(ws, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function cleanup(ws, notify = true) {
  const roomId = ws.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);

  if (room) {
    const opponent = ws === room.white ? room.black : room.white;

    if (notify && opponent) {
      send(opponent, { type: 'opponent_left' });
      opponent.roomId = null;
      opponent.color = null;
    }

    rooms.delete(roomId);
  }

  ws.roomId = null;
  ws.color = null;
}

wss.on('connection', ws => {
  ws.roomId = null;
  ws.color = null;

  ws.on('message', raw => {
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'create') {
      cleanup(ws, false);

      const variant = safeVariant(msg.variant);

      if (!variant) {
        send(ws, {
          type: 'error',
          message: '체스 종류를 먼저 선택하세요.'
        });
        return;
      }

      const roomId = randomId();
      const game = createBoardByVariant(variant);

      rooms.set(roomId, {
        white: ws,
        black: null,
        state: 'waiting',
        variant: game.variant,
        board: game.board,
        createdAt: Date.now()
      });

      ws.roomId = roomId;
      ws.color = 'white';

      send(ws, {
        type: 'created',
        roomId,
        color: 'white',
        variant: game.variant,
        board: game.board
      });

      return;
    }

    if (msg.type === 'join') {
      cleanup(ws, false);

      const roomId = String(msg.roomId || '').trim().toUpperCase();
      const room = rooms.get(roomId);

      if (!/^[0-9A-F]{6}$/.test(roomId)) {
        send(ws, { type: 'error', message: '방 코드는 6자리 영문/숫자입니다.' });
        return;
      }

      if (!room) {
        send(ws, { type: 'error', message: '존재하지 않는 방입니다.' });
        return;
      }

      if (room.white === ws) {
        send(ws, { type: 'error', message: '자신이 만든 방에는 참가할 수 없습니다.' });
        return;
      }

      if (room.black || room.state === 'playing') {
        send(ws, { type: 'error', message: '이미 게임이 진행 중이거나 가득 찬 방입니다.' });
        return;
      }

      room.black = ws;
      room.state = 'playing';

      ws.roomId = roomId;
      ws.color = 'black';

      send(room.white, {
        type: 'start',
        color: 'white',
        roomId,
        variant: room.variant,
        board: room.board
      });

      send(room.black, {
        type: 'start',
        color: 'black',
        roomId,
        variant: room.variant,
        board: room.board
      });

      return;
    }

    if (msg.type === 'move') {
      const room = rooms.get(ws.roomId);
      if (!room || room.state !== 'playing') return;

      const opponent = ws === room.white ? room.black : room.white;

      send(opponent, {
        type: 'move',
        from: msg.from,
        to: msg.to,
        promo: msg.promo || null
      });

      return;
    }

    if (msg.type === 'leave') {
      cleanup(ws);
    }
  });

  ws.on('close', () => cleanup(ws));
});

setInterval(() => {
  const now = Date.now();

  for (const [roomId, room] of rooms) {
    if (room.state === 'waiting' && now - room.createdAt > 1000 * 60 * 60) {
      send(room.white, {
        type: 'error',
        message: '대기 시간이 너무 길어 방이 삭제되었습니다.'
      });

      cleanup(room.white, false);
    }
  }
}, 1000 * 60 * 10);

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT} 에서 체스 서버 실행 중`);
});