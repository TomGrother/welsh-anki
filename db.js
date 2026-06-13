const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Use a persistent volume if mounted (e.g. Railway volume at /app/data),
// otherwise fall back to a local file for development.
const dataDir = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'welsh.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_study_date TEXT,
  new_cards_per_day INTEGER NOT NULL DEFAULT 10,
  active_level TEXT NOT NULL DEFAULT 'Beginner',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  level TEXT NOT NULL DEFAULT 'Beginner',
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  welsh TEXT NOT NULL,
  english TEXT NOT NULL,
  notes TEXT,
  example_welsh TEXT,
  example_english TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-user SRS progress on each card (SM-2 algorithm)
CREATE TABLE IF NOT EXISTS user_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL DEFAULT (datetime('now')),
  last_reviewed TEXT,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, card_id)
);

CREATE TABLE IF NOT EXISTS review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  quality INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_cards_due ON user_cards(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);

CREATE TABLE IF NOT EXISTS user_achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, code)
);

CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migration: add 'level' column to decks if upgrading from an older schema
const deckColumns = db.prepare("PRAGMA table_info(decks)").all().map(c => c.name);
if (!deckColumns.includes('level')) {
  db.exec("ALTER TABLE decks ADD COLUMN level TEXT NOT NULL DEFAULT 'Beginner'");
}
if (!deckColumns.includes('owner_id')) {
  db.exec("ALTER TABLE decks ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
}

// Migration: add 'first_seen' column to user_cards if upgrading from an older schema
const userCardColumns = db.prepare("PRAGMA table_info(user_cards)").all().map(c => c.name);
if (!userCardColumns.includes('first_seen')) {
  db.exec("ALTER TABLE user_cards ADD COLUMN first_seen TEXT NOT NULL DEFAULT '1970-01-01'");
}

// Migration: add 'new_cards_per_day' and 'active_level' columns to users if upgrading
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns.includes('new_cards_per_day')) {
  db.exec("ALTER TABLE users ADD COLUMN new_cards_per_day INTEGER NOT NULL DEFAULT 10");
}
if (!userColumns.includes('active_level')) {
  db.exec("ALTER TABLE users ADD COLUMN active_level TEXT NOT NULL DEFAULT 'Beginner'");
}

// Migration: add 'email_verified' column to users if upgrading. Existing
// users are grandfathered in as verified; new registrations default to 0
// and must confirm via the link emailed to them.
if (!userColumns.includes('email_verified')) {
  db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE users SET email_verified = 1");
}

// Migration: add 'email_reminders' opt-in and 'last_reminder_sent' tracking columns.
// Opt-in: off by default, users must explicitly enable in settings.
if (!userColumns.includes('email_reminders')) {
  db.exec("ALTER TABLE users ADD COLUMN email_reminders INTEGER NOT NULL DEFAULT 0");
} else {
  // Was previously on by default for everyone - switch existing users back to opt-in.
  const reminderDefault = db.prepare("SELECT dflt_value FROM pragma_table_info('users') WHERE name = 'email_reminders'").get();
  if (reminderDefault && reminderDefault.dflt_value === '1') {
    db.exec("ALTER TABLE users RENAME COLUMN email_reminders TO email_reminders_old");
    db.exec("ALTER TABLE users ADD COLUMN email_reminders INTEGER NOT NULL DEFAULT 0");
    db.exec("UPDATE users SET email_reminders = 0");
    db.exec("ALTER TABLE users DROP COLUMN email_reminders_old");
  }
}
if (!userColumns.includes('last_reminder_sent')) {
  db.exec("ALTER TABLE users ADD COLUMN last_reminder_sent TEXT");
}

// Hour of day (0-23, UTC) at which the daily reminder email should be sent.
if (!userColumns.includes('reminder_hour')) {
  db.exec("ALTER TABLE users ADD COLUMN reminder_hour INTEGER NOT NULL DEFAULT 17");
}

module.exports = db;
