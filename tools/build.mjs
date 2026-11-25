// Regenerates the two derived files. Run with: npm run sync
//   js/cards.default.js  a copy of cards.json the app falls back to when it
//                        is opened straight from a file (fetch is blocked there)
//   icons/*.png          placeholder app icons (replace when the design lands)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const cards = JSON.parse(readFileSync(join(root, 'cards.json'), 'utf8'));
writeFileSync(
  join(root, 'js/cards.default.js'),
  '// GENERATED from cards.json by tools/build.mjs. Edit cards.json, then run: npm run sync\n' +
  'window.DEFAULT_CARDS = ' + JSON.stringify(cards, null, 2) + ';\n'
);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

// A plain disc on a plain field: a jar seen from above. Placeholder only.
function icon(size) {
  const bg = [38, 50, 56], fg = [255, 213, 128];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const r = size * 0.3, c = size / 2;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const inside = Math.hypot(x + 0.5 - c, y + 0.5 - c) <= r;
      raw.set(inside ? fg : bg, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

mkdirSync(join(root, 'icons'), { recursive: true });
for (const size of [180, 192, 512]) writeFileSync(join(root, `icons/icon-${size}.png`), icon(size));

console.log('Wrote js/cards.default.js and icons/');
