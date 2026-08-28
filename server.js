require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const authRoutes = require('./routes/auth');
const studyRoutes = require('./routes/study');
const adminRoutes = require('./routes/admin');
const pagesRoutes = require('./routes/pages');
const socialRoutes = require('./routes/social');
const { startReminderScheduler } = require('./reminders');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway sits in front of the app as a reverse proxy; trust its X-Forwarded-For
// so req.ip reflects the real client (used for rate limiting).
app.set('trust proxy', 1);

app.use(compression());
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/study', studyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/social', socialRoutes);

// Crawlable, server-rendered SEO pages (e.g. /decks, /decks/:slug)
app.use('/', pagesRoutes);

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.get('*', (req, res) => {
  // Anything with a file extension that made it past express.static doesn't
  // exist — return a real 404 instead of soft-404ing with the app shell.
  if (path.extname(req.path)) return res.status(404).type('text').send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

startReminderScheduler();

app.listen(PORT, () => {
  console.log(`Dragon Lingo server running on http://localhost:${PORT}`);
});
