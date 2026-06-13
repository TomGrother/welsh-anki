const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// Temporary debug endpoint to verify which migrations have run on this deployment.
router.get('/debug-migrations', (req, res) => {
  const migrations = db.prepare('SELECT * FROM migrations').all();
  const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => ({ name: c.name, dflt: c.dflt_value }));
  res.json({ migrations, userCols, version: 'e949f8b' });
});

// --- Decks ---
router.get('/decks', (req, res) => {
  const decks = db.prepare(`
    SELECT d.*, (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS card_count
    FROM decks d ORDER BY d.id
  `).all();
  res.json({ decks });
});

const VALID_LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Fluent'];

router.post('/decks', (req, res) => {
  const { name, description, level } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Deck name is required' });
  const lvl = VALID_LEVELS.includes(level) ? level : 'Beginner';
  try {
    const result = db.prepare('INSERT INTO decks (name, description, level) VALUES (?, ?, ?)').run(name, description || '', lvl);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'A deck with that name already exists' });
  }
});

router.put('/decks/:id', (req, res) => {
  const { name, description, level } = req.body || {};
  if (level && !VALID_LEVELS.includes(level)) {
    return res.status(400).json({ error: 'level must be Beginner, Intermediate, Advanced or Fluent' });
  }
  db.prepare('UPDATE decks SET name = COALESCE(?, name), description = COALESCE(?, description), level = COALESCE(?, level) WHERE id = ?')
    .run(name, description, level, req.params.id);
  res.json({ ok: true });
});

router.delete('/decks/:id', (req, res) => {
  db.prepare('DELETE FROM decks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Cards ---
router.get('/cards', (req, res) => {
  const deckId = req.query.deck_id;
  const cards = deckId
    ? db.prepare('SELECT * FROM cards WHERE deck_id = ? ORDER BY id DESC').all(deckId)
    : db.prepare('SELECT * FROM cards ORDER BY id DESC LIMIT 500').all();
  res.json({ cards });
});

router.post('/cards', (req, res) => {
  const { deck_id, welsh, english, notes, example_welsh, example_english } = req.body || {};
  if (!deck_id || !welsh || !english) {
    return res.status(400).json({ error: 'deck_id, welsh and english are required' });
  }
  const result = db.prepare(`
    INSERT INTO cards (deck_id, welsh, english, notes, example_welsh, example_english)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(deck_id, welsh, english, notes || null, example_welsh || null, example_english || null);
  res.json({ id: result.lastInsertRowid });
});

router.put('/cards/:id', (req, res) => {
  const { deck_id, welsh, english, notes, example_welsh, example_english } = req.body || {};
  db.prepare(`
    UPDATE cards SET
      deck_id = COALESCE(?, deck_id),
      welsh = COALESCE(?, welsh),
      english = COALESCE(?, english),
      notes = ?,
      example_welsh = ?,
      example_english = ?
    WHERE id = ?
  `).run(deck_id, welsh, english, notes || null, example_welsh || null, example_english || null, req.params.id);
  res.json({ ok: true });
});

router.delete('/cards/:id', (req, res) => {
  db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Bulk import: accepts { deck_id, cards: [{welsh, english, notes?, example_welsh?, example_english?}, ...] }
router.post('/import', (req, res) => {
  const { deck_id, cards } = req.body || {};
  if (!deck_id || !Array.isArray(cards)) {
    return res.status(400).json({ error: 'deck_id and a cards array are required' });
  }
  const insert = db.prepare(`
    INSERT INTO cards (deck_id, welsh, english, notes, example_welsh, example_english)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  let count = 0;
  const run = db.transaction((rows) => {
    for (const row of rows) {
      if (!row.welsh || !row.english) continue;
      insert.run(deck_id, row.welsh, row.english, row.notes || null, row.example_welsh || null, row.example_english || null);
      count++;
    }
  });
  run(cards);
  res.json({ imported: count });
});

// --- Users (read-only overview) ---
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT id, username, email, is_admin, current_streak, longest_streak, last_study_date, created_at
    FROM users ORDER BY id
  `).all();
  res.json({ users });
});

router.delete('/users/:id', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (userId === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const run = db.transaction(() => {
    db.prepare('DELETE FROM user_cards WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM review_log WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_achievements WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM friendships WHERE user_id = ? OR friend_id = ?').run(userId, userId);
    const ownDecks = db.prepare('SELECT id FROM decks WHERE owner_id = ?').all(userId);
    for (const d of ownDecks) {
      db.prepare('DELETE FROM cards WHERE deck_id = ?').run(d.id);
    }
    db.prepare('DELETE FROM decks WHERE owner_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  run();

  res.json({ ok: true });
});

// Diagnostic: per-deck progress for a given user, including which cards
// (if any) in a deck have never been introduced to that user.
router.get('/users/:id/deck-progress', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const decks = db.prepare(`
    SELECT d.id, d.name, d.level,
      (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS total_cards,
      (SELECT COUNT(*) FROM cards c JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ? WHERE c.deck_id = d.id) AS started_cards
    FROM decks d
    WHERE d.owner_id IS NULL
    ORDER BY CASE d.level WHEN 'Beginner' THEN 0 WHEN 'Intermediate' THEN 1 WHEN 'Advanced' THEN 2 WHEN 'Fluent' THEN 3 ELSE 4 END, d.id
  `).all(userId);

  const deckId = req.query.deck_id ? parseInt(req.query.deck_id, 10) : null;
  let missingCards = null;
  if (deckId) {
    missingCards = db.prepare(`
      SELECT c.id, c.welsh, c.english FROM cards c
      LEFT JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
      WHERE c.deck_id = ? AND uc.id IS NULL
    `).all(userId, deckId);
  }

  res.json({ decks, missingCards });
});

module.exports = router;
