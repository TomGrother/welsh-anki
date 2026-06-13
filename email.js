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

module.exports = { sendEmail };
