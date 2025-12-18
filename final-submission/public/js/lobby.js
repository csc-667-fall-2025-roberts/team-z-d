const socket = io();

const gamesList = document.getElementById("gamesList");
const gamesCount = document.getElementById("gamesCount");

const lobbyChat = document.getElementById("lobbyChat");
const lobbyChatForm = document.getElementById("lobbyChatForm");
const lobbyChatText = document.getElementById("lobbyChatText");

const toast = document.getElementById("toast");

function showToast(msg) {
  toast.textContent = msg;
  toast.style.display = "block";
  setTimeout(() => (toast.style.display = "none"), 2500);
}

function renderGames(games) {
  gamesCount.textContent = String(games.length);
  gamesList.innerHTML = "";

  if (!games.length) {
    const empty = document.createElement("div");
    empty.className = "text-muted";
    empty.textContent = "No active games yet. Create one!";
    gamesList.appendChild(empty);
    return;
  }

  for (const g of games) {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div>
        <div class="item-title">${g.name}</div>
        <div class="text-muted">Host: ${g.hostUsername} · Players: ${g.players}/${g.maxPlayers} · State: ${g.state}</div>
      </div>
      <a class="btn btn--small" href="/game/${g.id}">Join</a>
    `;
    gamesList.appendChild(row);
  }
}

function appendChat(container, msg) {
  const line = document.createElement("div");
  const time = new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  line.className = "chat-line";
  line.innerHTML = `<span class="chat-time">${time}</span> <strong>${msg.username}:</strong> <span>${msg.text}</span>`;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

socket.on("connect", () => {
  socket.emit("context:lobby");
});

socket.on("lobby:games", renderGames);

socket.on("lobby:chatHistory", (history) => {
  lobbyChat.innerHTML = "";
  for (const msg of history) appendChat(lobbyChat, msg);
});

socket.on("lobby:chat", (msg) => appendChat(lobbyChat, msg));

socket.on("app:error", (e) => showToast(e?.message || "Error"));

lobbyChatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = (lobbyChatText.value || "").trim();
  if (!text) return;
  socket.emit("lobby:chat", { text });
  lobbyChatText.value = "";
});
