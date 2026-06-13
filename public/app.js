const API = '/api';
let state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  collapsedLevels: JSON.parse(localStorage.getItem('collapsedLevels') || '{"Beginner":true,"Intermediate":true,"Advanced":true,"Fluent":true}'),
  queue: [],
  queueIndex: 0,
  flipped: false,
  decks: [],
  typedMode: localStorage.getItem('typedMode') === '1'
};

function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  if (opts.body) headers['Content-Type'] = 'application/json';
  return fetch(API + path, { ...opts, headers }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  });
}

function renderNav() {
  const nav = document.getElementById('nav');
  if (state.user) {
    nav.innerHTML = `
      <span style="margin-right:0.5rem">${state.user.username}</span>
      <button class="btn-outline" onclick="showView('achievements')">🏆 Achievements</button>
      <button class="btn-outline" onclick="showView('friends')">👥 Friends</button>
      <button class="btn-outline" onclick="showView('settings')">⚙️ Settings</button>
      ${state.user.is_admin ? '<button class="btn-outline" onclick="showView(\'admin\')">Admin</button>' : ''}
      <button class="btn-outline" id="theme-toggle" onclick="toggleTheme()" title="Toggle dark mode"></button>
      <button class="btn-outline" onclick="logout()">Log Out</button>
    `;
  } else {
    nav.innerHTML = `
      <a class="nav-link" href="/about">About</a>
      <a class="nav-link" href="/how-it-works">How It Works</a>
      <a class="nav-link" href="/faq">FAQ</a>
      <button class="btn-outline" id="theme-toggle" onclick="toggleTheme()" title="Toggle dark mode"></button>
      <button class="btn-outline" onclick="showView('login')">Log In</button>
      <button class="btn" onclick="showView('register')">Sign Up</button>
    `;
  }
  syncThemeToggle();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  syncThemeToggle();
}

function syncThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  btn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function goHome() {
  showView(state.user ? 'dashboard' : 'home');
}

function toggleNav() {
  document.getElementById('nav').classList.toggle('nav-open');
  document.getElementById('nav-backdrop').classList.toggle('nav-open');
}

function showView(name) {
  document.getElementById('nav').classList.remove('nav-open');
  document.getElementById('nav-backdrop').classList.remove('nav-open');
  document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
  document.getElementById('view-' + name).classList.remove('hidden');
  if (name === 'dashboard') loadDashboard();
  if (name === 'admin') loadAdmin();
  if (name === 'progress') loadProgress();
  if (name === 'achievements') loadAchievements();
  if (name === 'friends') loadFriends();
  if (name === 'settings') loadSettings();
}

function logout() {
  state.token = null; state.user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user');
  renderNav();
  showView('home');
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const new_cards_per_day = parseInt(document.getElementById('reg-new-cards').value, 10);
  const level = document.getElementById('reg-level').value;
  try {
    const data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, new_cards_per_day, level }) });
    onAuthSuccess(data);
  } catch (err) {
    document.getElementById('reg-error').textContent = err.message;
  }
  return false;
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value.trim();
  const errorEl = document.getElementById('forgot-error');
  const successEl = document.getElementById('forgot-success');
  errorEl.textContent = '';
  successEl.textContent = '';
  try {
    const data = await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    successEl.textContent = data.message;
  } catch (err) {
    errorEl.textContent = err.message;
  }
  return false;
}

async function handleResetPassword(e) {
  e.preventDefault();
  const password = document.getElementById('reset-password').value;
  const errorEl = document.getElementById('reset-error');
  const successEl = document.getElementById('reset-success');
  errorEl.textContent = '';
  successEl.textContent = '';
  try {
    await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: state.resetToken, password }) });
    successEl.textContent = 'Password updated. You can now log in.';
    setTimeout(() => showView('login'), 1500);
  } catch (err) {
    errorEl.textContent = err.message;
  }
  return false;
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    onAuthSuccess(data);
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
  }
  return false;
}

function onAuthSuccess(data) {
  state.token = data.token; state.user = data.user;
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
  renderNav();
  showView('dashboard');
}

// --- Settings ---
async function loadSettings() {
  const { user } = await api('/auth/me');
  document.getElementById('settings-new-cards').value = user.new_cards_per_day;
  document.getElementById('settings-success').textContent = '';
  document.getElementById('settings-error').textContent = '';
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const new_cards_per_day = parseInt(document.getElementById('settings-new-cards').value, 10);
  const successEl = document.getElementById('settings-success');
  const errorEl = document.getElementById('settings-error');
  successEl.textContent = '';
  errorEl.textContent = '';
  try {
    await api('/auth/me/settings', { method: 'PUT', body: JSON.stringify({ new_cards_per_day }) });
    successEl.textContent = 'Settings saved!';
  } catch (err) {
    errorEl.textContent = err.message;
  }
  return false;
}

