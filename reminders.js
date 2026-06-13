// Daily "you have cards due" reminder emails. No extra cron dependency —
// just checks every few minutes whether it's time to run today's batch yet,
// per-user, based on each user's chosen reminder_hour (UTC).
const db = require('./db');
const { sendEmail, reminderEmail } = require('./email');

const CHECK_INTERVAL_MS = 10 * 60 * 1000;

async function sendDueReminders(hour) {
  const users = db.prepare(`
    SELECT u.id, u.username, u.email,
      (SELECT COUNT(*) FROM user_cards WHERE user_id = u.id AND due_date <= datetime('now')) AS due_now
    FROM users u
    WHERE u.email_verified = 1
      AND u.email_reminders = 1
      AND u.reminder_hour = ?
      AND (u.last_reminder_sent IS NULL OR date(u.last_reminder_sent) < date('now'))
  `).all(hour);

  for (const user of users) {
    if (user.due_now > 0) {
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

    db.prepare('UPDATE users SET last_reminder_sent = datetime(\'now\') WHERE id = ?').run(user.id);
  }
}

function startReminderScheduler() {
  setInterval(() => {
    const hour = new Date().getUTCHours();
    sendDueReminders(hour).catch(err => console.error('[reminders] batch failed:', err));
  }, CHECK_INTERVAL_MS).unref();
}

module.exports = { startReminderScheduler, sendDueReminders };
