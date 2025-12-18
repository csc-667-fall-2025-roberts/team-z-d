const path = require("path");
const http = require("http");
const crypto = require("crypto");

const express = require("express");
const session = require("express-session");
const { Server } = require("socket.io");

const db = require("./db");

const PORT = Number(process.env.PORT || 3000);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// -------------------- Express --------------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: false }));
app.use("/public", express.static(path.join(__dirname, "public")));

const sessionMiddleware = session({
  name: "wg.sid",
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 }
});
app.use(sessionMiddleware);

// expose user to views
app.use((req, res, next) => {
  const userId = req.session?.userId;
  res.locals.user = userId ? db.getUserById(userId) : null;
  next();
});

function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  return res.redirect("/login");
}
function redirectIfAuthed(req, res, next) {
  if (req.session?.userId) return res.redirect("/lobby");
  return next();
}

// -------------------- Game State (in-memory) --------------------
const games = new Map(); // id -> game
const WORDS = ["APPLE", "BANANA", "ORANGE", "MANGO", "PEACH", "SOCKET", "SESSION", "EXPRESS", "JAVASCRIPT", "COMPUTER"];

function sanitizeName(v) { return String(v || "").trim().slice(0, 40); }
function sanitizeWord(v) {
  const raw = String(v || "").trim().toUpperCase();
  return raw.replace(/[^A-Z]/g, "").slice(0, 24);
}
function sanitizeChat(v) {
  const raw = String(v || "").trim();
  return raw.replace(/[<>]/g, "").slice(0, 240);
}
function pickRandomWord() { return WORDS[Math.floor(Math.random() * WORDS.length)]; }

function maskWord(word, guessed) {
  return word.split("").map(c => (guessed.has(c) ? c : "_")).join(" ");
}
function isSolved(word, guessed) {
  for (const c of word) if (!guessed.has(c)) return false;
  return true;
}

function listGamesForLobby() {
  return Array.from(games.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(g => ({
      id: g.id,
      name: g.name,
      state: g.state,
      players: g.players.length,
      maxPlayers: g.maxPlayers,
      hostUsername: g.hostUsername
    }));
}

function createGame({ host, name, maxPlayers, secretWord }) {
  const id = crypto.randomUUID();
  const word = sanitizeWord(secretWord) || pickRandomWord();

  const game = {
    id,
    name: sanitizeName(name) || `Game ${id.slice(0, 4)}`,
    hostId: host.id,
    hostUsername: host.username,
    maxPlayers: Math.min(Math.max(Number(maxPlayers) || 4, 2), 8),

    state: "active",
    createdAt: Date.now(),

    word,
    guessedLetters: new Set(),
    remaining: 6,

    players: [],     // {id, username}
    turnIndex: 0,

    chat: [],        // {ts, username, text}
    winnerId: null
  };

  games.set(id, game);
  return game;
}

function addPlayer(game, user) {
  if (game.state === "ended") return { ok: false, reason: "Game already ended." };
  if (game.players.some(p => p.id === user.id)) return { ok: true };
  if (game.players.length >= game.maxPlayers) return { ok: false, reason: "Game is full." };

  game.players.push({ id: user.id, username: user.username });
  if (game.players.length === 1) game.turnIndex = 0;
  return { ok: true };
}

function removePlayer(game, userId) {
  const before = game.players.length;
  game.players = game.players.filter(p => p.id !== userId);

  // if everyone leaves, delete the game to keep lobby clean
  if (game.players.length === 0 && before > 0) {
    games.delete(game.id);
    return;
  }
  if (game.turnIndex >= game.players.length) game.turnIndex = 0;
}

function advanceTurn(game) {
  if (game.players.length === 0) return;
  game.turnIndex = (game.turnIndex + 1) % game.players.length;
}

function endGame(game, winnerId) {
  game.state = "ended";
  game.winnerId = winnerId || null;
}

function toClientState(game) {
  const currentTurn = game.players[game.turnIndex] || null;
  return {
    id: game.id,
    name: game.name,
    state: game.state,
    hostUsername: game.hostUsername,
    players: game.players,
    maxPlayers: game.maxPlayers,
    remaining: game.remaining,
    guessed: Array.from(game.guessedLetters).sort().join(", "),
    masked: maskWord(game.word, game.guessedLetters),
    currentTurn,
    winnerId: game.winnerId
  };
}

function pushChat(arr, msg, max = 50) {
  arr.push(msg);
  while (arr.length > max) arr.shift();
}

function handleGuess(game, user, guessRaw) {
  if (game.state !== "active") return { ok: false, reason: "Game is not active." };

  const currentTurn = game.players[game.turnIndex];
  if (!currentTurn || currentTurn.id !== user.id) return { ok: false, reason: "Not your turn." };

  const guess = sanitizeWord(guessRaw);
  if (!guess) return { ok: false, reason: "Enter a letter (A-Z) or a full word." };

  // full-word guess
  if (guess.length > 1) {
    if (guess === game.word) {
      for (const c of game.word) game.guessedLetters.add(c);
      endGame(game, user.id);
      return { ok: true, message: `${user.username} guessed the word and wins!` };
    }
    game.remaining -= 1;
    if (game.remaining <= 0) {
      endGame(game, null);
      return { ok: true, message: `${user.username} guessed wrong. Game over.` };
    }
    advanceTurn(game);
    return { ok: true, message: `${user.username} guessed wrong.` };
  }

  const letter = guess[0];
  if (game.guessedLetters.has(letter)) return { ok: false, reason: "That letter was already guessed." };

  game.guessedLetters.add(letter);
  if (!game.word.includes(letter)) game.remaining -= 1;

  if (isSolved(game.word, game.guessedLetters)) {
    endGame(game, user.id);
    return { ok: true, message: `${user.username} completed the word and wins!` };
  }
  if (game.remaining <= 0) {
    endGame(game, null);
    return { ok: true, message: "No attempts left. Game over." };
  }

  advanceTurn(game);
  return { ok: true, message: `${user.username} guessed "${letter}".` };
}

// -------------------- Routes --------------------
app.get("/", (req, res) => (req.session?.userId ? res.redirect("/lobby") : res.redirect("/login")));

app.get("/signup", redirectIfAuthed, (req, res) => res.render("signup", { error: null }));
app.post("/signup", redirectIfAuthed, async (req, res) => {
  try {
    const user = await db.createUser(req.body);
    req.session.userId = user.id;
    res.redirect("/lobby");
  } catch (e) {
    res.status(400).render("signup", { error: e.message || "Sign up failed." });
  }
});

app.get("/login", redirectIfAuthed, (req, res) => res.render("login", { error: null }));
app.post("/login", redirectIfAuthed, async (req, res) => {
  const user = await db.verifyUser({ login: req.body.login, password: req.body.password });
  if (!user) return res.status(401).render("login", { error: "Invalid credentials." });
  req.session.userId = user.id;
  res.redirect("/lobby");
});

app.post("/auth/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("wg.sid");
    res.redirect("/login");
  });
});