// --- Dashboard ---
async function loadDashboard() {
  document.getElementById('dash-username').textContent = state.user.username;
  try {
    const stats = await api('/study/stats');
    document.getElementById('stat-streak').textContent = stats.current_streak;
    document.getElementById('stat-longest').textContent = stats.longest_streak;
    document.getElementById('stat-due').textContent = stats.due_now;
    document.getElementById('stat-learned').textContent = stats.learned_cards;

    const { decks } = await api('/study/decks');
    state.decks = decks;
    renderDeckList();
  } catch (err) {
    if (err.message.includes('expired') || err.message.includes('authenticated')) logout();
  }
}

function toggleLevelSection(level) {
  state.collapsedLevels = state.collapsedLevels || {};
  state.collapsedLevels[level] = !state.collapsedLevels[level];
  localStorage.setItem('collapsedLevels', JSON.stringify(state.collapsedLevels));
  renderDeckList();
}

function renderDeckList() {
  const list = document.getElementById('deck-list');
  const levels = ['Beginner', 'Intermediate', 'Advanced', 'Fluent', 'My Decks'];
  const icons = { Beginner: '🌱', Intermediate: '🌿', Advanced: '🌳', Fluent: '🐉', 'My Decks': '📝' };
  const query = (document.getElementById('deck-search')?.value || '').trim().toLowerCase();
  const decks = query
    ? state.decks.filter(d => d.name.toLowerCase().includes(query) || (d.description || '').toLowerCase().includes(query))
    : state.decks;

  if (state.decks.length === 0) {
    list.innerHTML = '<p class="muted">No decks yet.</p>';
    return;
  }
  if (decks.length === 0) {
    list.innerHTML = '<p class="muted">No topics match your search.</p>';
    return;
  }

  list.innerHTML = levels.map(level => {
    const levelDecks = decks.filter(d => (d.level || 'Beginner') === level);
    if (levelDecks.length === 0) return '';
    const totalCards = levelDecks.reduce((s, d) => s + d.total_cards, 0);
    const totalPct = totalCards > 0
      ? Math.round(levelDecks.reduce((s, d) => s + (d.progress_pct * d.total_cards), 0) / totalCards)
      : 0;
    const collapsed = state.collapsedLevels && state.collapsedLevels[level];
    return `
      <div class="level-section">
        <div class="level-heading" onclick="toggleLevelSection('${level}')">
          <span class="level-toggle">${collapsed ? '▶' : '▼'}</span>
          <h3>${icons[level]} ${level}</h3>
          <span class="level-pill ${level}">${levelDecks.length} decks</span>
          <div class="level-progress" title="${totalPct}% complete">
            <div class="level-progress-bar" style="width:${totalPct}%"></div>
          </div>
          <span class="level-progress-pct">${totalPct}%</span>
        </div>
        <div class="deck-list" ${collapsed ? 'style="display:none"' : ''}>
          ${levelDecks.map(d => `
            <div class="deck-item ${d.locked ? 'deck-locked' : ''}">
              <span class="status-dot ${d.locked ? 'status-locked' : d.completed ? 'status-done' : d.in_progress ? 'status-progress' : 'status-new'}" title="${d.locked ? 'Locked' : d.completed ? 'Completed' : d.in_progress ? 'In Progress' : 'Not Started'}"></span>
              <div class="deck-info">
                <div class="deck-name">${escapeHtml(d.name)} ${d.locked ? '<span class="status-badge status-locked">🔒 Locked</span>' : d.completed ? '<span class="status-badge status-done">Completed</span>' : d.in_progress ? '<span class="status-badge status-progress">In Progress</span>' : ''}</div>
                <div class="deck-meta">${d.total_cards} words — ${escapeHtml(d.locked ? 'Complete the previous topic to unlock' : (d.description || ''))}</div>
              </div>
              <div class="flex-row">
                <button class="btn-outline icon-btn" onclick="printCheatsheet(${d.id})" title="Print a cheatsheet for this topic">🖨️</button>
                ${d.is_own ? `<button class="btn-outline icon-btn" onclick="openMyDeck(${d.id})" title="Manage words">✏️</button>
                  <button class="btn-danger icon-btn" onclick="deleteMyDeck(${d.id})" title="Delete this deck">🗑️</button>` : ''}
                ${d.locked
                  ? `<button class="btn" disabled title="Complete the previous topic to unlock">🔒 Locked</button>`
                  : d.total_cards === 0
                  ? `<button class="btn" disabled title="Add some words first">Study</button>`
                  : `<button class="btn" onclick="startStudy(${d.id}, true)" title="Review any word from this topic, any time">Study</button>`}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// --- My Decks ---
function toggleNewDeckForm() {
  document.getElementById('new-deck-form').classList.toggle('hidden');
}

async function createMyDeck(e) {
  e.preventDefault();
  const name = document.getElementById('new-deck-name').value.trim();
  const description = document.getElementById('new-deck-desc').value.trim();
  if (!name) return false;
  await api('/study/decks', { method: 'POST', body: JSON.stringify({ name, description }) });
  document.getElementById('new-deck-name').value = '';
  document.getElementById('new-deck-desc').value = '';
  document.getElementById('new-deck-form').classList.add('hidden');
  await loadDashboard();
  return false;
}

async function deleteMyDeck(id) {
  if (!confirm('Delete this deck and all its words?')) return;
  await api('/study/decks/' + id, { method: 'DELETE' });
  await loadDashboard();
}

async function openMyDeck(id) {
  state.myDeckId = id;
  showView('mydeck');
  await loadMyDeck();
}

async function loadMyDeck() {
  const { deck, cards } = await api(`/study/decks/${state.myDeckId}/cards`);
  document.getElementById('mydeck-name').textContent = `✏️ ${deck.name}`;
  document.querySelector('#mydeck-table tbody').innerHTML = cards.length === 0
    ? '<tr><td colspan="4" class="muted">No words yet — add your first one above.</td></tr>'
    : cards.map(c => `
      <tr>
        <td>${escapeHtml(c.welsh)}</td>
        <td>${escapeHtml(c.english)}</td>
        <td>${escapeHtml(c.notes || '')}</td>
        <td><button class="btn-danger" onclick="deleteMyCard(${c.id})">Delete</button></td>
      </tr>
    `).join('');
}

async function addMyCard(e) {
  e.preventDefault();
  const welsh = document.getElementById('mydeck-welsh').value.trim();
  const english = document.getElementById('mydeck-english').value.trim();
  const notes = document.getElementById('mydeck-notes').value.trim();
  if (!welsh || !english) return false;
  await api(`/study/decks/${state.myDeckId}/cards`, { method: 'POST', body: JSON.stringify({ welsh, english, notes }) });
  document.getElementById('mydeck-welsh').value = '';
  document.getElementById('mydeck-english').value = '';
  document.getElementById('mydeck-notes').value = '';
  await loadMyDeck();
  return false;
}

function toggleMyDeckImport() {
  document.getElementById('mydeck-import').classList.toggle('hidden');
}

async function importMyDeckCards() {
  const resultEl = document.getElementById('mydeck-import-result');
  resultEl.textContent = '';
  let cards;
  try {
    cards = JSON.parse(document.getElementById('mydeck-import-json').value);
    if (!Array.isArray(cards)) throw new Error('Expected a JSON array');
  } catch (err) {
    resultEl.style.color = 'var(--welsh-red)';
    resultEl.textContent = 'Invalid JSON: ' + err.message;
    return;
  }
  try {
    const data = await api(`/study/decks/${state.myDeckId}/import`, { method: 'POST', body: JSON.stringify({ cards }) });
    resultEl.style.color = '';
    resultEl.textContent = `Imported ${data.imported} word(s).`;
    document.getElementById('mydeck-import-json').value = '';
    await loadMyDeck();
  } catch (err) {
    resultEl.style.color = 'var(--welsh-red)';
    resultEl.textContent = err.message;
  }
}

async function deleteMyCard(id) {
  await api('/study/cards/' + id, { method: 'DELETE' });
  await loadMyDeck();
}

// --- Cheatsheets ---
async function printCheatsheet(deckId) {
  const { deck, cards } = await api(`/study/decks/${deckId}/cards`);
  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${escapeHtml(deck.name)} — Cheatsheet — Dragon Lingo</title>
      <style>
        body { font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; padding: 2rem; color: #1a202c; }
        h1 { margin-bottom: 0.2rem; }
        .desc { color: #718096; margin-bottom: 1.5rem; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 0.5rem 0.7rem; border-bottom: 1px solid #e6eaf0; font-size: 0.95rem; vertical-align: top; }
        th { text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.06em; color: #718096; }
        .example { color: #718096; font-size: 0.85rem; margin-top: 0.2rem; }
        @media print { body { padding: 0.5rem; } }
      </style>
    </head>
    <body>
      <h1>🐉 ${escapeHtml(deck.name)}</h1>
      <div class="desc">${escapeHtml(deck.description || '')} — ${cards.length} words — Dragon Lingo</div>
      <table>
        <thead><tr><th>Welsh</th><th>English</th><th>Notes / Example</th></tr></thead>
        <tbody>
          ${cards.map(c => `
            <tr>
              <td>${escapeHtml(c.welsh)}</td>
              <td>${escapeHtml(c.english)}</td>
              <td>
                ${c.notes ? escapeHtml(c.notes) : ''}
                ${c.example_welsh ? `<div class="example">${escapeHtml(c.example_welsh)}<br>${escapeHtml(c.example_english || '')}</div>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

// --- Progress ---
async function loadProgress() {
  const { days, quality } = await api('/study/history');

  renderHeatmap('chart-reviews', days, 'reviews', 'green');
  renderHeatmap('chart-new', days, 'new_cards', 'blue');

  const labels = { 0: 'Again', 3: 'Hard', 4: 'Good', 5: 'Easy' };
  const classes = { 0: 'btn-again', 3: 'btn-hard', 4: 'btn-good', 5: 'btn-easy' };
  const totalQ = quality.reduce((s, q) => s + q.count, 0) || 1;
  const qMap = Object.fromEntries(quality.map(q => [q.quality, q.count]));
  document.getElementById('chart-quality').innerHTML = Object.entries(labels).map(([q, label]) => {
    const count = qMap[q] || 0;
    const pct = Math.round((count / totalQ) * 100);
    return `
      <div class="quality-row">
        <span class="quality-label">${label}</span>
        <div class="quality-track"><div class="quality-fill ${classes[q]}" style="width:${pct}%"></div></div>
        <span class="quality-count">${count} (${pct}%)</span>
      </div>
    `;
  }).join('');

  const { words } = await api('/study/learned-words');
  state.learnedWords = words;
  renderLearnedWords();
}

function renderLearnedWords() {
  const words = state.learnedWords || [];
  const search = (document.getElementById('learned-search').value || '').trim().toLowerCase();
  const filtered = search
    ? words.filter(w => w.welsh.toLowerCase().includes(search) || w.english.toLowerCase().includes(search))
    : words;

  document.getElementById('learned-count').textContent = `(${words.length})`;
  document.getElementById('learned-empty').style.display = words.length === 0 ? 'block' : 'none';
  document.getElementById('learned-words-table').style.display = words.length === 0 ? 'none' : '';

  document.getElementById('learned-words-body').innerHTML = filtered.map(w => `
    <tr>
      <td>${escapeHtml(w.welsh)}</td>
      <td>${escapeHtml(w.english)}</td>
      <td>${escapeHtml(w.deck_name)}</td>
    </tr>
  `).join('');
}

// Renders a GitHub-style activity heatmap: weeks as columns, days (Sun-Sat) as rows.
function renderHeatmap(elId, days, key, color) {
  const cells = [];
  const firstDay = new Date(days[0].day + 'T00:00:00Z').getUTCDay();
  for (let i = 0; i < firstDay; i++) cells.push(null);
  days.forEach(d => cells.push(d));

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const max = Math.max(1, ...days.map(d => d[key]));
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  document.getElementById(elId).innerHTML = `
    <div class="heatmap">
      <div class="heatmap-col heatmap-labels">
        ${dayLabels.map((l, i) => `<div class="heatmap-cell heatmap-daylabel">${i % 2 === 1 ? l : ''}</div>`).join('')}
      </div>
      ${weeks.map(week => `
        <div class="heatmap-col">
          ${week.map(d => {
            if (!d) return '<div class="heatmap-cell empty"></div>';
            const level = d[key] === 0 ? 0 : Math.min(4, Math.ceil((d[key] / max) * 4));
            const date = new Date(d.day + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
            return `<div class="heatmap-cell ${color} level-${level}" title="${date}: ${d[key]}"></div>`;
          }).join('')}
        </div>
      `).join('')}
    </div>
  `;
}

// Best-effort phonetic respelling of Welsh text, using English-reader-friendly
// approximations of standard Welsh letter/sound rules. Not IPA — just a guide.
const WELSH_DIGRAPHS = [
  ['ngh', 'ng-h'], ['mh', 'm'], ['nh', 'n'], ['ng', 'ng'],
  ['ch', 'kh'], ['dd', 'th'], ['ff', 'f'], ['ll', 'hl'],
  ['ph', 'f'], ['rh', 'rh'], ['th', 'th'],
];
const WELSH_LETTERS = {
  a: 'a', â: 'ah', e: 'e', ê: 'eh', i: 'ee', î: 'ee',
  o: 'o', ô: 'oh', u: 'i', û: 'ee', w: 'oo', ŵ: 'oo',
  y: 'u', ŷ: 'ee', c: 'k', f: 'v', g: 'g', j: 'j',
};

function transcribeWelshWord(word) {
  const s = word.toLowerCase();
  let out = '';
  let i = 0;
  while (i < s.length) {
    const digraph = WELSH_DIGRAPHS.find(([from]) => s.startsWith(from, i));
    if (digraph) {
      out += digraph[1];
      i += digraph[0].length;
      continue;
    }
    const c = s[i];
    out += WELSH_LETTERS[c] !== undefined ? WELSH_LETTERS[c] : c;
    i++;
  }
  return out;
}

function welshPronunciation(text) {
  if (!text) return '';
  return text.replace(/[a-zA-Zâêîôûŵŷ]+/g, transcribeWelshWord);
}

// --- Study ---
let pendingStudyAction = null;

function promptTypedMode(action) {
  pendingStudyAction = action;
  document.getElementById('typed-mode-modal').classList.remove('hidden');
}

function chooseTypedMode(useTyped) {
  state.typedMode = useTyped;
  localStorage.setItem('typedMode', useTyped ? '1' : '0');
  syncTypedModeToggle();
  document.getElementById('typed-mode-modal').classList.add('hidden');
  const action = pendingStudyAction;
  pendingStudyAction = null;
  if (action) action();
}

function startStudy(deckId, reviewAll) {
  promptTypedMode(() => _startStudy(deckId, reviewAll));
}

async function _startStudy(deckId, reviewAll) {
  const { cards } = await api(`/study/queue?limit=20${deckId ? '&deck_id=' + deckId : ''}${reviewAll ? '&review_all=1' : ''}`);
  if (cards.length === 0) {
    showView('complete');
    const note = document.getElementById('complete-note');
    const continueBtn = document.getElementById('btn-continue-study');
    if (deckId) {
      note.textContent = "You've completed every card in this deck — nice work!";
    } else {
      note.textContent = "You're all caught up — nothing due for review right now!";
    }
    continueBtn.classList.add('hidden');
    return;
  }
  state.queue = cards;
  state.queueIndex = 0;
  state.lastDeckId = deckId || cards[cards.length - 1].deck_id;
  syncTypedModeToggle();
  showView('study');
  renderCard();
}

function startRandomStudy() {
  promptTypedMode(_startRandomStudy);
}

async function _startRandomStudy() {
  const { cards } = await api('/study/queue?limit=20&random=1');
  if (cards.length === 0) {
    showView('complete');
    document.getElementById('complete-note').textContent = "Complete a topic first to unlock random study!";
    document.getElementById('btn-continue-study').classList.add('hidden');
    return;
  }
  state.queue = cards;
  state.queueIndex = 0;
  state.lastDeckId = cards[cards.length - 1].deck_id;
  syncTypedModeToggle();
  showView('study');
  renderCard();
}

function startHardStudy() {
  promptTypedMode(_startHardStudy);
}

async function _startHardStudy() {
  const { cards } = await api('/study/queue?limit=20&hard=1');
  if (cards.length === 0) {
    showView('complete');
    document.getElementById('complete-note').textContent = "No hard words right now — nice work!";
    document.getElementById('btn-continue-study').classList.add('hidden');
    return;
  }
  state.queue = cards;
  state.queueIndex = 0;
  state.lastDeckId = cards[cards.length - 1].deck_id;
  syncTypedModeToggle();
  showView('study');
  renderCard();
}

function continueStudy() {
  if (state.lastDeckId) {
    startStudy(state.lastDeckId);
  } else {
    showView('dashboard');
  }
}

function renderCard() {
  const card = state.queue[state.queueIndex];
  state.flipped = false;
  const ex = document.getElementById('card-example');
  if (card.example_welsh) {
    ex.innerHTML = `${escapeHtml(card.example_welsh)}<br>${escapeHtml(card.example_english || '')}`;
  } else {
    ex.innerHTML = '';
  }
  ex.classList.add('hidden');
  document.getElementById('review-buttons').classList.add('hidden');

  const typedForm = document.getElementById('typed-answer-form');
  const typedResult = document.getElementById('typed-result');
  typedResult.classList.add('hidden');
  typedResult.textContent = '';

  const pron = document.getElementById('card-pronunciation');
  pron.textContent = `🔊 ${welshPronunciation(card.welsh)}`;

  if (state.typedMode) {
    document.getElementById('card-front').textContent = card.english;
    document.getElementById('card-back').textContent = card.welsh;
    document.getElementById('card-back').classList.add('hidden');
    document.getElementById('card-hint').classList.add('hidden');
    pron.classList.add('hidden');
    document.getElementById('typed-answer-input').value = '';
    typedForm.classList.remove('hidden');
    setTimeout(() => document.getElementById('typed-answer-input').focus(), 50);
  } else {
    document.getElementById('card-front').textContent = card.welsh;
    document.getElementById('card-back').textContent = card.english;
    document.getElementById('card-back').classList.add('hidden');
    document.getElementById('card-hint').classList.remove('hidden');
    pron.classList.remove('hidden');
    typedForm.classList.add('hidden');
  }

  document.getElementById('study-counter').textContent = `${state.queueIndex + 1} / ${state.queue.length}`;
  document.getElementById('study-progress').style.width = `${(state.queueIndex / state.queue.length) * 100}%`;
}

function flipCard() {
  if (state.typedMode || state.flipped) return;
  state.flipped = true;
  document.getElementById('card-back').classList.remove('hidden');
  document.getElementById('card-example').classList.remove('hidden');
  document.getElementById('card-hint').classList.add('hidden');
  document.getElementById('review-buttons').classList.remove('hidden');
}

function normalizeAnswer(str) {
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

function checkTypedAnswer(e) {
  e.preventDefault();
  if (state.flipped) return false;
  const card = state.queue[state.queueIndex];
  const given = document.getElementById('typed-answer-input').value;
  const correct = normalizeAnswer(given) === normalizeAnswer(card.welsh);

  state.flipped = true;
  document.getElementById('typed-answer-form').classList.add('hidden');
  document.getElementById('card-back').classList.remove('hidden');
  document.getElementById('card-example').classList.remove('hidden');
  document.getElementById('card-pronunciation').classList.remove('hidden');

  const result = document.getElementById('typed-result');
  result.classList.remove('hidden');
  result.textContent = correct ? '✅ Correct!' : `❌ Not quite — correct answer: ${card.welsh}`;
  result.style.color = correct ? 'var(--welsh-green-dark)' : 'var(--welsh-red)';

  document.getElementById('review-buttons').classList.remove('hidden');
  return false;
}

function syncTypedModeToggle() {
  const toggle = document.getElementById('typed-mode-toggle');
  toggle.checked = state.typedMode;
  toggle.closest('.typed-mode-label').classList.toggle('active', state.typedMode);
}

function toggleTypedMode() {
  state.typedMode = document.getElementById('typed-mode-toggle').checked;
  localStorage.setItem('typedMode', state.typedMode ? '1' : '0');
  syncTypedModeToggle();
  if (state.queue.length) renderCard();
}

async function submitReview(quality) {
  const card = state.queue[state.queueIndex];
  await api('/study/review', { method: 'POST', body: JSON.stringify({ card_id: card.id, quality }) });
  if (quality === 0) {
    if (state.queue.length > 1) {
      state.queue.splice(state.queueIndex, 1);
      state.queue.push(card);
    }
    if (state.queueIndex >= state.queue.length) state.queueIndex = 0;
    renderCard();
    return;
  }
  state.queueIndex++;
  if (state.queueIndex >= state.queue.length) {
    document.getElementById('study-progress').style.width = '100%';
    showView('complete');
  } else {
    renderCard();
  }
}

// --- Achievements ---
async function loadAchievements() {
  const { achievements } = await api('/study/achievements');
  const earned = achievements.filter(a => a.earned).length;
  document.getElementById('achievements-summary').textContent = `${earned} / ${achievements.length} unlocked`;
  document.getElementById('achievements-grid').innerHTML = achievements.map(a => `
    <div class="badge-card ${a.earned ? 'earned' : 'locked'}">
      <div class="badge-icon">${a.icon}</div>
      <div class="badge-name">${escapeHtml(a.name)}</div>
      <div class="badge-desc">${escapeHtml(a.description)}</div>
      ${a.earned ? `<div class="badge-date">Earned ${new Date(a.earned_at).toLocaleDateString()}</div>` : '<div class="badge-date">🔒 Locked</div>'}
    </div>
  `).join('');
}

// --- Friends ---
async function loadFriends() {
  const [{ friends, incoming, outgoing }, { leaderboard }] = await Promise.all([
    api('/social/friends'),
    api('/social/leaderboard')
  ]);

  const requestsEl = document.getElementById('friend-requests');
  if (incoming.length === 0 && outgoing.length === 0) {
    requestsEl.innerHTML = '';
  } else {
    requestsEl.innerHTML = `
      ${incoming.map(r => `
        <div class="friend-request">
          <span>${escapeHtml(r.username)} wants to be your friend</span>
          <div class="flex-row">
            <button class="btn" onclick="respondFriendRequest(${r.request_id}, true)">Accept</button>
            <button class="btn-outline" onclick="respondFriendRequest(${r.request_id}, false)">Decline</button>
          </div>
        </div>
      `).join('')}
      ${outgoing.map(r => `
        <div class="friend-request">
          <span>Request sent to ${escapeHtml(r.username)}</span>
          <span class="muted">Pending</span>
        </div>
      `).join('')}
    `;
  }

  const friendsEl = document.getElementById('friends-list');
  friendsEl.innerHTML = friends.length === 0
    ? '<p class="muted">No friends yet — search for a username above to add one.</p>'
    : friends.map(f => `
      <div class="friend-item">
        <span>${escapeHtml(f.username)}</span>
        <button class="btn-outline" onclick="removeFriend(${f.id})">Remove</button>
      </div>
    `).join('');

  renderLeaderboard(leaderboard);
}

function renderLeaderboard(leaderboard) {
  const tbody = document.querySelector('#leaderboard-table tbody');
  tbody.innerHTML = leaderboard.map((u, i) => `
    <tr class="${u.id === state.user.id ? 'leaderboard-you' : ''}">
      <td>${i + 1}</td>
      <td>${escapeHtml(u.username)}${u.id === state.user.id ? ' (you)' : ''}</td>
      <td>${u.current_streak} 🔥</td>
      <td>${u.longest_streak}</td>
      <td>${u.learned_cards}</td>
      <td>${u.total_reviews}</td>
    </tr>
  `).join('');
}

let friendSearchTimeout;
function onFriendSearchInput() {
  clearTimeout(friendSearchTimeout);
  friendSearchTimeout = setTimeout(friendSearch, 300);
}

async function friendSearch() {
  const q = document.getElementById('friend-search').value.trim();
  const resultsEl = document.getElementById('friend-search-results');
  if (!q) { resultsEl.innerHTML = ''; return; }
  const { users } = await api('/social/search?q=' + encodeURIComponent(q));
  resultsEl.innerHTML = users.map(u => `
    <div class="friend-item">
      <span>${escapeHtml(u.username)}</span>
      <button class="btn" onclick="sendFriendRequest('${escapeHtml(u.username)}')">Add Friend</button>
    </div>
  `).join('') || '<p class="muted">No users found.</p>';
}

async function sendFriendRequest(username) {
  const errorEl = document.getElementById('friend-error');
  errorEl.textContent = '';
  try {
    await api('/social/request', { method: 'POST', body: JSON.stringify({ username }) });
    document.getElementById('friend-search').value = '';
    document.getElementById('friend-search-results').innerHTML = '';
    await loadFriends();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function respondFriendRequest(requestId, accept) {
  await api('/social/respond', { method: 'POST', body: JSON.stringify({ request_id: requestId, accept }) });
  await loadFriends();
}

async function removeFriend(userId) {
  if (!confirm('Remove this friend?')) return;
  await api('/social/remove', { method: 'POST', body: JSON.stringify({ user_id: userId }) });
  await loadFriends();
}

// --- Admin ---
async function loadAdmin() {
  await Promise.all([loadAdminDecks(), loadAdminCards(), loadAdminUsers()]);
}

function adminTab(name) {
  ['decks', 'cards', 'import', 'users'].forEach(t => {
    document.getElementById('admin-' + t).classList.toggle('hidden', t !== name);
    document.getElementById('tab-' + t).classList.toggle('active', t === name);
  });
}

async function loadAdminDecks() {
  const { decks } = await api('/admin/decks');
  state.decks = decks;
  const levels = ['Beginner', 'Intermediate', 'Advanced', 'Fluent'];
  const tbody = document.querySelector('#decks-table tbody');
  tbody.innerHTML = decks.map(d => `
    <tr>
      <td>${escapeHtml(d.name)}</td>
      <td>${escapeHtml(d.description || '')}</td>
      <td>
        <select onchange="adminSetDeckLevel(${d.id}, this.value)">
          ${levels.map(l => `<option value="${l}" ${d.level === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </td>
      <td>${d.card_count}</td>
      <td><button class="btn-danger" onclick="adminDeleteDeck(${d.id})">Delete</button></td>
    </tr>
  `).join('');

  const opts = decks.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  document.getElementById('card-deck').innerHTML = opts;
  document.getElementById('import-deck').innerHTML = opts;
  document.getElementById('cards-filter').innerHTML = '<option value="">All decks</option>' + opts;
}

async function adminAddDeck(e) {
  e.preventDefault();
  const name = document.getElementById('deck-name').value.trim();
  const description = document.getElementById('deck-desc').value.trim();
  const level = document.getElementById('deck-level').value;
  await api('/admin/decks', { method: 'POST', body: JSON.stringify({ name, description, level }) });
  document.getElementById('deck-name').value = '';
  document.getElementById('deck-desc').value = '';
  await loadAdminDecks();
  await loadAdminCards();
  return false;
}

async function adminSetDeckLevel(id, level) {
  await api('/admin/decks/' + id, { method: 'PUT', body: JSON.stringify({ level }) });
}

async function adminDeleteDeck(id) {
  if (!confirm('Delete this deck and all its cards?')) return;
  await api('/admin/decks/' + id, { method: 'DELETE' });
  await loadAdminDecks();
  await loadAdminCards();
}

async function loadAdminCards() {
  const deckId = document.getElementById('cards-filter')?.value;
  const { cards } = await api('/admin/cards' + (deckId ? `?deck_id=${deckId}` : ''));
  const deckName = id => state.decks.find(d => d.id === id)?.name || id;
  const tbody = document.querySelector('#cards-table tbody');
  tbody.innerHTML = cards.map(c => `
    <tr>
      <td>${escapeHtml(c.welsh)}</td>
      <td>${escapeHtml(c.english)}</td>
      <td>${escapeHtml(deckName(c.deck_id))}</td>
      <td><button class="btn-danger" onclick="adminDeleteCard(${c.id})">Delete</button></td>
    </tr>
  `).join('');
}

async function adminAddCard(e) {
  e.preventDefault();
  const body = {
    deck_id: parseInt(document.getElementById('card-deck').value),
    welsh: document.getElementById('card-welsh').value.trim(),
    english: document.getElementById('card-english').value.trim(),
    notes: document.getElementById('card-notes').value.trim(),
    example_welsh: document.getElementById('card-ex-cy').value.trim(),
    example_english: document.getElementById('card-ex-en').value.trim()
  };
  await api('/admin/cards', { method: 'POST', body: JSON.stringify(body) });
  ['card-welsh', 'card-english', 'card-notes', 'card-ex-cy', 'card-ex-en'].forEach(id => document.getElementById(id).value = '');
  await loadAdminDecks();
  await loadAdminCards();
  return false;
}

async function adminDeleteCard(id) {
  if (!confirm('Delete this card?')) return;
  await api('/admin/cards/' + id, { method: 'DELETE' });
  await loadAdminDecks();
  await loadAdminCards();
}

async function adminImport(e) {
  e.preventDefault();
  const deck_id = parseInt(document.getElementById('import-deck').value);
  const result = document.getElementById('import-result');
  try {
    const cards = JSON.parse(document.getElementById('import-json').value);
    const data = await api('/admin/import', { method: 'POST', body: JSON.stringify({ deck_id, cards }) });
    result.textContent = `Imported ${data.imported} cards.`;
    document.getElementById('import-json').value = '';
    await loadAdminDecks();
    await loadAdminCards();
  } catch (err) {
    result.style.color = 'red';
    result.textContent = 'Error: ' + err.message;
  }
  return false;
}

async function loadAdminUsers() {
  const { users } = await api('/admin/users');
  document.querySelector('#users-table tbody').innerHTML = users.map(u => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${u.current_streak}</td>
      <td>${u.longest_streak}</td>
      <td>${u.is_admin ? 'Yes' : 'No'}</td>
    </tr>
  `).join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Init ---
renderNav();
if (state.token && state.user) {
  showView('dashboard');
} else {
  showView('home');
}
