const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const { getSudoku } = require('sudoku-gen');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // em produção, você pode restringir ao domínio do frontend
    methods: ["GET", "POST"]
  }
});

/* ── Salas em memória ─────────────────────────────────────────── */
const rooms = {};
// { [roomCode]: { players, puzzle, solution, difficulty, board[], wins{}, progress{}, chat[] } }

function generatePuzzle(difficulty = 'easy') {
  const d = ['easy','medium','hard','expert'].includes(difficulty) ? difficulty : 'easy';
  return getSudoku(d);
}

function roomPublic(room) {
  return {
    players:    room.players,
    puzzle:     room.puzzle,
    solution:   room.solution,
    difficulty: room.difficulty,
    wins:       room.wins,
    progress:   room.progress,
    chat:       room.chat,
  };
}

io.on('connection', (socket) => {
  console.log('+ Conectou:', socket.id);

  /* ── Solo ─────────────────────────────────────────────────── */
  socket.on('solo-game', ({ nickname, difficulty } = {}) => {
    const pd = generatePuzzle(difficulty);
    socket.emit('solo-game-ready', { puzzle: pd.puzzle, solution: pd.solution });
  });

  /* ── Criar sala ───────────────────────────────────────────── */
  socket.on('create-room', ({ nickname, difficulty }) => {
    // guard: mesmo socket já tem sala?
    const ex = Object.entries(rooms).find(([, r]) => r.players.some(p => p.id === socket.id));
    if (ex) {
      socket.emit('room-created', { roomCode: ex[0], isCreator: true });
      return;
    }
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const pd = generatePuzzle(difficulty);
    rooms[roomCode] = {
      players:    [{ id: socket.id, nickname }],
      puzzle:     pd.puzzle,
      solution:   pd.solution,
      difficulty,
      board:      pd.puzzle.split('').map(c => c === '-' ? 0 : parseInt(c)),
      wins:       { [socket.id]: 0 },
      progress:   { [socket.id]: 0 },
      chat:       [],
    };
    socket.join(roomCode);
    socket.emit('room-created', { roomCode, isCreator: true });
    console.log(`Sala ${roomCode} criada por ${nickname}`);
  });

  /* ── Entrar em sala ───────────────────────────────────────── */
  socket.on('join-room', ({ roomCode, nickname }) => {
    const room = rooms[roomCode];
    if (!room)                                      { socket.emit('error', 'Sala não encontrada'); return; }
    if (room.players.some(p => p.id === socket.id)) { /* reconexão silenciosa */ return; }
    if (room.players.length >= 2)                   { socket.emit('error', 'Sala cheia'); return; }

    room.players.push({ id: socket.id, nickname });
    room.wins[socket.id]     = 0;
    room.progress[socket.id] = 0;
    socket.join(roomCode);

    const payload = {
      ...roomPublic(room),
      roomCode,
      isCreator: false,
    };
    // envia para o 2º jogador
    socket.emit('game-ready', payload);
    // envia para o criador (com isCreator: true)
    const creator = room.players[0];
    io.to(creator.id).emit('game-ready', { ...payload, isCreator: true });
    console.log(`${nickname} entrou na sala ${roomCode}`);
  });

  /* ── Reconexão ────────────────────────────────────────────── */
  socket.on('rejoin-room', ({ roomCode, oldSocketId }) => {
    const room = rooms[roomCode];
    if (!room) { socket.emit('error', 'Sala expirada'); return; }
    const player = room.players.find(p => p.id === oldSocketId);
    if (!player) { socket.emit('error', 'Jogador não encontrado'); return; }
    // atualiza id
    room.wins[socket.id]     = room.wins[oldSocketId] || 0;
    room.progress[socket.id] = room.progress[oldSocketId] || 0;
    delete room.wins[oldSocketId];
    delete room.progress[oldSocketId];
    player.id = socket.id;
    socket.join(roomCode);
    const isCreator = room.players.indexOf(player) === 0;
    socket.emit('game-ready', { ...roomPublic(room), roomCode, isCreator });
    console.log(`Reconectou: ${socket.id} (era ${oldSocketId}) na sala ${roomCode}`);
  });

  /* ── Jogada ───────────────────────────────────────────────── */
  socket.on('make-move', ({ roomCode, row, col, value }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const idx = row * 9 + col;
    const correct = parseInt(room.solution[idx]);
    const isValid = value === 0 || value === correct;
    if (isValid) room.board[idx] = value;

    // progresso: conta células corretas deste jogador (baseado no board compartilhado)
    const filled = room.board.filter((v, i) => v === parseInt(room.solution[i])).length;
    room.progress[socket.id] = filled;

    // propaga para adversário
    socket.to(roomCode).emit('move-made', { row, col, value, isValid });
    // atualiza progresso para todos
    io.to(roomCode).emit('progress-update', { progress: room.progress });

    // vitória automática (todo board correto)
    const won = room.board.every((v, i) => v === parseInt(room.solution[i]));
    if (won) {
      const winner = room.players.find(p => p.id === socket.id);
      room.wins[socket.id] = (room.wins[socket.id] || 0) + 1;
      io.to(roomCode).emit('game-won', {
        winnerId: socket.id,
        winnerNickname: winner?.nickname,
        wins: room.wins,
      });
    }
  });

  /* ── Conclusão manual ─────────────────────────────────────── */
  socket.on('finish-game', ({ roomCode, time }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    room.wins[socket.id] = (room.wins[socket.id] || 0) + 1;
    io.to(roomCode).emit('player-finished', {
      playerId: socket.id,
      nickname: player.nickname,
      time,
      wins: room.wins,
    });
  });

  /* ── Dica ─────────────────────────────────────────────────── */
  socket.on('request-hint', ({ roomCode, row, col }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const value = parseInt(room.solution[row * 9 + col]);
    socket.emit('hint-response', { row, col, value });
  });

  /* ── Chat / reações ───────────────────────────────────────── */
  socket.on('chat-message', ({ roomCode, text }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const MAX_LEN = 120;
    const msg = { nickname: player.nickname, text: text.slice(0, MAX_LEN), ts: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > 50) room.chat.shift();
    io.to(roomCode).emit('chat-message', msg);
  });

  /* ── Reiniciar sala ───────────────────────────────────────── */
  socket.on('restart-room', ({ roomCode, difficulty: newDiff }) => {
    const room = rooms[roomCode];
    if (!room) return;
    // só o criador pode reiniciar
    if (room.players[0]?.id !== socket.id) return;
    const pd = generatePuzzle(newDiff || room.difficulty);
    room.puzzle     = pd.puzzle;
    room.solution   = pd.solution;
    room.difficulty = newDiff || room.difficulty;
    room.board      = pd.puzzle.split('').map(c => c === '-' ? 0 : parseInt(c));
    room.progress   = Object.fromEntries(room.players.map(p => [p.id, 0]));
    io.to(roomCode).emit('game-ready', { ...roomPublic(room), roomCode, isCreator: false });
    io.to(room.players[0].id).emit('game-ready', { ...roomPublic(room), roomCode, isCreator: true });
  });

  /* ── Desconexão ───────────────────────────────────────────── */
  socket.on('disconnect', () => {
    console.log('- Desconectou:', socket.id);
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) { delete rooms[roomCode]; }
        else { socket.to(roomCode).emit('player-left'); }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => {
  res.send('Sudoku Server is running');
});
app.get('/', (req, res) => res.send('Sudoku Server is running'));
server.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
