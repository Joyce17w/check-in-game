# The Check-In Game

A two-player check-in card game for one phone. Static files only: no build step,
no accounts, no analytics, no network calls beyond loading its own files.
Everything you write stays in the browser's storage on that device.

## Run it

```
npm start        # serves this folder at http://localhost:4173
```

Any static host works (GitHub Pages, Netlify, Cloudflare Pages): upload the
folder as it is. Opening `index.html` straight from disk also works, without
the offline install.

On a phone, open the hosted address and use "Add to Home Screen". After the
first visit it runs offline.

## Change the cards

Edit `cards.json`, then run `npm run sync` so the bundled fallback copy
(`js/cards.default.js`) matches. Each pile has `id`, `name`, `talkingStick`,
`hint` and `cards`. Keep the eight pile ids: the round plan refers to them.

Cards can also be edited inside the app (Edit cards). Those edits are saved on
that device only and override `cards.json` until "Reset all piles to defaults".

## Files

| File | What it is |
| --- | --- |
| `js/engine.js` | The rules: rounds, turns, passes, scoring, summary. No DOM. |
| `js/app.js` | Screens, storage, timers. |
| `styles.css` | The visual design. Each round has a colour theme set by `--bg` and `--ink`; system fonts only. |
| `cards.json` | The card piles. |
| `sw.js`, `manifest.webmanifest` | Offline install. |
| `icons/icon.svg` | The app icon. After editing it, run `npm run icons` to re-render the PNGs. |
| `tests/engine.test.mjs` | Rule tests. Run with `npm test`. |

## After changing any file

The service worker serves the cached copy first and refreshes in the
background, so a change shows up on the second load. If you add or rename
files, update the list in `sw.js` and bump its `CACHE` name.

## Rule decisions the spec left open

- The jar's maximum is the planned cards for the chosen length plus the close
  bonus. Shields and the reset Challenge card added after a warm temperature
  check are extra, so they can only help.
- A deep card takes two taps: each speaker taps "Yes, that's it" once the
  listener has said it back, and the second tap deals the next card.
- A pass on a deep card can be played ahead of your turn. It is unavailable
  once you have spoken.
- "Go to close" skips the temperature check. Pressed during the Close round,
  it goes to the commitments.
- A skipped temperature check is recorded as "skipped, both calm".
- Unfinished games are saved and can be resumed from the home screen. Only
  finished games go into the history.
