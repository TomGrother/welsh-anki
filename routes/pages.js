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
<meta property="og:site_name" content="Dragon Dysgu">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🐉</text></svg>">
<link rel="stylesheet" href="/style.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head>
<body>
<header>
  <a href="/" class="brand" style="text-decoration:none;color:inherit"><span class="dragon">🐉</span> Dragon Dysgu</a>
  <button class="nav-toggle" onclick="document.getElementById('site-nav').classList.toggle('nav-open');document.getElementById('site-nav-backdrop').classList.toggle('nav-open')" aria-label="Toggle navigation">☰</button>
  <nav id="site-nav">
    <a class="nav-link" href="/about">About</a>
    <a class="nav-link" href="/how-it-works">How It Works</a>
    <a class="nav-link" href="/decks">Decks</a>
    <a class="nav-link" href="/faq">FAQ</a>
    <a class="btn" href="/">Start Learning Free</a>
  </nav>
  <div class="nav-backdrop" id="site-nav-backdrop" onclick="document.getElementById('site-nav').classList.remove('nav-open');this.classList.remove('nav-open')"></div>
</header>
<main>
${body}
</main>
<footer>
  Dragon Dysgu — Open source Welsh vocabulary trainer.
  <nav class="footer-links">
    <a href="/about">About</a>
    <a href="/how-it-works">How It Works</a>
    <a href="/decks">Vocabulary Decks</a>
    <a href="/faq">FAQ</a>
    <a href="/">Sign up free</a>
  </nav>
