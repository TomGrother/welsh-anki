const express = require('express');
const db = require('../db');
const { ACHIEVEMENTS } = require('../achievements');

const router = express.Router();

const SITE_URL = process.env.SITE_URL || 'https://dragon-lingo.com';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layout({ title, description, canonical, body, jsonLd }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<script>document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'dark');</script>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE_URL}/og-image.png">
<meta property="og:locale" content="en_GB">
<meta property="og:site_name" content="Dragon Lingo">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${SITE_URL}/og-image.png">
<link rel="icon" type="image/svg+xml" href="/dragon-icon.svg">
<link rel="stylesheet" href="/style.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head>
<body>
<header>
  <a href="/" class="brand" style="text-decoration:none;color:inherit"><img class="dragon" src="/dragon-icon.svg" alt=""> Dragon Lingo <span class="beta-sticker">Beta</span></a>
  <button class="nav-toggle" onclick="document.getElementById('site-nav').classList.toggle('nav-open');document.getElementById('site-nav-backdrop').classList.toggle('nav-open')" aria-label="Toggle navigation">☰</button>
  <nav id="site-nav">
    <a class="nav-link" href="/about">About</a>
    <a class="nav-link" href="/how-it-works">How It Works</a>
    <a class="nav-link" href="/faq">FAQ</a>
    <a class="btn" href="/">Start Learning Free</a>
  </nav>
  <div class="nav-backdrop" id="site-nav-backdrop" onclick="document.getElementById('site-nav').classList.remove('nav-open');this.classList.remove('nav-open')"></div>
</header>
<main>
${body}
</main>
<footer>
  Dragon Lingo — Open source Welsh vocabulary trainer.
  <nav class="footer-links">
    <a href="/about">About</a>
    <a href="/how-it-works">How It Works</a>
    <a href="/faq">FAQ</a>
    <a href="/">Sign up free</a>
  </nav>
</footer>
</body>
</html>`;
}

// Sitemap including the homepage and static info pages.
router.get('/sitemap.xml', (req, res) => {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE_URL}/`, priority: '1.0', changefreq: 'weekly' },
    { loc: `${SITE_URL}/about`, priority: '0.8', changefreq: 'monthly' },
    { loc: `${SITE_URL}/how-it-works`, priority: '0.8', changefreq: 'monthly' },
    { loc: `${SITE_URL}/faq`, priority: '0.8', changefreq: 'monthly' },
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;
  res.type('application/xml').send(xml);
});

