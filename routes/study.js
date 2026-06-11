const express = require('express');
const db = require('../db');
const { sm2 } = require('../sm2');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

// How many never-studied cards a user is introduced to per day, across ALL
// decks combined. Keeps new accounts from being greeted by hundreds of
// "due" cards on day one.
function newCardsIntroducedToday(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS c FROM user_cards uc
    WHERE uc.user_id = ? AND date(uc.first_seen) = date('now')
  `).get(userId).c;
}

function getUserSettings(userId) {
  return db.prepare('SELECT new_cards_per_day, active_level FROM users WHERE id = ?').get(userId);
}

// List decks with total card count, and how many are due now for this user
// (existing reviews due, plus a share of the global capped new-card allowance
// for decks at the user's active level).
router.get('/decks', (req, res) => {
  const settings = getUserSettings(req.user.id);
  const decks = db.prepare(`
    SELECT d.id, d.name, d.description, d.level,
      (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS total_cards,
      (SELECT COUNT(*) FROM cards c
         JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
         WHERE c.deck_id = d.id AND uc.due_date <= datetime('now')) AS due_review,
      (SELECT COUNT(*) FROM cards c
         LEFT JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
         WHERE c.deck_id = d.id AND uc.id IS NULL) AS new_total,
      (SELECT COUNT(*) FROM cards c
         JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
         WHERE c.deck_id = d.id) AS started_cards
    FROM decks d
    ORDER BY CASE d.level WHEN 'Beginner' THEN 0 WHEN 'Intermediate' THEN 1 ELSE 2 END, d.id
  `).all(req.user.id, req.user.id, req.user.id);

  let newAllowed = Math.max(0, settings.new_cards_per_day - newCardsIntroducedToday(req.user.id));

  for (const deck of decks) {
    const started = deck.new_total < deck.total_cards;
    let newAvailable = 0;
    if (started && deck.level === settings.active_level) {
      newAvailable = Math.min(deck.new_total, newAllowed);
      newAllowed -= newAvailable;
    }
    deck.due_cards = deck.due_review + newAvailable;
    deck.in_progress = deck.started_cards > 0 && deck.started_cards < deck.total_cards;
    delete deck.due_review;
    delete deck.new_total;
    delete deck.started_cards;
  }

  res.json({ decks });
});

// Get a batch of cards due for review (optionally filtered by deck).
// Mixes due reviews with a small, globally-capped number of new cards
// drawn only from decks at the user's active level.
router.get('/queue', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const deckId = req.query.deck_id ? parseInt(req.query.deck_id) : null;
  const deckFilter = deckId ? 'AND c.deck_id = ?' : '';
  const settings = getUserSettings(req.user.id);

  const reviewSql = `
    SELECT c.id, c.welsh, c.english, c.notes, c.example_welsh, c.example_english, c.deck_id,
      uc.ease, uc.interval_days, uc.repetitions, uc.due_date
    FROM cards c
    JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
    WHERE uc.due_date <= datetime('now') ${deckFilter}
    ORDER BY uc.due_date ASC LIMIT ?
  `;
  const reviewParams = deckId ? [req.user.id, deckId, limit] : [req.user.id, limit];
  const reviewCards = db.prepare(reviewSql).all(...reviewParams);

  const remaining = limit - reviewCards.length;
  const newAllowed = Math.max(0, settings.new_cards_per_day - newCardsIntroducedToday(req.user.id));
  const newLimit = Math.min(remaining, newAllowed);

  let newCards = [];
  // Only introduce new cards from decks matching the user's active level.
  // If a specific deck was requested but it's not at the active level, no
  // new cards are introduced for it (review cards still apply above).
  // For the "all decks" queue, only introduce new cards from decks the user
  // has already started (at least one user_card exists), at their active
  // level — so a brand-new account doesn't see new cards from every topic.
  const levelFilter = deckId ? '' : `AND d.level = ? AND EXISTS (
    SELECT 1 FROM user_cards uc2 JOIN cards c2 ON c2.id = uc2.card_id
    WHERE uc2.user_id = ? AND c2.deck_id = d.id
  )`;
  if (newLimit > 0) {
    const newSql = `
      SELECT c.id, c.welsh, c.english, c.notes, c.example_welsh, c.example_english, c.deck_id,
        NULL AS ease, NULL AS interval_days, NULL AS repetitions, NULL AS due_date
      FROM cards c
      JOIN decks d ON d.id = c.deck_id
      LEFT JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
      WHERE uc.id IS NULL ${deckFilter} ${levelFilter}
      ORDER BY c.id ASC LIMIT ?
    `;
    let newParams;
    if (deckId) {
      const deck = db.prepare('SELECT level FROM decks WHERE id = ?').get(deckId);
      newParams = (deck && deck.level === settings.active_level)
        ? [req.user.id, deckId, newLimit]
        : null;
    } else {
      newParams = [req.user.id, settings.active_level, req.user.id, newLimit];
    }
    if (newParams) newCards = db.prepare(newSql).all(...newParams);
  }

  res.json({ cards: [...reviewCards, ...newCards] });
});

// Update the user's study pacing settings.
router.put('/settings', (req, res) => {
  const { new_cards_per_day, active_level } = req.body || {};
  const updates = [];
  const params = [];

  if (new_cards_per_day != null) {
    const n = parseInt(new_cards_per_day);
    if (!Number.isInteger(n) || n < 0 || n > 200) {
      return res.status(400).json({ error: 'new_cards_per_day must be an integer between 0 and 200' });
    }
    updates.push('new_cards_per_day = ?');
    params.push(n);
  }

  if (active_level != null) {
    if (!VALID_LEVELS.includes(active_level)) {
      return res.status(400).json({ error: 'active_level must be one of ' + VALID_LEVELS.join(', ') });
    }
    updates.push('active_level = ?');
    params.push(active_level);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  params.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const user = db.prepare('SELECT id, username, email, is_admin, current_streak, longest_streak, last_study_date, new_cards_per_day, active_level FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, user });
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
    INSERT INTO user_cards (user_id, card_id, ease, interval_days, repetitions, due_date, last_reviewed, first_seen)
    VALUES (?, ?, ?, ?, ?, ${dueDate}, datetime('now'), datetime('now'))
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

// Daily review history for charts (last 14 days), plus a quality breakdown.
router.get('/history', (req, res) => {
  const reviews = db.prepare(`
    SELECT date(reviewed_at) AS day, COUNT(*) AS count
    FROM review_log
    WHERE user_id = ? AND reviewed_at >= datetime('now', '-13 days')
    GROUP BY day
  `).all(req.user.id);

  const newCards = db.prepare(`
    SELECT date(first_seen) AS day, COUNT(*) AS count
    FROM user_cards
    WHERE user_id = ? AND first_seen >= datetime('now', '-13 days')
    GROUP BY day
  `).all(req.user.id);

  const reviewMap = Object.fromEntries(reviews.map(r => [r.day, r.count]));
  const newMap = Object.fromEntries(newCards.map(r => [r.day, r.count]));

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ day: key, reviews: reviewMap[key] || 0, new_cards: newMap[key] || 0 });
  }

  const quality = db.prepare(`
    SELECT quality, COUNT(*) AS count FROM review_log WHERE user_id = ? GROUP BY quality
  `).all(req.user.id);

  res.json({ days, quality });
});

module.exports = router;
