const socket = io();

const shell = document.querySelector(".app-shell");
const gameId = shell.dataset.gameId;

const statePill = document.getElementById("statePill");
const maskedWord = document.getElementById("maskedWord");
const guessedLetters = document.getElementById("guessedLetters");
const remaining = document.getElementById("remaining");
const currentTurn = document.getElementById("currentTurn");
const players = document.getElementById("players");

const guessForm = document.getElementById("guessForm");
const guessInput = document.getElementById("guessInput");

const gameChat = document.getElementById("gameChat");
const gameChatForm = document.getElementById("gameChatForm");
const gameChatText = document.getElementById("gameChatText");

const toast = document.getElementById("toast");

function showToast(msg) {
  toast.textContent = msg;
  toast.style.display = "block";
  setTimeout(() => (toast.style.display = "none"), 2500);
}

function appendChat(msg) {
  const line = document.createElement("div");
  const time = new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  line.className = "chat-line";
  line.innerHTML = `<span class="chat-time">${time}</span> <strong>${msg.username}:</strong> <span>${msg.text}</span>`;
  gameChat.appendChild(line);
  gameChat.scrollTop = gameChat.scrollHeight;
}

function renderState(s) {
  if (!s) return;

  statePill.textContent = s.state;
  maskedWord.textContent = s.masked || "_ _ _";
  guessedLetters.textContent = s.guessed || "—";
  remaining.textContent = String(s.remaining);

  currentTurn.textContent = s.currentTurn ? s.currentTurn.username : "—";
  players.textContent = (s.players || []).map((p) => p.username).join(", ") || "—";

  if (s.state === "ended") {
    if (s.winnerId) showToast("Game ended: winner declared.");
    else showToast("Game ended: no winner.");
  }
}

socket.on("connect", () => {
  socket.emit("game:join", { gameId });
});

socket.on("game:state", renderState);

socket.on("game:chatHistory", (history) => {
  gameChat.innerHTML = "";
  for (const msg of history) appendChat(msg);
});

socket.on("game:chat", appendChat);

socket.on("app:error", (e) => showToast(e?.message || "Error"));

guessForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const guess = (guessInput.value || "").trim();
  if (!guess) return;
  socket.emit("game:guess", { gameId, guess });
  guessInput.value = "";
});

gameChatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = (gameChatText.value || "").trim();
  if (!text) return;
  socket.emit("game:chat", { gameId, text });
  gameChatText.value = "";
});
