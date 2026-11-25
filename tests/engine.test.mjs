import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../js/engine.js');
const here = new URL('..', import.meta.url);
const { piles } = JSON.parse(readFileSync(new URL('cards.json', here), 'utf8'));

// Deterministic rng so runs are repeatable.
function seeded(seed = 1) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

function started(length = 'short', history = [], rng = seeded()) {
  const s = E.newSession({ names: ['A', 'B'], length, prize: 'dessert' }, piles, history, 0);
  E.agree(s, 0); E.agree(s, 1);
  E.startAfterPledge(s);
  if (s.phase === 'lasttime') {
    s.lastTime.items.forEach((it, i) => it.text && E.rateLast(s, i, 'Did it'));
    E.finishLastTime(s);
  }
  E.setWeather(s, 0, 'Sunny'); E.setWeather(s, 1, 'Foggy');
  E.finishWeather(s);
  E.flip(s, rng);
  E.begin(s, piles, rng);
  return { s, rng };
}

// Plays every card to completion, calm at every temperature check.
function playThrough(s, rng, onCard) {
  let guard = 0;
  while (s.phase !== 'closing' && guard++ < 500) {
    if (s.phase === 'temp') E.submitTemp(s, true, piles, rng);
    else if (s.phase === 'card') {
      if (onCard) onCard(s.card);
      if (s.card.stick) E.yes(s, piles, rng); else E.nextLight(s, piles, rng);
    }
  }
  assert.equal(s.phase, 'closing');
}

function toStick(s, rng) {
  while (!(s.phase === 'card' && s.card.stick)) {
    if (s.phase === 'temp') E.submitTemp(s, true, piles, rng);
    else E.nextLight(s, piles, rng);
  }
}

test('cards.default.js is in sync with cards.json', () => {
  const src = readFileSync(new URL('js/cards.default.js', here), 'utf8');
  const window = {};
  new Function('window', src)(window);
  assert.deepEqual(window.DEFAULT_CARDS.piles, piles);
});

test('every pile has the documented shape and no duplicate cards', () => {
  assert.deepEqual(piles.map(p => p.id), ['sweet', 'silly', 'challenge', 'dig', 'under', 'pat', 'rep', 'close']);
  assert.deepEqual(piles.map(p => p.cards.length), [10, 10, 8, 12, 12, 10, 10, 8]);
  for (const p of piles) {
    assert.equal(typeof p.talkingStick, 'boolean');
    assert.ok(p.name && p.hint);
    assert.equal(new Set(p.cards).size, p.cards.length);
  }
});

test('round plans match the spec table', () => {
  const count = len => E.planRounds(len).map(r => r.slots.length);
  assert.deepEqual(count('short'), [2, 2, 1, 1, 1]); // no Patterns round
  assert.deepEqual(count('full'), [3, 3, 3, 2, 2, 2]);
  assert.deepEqual(count('deep'), [4, 4, 4, 4, 3, 3]);
  assert.deepEqual(E.planRounds('deep').at(-1).slots, ['close', 'close', 'sweet']);
});

test('pledge gates the start', () => {
  const s = E.newSession({ names: ['A', 'B'], length: 'short' }, piles, [], 0);
  assert.equal(E.startAfterPledge(s), false);
  E.agree(s, 0);
  assert.equal(E.startAfterPledge(s), false);
  E.agree(s, 1);
  assert.equal(E.startAfterPledge(s), true);
  assert.equal(s.phase, 'weather');
});

test('the starter alternates every card', () => {
  const { s, rng } = started('deep');
  const starters = [];
  playThrough(s, rng, card => { if (starters.length < s.dealt) starters.push(card.starter); });
  assert.equal(starters.length, 22);
  starters.forEach((st, i) => assert.equal(st, (s.starter + i) % 2));
});

test('no card repeats within a session', () => {
  const { s, rng } = started('deep');
  playThrough(s, rng);
  for (const id of Object.keys(s.used)) assert.equal(new Set(s.used[id]).size, s.used[id].length);
});

test('a full clean game scores the maximum and fills the jar', () => {
  for (const len of ['short', 'full', 'deep']) {
    const { s, rng } = started(len);
    playThrough(s, rng);
    const rec = E.finish(s, 1000);
    assert.equal(rec.jar, s.max);
    assert.equal(rec.full, true);
  }
  assert.equal(started('short').s.max, 34);
});

