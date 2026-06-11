const express = require('express');
const db = require('../db');

const router = express.Router();

const SITE_URL = process.env.SITE_URL || 'https://welsh-anki-production.up.railway.app';

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layout({ title, description, canonical, body, jsonLd }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="Dysgu Cymraeg">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🐉</text></svg>">
<link rel="stylesheet" href="/style.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head>
<body>
<header>
  <a href="/" class="brand" style="text-decoration:none;color:inherit"><span class="dragon">🐉</span> Dysgu Cymraeg</a>
  <nav><a class="btn" href="/">Start Learning Free</a></nav>
</header>
<main>
${body}
</main>
<footer>Dysgu Cymraeg — Open source Welsh vocabulary trainer. <a href="/">Sign up free</a> to track your progress with spaced repetition.</footer>
</body>
</html>`;
}

// Dynamic sitemap including the homepage, deck index, and every deck page.
router.get('/sitemap.xml', (req, res) => {
  const decks = db.prepare('SELECT name FROM decks').all();
  const urls = [
    `${SITE_URL}/`,
    `${SITE_URL}/decks`,
    ...decks.map(d => `${SITE_URL}/decks/${slugify(d.name)}`)
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
  res.type('application/xml').send(xml);
});

// Index of all decks, grouped by level — crawlable overview page.
router.get('/decks', (req, res) => {
  const decks = db.prepare(`
    SELECT d.id, d.name, d.description, d.level, COUNT(c.id) AS card_count
    FROM decks d LEFT JOIN cards c ON c.deck_id = d.id
    GROUP BY d.id
    ORDER BY CASE d.level WHEN 'Beginner' THEN 0 WHEN 'Intermediate' THEN 1 ELSE 2 END, d.name
  `).all();

  const levels = ['Beginner', 'Intermediate', 'Advanced'];
  const sections = levels.map(level => {
    const levelDecks = decks.filter(d => d.level === level);
    if (!levelDecks.length) return '';
    return `
      <h2>${level} Welsh Decks</h2>
      <ul class="deck-list-seo">
        ${levelDecks.map(d => `
          <li><a href="/decks/${slugify(d.name)}"><strong>${escapeHtml(d.name)}</strong></a> — ${escapeHtml(d.description || '')} (${d.card_count} words)</li>
        `).join('')}
      </ul>
    `;
  }).join('');

  const body = `
    <div class="card-panel">
      <h1>Welsh Vocabulary Decks — Browse ${decks.length} Topics</h1>
      <p>Explore every Welsh vocabulary topic available on Dysgu Cymraeg, from everyday greetings to advanced grammar and mutations. Click a deck to preview the words, or <a href="/">create a free account</a> to study them with spaced repetition and track your progress.</p>
      ${sections}
    </div>
  `;

  res.send(layout({
    title: 'Browse Welsh Vocabulary Decks | Dysgu Cymraeg',
    description: `Browse ${decks.length} free Welsh vocabulary decks covering Beginner, Intermediate and Advanced topics — greetings, grammar, mutations, food, travel and more.`,
    canonical: `${SITE_URL}/decks`,
    body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: decks.map((d, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_URL}/decks/${slugify(d.name)}`,
        name: d.name
      }))
    }
  }));
});

// Individual deck preview page — crawlable, lists sample vocabulary.
router.get('/decks/:slug', (req, res, next) => {
  const decks = db.prepare('SELECT * FROM decks').all();
  const deck = decks.find(d => slugify(d.name) === req.params.slug);
  if (!deck) return next();

  const cards = db.prepare('SELECT welsh, english, example_welsh, example_english FROM cards WHERE deck_id = ? ORDER BY id').all(deck.id);

  const rows = cards.map(c => `
    <tr>
      <td>${escapeHtml(c.welsh)}</td>
      <td>${escapeHtml(c.english)}</td>
      <td class="muted">${c.example_welsh ? escapeHtml(c.example_welsh) + (c.example_english ? ' — ' + escapeHtml(c.example_english) : '') : ''}</td>
    </tr>
  `).join('');

  const body = `
    <div class="card-panel">
      <p><a href="/decks">← All Welsh decks</a></p>
      <h1>${escapeHtml(deck.name)} — ${escapeHtml(deck.level)} Welsh Vocabulary</h1>
      <p>${escapeHtml(deck.description || '')} This ${deck.level.toLowerCase()}-level deck contains ${cards.length} Welsh words and phrases with English translations. <a href="/">Sign up free</a> to learn these with spaced-repetition flashcards and track your progress.</p>
      <table>
        <thead><tr><th>Welsh</th><th>English</th><th>Example</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:1.5rem"><a class="btn" href="/">Study this deck for free →</a></p>
    </div>
  `;

  res.send(layout({
    title: `${deck.name} — ${deck.level} Welsh Vocabulary | Dysgu Cymraeg`,
    description: `Learn ${deck.name} Welsh vocabulary: ${cards.slice(0, 6).map(c => c.welsh).join(', ')}${cards.length > 6 ? ', and more' : ''}. ${deck.description || ''}`.trim(),
    canonical: `${SITE_URL}/decks/${req.params.slug}`,
    body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'LearningResource',
      name: deck.name,
      description: deck.description || undefined,
      educationalLevel: deck.level,
      inLanguage: 'cy',
      isPartOf: {
        '@type': 'WebSite',
        name: 'Dysgu Cymraeg',
        url: SITE_URL
      }
    }
  }));
});

module.exports = router;
