# Word Guesser – Milestone 4 (Auth + Sessions + Socket.IO)

## Requirements Covered
- Login/Logout/Signup
- Session persistence across refresh
- Real-time updates across multiple clients (Socket.IO)
- Lobby chat (global) isolated from game rooms
- Game room chat isolated per game
- Turn-based word guessing gameplay
- Win/end state

## Run
```bash
npm install
npm start
```

Then open:
- http://localhost:3000

## Demo Tips (rubric)
- Open two browser windows (or one normal + one incognito).
- Create accounts in both, log in, and verify chats/state sync live.
- Lobby chat should NOT appear in game room.
- Game chat should NOT appear in lobby or other games.