test('talking-stick card: two confirmations, +3 each, then the next card', () => {
  const { s, rng } = started('short');
  toStick(s, rng);
  const { text, starter } = s.card;
  const before = s.jar;
  assert.equal(s.card.speaker, starter);
  E.yes(s, piles, rng);
  assert.equal(s.card.text, text);
  assert.equal(s.card.speaker, 1 - starter);
  assert.equal(s.jar, before + 3);
  E.yes(s, piles, rng);
  assert.equal(s.jar, before + 6);
  assert.notEqual(s.card && s.card.text, text);
});

test('pass on a light card skips it for zero points', () => {
  const { s, rng } = started('short');
  const text = s.card.text;
  assert.equal(E.pass(s, 0, piles, rng), true);
  assert.equal(s.jar, 0);
  assert.equal(s.passes[0], 2);
  assert.equal(s.passes[1], 3);
  assert.notEqual(s.card.text, text);
});

test('pass on a talking-stick card skips only your own turn', () => {
  const { s, rng } = started('short');
  toStick(s, rng);
  const text = s.card.text;
  const first = s.card.speaker, second = 1 - first;
  const before = s.jar;

  // The second speaker passes ahead of time: the first still gets a turn.
  E.pass(s, second, piles, rng);
  assert.equal(s.card.text, text);
  assert.equal(s.card.speaker, first);
  assert.equal(E.canPass(s, second), false);
  E.yes(s, piles, rng);
  assert.equal(s.jar, before + 3);
  assert.notEqual(s.card && s.card.text, text);
});

test('both passing a talking-stick card moves on', () => {
  const { s, rng } = started('short');
  toStick(s, rng);
  const text = s.card.text;
  const first = s.card.speaker;
  const before = s.jar;
  E.pass(s, first, piles, rng);
  assert.equal(s.card.text, text);
  assert.equal(s.card.speaker, 1 - first);
  E.pass(s, 1 - first, piles, rng);
  assert.notEqual(s.card && s.card.text, text);
  assert.equal(s.jar, before);
});

test('passes run out at three each', () => {
  const { s, rng } = started('deep');
  let used = 0;
  while (s.phase !== 'closing' && used < 5) {
    if (s.phase === 'temp') { E.submitTemp(s, true, piles, rng); continue; }
    if (!E.pass(s, 0, piles, rng)) break;
    used++;
  }
  assert.equal(used, 3);
  assert.equal(s.passes[0], 0);
  assert.equal(s.passes[1], 3);
});

test('shield scores +4, counts per player, and never costs anything', () => {
  const { s } = started('short');
  E.shield(s, 1);
  assert.equal(s.jar, 4);
  assert.deepEqual(s.shields, [0, 1]);
});

test('a real break parks the card and resumes with the next one', () => {
  const { s, rng } = started('short');
  const text = s.card.text;
  E.takeBreak(s, 5000);
  assert.equal(s.phase, 'break');
  assert.equal(s.breakEndsAt, 5000 + 20 * 60 * 1000);
  assert.equal(s.parked[0].text, text);
  E.endBreak(s, piles, rng);
  assert.equal(s.phase, 'card');
});

test('park saves the card and swap replaces it from the same pile', () => {
  const { s, rng } = started('short');
  const first = s.card;
  const pile = first.pile, text = first.text, starter = first.starter;
  assert.equal(E.swap(s, piles, rng), true);
  assert.equal(s.card.pile, pile);
  assert.notEqual(s.card.text, text);
  assert.equal(s.card.starter, starter);
  const swapped = s.card.text;
  E.park(s, piles, rng);
  assert.deepEqual(s.parked.map(p => p.text), [swapped]);
});

