// Generates the NicheSpark PNG icons (rounded square + four-point spark) with no dependencies.
// Usage: node scripts/generate-icons.mjs          (extension icons)
//        node scripts/generate-icons.mjs --site   (website icons)
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const SITE = process.argv.includes('--site');

function render(size) {
  // Same design as site/assets/logo.svg: emerald gradient tile, white spark,
  // small mint companion spark (all coordinates in a 64-unit box).
  const ss = 4; // supersampling
  const rows = [];
  const from = [6, 95, 70]; // #065f46
  const to = [16, 185, 129]; // #10b981
  const white = [255, 255, 255];
  const mint = [167, 243, 208]; // #a7f3d0
  const star = (u, v, cx, cy, r) => (Math.abs(u - cx) / r) ** 0.55 + (Math.abs(v - cy) / r) ** 0.55 <= 1;
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      let a = 0;
      let acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = ((x + (sx + 0.5) / ss) / size) * 64;
          const py = ((y + (sy + 0.5) / ss) / size) * 64;
          const r = 15, dx = Math.max(Math.abs(px - 32) - (32 - r), 0), dy = Math.max(Math.abs(py - 32) - (32 - r), 0);
          if (dx * dx + dy * dy > r * r) continue;
          a++;
          let c = from.map((f, i) => f + (to[i] - f) * ((px + py) / 128));
          if (star(px, py, 32, 30, 19)) c = white;
          else if (star(px, py, 48, 15, 6)) c = mint;
          acc = acc.map((v, i) => v + c[i]);
        }
      }
      const n = ss * ss;
      row.push(...(a ? acc.map((v) => Math.round(v / a)) : [0, 0, 0]), Math.round((a / n) * 255));
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (SITE) for (const size of [32, 128, 180]) writeFileSync(`site/assets/logo-${size}.png`, render(size));
else for (const size of [16, 32, 48, 128]) writeFileSync(`public/icons/icon-${size}.png`, render(size));
console.log('icons written');
