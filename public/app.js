const API = '/api';
let state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
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
      ${state.user.is_admin ? '<button class="btn-outline" onclick="showView(\'admin\')">Admin</button>' : ''}
      <button class="btn-outline" onclick="logout()">Log Out</button>
    `;
  } else {
    nav.innerHTML = `
      <a class="nav-link" href="/about">About</a>
      <a class="nav-link" href="/how-it-works">How It Works</a>
      <a class="nav-link" href="/decks">Decks</a>
      <a class="nav-link" href="/faq">FAQ</a>
      <button class="btn-outline" onclick="showView('login')">Log In</button>
      <button class="btn" onclick="showView('register')">Sign Up</button>
    `;
  }
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
  try {
    const data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
    onAuthSuccess(data);
  } catch (err) {
    document.getElementById('reg-error').textContent = err.message;
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

function renderDeckList() {
  const list = document.getElementById('deck-list');
  const levels = ['Beginner', 'Intermediate', 'Advanced'];
  const icons = { Beginner: '🌱', Intermediate: '🌿', Advanced: '🌳' };
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
    return `
      <div class="level-section">
        <div class="level-heading">
          <h3>${icons[level]} ${level}</h3>
          <span class="level-pill ${level}">${levelDecks.length} decks</span>
        </div>
        <div class="deck-list">
          ${levelDecks.map(d => `
            <div class="deck-item">
              <span class="status-dot ${d.completed ? 'status-done' : d.in_progress ? 'status-progress' : 'status-new'}" title="${d.completed ? 'Completed' : d.in_progress ? 'In Progress' : 'Not Started'}"></span>
              <div>
                <div class="deck-name">${escapeHtml(d.name)} ${d.completed ? '<span class="status-badge status-done">Completed</span>' : d.in_progress ? '<span class="status-badge status-progress">In Progress</span>' : ''}</div>
                <div class="deck-meta">${d.total_cards} words — ${escapeHtml(d.description || '')}</div>
              </div>
              <div class="flex-row">
                ${d.due_cards > 0 ? `<span class="due-badge">${d.due_cards} due</span>` : ''}
                ${d.completed
                  ? `<button class="btn" onclick="startStudy(${d.id}, true)" title="Restudy every card in this topic">Study Again</button>`
                  : `<button class="btn" onclick="startStudy(${d.id})">Study</button>`}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// --- Progress ---
async function loadProgress() {
  const { days, quality } = await api('/study/history');

  const maxReviews = Math.max(1, ...days.map(d => d.reviews));
  document.getElementById('chart-reviews').innerHTML = days.map(d => `
    <div class="bar-col">
      <div class="bar" style="height:${(d.reviews / maxReviews) * 100}%" title="${d.reviews} reviews"></div>
      <div class="bar-label">${formatDay(d.day)}</div>
      <div class="bar-value">${d.reviews}</div>
    </div>
  `).join('');

  const maxNew = Math.max(1, ...days.map(d => d.new_cards));
  document.getElementById('chart-new').innerHTML = days.map(d => `
    <div class="bar-col">
      <div class="bar bar-new" style="height:${(d.new_cards / maxNew) * 100}%" title="${d.new_cards} new cards"></div>
      <div class="bar-label">${formatDay(d.day)}</div>
      <div class="bar-value">${d.new_cards}</div>
    </div>
  `).join('');

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
}

function formatDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

// --- Study ---
async function startStudy(deckId, reviewAll) {
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

async function startRandomStudy() {
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

  if (state.typedMode) {
    document.getElementById('card-front').textContent = card.english;
    document.getElementById('card-back').textContent = card.welsh;
    document.getElementById('card-back').classList.add('hidden');
    document.getElementById('card-hint').classList.add('hidden');
    document.getElementById('typed-answer-input').value = '';
    typedForm.classList.remove('hidden');
    setTimeout(() => document.getElementById('typed-answer-input').focus(), 50);
  } else {
    document.getElementById('card-front').textContent = card.welsh;
    document.getElementById('card-back').textContent = card.english;
    document.getElementById('card-back').classList.add('hidden');
    document.getElementById('card-hint').classList.remove('hidden');
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
  state.queueIndex++;
  if (state.queueIndex >= state.queue.length) {
    document.getElementById('study-progress').style.width = '100%';
    showView('complete');
  } else {
    renderCard();
  }
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
  const levels = ['Beginner', 'Intermediate', 'Advanced'];
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
