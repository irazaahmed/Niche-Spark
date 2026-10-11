// Generates site/assets/og-image.png (1200x630 social preview) with no dependencies.
// Usage: node scripts/generate-og.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 1200, H = 630, SS = 3;
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body)); return Buffer.concat([l, body, c]); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const from = [67, 56, 202], to = [124, 58, 237]; // indigo -> violet
// Sparks: [cx, cy, radius, opacity]
const sparks = [[600, 300, 190, 1], [330, 150, 50, 0.35], [880, 460, 70, 0.3], [960, 150, 34, 0.25], [250, 470, 28, 0.25]];
const inSpark = (x, y, [cx, cy, r]) => { const u = Math.abs(x - cx) / r, v = Math.abs(y - cy) / r; return u ** 0.55 + v ** 0.55 <= 1; };

const rows = [];
for (let y = 0; y < H; y++) {
  const row = [0];
  for (let x = 0; x < W; x++) {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
      let c = mix(from, to, (px / W) * 0.7 + (py / H) * 0.3);
      for (const s of sparks) if (inSpark(px, py, s)) c = mix(c, [255, 255, 255], s[3]);
      acc = acc.map((v, i) => v + c[i]);
    }
    row.push(...acc.map((v) => Math.round(v / (SS * SS))));
  }
  rows.push(Buffer.from(row));
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr.set([8, 2, 0, 0, 0], 8);
writeFileSync('site/assets/og-image.png', Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log('og-image written');
