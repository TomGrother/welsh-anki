const express = require('express');
const db = require('../db');
const { sm2 } = require('../sm2');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// List decks with total card count, and how many are due now for this user.
router.get('/decks', (req, res) => {
  const decks = db.prepare(`
    SELECT d.id, d.name, d.description,
      (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS total_cards,
      (SELECT COUNT(*) FROM cards c
         LEFT JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
         WHERE c.deck_id = d.id AND (uc.due_date IS NULL OR uc.due_date <= datetime('now'))) AS due_cards
    FROM decks d ORDER BY d.id
  `).all(req.user.id);
  res.json({ decks });
});

// Get a batch of cards due for review (optionally filtered by deck).
router.get('/queue', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const deckId = req.query.deck_id ? parseInt(req.query.deck_id) : null;

  let sql = `
    SELECT c.id, c.welsh, c.english, c.notes, c.example_welsh, c.example_english, c.deck_id,
      uc.ease, uc.interval_days, uc.repetitions, uc.due_date
    FROM cards c
    LEFT JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
    WHERE (uc.due_date IS NULL OR uc.due_date <= datetime('now'))
  `;
  const params = [req.user.id];
  if (deckId) {
    sql += ' AND c.deck_id = ?';
    params.push(deckId);
  }
  sql += ' ORDER BY (uc.due_date IS NULL) DESC, uc.due_date ASC LIMIT ?';
  params.push(limit);

  const cards = db.prepare(sql).all(...params);
  res.json({ cards });
});

// Submit a review for a card. quality: 0 (Again), 3 (Hard), 4 (Good), 5 (Easy)
router.post('/review', (req, res) => {
  const { card_id, quality } = req.body || {};
  if (card_id == null || quality == null || quality < 0 || quality > 5) {
    return res.status(400).json({ error: 'card_id and quality (0-5) are required' });
  }

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(card_id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  let userCard = db.prepare('SELECT * FROM user_cards WHERE user_id = ? AND card_id = ?').get(req.user.id, card_id);
  if (!userCard) {
    userCard = { ease: 2.5, interval_days: 0, repetitions: 0 };
  }

  const updated = sm2(userCard, quality);
  const dueDate = `datetime('now', '+${updated.interval_days} days')`;

  db.prepare(`
    INSERT INTO user_cards (user_id, card_id, ease, interval_days, repetitions, due_date, last_reviewed)
    VALUES (?, ?, ?, ?, ?, ${dueDate}, datetime('now'))
    ON CONFLICT(user_id, card_id) DO UPDATE SET
      ease = excluded.ease,
      interval_days = excluded.interval_days,
      repetitions = excluded.repetitions,
      due_date = excluded.due_date,
      last_reviewed = excluded.last_reviewed
  `).run(req.user.id, card_id, updated.ease, updated.interval_days, updated.repetitions);

  db.prepare('INSERT INTO review_log (user_id, card_id, quality) VALUES (?, ?, ?)').run(req.user.id, card_id, quality);

  updateStreak(req.user.id);

  res.json({ ok: true, ...updated });
});

function updateStreak(userId) {
  const user = db.prepare('SELECT current_streak, longest_streak, last_study_date FROM users WHERE id = ?').get(userId);
  const today = new Date().toISOString().slice(0, 10);

  if (user.last_study_date === today) return; // already counted today

  let newStreak;
  if (!user.last_study_date) {
    newStreak = 1;
  } else {
    const last = new Date(user.last_study_date + 'T00:00:00Z');
    const diffDays = Math.round((new Date(today + 'T00:00:00Z') - last) / 86400000);
    newStreak = diffDays === 1 ? user.current_streak + 1 : 1;
  }

  const longest = Math.max(newStreak, user.longest_streak);
  db.prepare('UPDATE users SET current_streak = ?, longest_streak = ?, last_study_date = ? WHERE id = ?')
    .run(newStreak, longest, today, userId);
}

// Overall progress stats for the dashboard.
router.get('/stats', (req, res) => {
  const user = db.prepare('SELECT current_streak, longest_streak, last_study_date FROM users WHERE id = ?').get(req.user.id);
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM cards) AS total_cards,
      (SELECT COUNT(*) FROM user_cards WHERE user_id = ?) AS started_cards,
      (SELECT COUNT(*) FROM user_cards WHERE user_id = ? AND repetitions >= 2) AS learned_cards,
      (SELECT COUNT(*) FROM user_cards WHERE user_id = ? AND due_date <= datetime('now')) AS due_now,
      (SELECT COUNT(*) FROM review_log WHERE user_id = ?) AS total_reviews
  `).get(req.user.id, req.user.id, req.user.id, req.user.id);

  res.json({ ...user, ...totals });
});

module.exports = router;
