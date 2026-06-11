require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const authRoutes = require('./routes/auth');
const studyRoutes = require('./routes/study');
const adminRoutes = require('./routes/admin');
const pagesRoutes = require('./routes/pages');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/study', studyRoutes);
app.use('/api/admin', adminRoutes);

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
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Dysgu Cymraeg server running on http://localhost:${PORT}`);
});
