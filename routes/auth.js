const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { SECRET, requireAuth } = require('../middleware/auth');

const PASSWORD_RULES = 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number and a symbol';
function isValidPassword(password) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

const router = express.Router();

router.post('/register', (req, res) => {
  const { username, email, password, new_cards_per_day } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password are required' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: PASSWORD_RULES });
  }
  let newCardsPerDay = 10;
  if (new_cards_per_day !== undefined) {
    const value = parseInt(new_cards_per_day, 10);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      return res.status(400).json({ error: 'new_cards_per_day must be an integer between 1 and 100' });
    }
    newCardsPerDay = value;
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) return res.status(409).json({ error: 'Username or email already in use' });

  const hash = bcrypt.hashSync(password, 10);
  const isFirstUser = db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;
  const result = db.prepare(
    'INSERT INTO users (username, email, password_hash, is_admin, new_cards_per_day) VALUES (?, ?, ?, ?, ?)'
  ).run(username, email, hash, isFirstUser ? 1 : 0, newCardsPerDay);

  const token = jwt.sign({ id: result.lastInsertRowid, username, is_admin: isFirstUser ? 1 : 0 }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: result.lastInsertRowid, username, is_admin: isFirstUser } });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username, is_admin: !!user.is_admin } });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, email, is_admin, current_streak, longest_streak, last_study_date, new_cards_per_day, active_level, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { ...user, is_admin: !!user.is_admin } });
});

// Update study preferences (e.g. how many new cards to introduce per day).
router.put('/me/settings', requireAuth, (req, res) => {
  const { new_cards_per_day } = req.body || {};
  const value = parseInt(new_cards_per_day, 10);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    return res.status(400).json({ error: 'new_cards_per_day must be an integer between 1 and 100' });
  }
  db.prepare('UPDATE users SET new_cards_per_day = ? WHERE id = ?').run(value, req.user.id);
  res.json({ new_cards_per_day: value });
});

// Request a password reset. Always responds with a generic success message so
// existing emails can't be enumerated. Generates a one-hour token; until an
// email provider is configured, the reset link is logged to the server console.
router.post('/forgot-password', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare(`
      INSERT INTO password_resets (user_id, token, expires_at)
      VALUES (?, ?, datetime('now', '+1 hour'))
    `).run(user.id, token);

    const resetUrl = `${req.protocol}://${req.get('host')}/?reset=${token}`;
    console.log(`Password reset requested for ${email}: ${resetUrl}`);
  }

  res.json({ ok: true, message: 'If an account exists for that email, a reset link has been generated.' });
});

// Complete a password reset using a token from /forgot-password.
router.post('/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: PASSWORD_RULES });
  }

  const reset = db.prepare(`
    SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime('now')
  `).get(token);
  if (!reset) return res.status(400).json({ error: 'Invalid or expired reset link' });

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, reset.user_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);

  res.json({ ok: true });
});

module.exports = router;