</footer>
</body>
</html>`;
}

// Dynamic sitemap including the homepage, deck index, and every deck page.
router.get('/sitemap.xml', (req, res) => {
  const decks = db.prepare('SELECT name FROM decks').all();
  const urls = [
    `${SITE_URL}/`,
    `${SITE_URL}/about`,
    `${SITE_URL}/how-it-works`,
    `${SITE_URL}/faq`,
    `${SITE_URL}/decks`,
    ...decks.map(d => `${SITE_URL}/decks/${slugify(d.name)}`)
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
  res.type('application/xml').send(xml);
});

// About page — explains the platform and method.
router.get('/about', (req, res) => {
  const totals = db.prepare(`
    SELECT (SELECT COUNT(*) FROM cards) AS cards, (SELECT COUNT(*) FROM decks) AS decks
  `).get();

  const body = `
    <div class="card-panel hero">
      <h1>About Dragon Dysgu</h1>
      <p>Dragon Dysgu ("Learning Welsh") is a free, open vocabulary trainer built to help anyone — from complete beginners to fluent speakers brushing up on grammar — learn the Welsh language using proven spaced-repetition techniques.</p>
    </div>
    <div class="card-panel">
      <h2>Our Mission</h2>
      <p>Welsh is a beautiful, living language spoken by hundreds of thousands of people, and we believe everyone should have free access to high-quality tools for learning it. Dragon Dysgu combines a comprehensive vocabulary database — currently ${totals.cards}+ flashcards across ${totals.decks}+ topic decks — with the same SM-2 spaced-repetition algorithm used by Anki, one of the most effective memorisation tools available.</p>
      <h2>What Makes Us Different</h2>
      <ul class="deck-list-seo">
        <li><strong>Comprehensive coverage</strong> — from "Bore da" and basic greetings to soft mutations, irregular verbs, and conditional tense.</li>
        <li><strong>Structured levels</strong> — Beginner, Intermediate and Advanced decks so you always know what to learn next.</li>
        <li><strong>Smart scheduling</strong> — spaced repetition shows you words right before you'd forget them.</li>
        <li><strong>Daily streaks</strong> — build a sustainable study habit with progress tracking.</li>
        <li><strong>Completely free</strong> — no subscriptions, no paywalls.</li>
      </ul>
      <p><a class="btn" href="/">Get Started Free</a></p>
    </div>
  `;

  res.send(layout({
    title: 'About Dragon Dysgu | Free Welsh Learning Platform',
    description: `Learn about Dragon Dysgu, a free platform for learning Welsh with ${totals.cards}+ spaced-repetition flashcards across ${totals.decks}+ topics, from Beginner to Advanced.`,
    canonical: `${SITE_URL}/about`,
    body
  }));
});

// How It Works page — explains spaced repetition and the study flow.
router.get('/how-it-works', (req, res) => {
  const body = `
    <div class="card-panel hero">
      <h1>How Dragon Dysgu Works</h1>
      <p>Learn Welsh efficiently using spaced repetition — a scientifically proven technique that shows you words at increasing intervals, right before you're likely to forget them.</p>
    </div>
    <div class="card-panel">
      <h2>1. Create a Free Account</h2>
      <p>Sign up in seconds with just a username, email and password. Your progress, streaks and review schedule are saved to your account so you can pick up where you left off on any device.</p>
      <h2>2. Choose Your Level</h2>
      <p>Decks are organised into <strong>Beginner</strong>, <strong>Intermediate</strong> and <strong>Advanced</strong> levels — covering everything from everyday phrases to soft mutations and conjugated prepositions. Pick the level you're ready for, and the platform introduces new words from that level at a comfortable pace.</p>
      <h2>3. Study with Flashcards</h2>
      <p>Each card shows a Welsh word or phrase. Try to recall the English translation, then flip the card to check. Rate how well you knew it — <em>Again</em>, <em>Hard</em>, <em>Good</em> or <em>Easy</em> — and the SM-2 algorithm schedules your next review automatically.</p>
      <h2>4. Build a Streak</h2>
      <p>Studying a little every day is far more effective than cramming. Dragon Dysgu tracks your daily streak and longest streak to help keep you motivated.</p>
      <h2>5. Track Your Progress</h2>
      <p>Visit your Progress page to see charts of your daily reviews, new words learned over time, and a breakdown of your answer quality — so you can see exactly how your Welsh is improving.</p>
      <p><a class="btn" href="/">Start Learning Now</a></p>
    </div>
  `;

  res.send(layout({
    title: 'How It Works — Spaced Repetition for Learning Welsh | Dragon Dysgu',
    description: 'See how Dragon Dysgu uses the SM-2 spaced-repetition algorithm, levelled decks, and daily streaks to help you learn Welsh vocabulary and grammar effectively.',
    canonical: `${SITE_URL}/how-it-works`,
    body
  }));
});

// FAQ page — common questions, with FAQPage structured data.
router.get('/faq', (req, res) => {
  const faqs = [
    ['Is Dragon Dysgu really free?', 'Yes — Dragon Dysgu is completely free to use, with no subscriptions, ads, or paywalls. Our goal is to make Welsh accessible to everyone.'],
    ['What is spaced repetition?', 'Spaced repetition is a learning technique where you review information at gradually increasing intervals. Cards you find easy are shown less often, while cards you struggle with appear more frequently — helping you learn efficiently and retain words long-term.'],
    ['Do I need to know any Welsh to start?', 'No. The Beginner decks start with everyday greetings and basic vocabulary, so complete beginners can jump straight in.'],
    ['How many words and topics are covered?', 'The platform currently covers thousands of flashcards across more than 90 topic decks, including grammar topics like mutations, verb conjugation, pronouns, and more — grouped into Beginner, Intermediate and Advanced levels.'],
    ['What does the daily streak mean?', 'Your streak counts the number of consecutive days you\'ve completed at least one review. It\'s a simple way to encourage consistent daily practice, which is the most effective way to learn a language.'],
    ['How many new cards do I learn per day?', 'By default, 10 new cards are introduced per day across all your decks combined, but you can change this number in your dashboard settings to suit your pace.'],
    ['Can I focus on a specific difficulty level?', 'Yes. In your study settings, you can choose your "active level" (Beginner, Intermediate or Advanced) — new cards will only be introduced from decks at that level until you choose to move on.'],
    ['Is this based on Anki?', 'Dragon Dysgu uses the same SM-2 spaced-repetition algorithm that powers Anki, one of the most popular and effective flashcard apps, but is purpose-built and pre-loaded with Welsh vocabulary.']
  ];

  const body = `
    <div class="card-panel hero">
      <h1>Frequently Asked Questions</h1>
      <p>Everything you need to know about learning Welsh with Dragon Dysgu.</p>
    </div>
    <div class="card-panel">
      ${faqs.map(([q, a]) => `<h2>${escapeHtml(q)}</h2><p>${escapeHtml(a)}</p>`).join('')}
      <p><a class="btn" href="/">Get Started Free</a></p>
    </div>
  `;

  res.send(layout({
    title: 'FAQ — Dragon Dysgu | Free Welsh Learning Platform',
    description: 'Frequently asked questions about Dragon Dysgu: spaced repetition, daily streaks, levels, vocabulary coverage, and more.',
    canonical: `${SITE_URL}/faq`,
    body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map(([q, a]) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a }
      }))
    }
  }));
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
      <p>Explore every Welsh vocabulary topic available on Dragon Dysgu, from everyday greetings to advanced grammar and mutations. Click a deck to preview the words, or <a href="/">create a free account</a> to study them with spaced repetition and track your progress.</p>
      ${sections}
    </div>
  `;

  res.send(layout({
    title: 'Browse Welsh Vocabulary Decks | Dragon Dysgu',
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
    title: `${deck.name} — ${deck.level} Welsh Vocabulary | Dragon Dysgu`,
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
        name: 'Dragon Dysgu',
        url: SITE_URL
      }
    }
  }));
});

module.exports = router;
