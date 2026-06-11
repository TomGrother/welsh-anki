# Dysgu Cymraeg — Welsh Flashcard Trainer

An Anki-style spaced repetition app focused entirely on learning Welsh.
Includes user accounts, daily streak tracking, SM-2 spaced repetition,
and an admin panel to manage the vocabulary database.

## Features
- Register/login with JWT auth (passwords hashed with bcrypt)
- SM-2 spaced repetition algorithm per user, per card
- Daily study streak + longest streak tracking
- Decks of vocabulary (greetings, numbers, colours, family, food, etc.) — 200+ starter cards
- Admin panel: add/edit/delete decks & cards, bulk JSON import, view registered users
- Welsh-themed UI (red/green/white)

## Local setup
```bash
npm install
npm run seed     # populates the database with starter Welsh vocabulary
npm start
```
Visit http://localhost:3000

The **first user to register automatically becomes an admin**. Use that
account to access the "Admin" panel and manage the vocabulary database.

## Configuration
Copy `.env.example` to `.env` and set:
- `PORT` — port to listen on (default 3000)
- `JWT_SECRET` — a long random string used to sign auth tokens (set this in production!)

## Deployment
This is a standard Node.js + SQLite app — deploy to any VPS, Render, Railway,
Fly.io, or similar:

1. Push the repo to your server (excluding `node_modules` and `welsh.db`).
2. `npm install --production`
3. Set environment variables (`PORT`, `JWT_SECRET`).
4. `npm run seed` (first deploy only, to populate vocabulary)
5. Run with a process manager: `pm2 start server.js --name welsh-anki` (or use a systemd service / Docker).
6. Put a reverse proxy (nginx/Caddy) in front for HTTPS.

The SQLite database file (`welsh.db`) persists all users, progress and
vocabulary — back it up regularly.

## Updating the vocabulary database
Log in as the admin user and go to the **Admin** tab:
- **Decks**: create new categories (e.g. "Weather", "Sport")
- **Cards**: add individual Welsh/English word pairs with optional notes and examples
- **Bulk Import**: paste a JSON array to add many cards to a deck at once, e.g.
```json
[
  { "welsh": "tywydd", "english": "weather" },
  { "welsh": "glaw", "english": "rain", "example_welsh": "Mae hi'n bwrw glaw", "example_english": "It's raining" }
]
```

## Tech stack
- Node.js, Express
- better-sqlite3 (file-based DB, zero config)
- JWT auth + bcrypt
- Vanilla HTML/CSS/JS frontend (no build step required)
