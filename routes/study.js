const express = require('express');
const db = require('../db');
const { sm2 } = require('../sm2');
const { ACHIEVEMENTS } = require('../achievements');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// List decks with total card count and how many reviews are due now for
// each. New cards have no cap — users can work through a topic at their
// own pace and it'll reappear for review once cards become due.
router.get('/decks', (req, res) => {
  const decks = db.prepare(`
    SELECT d.id, d.name, d.description, d.level,
      (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS total_cards,
      (SELECT COUNT(*) FROM cards c
         JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
         WHERE c.deck_id = d.id AND uc.due_date <= datetime('now')) AS due_cards,
      (SELECT COUNT(*) FROM cards c
         JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
         WHERE c.deck_id = d.id) AS started_cards
    FROM decks d
    ORDER BY CASE d.level WHEN 'Beginner' THEN 0 WHEN 'Intermediate' THEN 1 WHEN 'Advanced' THEN 2 ELSE 3 END, d.id
  `).all(req.user.id, req.user.id);

  for (const deck of decks) {
    deck.in_progress = deck.started_cards > 0 && deck.started_cards < deck.total_cards;
    deck.completed = deck.started_cards >= deck.total_cards && deck.total_cards > 0;
    deck.progress_pct = deck.total_cards > 0 ? Math.round((deck.started_cards / deck.total_cards) * 100) : 0;
    delete deck.started_cards;
  }

  res.json({ decks });
});

// Get a batch of cards due for review (optionally filtered by deck), topped
// up with new cards from that deck. With no deck specified, only due
// reviews across all decks are returned.
router.get('/queue', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const deckId = req.query.deck_id ? parseInt(req.query.deck_id) : null;

  // "random" pulls a shuffled batch of cards from decks the user has
  // already completed, for casual extra practice outside the SM-2 queue.
  if (req.query.random === '1') {
    const cards = db.prepare(`
      SELECT c.id, c.welsh, c.english, c.notes, c.example_welsh, c.example_english, c.deck_id,
        uc.ease, uc.interval_days, uc.repetitions, uc.due_date
      FROM cards c
      JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
      JOIN decks d ON d.id = c.deck_id
      WHERE d.id IN (
        SELECT c2.deck_id FROM cards c2
        JOIN user_cards uc2 ON uc2.card_id = c2.id AND uc2.user_id = ?
        GROUP BY c2.deck_id
        HAVING COUNT(*) = (SELECT COUNT(*) FROM cards c3 WHERE c3.deck_id = c2.deck_id)
      )
      ORDER BY RANDOM() LIMIT ?
    `).all(req.user.id, req.user.id, limit);
    return res.json({ cards });
  }

  // "hard" pulls cards the user has struggled with — low ease factor or
  // reset by an "Again" press — ordered worst-first, for focused drilling.
  if (req.query.hard === '1') {
    const cards = db.prepare(`
      SELECT c.id, c.welsh, c.english, c.notes, c.example_welsh, c.example_english, c.deck_id,
        uc.ease, uc.interval_days, uc.repetitions, uc.due_date
      FROM cards c
      JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
      WHERE uc.ease < 2.3 OR uc.repetitions = 0
      ORDER BY uc.ease ASC LIMIT ?
    `).all(req.user.id, limit);
    return res.json({ cards });
  }

  // "review_all" lets a user restudy every card in a completed deck, even
  // if none are due yet. Only meaningful with a deck_id.
  const reviewAll = req.query.review_all === '1' && deckId;
  const deckFilter = deckId ? 'AND c.deck_id = ?' : '';
  const dueFilter = reviewAll ? '' : "AND uc.due_date <= datetime('now')";

  const reviewSql = `
    SELECT c.id, c.welsh, c.english, c.notes, c.example_welsh, c.example_english, c.deck_id,
      uc.ease, uc.interval_days, uc.repetitions, uc.due_date
    FROM cards c
    JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
    WHERE 1=1 ${dueFilter} ${deckFilter}
    ORDER BY uc.due_date ASC LIMIT ?
  `;
  const reviewParams = deckId ? [req.user.id, deckId, limit] : [req.user.id, limit];
  const reviewCards = db.prepare(reviewSql).all(...reviewParams);

  let newCards = [];
  if (deckId) {
    const remaining = limit - reviewCards.length;
    if (remaining > 0) {
      newCards = db.prepare(`
        SELECT c.id, c.welsh, c.english, c.notes, c.example_welsh, c.example_english, c.deck_id,
          NULL AS ease, NULL AS interval_days, NULL AS repetitions, NULL AS due_date
        FROM cards c
        LEFT JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
        WHERE uc.id IS NULL AND c.deck_id = ?
        ORDER BY c.id ASC LIMIT ?
      `).all(req.user.id, deckId, remaining);
    }
  }

  res.json({ cards: [...reviewCards, ...newCards] });
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

// Compute progress stats used to evaluate achievements.
function getAchievementStats(userId) {
  const user = db.prepare('SELECT longest_streak FROM users WHERE id = ?').get(userId);
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM user_cards WHERE user_id = ? AND repetitions >= 2) AS learned_cards,
      (SELECT COUNT(*) FROM review_log WHERE user_id = ?) AS total_reviews,
      (SELECT COUNT(*) FROM decks) AS total_decks,
      (SELECT COUNT(*) FROM (
        SELECT d.id FROM decks d
        WHERE (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) > 0
          AND (SELECT COUNT(*) FROM cards c JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ? WHERE c.deck_id = d.id)
              >= (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id)
      )) AS completed_decks
  `).get(userId, userId, userId);

  return { longest_streak: user.longest_streak, ...totals };
}

// Returns the full achievement list annotated with earned status, awarding
// any newly-earned achievements along the way.
function getAchievements(userId) {
  const stats = getAchievementStats(userId);
  const earnedRows = db.prepare('SELECT code, earned_at FROM user_achievements WHERE user_id = ?').all(userId);
  const earnedMap = Object.fromEntries(earnedRows.map(r => [r.code, r.earned_at]));

  return ACHIEVEMENTS.map(a => {
    let earnedAt = earnedMap[a.code];
    if (!earnedAt && a.check(stats)) {
      db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, code) VALUES (?, ?)').run(userId, a.code);
      earnedAt = db.prepare('SELECT earned_at FROM user_achievements WHERE user_id = ? AND code = ?').get(userId, a.code).earned_at;
    }
    return {
      code: a.code, name: a.name, description: a.description, icon: a.icon,
      earned: !!earnedAt, earned_at: earnedAt || null,
    };
  });
}

router.get('/achievements', (req, res) => {
  res.json({ achievements: getAchievements(req.user.id) });
});

module.exports = router;
module.exports.getAchievements = getAchievements;