app.get("/lobby", requireAuth, (req, res) => {
  res.render("lobby", { games: listGamesForLobby() });
});

app.post("/games", requireAuth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  if (!user) return res.redirect("/login");

  const game = createGame({
    host: user,
    name: req.body.name,
    maxPlayers: req.body.maxPlayers,
    secretWord: req.body.secretWord
  });

  addPlayer(game, user);

  // real-time lobby updates
  io.to("lobby").emit("lobby:games", listGamesForLobby());

  res.redirect(`/game/${game.id}`);
});

app.get("/game/:id", requireAuth, (req, res) => {
  const game = games.get(req.params.id);
  if (!game) return res.status(404).render("error", { message: "Game not found." });
  res.render("game", { gameId: game.id, gameName: game.name });
});

app.use((req, res) => res.status(404).render("error", { message: "Page not found." }));

// -------------------- Socket.IO (sessions + rooms) --------------------
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const sess = socket.request.session;
  if (sess?.userId) return next();
  next(new Error("unauthorized"));
});

const lobbyChat = [];

io.on("connection", (socket) => {
  const userId = socket.request.session.userId;
  const user = db.getUserById(userId);
  if (!user) return socket.disconnect(true);

  // Lobby context
  socket.on("context:lobby", () => {
    socket.join("lobby");
    socket.emit("lobby:games", listGamesForLobby());
    socket.emit("lobby:chatHistory", lobbyChat);
  });

  // Lobby chat (global) — should only go to lobby room
  socket.on("lobby:chat", ({ text }) => {
    if (!socket.rooms.has("lobby")) return;
    const safe = sanitizeChat(text);
    if (!safe) return;

    const msg = { ts: Date.now(), username: user.username, text: safe };
    pushChat(lobbyChat, msg, 50);
    io.to("lobby").emit("lobby:chat", msg);
  });

  // Join game room
  socket.on("game:join", ({ gameId }) => {
    socket.leave("lobby"); // ensures lobby chat doesn't leak into game page

    const game = games.get(String(gameId));
    if (!game) return socket.emit("app:error", { message: "Game not found." });

    const add = addPlayer(game, user);
    if (!add.ok) return socket.emit("app:error", { message: add.reason });

    socket.data.gameId = game.id;
    socket.join(`game:${game.id}`);

    socket.emit("game:chatHistory", game.chat);
    io.to(`game:${game.id}`).emit("game:state", toClientState(game));

    // update lobby list for other clients
    io.to("lobby").emit("lobby:games", listGamesForLobby());
  });

  // Guess handling (unidirectional flow: client -> server -> broadcast new state)
  socket.on("game:guess", ({ gameId, guess }) => {
    const game = games.get(String(gameId));
    if (!game) return socket.emit("app:error", { message: "Game not found." });

    const inGame = game.players.some((p) => p.id === user.id);
    if (!inGame) return socket.emit("app:error", { message: "Join the game first." });

    const result = handleGuess(game, user, guess);
    if (!result.ok) return socket.emit("app:error", { message: result.reason });

    if (result.message) {
      const sys = { ts: Date.now(), username: "System", text: result.message };
      pushChat(game.chat, sys, 50);
      io.to(`game:${game.id}`).emit("game:chat", sys);
    }

    io.to(`game:${game.id}`).emit("game:state", toClientState(game));
    io.to("lobby").emit("lobby:games", listGamesForLobby());
  });

  // Game chat (room-scoped)
  socket.on("game:chat", ({ gameId, text }) => {
    const game = games.get(String(gameId));
    if (!game) return socket.emit("app:error", { message: "Game not found." });

    const inGame = game.players.some((p) => p.id === user.id);
    if (!inGame) return socket.emit("app:error", { message: "Join the game first." });

    const safe = sanitizeChat(text);
    if (!safe) return;

    const msg = { ts: Date.now(), username: user.username, text: safe };
    pushChat(game.chat, msg, 50);
    io.to(`game:${game.id}`).emit("game:chat", msg);
  });

  // Cleanup
  socket.on("disconnect", () => {
    const gameId = socket.data.gameId;
    if (!gameId) return;

    const game = games.get(String(gameId));
    if (!game) return;

    removePlayer(game, user.id);

    if (games.has(String(gameId))) {
      io.to(`game:${gameId}`).emit("game:state", toClientState(game));
    }
    io.to("lobby").emit("lobby:games", listGamesForLobby());
  });
});

server.listen(PORT, () => {
  console.log(`Running: http://localhost:${PORT}`);
});