// About page — explains the platform, its mission, and full feature set.
router.get('/about', (req, res) => {
  const totals = db.prepare(`
    SELECT (SELECT COUNT(*) FROM cards) AS cards, (SELECT COUNT(*) FROM decks WHERE owner_id IS NULL) AS decks
  `).get();

  const body = `
    <div class="card-panel hero">
      <h1>About Dragon Lingo</h1>
      <p>Dragon Lingo is a free, open vocabulary and grammar trainer built to help anyone — from complete beginners to fluent speakers brushing up before a job interview, exam, or visit home — learn the Welsh language using proven spaced-repetition techniques.</p>
    </div>

    <div class="card-panel">
      <h2>Our Mission</h2>
      <p>Welsh (Cymraeg) is a living, official language spoken by hundreds of thousands of people in Wales and around the world, and central to the identity, culture and history of Wales. We believe everyone — whether you're a complete beginner, a Welsh learner brushing up for GCSE or A-Level, a parent learning alongside your children, or someone reconnecting with family heritage — should have free access to high-quality tools for learning it.</p>
      <p>Dragon Lingo combines a comprehensive vocabulary database — currently ${totals.cards.toLocaleString()}+ flashcards across ${totals.decks}+ topic decks — with the same SM-2 spaced-repetition algorithm used by Anki, one of the most effective memorisation tools in the world. Read our <a href="/how-it-works">How It Works</a> page for a full explanation of the science behind it.</p>

      <h2>Structured Learning, From Bore Da to Fluency</h2>
      <p>Rather than a single overwhelming word list, every deck on Dragon Lingo is organised into one of four levels, so you always know what to learn next and never feel lost:</p>
      <ul class="deck-list-seo">
        <li><strong>🌱 Beginner</strong> — greetings, numbers, family, food, colours, everyday objects, and the basic sentence patterns you need to start having simple conversations.</li>
        <li><strong>🌿 Intermediate</strong> — expanded vocabulary across dozens of everyday topics (travel, work, hobbies, health, weather, shopping), plus an introduction to Welsh grammar including soft, nasal and aspirate mutations.</li>
        <li><strong>🌳 Advanced</strong> — irregular verbs, conjugated prepositions, the conditional and future tenses, idioms, and more nuanced vocabulary for discussing opinions, current affairs, and abstract topics.</li>
        <li><strong>🐉 Fluent</strong> — sentence-based decks that combine vocabulary you've already learned into natural, idiomatic Welsh phrases and conversations, helping you bridge the gap from "knowing words" to "speaking Welsh".</li>
      </ul>

      <h2>Everything You Get, For Free</h2>
      <ul class="deck-list-seo">
        <li><strong>Smart spaced-repetition scheduling</strong> — the SM-2 algorithm decides exactly when each word should resurface based on how well you knew it last time.</li>
        <li><strong>Typed answer mode</strong> — instead of just flipping a card, type the Welsh translation from memory for a stricter test of recall and spelling.</li>
        <li><strong>Daily streaks</strong> — track your current and longest streaks to build a sustainable daily habit.</li>
        <li><strong>Progress heatmaps</strong> — a GitHub-style view of your reviews and new words learned over the last 17 weeks, plus a breakdown of how often you rate cards Again, Hard, Good or Easy.</li>
        <li><strong>Achievements &amp; badges</strong> — unlock over ${ACHIEVEMENTS.length} badges for streaks, vocabulary milestones, review counts and completed topics.</li>
        <li><strong>Friends &amp; leaderboards</strong> — add friends and compare streaks and progress on a friendly leaderboard.</li>
        <li><strong>Your own personal decks</strong> — create private decks of your own words and phrases (e.g. for work, family, or a holiday) that only you can see.</li>
        <li><strong>Printable cheatsheets</strong> — generate a print-friendly vocabulary sheet for any topic in one click.</li>
        <li><strong>Random &amp; focused practice</strong> — revisit completed topics for fun, or drill specifically into the words you find hardest.</li>
        <li><strong>Dark mode</strong> — study comfortably day or night.</li>
        <li><strong>Completely free</strong> — no subscriptions, no ads, no paywalls, ever.</li>
      </ul>

      <h2>Who Is It For?</h2>
      <p>Dragon Lingo is designed for anyone learning Welsh as a second language, whether through Welsh-medium education, an evening class, a workplace Cymraeg scheme, Duolingo-style apps, or self-study. It works equally well as a standalone course for absolute beginners, or as a vocabulary "gym" to run alongside a more formal course — many learners use Dragon Lingo for 5–10 minutes a day to reinforce what they're learning elsewhere.</p>

      <p><a class="btn" href="/">Get Started Free</a></p>
    </div>
  `;

  res.send(layout({
    title: 'About Dragon Lingo | Free Welsh Learning Platform',
    description: `Learn about Dragon Lingo, a free platform for learning Welsh with ${totals.cards.toLocaleString()}+ spaced-repetition flashcards across ${totals.decks}+ topics, from Beginner to Fluent — plus achievements, streaks, friends and more.`,
    canonical: `${SITE_URL}/about`,
    body
  }));
});

