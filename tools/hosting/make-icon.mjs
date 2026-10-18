// Draws the Graao Host icon (the graao planet with a yellow "host" sun) into apps/host/resources/icon.png (256 px)
// and icon.ico (256/64/48/32/16, PNG-compressed entries). No image libraries: 4×4 supersampled shapes, zlib, done.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const INK = [42, 33, 48];
const LEAF = [127, 174, 85];
const SKY = [79, 134, 201];
const SUN = [255, 211, 110];

/** Color of the icon at (x, y) in a 64×64 design space, or null for transparent. */
function sample(x, y) {
  const sun = Math.hypot(x - 50, y - 14);
  if (sun <= 8) return SUN;
  if (sun <= 10.5) return INK;
  const r = Math.hypot(x - 32, y - 32);
  if (r > 30) return null;
  if (r > 26) return INK;
  // The sea: below a wavy line, like the favicon.
  const wave = 34 + 4 * Math.sin((x - 8) / 7.5) - (x > 40 ? (x - 40) * 0.25 : 0);
  return y > wave ? SKY : LEAF;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample(((i + (sx + 0.5) / ss) / size) * 64, ((j + (sy + 0.5) / ss) / size) * 64);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
      const o = (j * size + i) * 4;
      if (a) {
        px[o] = Math.round(r / a);
        px[o + 1] = Math.round(g / a);
        px[o + 2] = Math.round(b / a);
      }
      px[o + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const px = render(size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) px.copy(raw, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const sizes = [256, 64, 48, 32, 16];
const images = sizes.map(png);
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, k) => {
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s;
  e[1] = s >= 256 ? 0 : s;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[k].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[k].length;
  return e;
});
mkdirSync('apps/host/resources', { recursive: true });
writeFileSync('apps/host/resources/icon.png', images[0]);
writeFileSync('apps/host/resources/icon.ico', Buffer.concat([header, ...dir, ...images]));
console.log('icon → apps/host/resources/icon.png, icon.ico');
