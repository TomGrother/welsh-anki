// Thin wrapper around the Resend API (https://resend.com) for transactional email.
// Requires RESEND_API_KEY and RESEND_FROM env vars; if RESEND_API_KEY is not
// set (e.g. local dev), emails are logged to the console instead of sent.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Dragon Lingo <onboarding@resend.dev>';

async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.log(`[email] RESEND_API_KEY not set — would send to ${to}: ${subject}\n${html}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[email] Resend request failed (${res.status}): ${body}`);
  }
}

const SITE_URL = process.env.SITE_URL || 'https://dragon-lingo.com';

// Wraps inner HTML in Dragon Lingo's branded email layout (logo, colours, footer).
function emailLayout({ title, preheader, bodyHtml }) {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -8px rgba(26,32,44,0.12);">
            <tr>
              <td style="background:#e53e3e;padding:24px;text-align:center;">
                <img src="${SITE_URL}/dragon-icon.svg" alt="Dragon Lingo" width="48" height="48" style="display:block;margin:0 auto 8px;">
                <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">Dragon Lingo</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px;color:#1a202c;font-size:15px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;background:#f5f7fa;text-align:center;color:#718096;font-size:12px;">
                <p style="margin:0 0 6px;">Dragon Lingo — Learn Welsh Online for Free 🐉</p>
                <p style="margin:0;">You can manage email preferences in your <a href="${SITE_URL}/?view=settings" style="color:#00a656;">account settings</a>.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// A friendly reminder that the user has cards due for review.
function reminderEmail({ username, dueCount }) {
  return emailLayout({
    title: 'Your Welsh words are waiting!',
    preheader: `You have ${dueCount} word${dueCount === 1 ? '' : 's'} due for review today.`,
    bodyHtml: `
      <p style="margin:0 0 16px;">Bore da, ${username}! 👋</p>
      <p style="margin:0 0 16px;">
        You have <strong style="color:#e53e3e;">${dueCount} word${dueCount === 1 ? '' : 's'}</strong>
        due for review on Dragon Lingo today.
      </p>
      <p style="margin:0 0 24px;">
        A few minutes now keeps your streak alive and your Welsh fresh in your memory — spaced repetition works best little and often!
      </p>
      <div style="text-align:center;">
        <a href="${SITE_URL}/?view=dashboard" style="display:inline-block;background:#00a656;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;">
          Review Now
        </a>
      </div>
    `,
  });
}

module.exports = { sendEmail, emailLayout, reminderEmail };
