const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Search for users by username (excluding self), for sending friend requests.
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ users: [] });

  const users = db.prepare(`
    SELECT id, username FROM users
    WHERE username LIKE ? AND id != ?
    ORDER BY username LIMIT 10
  `).all(`%${q}%`, req.user.id);

  res.json({ users });
});

// Send a friend request.
router.post('/request', (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username is required' });

  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't add yourself" });

  const existing = db.prepare(`
    SELECT * FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
  `).get(req.user.id, target.id, target.id, req.user.id);
  if (existing) return res.status(400).json({ error: 'Friend request already exists' });

  db.prepare('INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, ?)').run(req.user.id, target.id, 'pending');
  res.json({ ok: true });
});

// Accept or decline an incoming friend request.
router.post('/respond', (req, res) => {
  const { request_id, accept } = req.body || {};
  if (request_id == null) return res.status(400).json({ error: 'request_id is required' });

  const request = db.prepare('SELECT * FROM friendships WHERE id = ? AND friend_id = ? AND status = ?')
    .get(request_id, req.user.id, 'pending');
  if (!request) return res.status(404).json({ error: 'Request not found' });

  if (accept) {
    db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run('accepted', request.id);
  } else {
    db.prepare('DELETE FROM friendships WHERE id = ?').run(request.id);
  }
  res.json({ ok: true });
});

// Remove an existing friend.
router.post('/remove', (req, res) => {
  const { user_id } = req.body || {};
  if (user_id == null) return res.status(400).json({ error: 'user_id is required' });

  db.prepare(`
    DELETE FROM friendships
    WHERE status = 'accepted' AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
  `).run(req.user.id, user_id, user_id, req.user.id);
  res.json({ ok: true });
});

// List accepted friends plus pending incoming/outgoing requests.
router.get('/friends', (req, res) => {
  const friends = db.prepare(`
    SELECT u.id, u.username FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
    WHERE f.status = 'accepted' AND (f.user_id = ? OR f.friend_id = ?)
  `).all(req.user.id, req.user.id, req.user.id);

  const incoming = db.prepare(`
    SELECT f.id AS request_id, u.id AS user_id, u.username FROM friendships f
    JOIN users u ON u.id = f.user_id
    WHERE f.friend_id = ? AND f.status = 'pending'
  `).all(req.user.id);

  const outgoing = db.prepare(`
    SELECT f.id AS request_id, u.id AS user_id, u.username FROM friendships f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? AND f.status = 'pending'
  `).all(req.user.id);

  res.json({ friends, incoming, outgoing });
});

// Leaderboard across the user and their accepted friends.
router.get('/leaderboard', (req, res) => {
  const friendIds = db.prepare(`
    SELECT CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END AS id
    FROM friendships f
    WHERE f.status = 'accepted' AND (f.user_id = ? OR f.friend_id = ?)
  `).all(req.user.id, req.user.id, req.user.id).map(r => r.id);

  const ids = [req.user.id, ...friendIds];
  const placeholders = ids.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT u.id, u.username, u.current_streak, u.longest_streak,
      (SELECT COUNT(*) FROM user_cards WHERE user_id = u.id AND repetitions >= 2) AS learned_cards,
      (SELECT COUNT(*) FROM review_log WHERE user_id = u.id) AS total_reviews
    FROM users u
    WHERE u.id IN (${placeholders})
  `).all(...ids);

  rows.sort((a, b) => b.current_streak - a.current_streak || b.learned_cards - a.learned_cards);
  res.json({ leaderboard: rows });
});

module.exports = router;
