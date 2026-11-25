/* The Check-In Game: rules engine.
 * Pure game logic with no DOM and no storage, so it can be tested in Node
 * (tests/engine.test.mjs) and reused by any future UI.
 * Every function mutates the plain-JSON session object `s`.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var POINTS = { light: 2, yes: 3, shield: 4, close: 8 };
  var PASSES = 3;
  var FULL_AT = 0.7;
  var BREAK_MS = 20 * 60 * 1000;
  var RECENT_SESSIONS = 3;

  var WEATHER = ['Sunny', 'Partly cloudy', 'Foggy', 'Stormy'];
  var TEMPS = ['Calm', 'Fine', 'Tender', 'Warm', 'Heated'];
  var RATINGS = ['Did it', 'Partly', "Didn't"];
  var LENGTHS = {
    short: 'Short (~30 min)',
    full: 'Full (~60 min)',
    deep: 'Deep night (90+ min)'
  };

  var ROUNDS = [
    { id: 'warm', name: 'Warm-up' },
    { id: 'dig', name: 'Dig' },
    { id: 'under', name: 'Underneath' },
    { id: 'pat', name: 'Patterns' },
    { id: 'rep', name: 'Repair' },
    { id: 'close', name: 'Close' }
  ];

  var PLANS = {
    short: {
      warm: ['sweet', 'silly'],
      dig: ['dig', 'challenge'],
      under: ['under'],
      pat: [],
      rep: ['rep'],
      close: ['close']
    },
    full: {
      warm: ['sweet', 'silly', 'sweet'],
      dig: ['dig', 'dig', 'challenge'],
      under: ['under', 'under', 'challenge'],
      pat: ['pat', 'pat'],
      rep: ['rep', 'rep'],
      close: ['close', 'close']
    },
    deep: {
      warm: ['sweet', 'silly', 'sweet', 'silly'],
      dig: ['dig', 'dig', 'dig', 'challenge'],
      under: ['under', 'under', 'under', 'challenge'],
      pat: ['pat', 'pat', 'pat', 'challenge'],
      rep: ['rep', 'rep', 'rep'],
      close: ['close', 'close', 'sweet']
    }
  };

  function planRounds(length) {
    var plan = PLANS[length] || PLANS.full;
    return ROUNDS.filter(function (r) { return plan[r.id].length > 0; })
      .map(function (r) { return { id: r.id, name: r.name, slots: plan[r.id].slice() }; });
  }

  function findPile(piles, id) {
    for (var i = 0; i < piles.length; i++) if (piles[i].id === id) return piles[i];
    return null;
  }

  /* Maximum from the planned cards plus the close bonus. Shields and any
   * reset Challenge cards added by a warm temperature check are extra. */
  function maxPoints(rounds, piles) {
    var total = POINTS.close;
    rounds.forEach(function (r) {
      r.slots.forEach(function (id) {
        var pile = findPile(piles, id);
        total += pile && pile.talkingStick ? POINTS.yes * 2 : POINTS.light;
      });
    });
    return total;
  }

  function threshold(s) { return Math.ceil(FULL_AT * s.max); }
  function isFull(s) { return s.jar >= FULL_AT * s.max; }

  function recentCards(history) {
    var out = {};
    (history || []).slice(0, RECENT_SESSIONS).forEach(function (rec) {
      var used = rec.usedCards || {};
      Object.keys(used).forEach(function (id) {
        out[id] = (out[id] || []).concat(used[id]);
      });
    });
    return out;
  }

  function newSession(opts, piles, history, now) {
    var rounds = planRounds(opts.length);
    var last = history && history[0];
    var lastTime = null;
    if (last) {
      var c = last.commitments || ['', ''];
      var parked = last.parked || [];
      if (c[0] || c[1] || parked.length) {
        lastTime = {
          date: last.date,
          items: [{ text: c[0] || '', rating: null }, { text: c[1] || '', rating: null }],
          parked: parked
        };
      }
    }
    return {
      v: 1,
      id: 's' + now,
      startedAt: now,
      names: opts.names.slice(),
      length: opts.length,
      prize: opts.prize || '',
      tableMode: !!opts.tableMode,
      rounds: rounds,
      max: maxPoints(rounds, piles),
      phase: 'pledge',
      pledge: [false, false],
      lastTime: lastTime,
      weather: [null, null],
      starter: null,
      dealt: 0,
      roundIdx: -1,
      queue: [],
      card: null,
      used: {},
      recent: recentCards(history),
      temps: [],
      temp: null,
      pendingChallenge: false,
      shields: [0, 0],
      passes: [PASSES, PASSES],
      jar: 0,
      parked: [],
      breakEndsAt: null,
      commitments: ['', ''],
      appreciations: ['', ''],
      record: null
    };
  }

  /* ---------- opening ---------- */

  function agree(s, i) { s.pledge[i] = true; }

  function startAfterPledge(s) {
    if (!(s.pledge[0] && s.pledge[1])) return false;
    s.phase = s.lastTime ? 'lasttime' : 'weather';
    return true;
  }

  function rateLast(s, i, rating) { s.lastTime.items[i].rating = rating; }

  function lastTimeReady(s) {
    return s.lastTime.items.every(function (it) { return !it.text || it.rating !== null; });
  }

  function finishLastTime(s) {
    if (!lastTimeReady(s)) return false;
    s.phase = 'weather';
    return true;
  }

  function setWeather(s, i, w) { s.weather[i] = w; }

  function finishWeather(s) {
    if (s.weather[0] === null || s.weather[1] === null) return false;
    s.phase = 'coin';
    return true;
  }

  function flip(s, rng) { s.starter = rng() < 0.5 ? 0 : 1; }

  function begin(s, piles, rng) {
    if (s.starter === null) return false;
    enterRound(s, 0, piles, rng);
    return true;
  }

  /* ---------- dealing ---------- */

  function draw(s, pileId, piles, rng) {
    var pile = findPile(piles, pileId);
    if (!pile) return null;
    var used = s.used[pileId] || [];
    var pool = pile.cards.filter(function (c) { return used.indexOf(c) < 0; });
    if (!pool.length) return null;
    var recent = (s.recent && s.recent[pileId]) || [];
    var fresh = pool.filter(function (c) { return recent.indexOf(c) < 0; });
    var from = fresh.length ? fresh : pool;
    return { pile: pile, text: from[Math.floor(rng() * from.length)] };
  }

  function markUsed(s, pileId, text) {
    (s.used[pileId] = s.used[pileId] || []).push(text);
  }

  function enterRound(s, idx, piles, rng) {
    s.roundIdx = idx;
    s.queue = s.rounds[idx].slots.slice();
    s.temp = null;
    if (s.pendingChallenge) {
      s.queue.unshift('challenge');
      s.pendingChallenge = false;
    }
    deal(s, piles, rng);
  }

  function deal(s, piles, rng) {
    s.card = null;
    for (;;) {
      if (!s.queue.length) {
        if (s.roundIdx >= s.rounds.length - 1) {
          s.phase = 'closing';
        } else {
          s.phase = 'temp';
          s.temp = { forRound: s.roundIdx + 1, values: [null, null], warm: false };
        }
        return;
      }
      var got = draw(s, s.queue.shift(), piles, rng);
      if (!got) continue; // pile is empty or used up: skip the slot
      var starter = (s.starter + s.dealt) % 2;
      s.dealt += 1;
      markUsed(s, got.pile.id, got.text);
      s.card = {
        pile: got.pile.id,
        pileName: got.pile.name,
        hint: got.pile.hint || '',
        stick: !!got.pile.talkingStick,
        text: got.text,
        starter: starter,
        speaker: got.pile.talkingStick ? starter : null,
        turns: ['pending', 'pending']
      };
      s.phase = 'card';
      return;
    }
  }

  /* ---------- playing a card ---------- */

  function nextLight(s, piles, rng) {
    if (s.phase !== 'card' || s.card.stick) return false;
    s.jar += POINTS.light;
    deal(s, piles, rng);
    return true;
  }

  function advanceTurn(s, piles, rng) {
    var other = 1 - s.card.speaker;
    if (s.card.turns[other] === 'pending') s.card.speaker = other;
    else deal(s, piles, rng);
  }

  /* The speaker confirms the listener said it back accurately. */
  function yes(s, piles, rng) {
    if (s.phase !== 'card' || !s.card.stick) return false;
    s.jar += POINTS.yes;
    s.card.turns[s.card.speaker] = 'done';
    advanceTurn(s, piles, rng);
    return true;
  }

  function canPass(s, i) {
    if (s.phase !== 'card' || s.passes[i] <= 0) return false;
    return !s.card.stick || s.card.turns[i] === 'pending';
  }

  /* Light card: skip to the next card.
   * Talking-stick card: the passing player skips their own speaking turn and
   * the other still gets theirs. If both pass, the game moves on. */
  function pass(s, i, piles, rng) {
    if (!canPass(s, i)) return false;
    s.passes[i] -= 1;
    if (!s.card.stick) {
      deal(s, piles, rng);
      return true;
    }
    s.card.turns[i] = 'passed';
    if (s.card.speaker === i) advanceTurn(s, piles, rng);
    return true;
  }

  function shield(s, i) {
    if (s.phase !== 'card') return false;
    s.shields[i] += 1;
    s.jar += POINTS.shield;
    return true;
  }

  function parkCard(s, reason) {
    s.parked.push({ pile: s.card.pileName, text: s.card.text, reason: reason || 'parked' });
  }

  function park(s, piles, rng) {
    if (s.phase !== 'card') return false;
    parkCard(s);
    deal(s, piles, rng);
    return true;
  }

  function takeBreak(s, now) {
    if (s.phase !== 'card') return false;
    parkCard(s, 'break');
    s.card = null;
    s.phase = 'break';
    s.breakEndsAt = now + BREAK_MS;
    return true;
  }

  function endBreak(s, piles, rng) {
    if (s.phase !== 'break') return false;
    s.breakEndsAt = null;
    deal(s, piles, rng);
    return true;
  }

  function swap(s, piles, rng) {
    if (s.phase !== 'card') return false;
    var got = draw(s, s.card.pile, piles, rng);
    if (!got) return false;
    markUsed(s, got.pile.id, got.text);
    s.card.text = got.text;
    s.card.turns = ['pending', 'pending'];
    s.card.speaker = s.card.stick ? s.card.starter : null;
    return true;
  }

  function roundIndex(s, id) {
    for (var i = 0; i < s.rounds.length; i++) if (s.rounds[i].id === id) return i;
    return -1;
  }

  function canGoToClose(s) {
    return s.phase === 'card' || s.phase === 'temp' || s.phase === 'break';
  }

  function goToClose(s, piles, rng) {
    if (!canGoToClose(s)) return false;
    var idx = roundIndex(s, 'close');
    s.breakEndsAt = null;
    if (s.roundIdx === idx && s.phase !== 'temp') {
      s.card = null;
      s.queue = [];
      s.phase = 'closing';
    } else {
      enterRound(s, idx, piles, rng);
    }
    return true;
  }

  /* ---------- temperature check ---------- */

  function setTemp(s, i, v) { s.temp.values[i] = v; }

  function submitTemp(s, skipped, piles, rng) {
    if (s.phase !== 'temp' || s.temp.warm) return false;
    var v = s.temp.values;
    if (!skipped && (v[0] === null || v[1] === null)) return false;
    s.temps.push({
      round: s.rounds[s.temp.forRound].name,
      values: skipped ? null : v.slice()
    });
    if (!skipped && Math.max(v[0], v[1]) >= 4) {
      s.temp.warm = true;
      s.pendingChallenge = true;
      return true;
    }
    enterRound(s, s.temp.forRound, piles, rng);
    return true;
  }

  function continueFromWarm(s, piles, rng) {
    if (s.phase !== 'temp' || !s.temp.warm) return false;
    enterRound(s, s.temp.forRound, piles, rng);
    return true;
  }

  function canSkipToRepair(s) {
    return s.phase === 'temp' && roundIndex(s, 'rep') > s.temp.forRound;
  }

  function skipToRepair(s, piles, rng) {
    if (!canSkipToRepair(s)) return false;
    enterRound(s, roundIndex(s, 'rep'), piles, rng);
    return true;
  }

  /* ---------- close and summary ---------- */

  function finish(s, now) {
    if (s.phase !== 'closing') return null;
    s.jar += POINTS.close;
    s.phase = 'summary';
    s.record = {
      id: s.id,
      date: new Date(now).toISOString(),
      names: s.names.slice(),
      length: s.length,
      weather: s.weather.slice(),
      temps: s.temps.slice(),
      shields: s.shields.slice(),
      jar: s.jar,
      max: s.max,
      needed: threshold(s),
      full: isFull(s),
      prize: s.prize,
      commitments: s.commitments.map(function (t) { return t.trim(); }),
      appreciations: s.appreciations.map(function (t) { return t.trim(); }),
      parked: s.parked.slice(),
      followUp: s.lastTime ? s.lastTime.items.filter(function (it) { return it.text; }).length
        ? s.lastTime.items.map(function (it) { return { text: it.text, rating: it.rating }; })
        : null : null,
      usedCards: s.used
    };
    return s.record;
  }

  function jarLine(rec) {
    if (rec.full) {
      return rec.prize
        ? "Jar's full. Go get: " + rec.prize
        : "Jar's full. (Set a prize next time.)";
    }
    return 'Jar: ' + rec.jar + ' of the ' + rec.needed + ' points it needed. (Next time.)';
  }

  function tempLine(t, names) {
    if (!t.values) return t.round + ': skipped, both calm';
    return t.round + ': ' + names[0] + ' ' + t.values[0] + ' (' + TEMPS[t.values[0] - 1] + '), ' +
      names[1] + ' ' + t.values[1] + ' (' + TEMPS[t.values[1] - 1] + ')';
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined,
        { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return String(iso).slice(0, 10); }
  }

  function summaryText(rec) {
    var n = rec.names;
    var lines = [
      'The Check-In Game, ' + formatDate(rec.date),
      n[0] + ' & ' + n[1] + ' · ' + (LENGTHS[rec.length] || rec.length),
      '',
      'Weather: ' + n[0] + ' ' + (rec.weather[0] || 'n/a') + ' · ' + n[1] + ' ' + (rec.weather[1] || 'n/a')
    ];
    if (rec.temps.length) {
      lines.push('Temperature by round:');
      rec.temps.forEach(function (t) { lines.push('  ' + tempLine(t, n)); });
    }
    lines.push('Shields (self-caught defensiveness, a good thing): ' +
      n[0] + ' ' + rec.shields[0] + ' · ' + n[1] + ' ' + rec.shields[1]);
    lines.push(jarLine(rec));
    if (rec.followUp) {
      lines.push('', "Last time's commitments:");
      rec.followUp.forEach(function (f, i) {
        if (f.text) lines.push('  ' + n[i] + ': ' + f.text + ' (' + (f.rating || 'not rated') + ')');
      });
    }
    lines.push('', "This week I'll…");
    [0, 1].forEach(function (i) { lines.push('  ' + n[i] + ': ' + (rec.commitments[i] || '(left blank)')); });
    lines.push('', 'Tonight I appreciated…');
    [0, 1].forEach(function (i) { lines.push('  ' + n[i] + ': ' + (rec.appreciations[i] || '(left blank)')); });
    if (rec.parked.length) {
      lines.push('', 'Parked topics (pick a calm time within a week):');
      rec.parked.forEach(function (p) { lines.push('  [' + p.pile + '] ' + p.text); });
    }
    return lines.join('\n');
  }

  return {
    POINTS: POINTS, PASSES: PASSES, FULL_AT: FULL_AT, BREAK_MS: BREAK_MS,
    WEATHER: WEATHER, TEMPS: TEMPS, RATINGS: RATINGS, LENGTHS: LENGTHS, PLANS: PLANS,
    planRounds: planRounds, maxPoints: maxPoints, threshold: threshold, isFull: isFull,
    recentCards: recentCards, newSession: newSession,
    agree: agree, startAfterPledge: startAfterPledge,
    rateLast: rateLast, lastTimeReady: lastTimeReady, finishLastTime: finishLastTime,
    setWeather: setWeather, finishWeather: finishWeather, flip: flip, begin: begin,
    nextLight: nextLight, yes: yes, canPass: canPass, pass: pass, shield: shield,
    park: park, takeBreak: takeBreak, endBreak: endBreak, swap: swap,
    canGoToClose: canGoToClose, goToClose: goToClose,
    setTemp: setTemp, submitTemp: submitTemp, continueFromWarm: continueFromWarm,
    canSkipToRepair: canSkipToRepair, skipToRepair: skipToRepair,
    finish: finish, jarLine: jarLine, tempLine: tempLine, formatDate: formatDate,
    summaryText: summaryText
  };
});
