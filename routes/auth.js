const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { SECRET, requireAuth } = require('../middleware/auth');
const { sendEmail, emailLayout } = require('../email');
const { rateLimit } = require('../middleware/rateLimit');

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many attempts. Please try again in 15 minutes.' });
const emailLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many requests. Please try again in an hour.' });

const PASSWORD_RULES = 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number and a symbol';
function isValidPassword(password) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

const router = express.Router();

const LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Fluent'];

router.post('/register', authLimiter, (req, res) => {
  const { username, email, password, new_cards_per_day, level } = req.body || {};
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
  let userLevel = 'Beginner';
  if (level !== undefined) {
    if (!LEVELS.includes(level)) {
      return res.status(400).json({ error: 'level must be one of ' + LEVELS.join(', ') });
    }
    userLevel = level;
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) return res.status(409).json({ error: 'Username or email already in use' });

  const hash = bcrypt.hashSync(password, 10);
  const isFirstUser = db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;
  const result = db.prepare(
    'INSERT INTO users (username, email, password_hash, is_admin, new_cards_per_day, active_level, email_reminders) VALUES (?, ?, ?, ?, ?, ?, 0)'
  ).run(username, email, hash, isFirstUser ? 1 : 0, newCardsPerDay, userLevel);

  // If the user already knows some Welsh, mark every deck below their
  // chosen level as completed and "learned" so they unlock straight away
  // and feed into the SM-2 review queue, instead of starting from scratch.
  const levelIndex = LEVELS.indexOf(userLevel);
  if (levelIndex > 0) {
    const earlierDecks = db.prepare(`
      SELECT id FROM decks WHERE owner_id IS NULL AND level IN (${LEVELS.slice(0, levelIndex).map(() => '?').join(',')})
    `).all(...LEVELS.slice(0, levelIndex));

    if (earlierDecks.length > 0) {
      const cards = db.prepare(`
        SELECT id FROM cards WHERE deck_id IN (${earlierDecks.map(() => '?').join(',')})
      `).all(...earlierDecks.map(d => d.id));

      const insertUserCard = db.prepare(`
        INSERT INTO user_cards (user_id, card_id, ease, interval_days, repetitions, due_date, last_reviewed, first_seen)
        VALUES (?, ?, 2.5, 6, 2, datetime('now', '+6 days'), datetime('now'), datetime('now'))
      `);
      const run = db.transaction((rows) => {
        for (const c of rows) insertUserCard.run(result.lastInsertRowid, c.id);
      });
      run(cards);
    }
  }

  sendVerificationEmail(req, result.lastInsertRowid, email)
    .catch(err => console.error('[register] failed to send verification email:', err));

  if (process.env.ADMIN_NOTIFICATION_EMAIL) {
    sendEmail({
      to: process.env.ADMIN_NOTIFICATION_EMAIL,
      subject: 'New Dragon Lingo signup',
      html: emailLayout({
        title: 'New signup',
        preheader: `${username} just signed up.`,
        bodyHtml: `
          <p style="margin:0 0 8px;">A new user has signed up for Dragon Lingo:</p>
          <p style="margin:0 0 4px;"><strong>Username:</strong> ${username}</p>
          <p style="margin:0 0 4px;"><strong>Email:</strong> ${email}</p>
          <p style="margin:0;"><strong>Level:</strong> ${userLevel}</p>
        `,
      }),
    }).catch(err => console.error('[register] failed to send admin notification:', err));
  }

  res.json({ needs_verification: true, message: 'Please check your email and click the confirmation link to activate your account.' });
});

function sendVerificationEmail(req, userId, email) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`
    INSERT INTO email_verifications (user_id, token, expires_at)
    VALUES (?, ?, datetime('now', '+24 hours'))
  `).run(userId, token);

  const verifyUrl = `${req.protocol}://${req.get('host')}/?verify=${token}`;
  return sendEmail({
    to: email,
    subject: 'Confirm your Dragon Lingo account',
    html: emailLayout({
      title: 'Confirm your Dragon Lingo account',
      preheader: 'Please confirm your email address to activate your account.',
      bodyHtml: `
        <p style="margin:0 0 16px;">Welcome to Dragon Lingo! 🐉</p>
        <p style="margin:0 0 24px;">Please confirm your email address to activate your account and start learning Welsh.</p>
        <div style="text-align:center;">
          <a href="${verifyUrl}" style="display:inline-block;background:#00a656;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;">
            Verify Email
          </a>
        </div>
        <p style="margin:24px 0 0;color:#718096;font-size:13px;">This link expires in 24 hours.</p>
      `,
    }),
  });
}

