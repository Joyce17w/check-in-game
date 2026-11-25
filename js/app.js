/* The Check-In Game: interface.
 * Rules live in engine.js. This file draws screens, stores data locally and
 * makes no network calls beyond loading its own files.
 *
 * Every game screen is described as { title, shared, player, actions } so the
 * same screen can be laid out for one held phone or for table mode, where the
 * phone lies between the players and each half faces one of them.
 */
(function () {
  'use strict';

  var E = window.Engine;

  /* ---------- content ---------- */

  var FOLLOW_UPS = [
    "What's the hardest part of that?",
    'What do you need from me on this?',
    'Can you tell me more?',
    'What did you mean by…?',
    'How long have you felt this way?',
    'What would help, even a little?'
  ];

  var CHEAT_SHEET = [
    ['You always / you never…', 'I felt ___ when ___. What I need is ___.'],
    ["That's not true.", "That's not how I saw it. Can I share mine after I've got yours?"],
    ['Fine. Whatever.', "I'm getting flooded. Can we pause for 20 minutes and come back?"],
    ['Well, you did ___ too.', 'Fair. My part was ___. Can we look at yours separately later?'],
    ['I was just joking.', "That landed badly. I'm sorry. What I meant was ___."],
    ['Why are you so upset?', 'Help me understand what this feels like for you.'],
    ['Calm down.', 'I want to get this. What would help right now?'],
    ["I'm a terrible partner.", "I don't like that I did that. Here's what I want to try instead."]
  ];

  var HOW_TO = [
    ['Both of you answer every card.', 'A coin flip picks who starts the first card. After that you alternate.'],
    ['Light cards', 'The starter answers, then the other. One tap on Next.'],
    ['Deep cards (talking stick)', 'One speaks while the other only listens: no fixing, no correcting. The listener says it back ("What I heard is…"). The speaker taps "Yes, that\'s it" or "Not quite". Then you swap. Understanding isn\'t agreeing.'],
    ['Shield', 'If you notice yourself getting defensive, press your own Shield. It earns the most points in the game. You can only call it on yourself, never on the other person.'],
    ['Pass', 'Three each, no questions asked. On a deep card a pass skips only your own turn to speak.'],
    ['Park it, swap, go to close', 'Park a card to come back to at a calm time, swap it for another, or go to the close whenever you like. Stopping early counts as a good game.'],
    ['One shared jar', "You fill it together. No individual scores, and no points are ever taken away."]
  ];

  /* ---------- storage ---------- */

  var KEY = {
    settings: 'checkin.v1.settings',
    history: 'checkin.v1.history',
    active: 'checkin.v1.active',
    cards: 'checkin.v1.cards'
  };

  var storageWarned = false;
  var store = {
    get: function (k, fallback) {
      try {
        var v = localStorage.getItem(k);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; }
      catch (e) {
        if (!storageWarned) {
          storageWarned = true;
          toast("This device isn't letting the game save. You can still play.");
        }
        return false;
      }
    },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* nothing to remove */ } }
  };

  var DEFAULT_SETTINGS = {
    names: ['Joyce', 'Bailey'], length: 'full', prize: '',
    tableMode: false, haptics: true, onboarded: false
  };

  var settings = Object.assign({}, DEFAULT_SETTINGS, store.get(KEY.settings, {}));
  var history = store.get(KEY.history, []);
  if (!Array.isArray(history)) history = [];
  var S = store.get(KEY.active, null);          // session in progress, if any
  var defaultPiles = (window.DEFAULT_CARDS || { piles: [] }).piles;
  var piles = defaultPiles;
  var view = { name: settings.onboarded ? 'home' : 'onboarding' };
  var ui = { floor: null, breakFiredFor: null, coinFlipped: false, editorPile: null };

  function saveSettings() { store.set(KEY.settings, settings); }
  function saveSession() { if (S) store.set(KEY.active, S); else store.del(KEY.active); }
  function rng() { return Math.random(); }

  function validPiles(p) {
    return Array.isArray(p) && p.length > 0 && p.every(function (x) {
      return x && typeof x.id === 'string' && typeof x.name === 'string' && Array.isArray(x.cards) &&
        x.cards.every(function (c) { return typeof c === 'string'; });
    });
  }

  function loadCards() {
    var custom = store.get(KEY.cards, null);
    if (validPiles(custom)) piles = custom;
    // cards.json is the editable source. Opened from a file, fetch is blocked
    // and the bundled copy in cards.default.js is used instead.
    if (location.protocol === 'file:' || !window.fetch) return Promise.resolve();
    return fetch('cards.json').then(function (r) { return r.json(); }).then(function (data) {
      if (validPiles(data.piles)) {
        defaultPiles = data.piles;
        if (!validPiles(custom)) piles = defaultPiles;
      }
    }).catch(function () { /* keep the bundled copy */ });
  }

  /* ---------- small helpers ---------- */

  function h(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'disabled' || k === 'checked' || k === 'open') el[k] = true;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }

  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(function (x) { add(el, x); });
    else el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }

  function btn(label, onClick, o) {
    o = o || {};
    return h('button', {
      type: 'button',
      class: 'btn' + (o.kind ? ' ' + o.kind : ''),
      'data-k': o.k || null,
      disabled: o.disabled,
      'aria-label': o.aria || null,
      'aria-pressed': o.pressed === undefined ? null : String(!!o.pressed),
      onclick: onClick
    }, label);
  }

  /* A row of mutually exclusive choices. */
  function choice(groupLabel, labels, current, onPick, k, extra) {
    extra = extra || {};
    return h('div', { class: 'choices', role: 'group', 'aria-label': groupLabel },
      labels.map(function (label, idx) {
        var b = btn(label, function () { onPick(idx); },
          { kind: 'pick' + (extra.cls ? ' ' + extra.cls(idx) : ''), pressed: current === idx, k: k + idx });
        if (extra.icons) {
          var icon = h('span', { class: 'icon', 'aria-hidden': 'true' });
          icon.innerHTML = extra.icons[idx];
          b.prepend(icon);
        }
        return b;
      }));
  }

  function svg(body) {
    return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }
  var CLOUD = 'M14 38h20a8 8 0 0 0 1-15.900A11 11 0 0 0 14 24a7 7 0 0 0 0 14z';
  var WEATHER_ICONS = [
    svg('<circle cx="24" cy="24" r="8" fill="currentColor"/><path d="M24 4v5M24 39v5M4 24h5M39 24h5M9.900 9.900l3.500 3.500M34.600 34.600l3.500 3.500M9.900 38.100l3.500-3.500M34.600 13.400l3.500-3.500"/>'),
    svg('<circle cx="33" cy="15" r="6" fill="currentColor"/><path d="M33 3v3M45 15h-3M41.500 6.500l-2 2"/><path fill="currentColor" fill-opacity=".25" d="' + CLOUD + '"/>'),
    svg('<path d="M8 14h32M4 23h30M14 32h30M8 41h24"/>'),
    svg('<path fill="currentColor" fill-opacity=".25" d="M14 30h20a8 8 0 0 0 1-15.900A11 11 0 0 0 14 16a7 7 0 0 0 0 14z"/><path fill="currentColor" d="M25 27l-6 9h5l-2 8 8-11h-5z"/>')
  ];

  function p(text, cls) { return h('p', { class: cls || null }, text); }
  function other(i) { return 1 - i; }
  function nameOf(i) { return (S ? S.names : settings.names)[i]; }

  function buzz(pattern) {
    try { if (settings.haptics && navigator.vibrate) navigator.vibrate(pattern); }
    catch (e) { /* haptics are optional */ }
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); el.textContent = ''; }, 4000);
  }

  function fmt(ms) {
    var t = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  /* Run a rule, save, redraw. */
  function act(fn) {
    var result = fn();
    saveSession();
    render();
    return result;
  }

  /* ---------- sheets (menus, references, the shield reset) ---------- */

  var sheet = null;

  function openSheet(o) {
    closeSheet();
    var body = h('div', { class: 'sheet-body' });
    var dlg = h('dialog', {
      class: 'sheet' + (S && S.tableMode && view.name === 'game' && o.facing === 1 ? ' flip' : ''),
      'aria-label': o.title
    }, body);
    dlg.addEventListener('cancel', function (e) { if (o.locked) e.preventDefault(); });
    dlg.addEventListener('close', function () {
      dlg.remove();
      if (sheet && sheet.dlg === dlg) sheet = null;
      if (o.onClose) o.onClose();
    });
    document.body.append(dlg);
    sheet = { dlg: dlg, body: body, opts: o };
    setSheet(o.title, o.content, o.locked);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    return sheet;
  }

  function setSheet(title, content, locked) {
    if (!sheet) return;
    var heading = h('h2', { tabindex: '-1' }, title);
    sheet.body.replaceChildren(heading);
    add(sheet.body, content);
    if (!locked) add(sheet.body, h('div', { class: 'actions' }, btn('Close', closeSheet, { k: 'close' })));
    heading.focus();
  }

  function closeSheet() {
    if (!sheet) return;
    var dlg = sheet.dlg;
    if (dlg.open && dlg.close) dlg.close(); else { dlg.remove(); sheet = null; }
  }

  function confirmSheet(title, text, yesLabel, onYes, facing) {
    openSheet({
      title: title, facing: facing, locked: true,
      content: [p(text), h('div', { class: 'actions' },
        btn(yesLabel, function () { closeSheet(); onYes(); }, { kind: 'primary' }),
        btn('Cancel', closeSheet))]
    });
  }

  function howToContent() {
    return h('dl', { class: 'rules' }, HOW_TO.map(function (r) {
      return [h('dt', null, r[0]), h('dd', null, r[1])];
    }));
  }

  function pointsContent() {
    var rows = [
      ['Light card completed', '+' + E.POINTS.light],
      ['Each "Yes, that\'s it" on a deep card', '+' + E.POINTS.yes + ' (so +' + E.POINTS.yes * 2 + ' a card)'],
      ['Shield: catching your own defensiveness', '+' + E.POINTS.shield],
      ['Finishing the close', '+' + E.POINTS.close],
      ['Pass', '0, never negative']
    ];
    var out = [h('table', { class: 'points' }, h('tbody', null, rows.map(function (r) {
      return h('tr', null, h('th', { scope: 'row' }, r[0]), h('td', null, r[1]));
    })))];
    if (S) {
      out.unshift(p('The jar has ' + S.jar + ' points. It counts as full at ' + E.threshold(S) +
        ' (70% of the ' + S.max + ' this game can earn from its cards).'));
    }
    out.push(p('One jar, filled together. Nothing is ever taken away, and nobody has a score of their own.'));
    return out;
  }

  function cheatContent() {
    return h('table', { class: 'cheat' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Instead of'), h('th', { scope: 'col' }, 'Try'))),
      h('tbody', null, CHEAT_SHEET.map(function (r) {
        return h('tr', null, h('td', null, r[0]), h('td', null, r[1]));
      })));
  }

  function followUpList() {
    return h('ul', { class: 'followups' }, FOLLOW_UPS.map(function (q) { return h('li', null, q); }));
  }

  function showHowTo(facing) { openSheet({ title: 'How to play', facing: facing, content: howToContent() }); }
  function showPoints(facing) { openSheet({ title: 'What earns points', facing: facing, content: pointsContent() }); }
  function showCheat(facing) { openSheet({ title: 'Say this instead', facing: facing, content: cheatContent() }); }

  function showMenu(facing) {
    var items = [];
    var item = function (label, fn, o) { items.push(btn(label, function () { closeSheet(); fn(); }, o)); };
    if (S.phase === 'card') {
      item('Park it: come back to this card another day', function () {
        act(function () { E.park(S, piles, rng); });
        toast('Parked. It will be in your summary.');
      });
      item('Swap this card for another', function () {
        if (act(function () { return E.swap(S, piles, rng); })) ui.floor = null;
        else toast('No other cards left in this pile.');
      });
    }
    if (E.canGoToClose(S)) {
      item('Go to close', function () { act(function () { E.goToClose(S, piles, rng); }); });
    }
    item('How to play', function () { showHowTo(facing); });
    item('Say this instead', function () { showCheat(facing); });
    item('What earns points', function () { showPoints(facing); });
    item(S.tableMode ? 'Table mode: on. Switch to one held phone' : 'Table mode: off. Lay the phone between you',
      function () { act(function () { S.tableMode = !S.tableMode; }); });
    item('Leave for now (the game is saved)', function () { view = { name: 'home' }; render(); });
    openSheet({ title: 'More', facing: facing, content: h('div', { class: 'menu' }, items) });
  }

  /* ---------- the shield reset ---------- */

  function openShield(i) {
    var me = nameOf(i), them = nameOf(other(i));
    act(function () { E.shield(S, i); });
    buzz(30);
    openSheet({ title: 'Good catch, ' + me + '.', facing: i, locked: true, content: [] });
    var timer = null;

    function intro() {
      return [
        p('Noticing it is the hard part.'),
        p(them + ", you don't need to say anything, except maybe “thank you.”"),
        p('+' + E.POINTS.shield + ' to the jar.', 'quiet')
      ];
    }

    function breathe() {
      var total = 3, breath = 1, phase = 'in', left = 4;
      var circle = h('div', { class: 'breath-circle', 'aria-hidden': 'true' });
      var label = h('p', { class: 'breath-label', 'aria-hidden': 'true' });
      var count = h('p', { class: 'breath-count', 'aria-hidden': 'true' });
      var spoken = h('p', { class: 'sr-only', 'aria-live': 'assertive' });
      function paint(announce) {
        label.textContent = phase === 'in' ? 'Breathe in' : 'Breathe out';
        count.replaceChildren(h('b', null, left), ' breath ' + breath + ' of ' + total);
        circle.className = 'breath-circle ' + phase;
        if (announce) spoken.textContent = label.textContent + ', ' + (phase === 'in' ? 4 : 6) + ' seconds. Breath ' + breath + ' of ' + total + '.';
      }
      setSheet('Good catch, ' + me + '.', [intro(),
        h('div', { class: 'breath' }, circle, label, count, spoken),
        p('Three slow breaths. Your options appear after.', 'quiet')], true);
      paint(true);
      // Start the circle small, then grow on the next frame so it animates.
      circle.className = 'breath-circle';
      requestAnimationFrame(function () { circle.className = 'breath-circle ' + phase; });
      timer = setInterval(function () {
        left -= 1;
        if (left > 0) return paint(false);
        if (phase === 'in') { phase = 'out'; left = 6; return paint(true); }
        if (breath < total) { breath += 1; phase = 'in'; left = 4; return paint(true); }
        clearInterval(timer);
        buzz(40);
        options();
      }, 1000);
    }

    function back() { closeSheet(); }

    function script(title, lines, extra) {
      setSheet(title, [
        lines.map(function (l) { return p(l, 'script'); }), extra || null,
        h('div', { class: 'actions' },
          btn('Back to the card', back, { kind: 'primary', k: 'back' }),
          btn('Other options', options, { k: 'opts' }))
      ], true);
    }

    function options() {
      setSheet(me + ', pick one', [
        h('div', { class: 'menu' },
          btn('Say the part of ' + them + "'s view I can agree with", function () {
            script('Say it out loud', ['“The part that makes sense to me is…”',
              'Then, only if you want to: “…and where I see it differently is…”']);
          }, { k: 'o1' }),
          btn('Ask a curious question instead', function () {
            script('Ask one of these', [], followUpList());
          }, { k: 'o2' }),
          btn("Name what I'm protecting", function () {
            script('Say it out loud', ['“When you said ___, what I heard was ___. That might not be what you meant.”']);
          }, { k: 'o3' }),
          btn('I need a real break', function () {
            closeSheet();
            act(function () { E.takeBreak(S, Date.now()); });
          }, { k: 'o4' }))
      ], true);
    }

    sheet.opts.onClose = function () { clearInterval(timer); };
    breathe();
  }

  /* ---------- summary ---------- */

  function summaryNodes(rec) {
    var n = rec.names;
    var pair = function (a, b) { return n[0] + ': ' + a + ' · ' + n[1] + ': ' + b; };
    var rows = [
      ['Date', E.formatDate(rec.date)],
      ['Weather', pair(rec.weather[0] || 'n/a', rec.weather[1] || 'n/a')],
      ['Temperature by round', rec.temps.length
        ? h('ul', null, rec.temps.map(function (t) { return h('li', null, E.tempLine(t, n)); }))
        : 'No checks this game'],
      ['Shields', pair(rec.shields[0], rec.shields[1]) + '. Self-caught defensiveness, a good thing.'],
      ['The jar', E.jarLine(rec)]
    ];
    if (rec.followUp) {
      rows.push(["Last time's commitments", h('ul', null, rec.followUp.map(function (f, i) {
        return f.text ? h('li', null, n[i] + ': ' + f.text + ' (' + (f.rating || 'not rated') + ')') : null;
      }))]);
    }
    var each = function (list) {
      return h('ul', null, [0, 1].map(function (i) { return h('li', null, n[i] + ': ' + (list[i] || '(left blank)')); }));
    };
    rows.push(["This week I'll…", each(rec.commitments)]);
    rows.push(['Tonight I appreciated…', each(rec.appreciations)]);
    rows.push(['Parked topics', rec.parked.length
      ? [h('ul', null, rec.parked.map(function (c) { return h('li', null, c.text + ' (' + c.pile + ')'); })),
        p('Pick a calm time within a week.', 'quiet')]
      : 'None']);
    return h('dl', { class: 'summary paper' }, rows.map(function (r) {
      return [h('dt', null, r[0]), h('dd', null, r[1])];
    }));
  }

  function copyText(text) {
    var done = function () { toast('Copied.'); };
    var fallback = function () {
      var ta = h('textarea', { class: 'sr-only', value: text, readonly: true });
      document.body.append(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast("Couldn't copy on this device."); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  }

  function shareButtons(rec) {
    var text = E.summaryText(rec);
    var out = [btn('Copy summary', function () { copyText(text); }, { k: 'copy' })];
    if (navigator.share) {
      out.push(btn('Share', function () {
        navigator.share({ title: 'The Check-In Game', text: text }).catch(function () { /* cancelled */ });
      }, { k: 'share' }));
    }
    return out;
  }

  /* ---------- game screens ---------- */

  function jarButton(facing) {
    var need = E.threshold(S), frac = Math.min(1, S.jar / need);
    var from = typeof ui.jarFrac === 'number' ? ui.jarFrac : frac;
    var el = h('button', {
      type: 'button', class: 'jar' + (frac >= 1 ? ' full' : ''), 'data-k': 'jar',
      'aria-label': 'Shared jar: ' + S.jar + ' points. It counts as full at ' + need + '. What earns points?',
      onclick: function () { showPoints(facing); }
    });
    var body = 'M8 13q0-4 4-4h16q4 0 4 4v27q0 5-5 5H13q-5 0-5-5z';
    el.innerHTML = '<svg viewBox="0 0 40 48" aria-hidden="true">' +
      '<clipPath id="jar-clip"><path d="' + body + '"/></clipPath>' +
      '<path class="jar-glass" d="' + body + '"/>' +
      '<g clip-path="url(#jar-clip)"><rect class="jar-fill" x="8" y="9" width="24" height="36"/></g>' +
      '<path class="jar-glass" fill="none" style="fill:none" d="' + body + '"/>' +
      '<rect class="jar-lid" x="10" y="2" width="20" height="6" rx="2"/></svg>' +
      '<span class="jar-count"><b>' + S.jar + '</b> / ' + need + '</span>';
    var fill = el.querySelector('.jar-fill');
    fill.style.transform = 'scaleY(' + from + ')';
    // Let the old level paint first so the jar visibly fills.
    setTimeout(function () { fill.style.transform = 'scaleY(' + frac + ')'; ui.jarFrac = frac; }, 40);
    return el;
  }

  function shownRound() {
    if (S.roundIdx < 0 || S.phase === 'closing' || S.phase === 'summary') return -1;
    return S.phase === 'temp' ? S.temp.forRound : S.roundIdx;
  }

  function roundTrack() {
    var idx = shownRound();
    if (idx < 0) return h('span', { class: 'round' });
    return h('span', { class: 'round' },
      h('span', { class: 'round-name' }, S.rounds[idx].name),
      h('span', { class: 'pips', role: 'img', 'aria-label': 'Round ' + (idx + 1) + ' of ' + S.rounds.length },
        S.rounds.map(function (r, i) {
          return h('i', { class: 'pip' + (i < idx ? ' done' : i === idx ? ' now' : '') });
        })));
  }

  function themeFor(sc) {
    if (!sc.game && !(S && S.phase === 'summary' && view.name === 'game')) return 'night';
    if (S.phase === 'card') return S.rounds[S.roundIdx].id;
    if (S.phase === 'temp') return S.rounds[S.temp.forRound].id;
    if (S.phase === 'break') return 'break';
    if (S.phase === 'closing' || S.phase === 'summary') return 'close';
    return 'night';
  }

  function pledgeScreen() {
    return {
      key: 'pledge', title: 'The pledge',
      shared: function () {
        return [p('Say it out loud, both of you:'),
          h('blockquote', null, "I'm on your side. I'm here to understand, not to win.")];
      },
      player: function (i) {
        return [btn(S.pledge[i] ? nameOf(i) + ' agreed' : 'I agree',
          function () { act(function () { E.agree(S, i); }); buzz(20); },
          { kind: 'big', pressed: S.pledge[i], disabled: S.pledge[i], k: 'agree' + i,
            aria: S.pledge[i] ? null : nameOf(i) + ': I agree' })];
      },
      actions: function () {
        var ready = S.pledge[0] && S.pledge[1];
        return [btn('Start', function () { act(function () { E.startAfterPledge(S); }); },
          { kind: 'primary', disabled: !ready, k: 'start' }),
        ready ? null : p('Start unlocks once you have both agreed.', 'quiet')];
      }
    };
  }

  function lastTimeScreen() {
    var lt = S.lastTime;
    return {
      key: 'lasttime', title: 'Last time',
      shared: function () {
        return [
          p('On ' + E.formatDate(lt.date) + ' you each promised something. How did it go?'),
          p("Just information. Nobody's keeping count.", 'quiet'),
          lt.parked.length ? h('details', null, h('summary', null, 'Parked last time (' + lt.parked.length + ')'),
            h('ul', null, lt.parked.map(function (c) { return h('li', null, c.text); }))) : null
        ];
      },
      player: function (i) {
        var it = lt.items[i];
        if (!it.text) return [p('Nothing written last time.', 'quiet')];
        return [h('blockquote', null, it.text),
          choice(nameOf(i) + ': how it went', E.RATINGS, E.RATINGS.indexOf(it.rating), function (idx) {
            act(function () { E.rateLast(S, i, E.RATINGS[idx]); });
          }, 'rate' + i)];
      },
      actions: function () {
        return [btn('Continue', function () { act(function () { E.finishLastTime(S); }); },
          { kind: 'primary', disabled: !E.lastTimeReady(S), k: 'cont' })];
      }
    };
  }

  function weatherScreen() {
    return {
      key: 'weather', title: 'Weather report',
      shared: function () { return [p('How was your week? Pick one each. No explaining.')]; },
      player: function (i) {
        return [choice(nameOf(i) + ': your week', E.WEATHER, E.WEATHER.indexOf(S.weather[i]), function (idx) {
          act(function () { E.setWeather(S, i, E.WEATHER[idx]); });
        }, 'wx' + i, { icons: WEATHER_ICONS })];
      },
      actions: function () {
        return [btn('Continue', function () { act(function () { E.finishWeather(S); }); },
          { kind: 'primary', disabled: S.weather[0] === null || S.weather[1] === null, k: 'cont' })];
      }
    };
  }

  function coinScreen() {
    var flipped = S.starter !== null;
    return {
      key: 'coin' + (flipped ? '-done' : ''), title: flipped ? nameOf(S.starter) + ' starts' : 'Coin flip',
      shared: function () {
        return [h('div', { class: 'coin' + (flipped ? ' landed' : ''), 'aria-hidden': 'true' },
          flipped ? nameOf(S.starter).charAt(0).toUpperCase() : '?'), p(flipped
          ? nameOf(S.starter) + ' answers the first card first. After that you alternate every card.'
          : 'A coin flip decides who answers the first card first. After that you alternate every card.')];
      },
      actions: function () {
        return flipped
          ? [btn('Draw the first card', function () { act(function () { E.begin(S, piles, rng); }); }, { kind: 'primary', k: 'go' })]
          : [btn('Flip the coin', function () { act(function () { E.flip(S, rng); }); buzz(30); }, { kind: 'primary', k: 'go' })];
      }
    };
  }

  function tempScreen() {
    var t = S.temp, next = S.rounds[t.forRound].name;
    if (t.warm) {
      return {
        key: 'temp-warm', title: "Someone's running warm",
        shared: function () {
          return [p("That's useful information, not a problem."),
            p('The next round opens with a Challenge card as a reset.')];
        },
        actions: function () {
          var out = [btn('Continue to ' + next, function () { act(function () { E.continueFromWarm(S, piles, rng); }); },
            { kind: 'primary', k: 'cont' })];
          if (E.canSkipToRepair(S)) {
            out.push(btn('Skip to Repair & Close', function () { act(function () { E.skipToRepair(S, piles, rng); }); }, { k: 'skip' }));
            out.push(p('Stopping here counts as a good game.', 'quiet'));
          }
          return out;
        }
      };
    }
    return {
      key: 'temp' + t.forRound, title: 'Temperature check',
      shared: function () { return [p('Before ' + next + ': where are you each at, 1 to 5?')]; },
      player: function (i) {
        var labels = E.TEMPS.map(function (name, idx) { return (idx + 1) + ' ' + name; });
        return [choice(nameOf(i) + ': temperature', labels, t.values[i] === null ? -1 : t.values[i] - 1, function (idx) {
          act(function () { E.setTemp(S, i, idx + 1); });
        }, 'temp' + i, { cls: function (idx) { return 'temp-' + (idx + 1); } })];
      },
      actions: function () {
        var ready = t.values[0] !== null && t.values[1] !== null;
        return [
          btn('Continue', function () { act(function () { E.submitTemp(S, false, piles, rng); }); },
            { kind: 'primary', disabled: !ready, k: 'cont' }),
          btn("We're both calm. Skip", function () { act(function () { E.submitTemp(S, true, piles, rng); }); }, { k: 'skip' })
        ];
      }
    };
  }

  function playerRow(i) {
    var c = S.card, left = S.passes[i];
    var passLabel = 'Pass (' + left + ' left)';
    if (c.stick && c.turns[i] === 'passed') passLabel = 'Passed your turn';
    return h('div', { class: 'row' },
      btn([h('span', null, h('b', null, 'Shield'), h('small', null, "I'm getting defensive"))], function () { openShield(i); }, {
        kind: 'shield', k: 'shield' + i,
        aria: nameOf(i) + ": Shield. I'm getting defensive. Plus " + E.POINTS.shield + ' to the jar.'
      }),
      btn(passLabel, function () {
        var stick = c.stick;
        act(function () { E.pass(S, i, piles, rng); });
        toast('No questions asked.' + (stick && S.card === c ? ' ' + nameOf(other(i)) + ' still gets a turn.' : ''));
      }, { k: 'pass' + i, disabled: !E.canPass(S, i), aria: nameOf(i) + ': ' + passLabel }));
  }

  function floorTimer() {
    var c = S.card;
    if (ui.floor && (ui.floor.text !== c.text || ui.floor.speaker !== c.speaker)) ui.floor = null;
    if (!ui.floor) {
      return btn('Start a 2-minute floor timer', function () {
        ui.floor = { text: c.text, speaker: c.speaker, endsAt: Date.now() + 120000, fired: false };
        render();
      }, { k: 'floor' });
    }
    return h('p', { class: 'timer' }, 'Floor: ',
      h('span', { 'data-timer': 'floor' }, fmt(ui.floor.endsAt - Date.now())), ' ',
      btn('Stop timer', function () { ui.floor = null; render(); }, { kind: 'small', k: 'floor' }));
  }

  function cardScreen() {
    var c = S.card;
    var first = nameOf(c.starter), second = nameOf(other(c.starter));
    var header = function () {
      return [h('div', { class: 'deck', 'data-pile': c.pile },
        h('div', { class: 'playing-card paper' + (ui.dealt === c.text ? '' : ' deal') },
          h('p', { class: 'pile' }, h('b', null, c.pileName), c.hint),
          h('p', { class: 'card-text' }, c.text)))];
    };
    if (!c.stick) {
      return {
        key: 'card:' + c.text, title: c.pileName, hideTitle: true, actionsFirst: true,
        shared: function () { return header().concat([p(first + ' answers first, then ' + second + '.')]); },
        player: function (i) { return [playerRow(i)]; },
        actions: function () {
          return [btn('Next  +' + E.POINTS.light, function () { act(function () { E.nextLight(S, piles, rng); }); buzz(20); },
            { kind: 'primary', k: 'next', aria: 'Next card. Plus ' + E.POINTS.light + ' to the jar.' })];
        }
      };
    }
    var sp = c.speaker, li = other(sp);
    var turnNo = sp === c.starter ? 1 : 2;
    return {
      key: 'card:' + c.text + ':' + sp, title: c.pileName, hideTitle: true,
      role: function (i) { return i === sp ? 'speaking' : 'listening'; },
      shared: function () {
        return header().concat([
          p(nameOf(sp) + ' answers. ' + nameOf(li) + ' only listens: no fixing, no correcting. Then ' +
            nameOf(li) + ' says it back.'),
          p("Understanding isn't agreeing.", 'voice'),
          p('Turn ' + turnNo + ' of 2' + (c.turns[li] === 'passed' ? '. ' + nameOf(li) + ' passed their turn to speak.' : ''), 'quiet')
        ]);
      },
      player: function (i) {
        var out = [];
        if (i === sp) {
          out.push(p('When ' + nameOf(li) + ' has said it back, did they get it?'));
          out.push(h('div', { class: 'row' },
            btn("Yes, that's it  +" + E.POINTS.yes, function () {
              act(function () { E.yes(S, piles, rng); });
              buzz(20);
            }, { kind: 'primary', k: 'yes', aria: nameOf(i) + ": Yes, that's it. Plus " + E.POINTS.yes + ' to the jar.' }),
            btn('Not quite', function () {
              toast(nameOf(sp) + ' clarifies briefly, then ' + nameOf(li) + ' tries again.');
            }, { k: 'notquite', aria: nameOf(i) + ': Not quite' })));
          out.push(floorTimer());
        } else {
          out.push(p('Then say it back:'), p('“What I heard is…”', 'voice'));
          out.push(h('details', null, h('summary', null, 'Curious follow-ups'), followUpList()));
        }
        out.push(playerRow(i));
        return out;
      }
    };
  }

  function breakScreen() {
    return {
      key: 'break', title: 'A real break',
      shared: function () {
        return [
          h('p', { class: 'timer big' }, h('span', { 'data-timer': 'break' }, fmt(S.breakEndsAt - Date.now()))),
          p("Don't rehearse your argument while you're apart."),
          p('The card is parked. Twenty minutes is a guide: come back when you are both ready.', 'quiet')
        ];
      },
      actions: function () {
        return [btn("We're back. Next card", function () { act(function () { E.endBreak(S, piles, rng); }); },
          { kind: 'primary', k: 'back' })];
      }
    };
  }

  function closingScreen() {
    var field = function (i, list, label, k) {
      return h('label', { class: 'field' }, h('span', null, label),
        h('textarea', {
          rows: '2', 'data-k': k + i, value: list[i],
          'aria-label': nameOf(i) + ': ' + label,
          oninput: function (e) { list[i] = e.target.value; saveSession(); }
        }));
    };
    return {
      key: 'closing', title: 'Close',
      shared: function () {
        return [p('One commitment each, about your own action. One appreciation each.')];
      },
      player: function (i) {
        return [field(i, S.commitments, "This week I'll…", 'commit'),
          field(i, S.appreciations, 'Tonight I appreciated…', 'apprec')];
      },
      actions: function () {
        return [btn('Finish  +' + E.POINTS.close, function () {
          act(function () {
            var rec = E.finish(S, Date.now());
            history = [rec].concat(history.filter(function (r) { return r.id !== rec.id; }));
            store.set(KEY.history, history);
          });
          buzz([30, 60, 30]);
        }, { kind: 'primary', k: 'finish', aria: 'Finish. Plus ' + E.POINTS.close + ' to the jar.' })];
      }
    };
  }

  function summaryScreen() {
    return {
      key: 'summary', title: 'Tonight',
      shared: function () { return [summaryNodes(S.record), p('Saved to your history on this device.', 'quiet')]; },
      actions: function () {
        return shareButtons(S.record).concat([btn('Done', function () {
          S = null;
          saveSession();
          view = { name: 'home' };
          render();
        }, { kind: 'primary', k: 'done' })]);
      }
    };
  }

  function gameScreen() {
    var sc = {
      pledge: pledgeScreen, lasttime: lastTimeScreen, weather: weatherScreen, coin: coinScreen,
      temp: tempScreen, card: cardScreen, 'break': breakScreen, closing: closingScreen, summary: summaryScreen
    }[S.phase]();
    // The summary is read together, so it always uses the single layout.
    sc.game = S.phase !== 'summary';
    return sc;
  }

  /* ---------- screens outside a game ---------- */

  function soloScreen(key, title, nodes) {
    return { key: key, title: title, shared: function () { return nodes; } };
  }

  function onboardingScreen() {
    return soloScreen('onboarding', 'How to play', [
      p('A check-in for two. It starts light, goes deeper in the middle and ends warm.'),
      howToContent(),
      p('You can open this any time from the menu.', 'quiet'),
      h('div', { class: 'actions' }, btn('Got it', function () {
        settings.onboarded = true;
        saveSettings();
        view = { name: 'home' };
        render();
      }, { kind: 'primary', k: 'gotit' }))
    ]);
  }

  function startGame() {
    settings.names = settings.names.map(function (n, i) { return n.trim() || DEFAULT_SETTINGS.names[i]; });
    if (settings.names[0] === settings.names[1]) settings.names[1] += ' 2';
    settings.prize = settings.prize.trim();
    saveSettings();
    S = E.newSession(settings, piles, history, Date.now());
    ui.floor = null;
    ui.jarFrac = 0;
    saveSession();
    view = { name: 'game' };
    render();
  }

  function homeScreen() {
    var nodes = [];
    var hero = [h('div', { class: 'fan', 'aria-hidden': 'true' }, [0, 1, 2].map(function () { return h('i'); })),
      p('Starts light, goes deep, ends warm.', 'voice')];
    var links = h('div', { class: 'menu' },
      btn('History', function () { view = { name: 'history' }; render(); }, { k: 'hist' }),
      btn('Edit cards', function () { view = { name: 'editor' }; render(); }, { k: 'edit' }),
      btn('How to play', function () { showHowTo(); }, { k: 'how' }),
      btn('Say this instead', function () { showCheat(); }, { k: 'cheat' }));

    if (S) {
      nodes.push(p(S.phase === 'summary' ? "Tonight's summary is ready."
        : 'A game between ' + S.names[0] + ' and ' + S.names[1] + ' is in progress.'));
      nodes.push(h('div', { class: 'actions' },
        btn(S.phase === 'summary' ? 'See the summary' : 'Resume the game', function () { view = { name: 'game' }; render(); },
          { kind: 'primary', k: 'resume' }),
        S.phase === 'summary' ? null : btn('End it and start a new one', function () {
          confirmSheet('End this game?', "It won't be saved to your history.", 'End it', function () {
            S = null;
            saveSession();
            render();
          });
        }, { k: 'discard' })));
      nodes.push(links);
      return Object.assign(soloScreen('home-resume', 'The Check\u2011In Game', nodes), { hero: hero });
    }

    var nameField = function (i) {
      return h('label', { class: 'field' }, h('span', null, 'Player ' + (i + 1)),
        h('input', {
          type: 'text', value: settings.names[i], maxlength: '24', autocomplete: 'off', 'data-k': 'name' + i,
          oninput: function (e) { settings.names[i] = e.target.value; saveSettings(); }
        }));
    };
    var lengthPick = h('fieldset', null, h('legend', null, 'Game length'),
      Object.keys(E.LENGTHS).map(function (id) {
        return h('label', { class: 'radio' },
          h('input', {
            type: 'radio', name: 'length', value: id, checked: settings.length === id, 'data-k': 'len-' + id,
            onchange: function () { settings.length = id; saveSettings(); }
          }), ' ' + E.LENGTHS[id]);
      }));
    var check = function (key, label) {
      return h('label', { class: 'radio' },
        h('input', {
          type: 'checkbox', checked: settings[key], 'data-k': 'set-' + key,
          onchange: function (e) { settings[key] = e.target.checked; saveSettings(); }
        }), ' ' + label);
    };
    nodes.push(
      nameField(0), nameField(1), lengthPick,
      h('label', { class: 'field' }, h('span', null, 'Shared prize if the jar fills (optional)'),
        h('input', {
          type: 'text', value: settings.prize, maxlength: '80', placeholder: 'e.g. dessert run', 'data-k': 'prize',
          oninput: function (e) { settings.prize = e.target.value; saveSettings(); }
        })),
      check('tableMode', 'Table mode: the phone lies between you, each with your own controls'),
      check('haptics', 'Vibrate on confirmations and timers'),
      h('div', { class: 'actions' }, btn('Start', startGame, { kind: 'primary', k: 'start' })),
      links);
    return Object.assign(soloScreen('home', 'The Check\u2011In Game', nodes), { hero: hero });
  }

  function exportData() {
    var data = {
      app: 'check-in-game', version: 1, exportedAt: new Date().toISOString(),
      settings: settings, history: history, cards: store.get(KEY.cards, null)
    };
    var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    var a = h('a', { href: url, download: 'check-in-game-backup-' + data.exportedAt.slice(0, 10) + '.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Backup file saved.');
  }

  function importData(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast("Couldn't read that file."); };
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { data = null; }
      if (!data || data.app !== 'check-in-game' || !Array.isArray(data.history)) {
        toast("That doesn't look like a Check-In Game backup.");
        return;
      }
      var seen = {};
      var merged = history.concat(data.history).filter(function (r) {
        if (!r || !r.id || !r.date || seen[r.id]) return false;
        seen[r.id] = true;
        return true;
      }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      var added = merged.length - history.length;
      history = merged;
      store.set(KEY.history, history);
      if (validPiles(data.cards)) { piles = data.cards; store.set(KEY.cards, piles); }
      if (data.settings && Array.isArray(data.settings.names)) {
        settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
        saveSettings();
      }
      toast('Imported. ' + added + ' new session' + (added === 1 ? '' : 's') + ' added.');
      render();
    };
    reader.readAsText(file);
  }

  function historyScreen() {
    var picker = h('input', {
      type: 'file', accept: 'application/json,.json', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true',
      onchange: function (e) { importData(e.target.files[0]); e.target.value = ''; }
    });
    return soloScreen('history', 'History', [
      history.length
        ? h('ul', { class: 'list' }, history.map(function (rec) {
          return h('li', null, btn(E.formatDate(rec.date) + ' · ' + rec.names.join(' & ') +
            (rec.full ? " · jar's full" : ''), function () { view = { name: 'session', id: rec.id }; render(); },
          { k: 'rec-' + rec.id }));
        }))
        : p('No games yet. Finished games are saved here, on this device only.'),
      h('div', { class: 'actions' },
        btn('Export all data', exportData, { k: 'export' }),
        btn('Import data', function () { picker.click(); }, { k: 'import' }),
        picker,
        btn('Back', function () { view = { name: 'home' }; render(); }, { k: 'back' })),
      p('Export makes a backup file you can import on another phone. Nothing leaves this device unless you send it.', 'quiet')
    ]);
  }

  function sessionScreen() {
    var rec = history.filter(function (r) { return r.id === view.id; })[0];
    if (!rec) { view = { name: 'history' }; return historyScreen(); }
    return soloScreen('session-' + rec.id, E.formatDate(rec.date), [
      summaryNodes(rec),
      h('div', { class: 'actions' }, shareButtons(rec),
        btn('Delete this game', function () {
          confirmSheet('Delete this game?', 'Its summary, commitments and parked topics will be removed from this device.', 'Delete', function () {
            history = history.filter(function (r) { return r.id !== rec.id; });
            store.set(KEY.history, history);
            view = { name: 'history' };
            render();
          });
        }, { k: 'del' }),
        btn('Back', function () { view = { name: 'history' }; render(); }, { k: 'back' }))
    ]);
  }

  function editorScreen() {
    var pile = piles.filter(function (x) { return x.id === ui.editorPile; })[0] || piles[0];
    var commit = function () {
      store.set(KEY.cards, piles);
    };
    var edit = function (fn) {
      // Work on a private copy so the defaults stay intact for "reset".
      piles = JSON.parse(JSON.stringify(piles));
      pile = piles.filter(function (x) { return x.id === pile.id; })[0];
      fn();
      commit();
      render();
    };
    var draft = h('textarea', { rows: '2', 'data-k': 'new', 'aria-label': 'New card for ' + pile.name });
    return soloScreen('editor', 'Edit cards', [
      h('label', { class: 'field' }, h('span', null, 'Pile'),
        h('select', {
          'data-k': 'pile',
          onchange: function (e) { ui.editorPile = e.target.value; render(); }
        }, piles.map(function (x) {
          var opt = h('option', { value: x.id }, x.name + ' (' + x.cards.length + ')');
          opt.selected = x.id === pile.id;
          return opt;
        }))),
      p((pile.talkingStick ? 'Deep, talking-stick pile. ' : 'Light pile. ') + (pile.hint || ''), 'quiet'),
      p('Keep questions about your own feelings, needs and part. No card should invite blaming the other.', 'quiet'),
      h('ol', { class: 'list cards' }, pile.cards.map(function (text, idx) {
        return h('li', null,
          h('textarea', {
            rows: '2', value: text, 'data-k': 'card' + idx, 'aria-label': pile.name + ' card ' + (idx + 1),
            onchange: function (e) {
              var v = e.target.value.trim();
              if (!v) { e.target.value = text; return; }
              edit(function () { pile.cards[idx] = v; });
              toast('Saved.');
            }
          }),
          btn('Delete', function () { edit(function () { pile.cards.splice(idx, 1); }); },
            { kind: 'small', k: 'del' + idx, aria: 'Delete ' + pile.name + ' card ' + (idx + 1) }));
      })),
      h('div', { class: 'field' }, h('span', null, 'Add a card'), draft),
      h('div', { class: 'actions' },
        btn('Add card', function () {
          var v = draft.value.trim();
          if (!v) return;
          if (pile.cards.indexOf(v) >= 0) { toast('That card is already in this pile.'); return; }
          edit(function () { pile.cards.push(v); });
        }, { k: 'add' }),
        btn('Reset all piles to defaults', function () {
          confirmSheet('Reset all cards?', 'Every pile goes back to the original cards. Your edits will be removed.', 'Reset', function () {
            store.del(KEY.cards);
            piles = defaultPiles;
            render();
          });
        }, { k: 'reset' }),
        btn('Back', function () { view = { name: 'home' }; render(); }, { k: 'back' })),
      p('Changes are saved on this device. To change the defaults for everyone, edit cards.json.', 'quiet')
    ]);
  }

  /* ---------- layout and render ---------- */

  function currentScreen() {
    if (view.name === 'game' && !S) view = { name: 'home' };
    switch (view.name) {
      case 'onboarding': return onboardingScreen();
      case 'game': return gameScreen();
      case 'history': return historyScreen();
      case 'session': return sessionScreen();
      case 'editor': return editorScreen();
      default: return homeScreen();
    }
  }

  function moreButton(facing) {
    return btn('More', function () { showMenu(facing); }, { k: 'more', aria: 'More options' });
  }

  function single(sc) {
    var main = h('main', { class: 'screen' });
    if (sc.game) {
      main.append(h('header', { class: 'bar' },
        roundTrack(), jarButton(), moreButton()));
    }
    if (sc.hero) main.append(sc.hero[0]);
    main.append(h('h1', { tabindex: '-1', 'data-title': '', class: sc.hideTitle ? 'sr-only' : null }, sc.title));
    if (sc.hero) main.append(sc.hero[1]);
    add(main, sc.shared ? sc.shared() : null);
    var actions = sc.actions ? h('div', { class: 'actions' }, sc.actions()) : null;
    if (actions && sc.actionsFirst) main.append(actions);
    if (sc.player) {
      [0, 1].forEach(function (i) {
        var role = sc.role ? sc.role(i) : null;
        main.append(h('section', { class: 'player', 'aria-label': nameOf(i), 'data-role': role },
          h('h2', null, nameOf(i), role ? h('span', { class: 'role' }, role) : null), sc.player(i)));
      });
    }
    if (actions && !sc.actionsFirst) main.append(actions);
    return main;
  }

  /* Table mode: the top half is turned to face the player sitting opposite. */
  function table(sc) {
    var half = function (side) {
      var el = h('section', { class: 'half' + (side === 1 ? ' flip' : ''), 'aria-label': nameOf(side) + "'s side" },
        h('h1', { tabindex: '-1', 'data-title': side === 0 ? '' : null, class: sc.hideTitle ? 'sr-only' : null }, sc.title));
      add(el, sc.shared ? sc.shared() : null);
      var actions = function () { return sc.actions ? h('div', { class: 'actions' }, sc.actions()) : null; };
      if (sc.actionsFirst) add(el, actions());
      var role = sc.role ? sc.role(side) : null;
      if (sc.player) {
        add(el, h('div', { class: 'player', 'data-role': role },
          h('h2', null, nameOf(side), role ? h('span', { class: 'role' }, role) : null), sc.player(side)));
      }
      if (!sc.actionsFirst) add(el, actions());
      add(el, h('div', { class: 'actions' }, moreButton(side)));
      el.querySelectorAll('[data-k]').forEach(function (n) { n.dataset.k = side + ':' + n.dataset.k; });
      return el;
    };
    return h('main', { class: 'screen table' }, half(1),
      h('div', { class: 'strip' }, roundTrack(), jarButton(0)), half(0));
  }

  var lastKey = null;

  function render() {
    var root = document.getElementById('app');
    var focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
    var scrolls = Array.prototype.map.call(root.querySelectorAll('.half'), function (el) { return el.scrollTop; });
    var sc = currentScreen();
    var tableMode = !!(sc.game && S && S.tableMode);
    document.body.classList.toggle('table-mode', tableMode);
    document.body.dataset.theme = themeFor(sc);
    root.replaceChildren(tableMode ? table(sc) : single(sc));
    ui.dealt = S && S.card ? S.card.text : null;

    var key = (tableMode ? 't:' : 's:') + sc.key;
    if (key !== lastKey) {
      lastKey = key;
      window.scrollTo(0, 0);
      var title = root.querySelector('[data-title]');
      if (title) title.focus({ preventScroll: true });
      return;
    }
    root.querySelectorAll('.half').forEach(function (el, i) { el.scrollTop = scrolls[i] || 0; });
    if (focused) {
      var again = root.querySelector('[data-k="' + focused.replace(/"/g, '\\"') + '"]');
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
  }

  /* Soft timers: a toast and a buzz, never a cutoff. */
  setInterval(function () {
    var now = Date.now();
    var paint = function (name, ms) {
      document.querySelectorAll('[data-timer="' + name + '"]').forEach(function (el) { el.textContent = fmt(ms); });
    };
    if (ui.floor) {
      paint('floor', ui.floor.endsAt - now);
      if (now >= ui.floor.endsAt && !ui.floor.fired) {
        ui.floor.fired = true;
        toast('Two minutes. Find a place to land, no rush.');
        buzz([200, 100, 200]);
      }
    }
    if (S && S.phase === 'break' && S.breakEndsAt) {
      paint('break', S.breakEndsAt - now);
      if (now >= S.breakEndsAt && ui.breakFiredFor !== S.breakEndsAt) {
        ui.breakFiredFor = S.breakEndsAt;
        toast("Twenty minutes. Come back when you're both ready.");
        buzz([200, 100, 200]);
      }
    }
  }, 500);

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline install is optional */ });
  }

  loadCards().then(render);
})();
