const ACHIEVEMENTS = [
  { code: 'first_steps', name: 'First Steps', description: 'Review your first card', icon: '🌱', check: s => s.total_reviews >= 1 },
  { code: 'streak_3', name: 'Getting Started', description: 'Reach a 3-day streak', icon: '🔥', check: s => s.longest_streak >= 3 },
  { code: 'streak_7', name: 'Week Warrior', description: 'Reach a 7-day streak', icon: '🔥', check: s => s.longest_streak >= 7 },
  { code: 'streak_30', name: 'Monthly Master', description: 'Reach a 30-day streak', icon: '🔥', check: s => s.longest_streak >= 30 },
  { code: 'streak_100', name: 'Unstoppable', description: 'Reach a 100-day streak', icon: '🐉', check: s => s.longest_streak >= 100 },
  { code: 'words_10', name: 'Vocabulary Builder', description: 'Learn 10 words', icon: '📚', check: s => s.learned_cards >= 10 },
  { code: 'words_50', name: 'Word Collector', description: 'Learn 50 words', icon: '📚', check: s => s.learned_cards >= 50 },
  { code: 'words_200', name: 'Word Hoarder', description: 'Learn 200 words', icon: '📖', check: s => s.learned_cards >= 200 },
  { code: 'words_500', name: 'Lexicon Legend', description: 'Learn 500 words', icon: '🏆', check: s => s.learned_cards >= 500 },
  { code: 'reviews_100', name: 'Dedicated Learner', description: 'Complete 100 reviews', icon: '✅', check: s => s.total_reviews >= 100 },
  { code: 'reviews_1000', name: 'Review Machine', description: 'Complete 1,000 reviews', icon: '⚙️', check: s => s.total_reviews >= 1000 },
  { code: 'deck_complete', name: 'Topic Champion', description: 'Complete your first topic', icon: '🎯', check: s => s.completed_decks >= 1 },
  { code: 'decks_5', name: 'Explorer', description: 'Complete 5 topics', icon: '🗺️', check: s => s.completed_decks >= 5 },
  { code: 'decks_10', name: 'Cartographer', description: 'Complete 10 topics', icon: '🧭', check: s => s.completed_decks >= 10 },
  { code: 'decks_all', name: 'Welsh Master', description: 'Complete every topic', icon: '👑', check: s => s.total_decks > 0 && s.completed_decks >= s.total_decks },
];

module.exports = { ACHIEVEMENTS };
