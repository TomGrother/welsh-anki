// Daily "you have cards due" reminder emails. No extra cron dependency —
// just checks every few minutes whether it's time to run today's batch yet.
const db = require('./db');
const { sendEmail, reminderEmail } = require('./email');

const REMINDER_HOUR_UTC = parseInt(process.env.REMINDER_HOUR_UTC, 10) || 17; // ~5/6pm UK time
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

async function sendDueReminders() {
  const users = db.prepare(`
    SELECT u.id, u.username, u.email,
      (SELECT COUNT(*) FROM user_cards WHERE user_id = u.id AND due_date <= datetime('now')) AS due_now
    FROM users u
    WHERE u.email_verified = 1
      AND u.email_reminders = 1
      AND (u.last_reminder_sent IS NULL OR date(u.last_reminder_sent) < date('now'))
  `).all();

  for (const user of users) {
    if (user.due_now <= 0) continue;

    try {
      await sendEmail({
        to: user.email,
        subject: `${user.due_now} word${user.due_now === 1 ? '' : 's'} due for review on Dragon Lingo`,
        html: reminderEmail({ username: user.username, dueCount: user.due_now }),
      });
    } catch (err) {
      console.error(`[reminders] failed to send to ${user.email}:`, err);
    }
  }

  db.prepare(`
    UPDATE users SET last_reminder_sent = datetime('now')
    WHERE email_verified = 1 AND email_reminders = 1
      AND (last_reminder_sent IS NULL OR date(last_reminder_sent) < date('now'))
  `).run();
}

function startReminderScheduler() {
  setInterval(() => {
    const hour = new Date().getUTCHours();
    if (hour !== REMINDER_HOUR_UTC) return;

    const anyDue = db.prepare(`
      SELECT 1 FROM users
      WHERE email_verified = 1 AND email_reminders = 1
        AND (last_reminder_sent IS NULL OR date(last_reminder_sent) < date('now'))
      LIMIT 1
    `).get();
    if (!anyDue) return;

    sendDueReminders().catch(err => console.error('[reminders] batch failed:', err));
  }, CHECK_INTERVAL_MS).unref();
}

module.exports = { startReminderScheduler, sendDueReminders };
