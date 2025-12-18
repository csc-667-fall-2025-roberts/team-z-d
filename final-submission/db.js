const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ lastId: 0, users: [] }, null, 2));
  }
}

function read() {
  ensure();
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function write(data) {
  ensure();
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function normUser(username) {
  return String(username || "").trim();
}

async function createUser({ username, email, password }) {
  username = normUser(username);
  email = normEmail(email);
  password = String(password || "");

  if (!username || !email || !password) throw new Error("All fields are required.");

  const data = read();
  const exists = data.users.some(
    (u) => u.email === email || u.username.toLowerCase() === username.toLowerCase()
  );
  if (exists) throw new Error("Username or email already exists.");

  const passwordHash = await bcrypt.hash(password, 10);
  const id = ++data.lastId;

  const user = { id, username, email, passwordHash, createdAt: new Date().toISOString() };
  data.users.push(user);
  write(data);

  return { id, username, email, createdAt: user.createdAt };
}

function getUserById(id) {
  const data = read();
  const u = data.users.find((x) => x.id === Number(id));
  if (!u) return null;
  return { id: u.id, username: u.username, email: u.email, createdAt: u.createdAt };
}

async function verifyUser({ login, password }) {
  login = String(login || "").trim();
  password = String(password || "");
  if (!login || !password) return null;

  const data = read();
  const u =
    data.users.find((x) => x.email === login.toLowerCase()) ||
    data.users.find((x) => x.username.toLowerCase() === login.toLowerCase());
  if (!u) return null;

  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return null;

  return { id: u.id, username: u.username, email: u.email, createdAt: u.createdAt };
}

module.exports = { createUser, verifyUser, getUserById };