// Confirm an email address using the token from the verification email.
router.post('/verify-email', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token is required' });

  const verification = db.prepare(`
    SELECT * FROM email_verifications WHERE token = ? AND used = 0 AND expires_at > datetime('now')
  `).get(token);
  if (!verification) return res.status(400).json({ error: 'Invalid or expired verification link' });

  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(verification.user_id);
  db.prepare('UPDATE email_verifications SET used = 1 WHERE id = ?').run(verification.id);

  res.json({ ok: true });
});

// Resend the verification email to the logged-in user.
router.post('/resend-verification', requireAuth, (req, res) => {
  const user = db.prepare('SELECT email, email_verified FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.email_verified) return res.json({ ok: true, message: 'Your email is already verified.' });

  sendVerificationEmail(req, req.user.id, user.email)
    .catch(err => console.error('[resend-verification] failed to send email:', err));

  res.json({ ok: true, message: 'Verification email sent.' });
});

// Resend the verification email for an account that can't log in yet
// (email/username not verified). Always responds generically so accounts
// can't be enumerated.
router.post('/resend-verification-public', emailLimiter, (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Username or email is required' });

  const user = db.prepare('SELECT id, email, email_verified FROM users WHERE username = ? OR email = ?').get(username, username);
  if (user && !user.email_verified) {
    sendVerificationEmail(req, user.id, user.email)
      .catch(err => console.error('[resend-verification-public] failed to send email:', err));
  }

  res.json({ ok: true, message: 'If an unverified account exists, a confirmation email has been sent.' });
});

router.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!user.email_verified) {
    return res.status(403).json({ error: 'Please verify your email address before logging in. Check your inbox for the confirmation link.', needs_verification: true });
  }

  const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username, is_admin: !!user.is_admin } });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, email, is_admin, current_streak, longest_streak, last_study_date, new_cards_per_day, active_level, email_verified, email_reminders, reminder_hour, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { ...user, is_admin: !!user.is_admin } });
});

// Update study preferences (e.g. how many new cards to introduce per day).
router.put('/me/settings', requireAuth, (req, res) => {
  const { new_cards_per_day, email_reminders, reminder_hour } = req.body || {};
  const value = parseInt(new_cards_per_day, 10);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    return res.status(400).json({ error: 'new_cards_per_day must be an integer between 1 and 100' });
  }
  const reminders = email_reminders ? 1 : 0;
  let hour = parseInt(reminder_hour, 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) hour = 17;
  db.prepare('UPDATE users SET new_cards_per_day = ?, email_reminders = ?, reminder_hour = ? WHERE id = ?').run(value, reminders, hour, req.user.id);
  res.json({ new_cards_per_day: value, email_reminders: reminders, reminder_hour: hour });
});

// Request a password reset. Always responds with a generic success message so
// existing emails can't be enumerated. Generates a one-hour token and emails
// the reset link via Resend.
router.post('/forgot-password', emailLimiter, (req, res) => {
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
    sendEmail({
      to: email,
      subject: 'Reset your Dragon Lingo password',
      html: emailLayout({
        title: 'Reset your Dragon Lingo password',
        preheader: 'Click the link to choose a new password.',
        bodyHtml: `
          <p style="margin:0 0 16px;">Someone requested a password reset for your Dragon Lingo account.</p>
          <div style="text-align:center;margin-bottom:16px;">
            <a href="${resetUrl}" style="display:inline-block;background:#00a656;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;">
              Reset Password
            </a>
          </div>
          <p style="margin:0;color:#718096;font-size:13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        `,
      }),
    }).catch(err => console.error('[forgot-password] failed to send email:', err));
  }

  res.json({ ok: true, message: 'If an account exists for that email, a reset link has been generated.' });
});

// Complete a password reset using a token from /forgot-password.
router.post('/reset-password', authLimiter, (req, res) => {
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