// How It Works page — deep dive into SM-2, levels, and every feature.
router.get('/how-it-works', (req, res) => {
  const body = `
    <div class="card-panel hero">
      <h1>How Dragon Lingo Works</h1>
      <p>Learn Welsh efficiently using spaced repetition — a scientifically proven technique that shows you words at increasing intervals, right before you're likely to forget them. Here's exactly how the platform takes you from your first login to fluent recall.</p>
    </div>

    <div class="card-panel">
      <h2>1. Create a Free Account</h2>
      <p>Sign up in seconds with just a username, email and password. Your progress, streaks, achievements and review schedule are saved to your account, so you can study from your phone, tablet or laptop and always pick up exactly where you left off.</p>

      <h2>2. Choose Your Level &amp; Pace</h2>
      <p>Decks are organised into four levels — <strong>Beginner</strong>, <strong>Intermediate</strong>, <strong>Advanced</strong> and <strong>Fluent</strong> — covering everything from everyday greetings to soft mutations, conjugated prepositions, and natural conversational Welsh. During sign-up you'll choose how many <strong>new words per day</strong> you'd like to learn — Relaxed (5), Steady (10), Brisk (20) or Intensive (40). This single setting controls how quickly new vocabulary is introduced, which keeps your future review workload predictable and manageable. You can change it anytime from the Settings page.</p>

      <h2>3. Study with Flashcards</h2>
      <p>Before each session starts, you'll be asked whether you want <strong>Typed Mode</strong> for that session. Choose <strong>Normal Mode</strong> and each card shows the Welsh word or phrase first — try to recall the English translation, then flip the card to reveal the answer along with an example sentence in context. Choose <strong>Typed Mode</strong> and every card in the session shows the English meaning first, and you type the Welsh word or phrase from memory, including correct spelling and any mutations.</p>
      <p>After answering, rate how well you knew it:</p>
      <ul class="deck-list-seo">
        <li><strong>Again</strong> — you didn't know it. The card is moved to the back of your current queue (or repeated immediately if it's the only card left) so you'll see it again before the session ends, and its SM-2 schedule resets to come back the next day.</li>
        <li><strong>Hard</strong> — you knew it, but it took effort. The next review comes a little sooner than normal.</li>
        <li><strong>Good</strong> — a normal, confident recall. The interval grows steadily.</li>
        <li><strong>Easy</strong> — instant recall. The interval grows even faster, so you spend less time on words you've mastered.</li>
      </ul>

      <h2>4. The Science: How the SM-2 Algorithm Schedules Your Reviews</h2>
      <p>Dragon Lingo uses <strong>SM-2</strong>, the spaced-repetition algorithm originally developed for SuperMemo in the late 1980s and later popularised by Anki — widely considered one of the most effective methods for long-term vocabulary retention. Here's what happens behind the scenes every time you review a card:</p>
      <ul class="deck-list-seo">
        <li>Every card you've started has an <strong>ease factor</strong> (how easy you generally find it, starting at 2.5) and an <strong>interval</strong> (how many days until it's due again).</li>
        <li>When you rate a card <strong>Good</strong> or <strong>Easy</strong>, the interval is multiplied by the ease factor — so a card you find easy might jump from a 1-day interval to a 6-day interval, then to a 16-day interval, then a month, and so on, growing further apart each time.</li>
        <li>Rating a card <strong>Easy</strong> also nudges its ease factor up slightly, so that card grows its intervals even faster in future — you'll see it less and less as it moves into your long-term memory.</li>
        <li>Rating a card <strong>Hard</strong> slightly reduces the ease factor and grows the interval more conservatively, so tricky words are reviewed a bit more often.</li>
        <li>Rating a card <strong>Again</strong> resets its interval back to one day and lowers its ease factor — the card effectively becomes "new" again and becomes due tomorrow.</li>
        <li>Whenever an interval is one day or longer, the due date is set to <strong>midnight</strong> of the target day rather than the exact time you reviewed it — so a card reviewed at 11pm becomes due as soon as the new day starts, not 24 hours later.</li>
      </ul>
      <p>The net effect is a review queue that's always focused on exactly the words you're at risk of forgetting <em>today</em> — no more, no less. Words you find easy quickly fade into occasional refreshers measured in months, while words you find tricky keep reappearing until they stick. This is far more efficient than re-reading a vocabulary list from the top every time, because your study time is concentrated on your weak spots rather than wasted re-confirming things you already know.</p>

      <h2>5. New Cards vs. Reviews</h2>
      <p>Each study session blends two types of card: <strong>reviews</strong> (cards you've seen before that are now due, scheduled by SM-2) and <strong>new cards</strong> (words you haven't studied yet, introduced at the daily pace you chose at sign-up or set in Settings). Once you've reached your daily new-card limit, a session will only contain reviews — this keeps your workload predictable and stops your review queue from spiralling out of control after a big study session.</p>

      <h2>6. Build a Daily Streak</h2>
      <p>Studying a little every day is far more effective for long-term memory than cramming occasionally — this is sometimes called the "spacing effect". Dragon Lingo tracks your <strong>current streak</strong> (consecutive days you've completed at least one review) and your <strong>longest streak ever</strong>, both shown on your dashboard, to help keep you motivated and consistent.</p>

      <h2>7. Unlock Achievements</h2>
      <p>As you study, you'll automatically unlock <strong>achievement badges</strong> — for reaching streak milestones (3, 7, 30, 100, even 365 days), learning vocabulary milestones (10 up to 1,500+ words), completing review-count milestones, and finishing entire topic decks. Visit the Achievements page any time to see which badges you've earned and which are still locked.</p>

      <h2>8. Add Friends &amp; Compete on the Leaderboard</h2>
      <p>Search for friends by username, send a friend request, and once accepted you'll both appear on each other's leaderboard — ranked by current streak, with longest streak, words learned and total reviews shown alongside. A bit of friendly competition is a great way to stay accountable.</p>

      <h2>9. Create Your Own Personal Decks</h2>
      <p>Beyond the built-in topic decks, you can create your own private decks — perfect for vocabulary specific to your job, your family, a holiday, or anything that isn't covered by the standard topics. These decks are visible only to you, but study and SM-2 scheduling work exactly the same way as the built-in decks.</p>

      <h2>10. Print Cheatsheets &amp; Track Your Progress</h2>
      <p>Every deck has a one-click "print cheatsheet" option that generates a clean, printable table of all the words, translations, notes and example sentences in that topic — handy for revision away from a screen. Meanwhile, your Progress page shows GitHub-style activity heatmaps of your reviews and new words learned over the last 17 weeks, plus a breakdown of how often you rate cards Again, Hard, Good or Easy, so you can see exactly how your Welsh is improving over time.</p>

      <h2>11. Extra Practice Modes</h2>
      <p>Once you've completed a topic, unlock <strong>Random Study</strong> to revisit its words for fun outside the normal SM-2 schedule, or use <strong>Hard Words</strong> mode to drill specifically into the cards you've found most difficult (lowest ease factor, or ones you've recently pressed "Again" on).</p>

      <p><a class="btn" href="/">Start Learning Now</a></p>
    </div>
  `;

  res.send(layout({
    title: 'How It Works — Spaced Repetition for Learning Welsh | Dragon Lingo',
    description: 'A deep dive into how Dragon Lingo works: the SM-2 spaced-repetition algorithm explained, levelled decks from Beginner to Fluent, typed answer mode, daily streaks, achievements, friends, personal decks, and progress tracking.',
    canonical: `${SITE_URL}/how-it-works`,
    body
  }));
});

