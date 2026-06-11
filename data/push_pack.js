// Pushes a word pack (JSON: { decks: [{ name, description, cards: [[welsh, english], ...] }] })
// to a live deployed instance via the admin API.
//
// Usage:
//   BASE_URL=https://your-app.up.railway.app ADMIN_USER=... ADMIN_PASS=... \
//   node data/push_pack.js data/pack_basics_500.json

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const packFile = process.argv[2];

if (!BASE_URL || !ADMIN_USER || !ADMIN_PASS || !packFile) {
  console.error('Usage: BASE_URL=... ADMIN_USER=... ADMIN_PASS=... node data/push_pack.js <pack.json>');
  process.exit(1);
}

const pack = JSON.parse(fs.readFileSync(path.resolve(packFile), 'utf8'));

async function main() {
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS })
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) throw new Error('Login failed: ' + loginData.error);
  const token = loginData.token;
  if (!loginData.user.is_admin) throw new Error('This account is not an admin.');

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const existingDecksRes = await fetch(`${BASE_URL}/api/admin/decks`, { headers });
  const { decks: existingDecks } = await existingDecksRes.json();

  let totalImported = 0;

  for (const deck of pack.decks) {
    let deckEntry = existingDecks.find(d => d.name === deck.name);
    let deckId;
    if (deckEntry) {
      deckId = deckEntry.id;
      console.log(`Using existing deck "${deck.name}" (id ${deckId})`);
    } else {
      const res = await fetch(`${BASE_URL}/api/admin/decks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: deck.name, description: deck.description || '' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Failed to create deck "${deck.name}": ${data.error}`);
      deckId = data.id;
      console.log(`Created deck "${deck.name}" (id ${deckId})`);
    }

    const cards = deck.cards.map(([welsh, english]) => ({ welsh, english }));
    const importRes = await fetch(`${BASE_URL}/api/admin/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ deck_id: deckId, cards })
    });
    const importData = await importRes.json();
    if (!importRes.ok) throw new Error(`Import failed for "${deck.name}": ${importData.error}`);
    console.log(`  -> imported ${importData.imported} cards`);
    totalImported += importData.imported;
  }

  console.log(`\nDone. Total cards imported: ${totalImported}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
