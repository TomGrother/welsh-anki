const API = '/api';
let state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  queue: [],
  queueIndex: 0,
  flipped: false,
  decks: []
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
    nav.innerHTML = '';
  }
}

function showView(name) {
  document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
  document.getElementById('view-' + name).classList.remove('hidden');
  if (name === 'dashboard') loadDashboard();
  if (name === 'admin') loadAdmin();
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
    document.getElementById('stat-total').textContent = stats.total_cards;

    const { decks } = await api('/study/decks');
    state.decks = decks;
    const list = document.getElementById('deck-list');
    const levels = ['Beginner', 'Intermediate', 'Advanced'];
    const icons = { Beginner: '🌱', Intermediate: '🌿', Advanced: '🌳' };

    if (decks.length === 0) {
      list.innerHTML = '<p class="muted">No decks yet.</p>';
    } else {
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
                  <div>
                    <div class="deck-name">${escapeHtml(d.name)}</div>
                    <div class="deck-meta">${d.total_cards} words — ${escapeHtml(d.description || '')}</div>
                  </div>
                  <div class="flex-row">
                    ${d.due_cards > 0 ? `<span class="due-badge">${d.due_cards} due</span>` : ''}
                    <button class="btn" onclick="startStudy(${d.id})">Study</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    if (err.message.includes('expired') || err.message.includes('authenticated')) logout();
  }
}

// --- Study ---
async function startStudy(deckId) {
  const { cards } = await api(`/study/queue?limit=20${deckId ? '&deck_id=' + deckId : ''}`);
  if (cards.length === 0) {
    showView('complete');
    return;
  }
  state.queue = cards;
  state.queueIndex = 0;
  showView('study');
  renderCard();
}

function renderCard() {
  const card = state.queue[state.queueIndex];
  state.flipped = false;
  document.getElementById('card-front').textContent = card.welsh;
  document.getElementById('card-back').textContent = card.english;
  document.getElementById('card-back').classList.add('hidden');
  const ex = document.getElementById('card-example');
  if (card.example_welsh) {
    ex.innerHTML = `${escapeHtml(card.example_welsh)}<br>${escapeHtml(card.example_english || '')}`;
  } else {
    ex.innerHTML = '';
  }
  ex.classList.add('hidden');
  document.getElementById('card-hint').classList.remove('hidden');
  document.getElementById('review-buttons').classList.add('hidden');

  document.getElementById('study-counter').textContent = `${state.queueIndex + 1} / ${state.queue.length}`;
  document.getElementById('study-progress').style.width = `${(state.queueIndex / state.queue.length) * 100}%`;
}

function flipCard() {
  if (state.flipped) return;
  state.flipped = true;
  document.getElementById('card-back').classList.remove('hidden');
  document.getElementById('card-example').classList.remove('hidden');
  document.getElementById('card-hint').classList.add('hidden');
  document.getElementById('review-buttons').classList.remove('hidden');
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
