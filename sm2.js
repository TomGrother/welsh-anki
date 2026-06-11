// SM-2 spaced repetition algorithm.
// quality: 0-5 (0 = total blackout, 5 = perfect recall). We use a 4-button
// UI mapped as: Again=0, Hard=3, Good=4, Easy=5.
function sm2(card, quality) {
  let { ease, interval_days, repetitions } = card;

  if (quality < 3) {
    repetitions = 0;
    interval_days = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) interval_days = 1;
    else if (repetitions === 2) interval_days = 6;
    else interval_days = Math.round(interval_days * ease);
  }

  ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ease < 1.3) ease = 1.3;

  return { ease, interval_days, repetitions };
}

module.exports = { sm2 };
