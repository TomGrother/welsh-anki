const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { sm2 } = require('../sm2');
const { ACHIEVEMENTS } = require('../achievements');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// --- Text-to-speech (Welsh pronunciation audio) ---
// Uses Azure Speech's Welsh neural voices. Generated MP3s are cached on disk
// (the Railway volume) keyed by voice+text, so each word is synthesised once
// ever. Without AZURE_SPEECH_KEY set, /tts returns 503 and the UI hides the
// listen button.
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || 'uksouth';
const TTS_VOICE = process.env.AZURE_SPEECH_VOICE || 'cy-GB-NiaNeural';
const ttsDir = path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'tts');

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

router.get('/tts-status', (req, res) => {
  res.json({ available: !!AZURE_SPEECH_KEY });
});

router.get('/tts/:cardId', async (req, res) => {
  if (!AZURE_SPEECH_KEY) return res.status(503).json({ error: 'Audio is not configured' });
  const card = db.prepare('SELECT welsh FROM cards WHERE id = ?').get(req.params.cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const hash = crypto.createHash('sha1').update(`${TTS_VOICE}|${card.welsh}`).digest('hex');
  const file = path.join(ttsDir, `${hash}.mp3`);

  if (!fs.existsSync(file)) {
    const ssml = `<speak version='1.0' xml:lang='cy-GB'><voice name='${TTS_VOICE}'><prosody rate='-10%'>${escapeXml(card.welsh)}</prosody></voice></speak>`;
    try {
      const resp = await fetch(`https://${AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'dragon-lingo',
        },
        body: ssml,
      });
      if (!resp.ok) {
        console.error(`[tts] Azure TTS failed (${resp.status}):`, await resp.text().catch(() => ''));
        return res.status(502).json({ error: 'Audio generation failed' });
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.mkdirSync(ttsDir, { recursive: true });
      fs.writeFileSync(file, buf);
    } catch (err) {
      console.error('[tts] request error:', err);
      return res.status(502).json({ error: 'Audio generation failed' });
    }
  }

  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.type('audio/mpeg').send(fs.readFileSync(file));
});

// Global decks unlock sequentially in level order. Returns the ordered list
// of global decks with their completion status for a user.
function getOrderedGlobalDecks(userId) {
  return db.prepare(`
    SELECT d.id,
      (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS total_cards,
      (SELECT COUNT(*) FROM cards c JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ? WHERE c.deck_id = d.id) AS started_cards
    FROM decks d
    WHERE d.owner_id IS NULL
    ORDER BY CASE d.level WHEN 'Beginner' THEN 0 WHEN 'Intermediate' THEN 1 WHEN 'Advanced' THEN 2 WHEN 'Fluent' THEN 3 ELSE 4 END, d.id
  `).all(userId);
}

// The first global deck (in level order) that isn't fully completed yet —
// the only deck currently allowed to introduce new cards.
function getFrontierDeckId(userId) {
  for (const d of getOrderedGlobalDecks(userId)) {
    if (!(d.total_cards > 0 && d.started_cards >= d.total_cards)) return d.id;
  }
  return null;
}

// A global deck is locked until every deck before it (in level order) is
// fully completed.
function isDeckLocked(userId, deckId) {
  for (const d of getOrderedGlobalDecks(userId)) {
    if (d.id === deckId) return false;
    if (!(d.total_cards > 0 && d.started_cards >= d.total_cards)) return true;
  }
  return false;
}

// List decks with total card count and how many reviews are due now for
// each. New cards have no cap — users can work through a topic at their
// own pace and it'll reappear for review once cards become due.
router.get('/decks', (req, res) => {
  const decks = db.prepare(`
    SELECT d.id, d.name, d.description, d.level, d.owner_id,
      (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS total_cards,
      (SELECT COUNT(*) FROM cards c
         JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
         WHERE c.deck_id = d.id AND uc.due_date <= datetime('now')) AS due_cards,
      (SELECT COUNT(*) FROM cards c
         JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
         WHERE c.deck_id = d.id) AS started_cards
    FROM decks d
    WHERE d.owner_id IS NULL OR d.owner_id = ?
    ORDER BY CASE d.level WHEN 'Beginner' THEN 0 WHEN 'Intermediate' THEN 1 WHEN 'Advanced' THEN 2 WHEN 'Fluent' THEN 3 ELSE 4 END, d.id
  `).all(req.user.id, req.user.id, req.user.id);

  let prevCompleted = true;
  for (const deck of decks) {
    deck.in_progress = deck.started_cards > 0 && deck.started_cards < deck.total_cards;
    deck.completed = deck.started_cards >= deck.total_cards && deck.total_cards > 0;
    deck.progress_pct = deck.total_cards > 0 ? Math.round((deck.started_cards / deck.total_cards) * 100) : 0;
    deck.is_own = deck.owner_id === req.user.id;

    // Global decks unlock sequentially: a deck is locked until every deck
    // before it (in level order) has been fully completed. Personal decks
    // are always unlocked.
    if (deck.owner_id) {
      deck.locked = false;
    } else {
      deck.locked = !prevCompleted;
      prevCompleted = prevCompleted && deck.completed;
    }

    delete deck.started_cards;
    delete deck.owner_id;
  }

  res.json({ decks });
});

// Create a personal deck, visible only to the creator.
router.post('/decks', (req, res) => {
  const { name, description } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

  let finalName = name.trim();
  let suffix = 1;
  while (db.prepare('SELECT id FROM decks WHERE name = ?').get(finalName)) {
    suffix++;
    finalName = `${name.trim()} #${suffix}`;
  }

  const result = db.prepare('INSERT INTO decks (name, description, level, owner_id) VALUES (?, ?, ?, ?)')
    .run(finalName, (description || '').trim(), 'My Decks', req.user.id);

  res.json({ id: result.lastInsertRowid, name: finalName });
});

// Delete one of your own personal decks (and its cards).
router.delete('/decks/:id', (req, res) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (deck.owner_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own decks' });

  db.prepare('DELETE FROM decks WHERE id = ?').run(deck.id);
  res.json({ ok: true });
});

// Add a card to one of your own personal decks.
router.post('/decks/:id/cards', (req, res) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (deck.owner_id !== req.user.id) return res.status(403).json({ error: 'You can only add cards to your own decks' });

  const { welsh, english, notes, example_welsh, example_english } = req.body || {};
  if (!welsh || !english) return res.status(400).json({ error: 'welsh and english are required' });

  const result = db.prepare(`
    INSERT INTO cards (deck_id, welsh, english, notes, example_welsh, example_english)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(deck.id, welsh.trim(), english.trim(), (notes || '').trim(), (example_welsh || '').trim(), (example_english || '').trim());

  res.json({ id: result.lastInsertRowid });
});

// Bulk import cards into one of your own personal decks.
// Accepts { cards: [{welsh, english, notes?, example_welsh?, example_english?}, ...] }
router.post('/decks/:id/import', (req, res) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (deck.owner_id !== req.user.id) return res.status(403).json({ error: 'You can only import into your own decks' });

  const { cards } = req.body || {};
  if (!Array.isArray(cards)) return res.status(400).json({ error: 'A cards array is required' });

  const insert = db.prepare(`
    INSERT INTO cards (deck_id, welsh, english, notes, example_welsh, example_english)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  let count = 0;
  const run = db.transaction((rows) => {
    for (const row of rows) {
      if (!row.welsh || !row.english) continue;
      insert.run(deck.id, row.welsh, row.english, row.notes || null, row.example_welsh || null, row.example_english || null);
      count++;
    }
  });
  run(cards);
  res.json({ imported: count });
});

// Delete a card from one of your own personal decks.
router.delete('/cards/:id', (req, res) => {
  const card = db.prepare('SELECT c.*, d.owner_id FROM cards c JOIN decks d ON d.id = c.deck_id WHERE c.id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  if (card.owner_id !== req.user.id) return res.status(403).json({ error: 'You can only delete cards from your own decks' });

  db.prepare('DELETE FROM cards WHERE id = ?').run(card.id);
  res.json({ ok: true });
});

// Get a batch of cards due for review (optionally filtered by deck), topped
// up with new cards from that deck. With no deck specified, only due
// reviews across all decks are returned.
router.get('/queue', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const deckId = req.query.deck_id ? parseInt(req.query.deck_id) : null;

  if (deckId) {
    const deck = db.prepare('SELECT owner_id FROM decks WHERE id = ?').get(deckId);
    if (!deck || (deck.owner_id && deck.owner_id !== req.user.id)) return res.status(404).json({ error: 'Deck not found' });
    if (!deck.owner_id && isDeckLocked(req.user.id, deckId)) return res.status(403).json({ error: 'This deck is locked until you complete the previous decks' });
  }

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

  // Studying a specific deck (deck_id set) is completely independent of
  // the SM-2 Due Now queue and the daily new-card pace: every card in the
  // deck — reviewed or never-seen, due or not — is available so a deck can
  // always be fully completed in one sitting. Reviewing a card here still
  // writes normal SM-2 data via /review, which is what later feeds Due Now.
  if (deckId) {
    const cards = db.prepare(`
      SELECT c.id, c.welsh, c.english, c.notes, c.example_welsh, c.example_english, c.deck_id,
        uc.ease, uc.interval_days, uc.repetitions, uc.due_date
      FROM cards c
      LEFT JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
      WHERE c.deck_id = ?
      ORDER BY (uc.id IS NULL) DESC, uc.due_date ASC, c.id ASC
    `).all(req.user.id, deckId);
    return res.json({ cards });
  }

  const { new_cards_per_day } = db.prepare('SELECT new_cards_per_day FROM users WHERE id = ?').get(req.user.id);
  const DAILY_NEW_CARD_LIMIT = new_cards_per_day || 10;

  // Work out new cards first and guarantee them a slot, so a backlog of
  // due reviews from already-learned decks can never crowd out the day's
  // new vocabulary.
  let newCards = [];
  const { count: newToday } = db.prepare(`
    SELECT COUNT(*) AS count FROM user_cards
    WHERE user_id = ? AND date(first_seen) = date('now')
  `).get(req.user.id);
  const newAllowance = Math.max(0, Math.min(limit, DAILY_NEW_CARD_LIMIT - newToday));
  if (newAllowance > 0) {
    // New cards are only drawn from the current "frontier" deck — the
    // first global deck (in level order) that isn't fully completed yet.
    // Earlier decks must be completed before later ones unlock.
    const frontierId = getFrontierDeckId(req.user.id);

    if (frontierId) {
      newCards = db.prepare(`
        SELECT c.id, c.welsh, c.english, c.notes, c.example_welsh, c.example_english, c.deck_id,
          NULL AS ease, NULL AS interval_days, NULL AS repetitions, NULL AS due_date
        FROM cards c
        LEFT JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
        WHERE uc.id IS NULL AND c.deck_id = ?
        ORDER BY c.id ASC
        LIMIT ?
      `).all(req.user.id, frontierId, newAllowance);
    }
  }

  const reviewLimit = Math.max(0, limit - newCards.length);
  let reviewCards = [];
  if (reviewLimit > 0) {
    reviewCards = db.prepare(`
      SELECT c.id, c.welsh, c.english, c.notes, c.example_welsh, c.example_english, c.deck_id,
        uc.ease, uc.interval_days, uc.repetitions, uc.due_date
      FROM cards c
      JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
      WHERE uc.due_date <= datetime('now')
      ORDER BY uc.due_date ASC LIMIT ?
    `).all(req.user.id, reviewLimit);
  }

  res.json({ cards: [...reviewCards, ...newCards] });
});

// All cards in a deck, for printable cheatsheets.
router.get('/decks/:id/cards', (req, res) => {
  const deck = db.prepare('SELECT id, name, description, owner_id FROM decks WHERE id = ?').get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (deck.owner_id && deck.owner_id !== req.user.id) return res.status(404).json({ error: 'Deck not found' });

  const cards = db.prepare(`
    SELECT id, welsh, english, notes, example_welsh, example_english
    FROM cards WHERE deck_id = ? ORDER BY id
  `).all(deck.id);

  res.json({ deck, cards });
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

  // First-ever review of a card normally schedules it for tomorrow. If a user
  // completes many decks in one sitting, that dumps all those cards into
  // tomorrow's Due Now at once. Spread first-time reviews out at the user's
  // own "new words per day" pace so the review load stays manageable.
  let extraDays = 0;
  const isFirstReview = !userCard.first_seen && updated.repetitions === 1;
  if (isFirstReview) {
    const { new_cards_per_day } = db.prepare('SELECT new_cards_per_day FROM users WHERE id = ?').get(req.user.id);
    const pace = new_cards_per_day || 10;
    const { count: introducedToday } = db.prepare(`
      SELECT COUNT(*) AS count FROM user_cards
      WHERE user_id = ? AND date(first_seen) = date('now')
    `).get(req.user.id);
    extraDays = Math.floor(introducedToday / pace);
  }

  const totalIntervalDays = updated.interval_days + extraDays;
  const dueDate = quality < 3
    ? `datetime('now')`
    : totalIntervalDays >= 1
      ? `datetime(date('now', '+${totalIntervalDays} days'))`
      : `datetime('now', '+${totalIntervalDays} days')`;

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

  // The stored streak only updates when the user reviews a card, so it goes
  // stale if they stop studying — report 0 once a day has been missed.
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (user.last_study_date && user.last_study_date < yesterday) user.current_streak = 0;
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

// Daily review history for charts (last 119 days, ~17 weeks for a heatmap), plus a quality breakdown.
router.get('/history', (req, res) => {
  const reviews = db.prepare(`
    SELECT date(reviewed_at) AS day, COUNT(*) AS count
    FROM review_log
    WHERE user_id = ? AND reviewed_at >= datetime('now', '-118 days')
    GROUP BY day
  `).all(req.user.id);

  const newCards = db.prepare(`
    SELECT date(first_seen) AS day, COUNT(*) AS count
    FROM user_cards
    WHERE user_id = ? AND first_seen >= datetime('now', '-118 days')
    GROUP BY day
  `).all(req.user.id);

  const reviewMap = Object.fromEntries(reviews.map(r => [r.day, r.count]));
  const newMap = Object.fromEntries(newCards.map(r => [r.day, r.count]));

  const days = [];
  for (let i = 118; i >= 0; i--) {
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

// All "learned" words (reviewed correctly at least twice), most recently
// reviewed first, for the progress page.
router.get('/learned-words', (req, res) => {
  const words = db.prepare(`
    SELECT c.welsh, c.english, c.notes, d.name AS deck_name, d.level,
      uc.repetitions, uc.ease, uc.last_reviewed
    FROM user_cards uc
    JOIN cards c ON c.id = uc.card_id
    JOIN decks d ON d.id = c.deck_id
    WHERE uc.user_id = ? AND uc.repetitions >= 2
    ORDER BY uc.last_reviewed DESC
  `).all(req.user.id);

  res.json({ words });
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