test('a warm temperature adds a Challenge card and offers Repair', () => {
  const { s, rng } = started('full');
  while (s.phase === 'card') { if (s.card.stick) E.yes(s, piles, rng); else E.nextLight(s, piles, rng); }
  assert.equal(s.phase, 'temp');
  E.setTemp(s, 0, 2); E.setTemp(s, 1, 4);
  E.submitTemp(s, false, piles, rng);
  assert.equal(s.temp.warm, true);
  assert.equal(E.canSkipToRepair(s), true);
  E.continueFromWarm(s, piles, rng);
  assert.equal(s.rounds[s.roundIdx].id, 'dig');
  assert.equal(s.card.pile, 'challenge');
  assert.deepEqual(s.temps, [{ round: 'Dig', values: [2, 4] }]);
});

test('skip to Repair still opens with the Challenge reset', () => {
  const { s, rng } = started('full');
  while (s.phase === 'card') E.nextLight(s, piles, rng);
  E.setTemp(s, 0, 5); E.setTemp(s, 1, 1);
  E.submitTemp(s, false, piles, rng);
  E.skipToRepair(s, piles, rng);
  assert.equal(s.rounds[s.roundIdx].id, 'rep');
  assert.equal(s.card.pile, 'challenge');
});

test('a calm temperature check goes straight on', () => {
  const { s, rng } = started('full');
  while (s.phase === 'card') E.nextLight(s, piles, rng);
  E.setTemp(s, 0, 3); E.setTemp(s, 1, 3);
  E.submitTemp(s, false, piles, rng);
  assert.equal(s.phase, 'card');
  assert.equal(s.card.pile, 'dig');
});

test('go to close jumps to the Close round from anywhere', () => {
  const { s, rng } = started('deep');
  E.goToClose(s, piles, rng);
  assert.equal(s.rounds[s.roundIdx].id, 'close');
  assert.equal(s.card.pile, 'close');
  E.goToClose(s, piles, rng);
  assert.equal(s.phase, 'closing');
});

test('cards from the last three sessions are avoided', () => {
  const sweet = piles.find(p => p.id === 'sweet').cards;
  const history = [
    { usedCards: { sweet: sweet.slice(0, 4) } },
    { usedCards: { sweet: sweet.slice(4, 7) } },
    { usedCards: { sweet: sweet.slice(7, 9) } },
    { usedCards: { sweet: [sweet[9]] } } // fourth-oldest: fair game again
  ];
  for (let seed = 1; seed < 20; seed++) {
    const { s } = started('short', history, seeded(seed));
    assert.equal(s.card.pile, 'sweet');
    assert.equal(s.card.text, sweet[9]);
  }
});

test('last time appears only when there is something to follow up', () => {
  const none = E.newSession({ names: ['A', 'B'], length: 'short' }, piles, [], 0);
  assert.equal(none.lastTime, null);
  const some = E.newSession({ names: ['A', 'B'], length: 'short' }, piles,
    [{ date: '2026-11-18T00:00:00Z', commitments: ['dishes', ''], parked: [] }], 0);
  E.agree(some, 0); E.agree(some, 1); E.startAfterPledge(some);
  assert.equal(some.phase, 'lasttime');
  assert.equal(E.finishLastTime(some), false);
  E.rateLast(some, 0, 'Partly'); // the blank one needs no rating
  assert.equal(E.finishLastTime(some), true);
});

test('the record and its text carry everything in the summary', () => {
  const { s, rng } = started('short');
  E.shield(s, 0);
  E.park(s, piles, rng);
  playThrough(s, rng);
  s.commitments = ['put my phone away at dinner ', 'ask before fixing'];
  s.appreciations = ['you stayed', 'you laughed'];
  const rec = E.finish(s, Date.UTC(2026, 10, 25));
  assert.equal(rec.commitments[0], 'put my phone away at dinner');
  assert.equal(rec.full, true);
  const text = E.summaryText(rec);
  for (const bit of ['A Sunny', 'B Foggy', 'self-caught defensiveness, a good thing', 'A 1 · B 0',
    "Jar's full. Go get: dessert", 'ask before fixing', 'you laughed', 'pick a calm time within a week',
    'skipped, both calm']) {
    assert.ok(text.includes(bit), bit);
  }
});

test('a jar that did not fill says next time', () => {
  const { s, rng } = started('full');
  E.goToClose(s, piles, rng);
  E.goToClose(s, piles, rng);
  const rec = E.finish(s, 0);
  assert.equal(rec.full, false);
  assert.match(E.jarLine(rec), /Next time/);
});
