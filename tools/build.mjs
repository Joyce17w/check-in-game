// Regenerates js/cards.default.js, the copy of cards.json the app falls back
// to when it is opened straight from a file (fetch is blocked there).
// Run with: npm run sync
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const cards = JSON.parse(readFileSync(join(root, 'cards.json'), 'utf8'));
writeFileSync(
  join(root, 'js/cards.default.js'),
  '// GENERATED from cards.json by tools/build.mjs. Edit cards.json, then run: npm run sync\n' +
  'window.DEFAULT_CARDS = ' + JSON.stringify(cards, null, 2) + ';\n'
);

console.log('Wrote js/cards.default.js');