// FAQ page — common questions, with FAQPage structured data.
router.get('/faq', (req, res) => {
  const faqs = [
    ['Is Dragon Lingo really free?', 'Yes — Dragon Lingo is completely free to use, with no subscriptions, ads, or paywalls. Our goal is to make Welsh accessible to everyone.'],
    ['What is spaced repetition?', 'Spaced repetition is a learning technique where you review information at gradually increasing intervals. Cards you find easy are shown less often, while cards you struggle with appear more frequently — helping you learn efficiently and retain words long-term. See our How It Works page for a full explanation of the SM-2 algorithm that powers this.'],
    ['What exactly is the SM-2 algorithm?', 'SM-2 is the spaced-repetition algorithm originally created for SuperMemo and later used by Anki. After every review, it adjusts two numbers for that card: an "ease factor" (how easy you generally find it) and an "interval" (days until the next review). Rating a card Easy or Good grows the interval — often multiplying it — so well-known words are reviewed less and less often, while rating it Hard or Again shortens the interval so weak words come back around sooner.'],
    ['Do I need to know any Welsh to start?', 'No. The Beginner decks start with everyday greetings and basic vocabulary, so complete beginners can jump straight in. If you already speak some Welsh, you can set your active level to Intermediate, Advanced or even Fluent and skip ahead.'],
    ['How many words and topics are covered?', 'The platform covers thousands of flashcards across over 100 topic decks, including grammar topics like mutations, verb conjugation, conjugated prepositions and idioms — grouped into Beginner, Intermediate, Advanced and Fluent levels.'],
    ['What is the "Fluent" level?', 'Fluent decks are sentence-based rather than single-word — they combine vocabulary from the earlier levels into natural, idiomatic Welsh phrases and short conversations, helping bridge the gap between knowing individual words and actually speaking Welsh.'],
    ['What does the daily streak mean?', 'Your streak counts the number of consecutive days you\'ve completed at least one review. It\'s a simple way to encourage consistent daily practice, which is the most effective way to learn a language. Your longest-ever streak is also recorded, and several achievement badges are tied to streak milestones.'],
    ['How many new cards do I learn per day?', 'You choose this when you sign up — Relaxed (5), Steady (10, recommended), Brisk (20) or Intensive (40) new cards per day. This caps how many brand-new words are introduced each day so your future reviews stay manageable, and you can change it anytime from the Settings page.'],
    ['Can I focus on a specific difficulty level?', 'Yes. In your study settings, you can choose your "active level" (Beginner, Intermediate, Advanced or Fluent) — new cards will only be introduced from decks at that level until you choose to move on.'],
    ['Is this based on Anki?', 'Dragon Lingo uses the same SM-2 spaced-repetition algorithm that powers Anki, one of the most popular and effective flashcard apps, but is purpose-built and pre-loaded with Welsh vocabulary and grammar.'],
    ['What is Typed Mode?', 'Before each study session starts, you\'re asked whether you want Typed Mode for that session. If you choose it, every card shows the English meaning first and you type the Welsh word or phrase from memory, including spelling and mutations — a stricter test of recall than simple recognition. If you choose Normal Mode, cards show the Welsh side first as usual.'],
    ['What happens if I press "Again" on a card?', 'The card is moved to the back of your current session\'s queue, so other due cards come first — but it\'ll come back round before the session ends. If it\'s the only card left in the session, it\'ll keep reappearing until you rate it Hard, Good or Easy. Its SM-2 schedule also resets so it\'s due again tomorrow.'],
    ['What are achievements and badges?', 'As you study, you automatically unlock badges for milestones such as reaching a streak of 3, 7, 30, 100 or even 365 days; learning your 10th, 100th, 500th or 1,000th+ word; completing thousands of reviews; and finishing entire topic decks. You can view all your earned and locked badges on the Achievements page.'],
    ['Can I add friends and compare progress?', 'Yes. From the Friends page you can search for other users by username and send a friend request. Once accepted, you\'ll both appear on each other\'s leaderboard, ranked by current streak alongside longest streak, words learned and total reviews.'],
    ['Can I create my own flashcards?', 'Yes. Any user can create their own personal decks from the dashboard and add their own Welsh/English word pairs with optional notes. These personal decks are private — only you can see and study them — but they use exactly the same spaced-repetition scheduling as the built-in decks.'],
    ['Can I print a vocabulary list?', 'Yes — every deck has a "print cheatsheet" button that opens a clean, printable page listing every word, its translation, and any notes or example sentences for that topic.'],
    ['What is Random Study and Hard Words mode?', 'Once you\'ve completed every card in a topic, Random Study lets you revisit its words for casual extra practice outside the normal spaced-repetition schedule. Hard Words mode pulls together the cards you\'ve found most difficult across all your decks — those with a low ease factor, or that you\'ve recently marked "Again" — so you can drill your weak spots directly.'],
    ['Does Dragon Lingo have a dark mode?', 'Yes — use the dark mode toggle in the navigation bar to switch between light and dark themes. Your preference is remembered automatically for next time.'],
    ['I forgot my password — what do I do?', 'On the login screen, click "Forgotten your password?" and enter your account email. You\'ll be sent a secure link to choose a new password.']
  ];

  const body = `
    <div class="card-panel hero">
      <h1>Frequently Asked Questions</h1>
      <p>Everything you need to know about learning Welsh with Dragon Lingo — spaced repetition, levels, streaks, achievements, friends, personal decks and more.</p>
    </div>
    <div class="card-panel">
      ${faqs.map(([q, a]) => `<h2>${escapeHtml(q)}</h2><p>${escapeHtml(a)}</p>`).join('')}
      <p><a class="btn" href="/">Get Started Free</a></p>
    </div>
  `;

  res.send(layout({
    title: 'FAQ — Dragon Lingo | Free Welsh Learning Platform',
    description: 'Frequently asked questions about Dragon Lingo: how the SM-2 spaced-repetition algorithm works, daily streaks, achievements, friends and leaderboards, personal decks, typed answer mode, printable cheatsheets and more.',
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

module.exports = router;
