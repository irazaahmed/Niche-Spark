// Generates the NicheSpark PNG icons (rounded square + four-point spark) with no dependencies.
// Usage: node scripts/generate-icons.mjs
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

function render(size) {
  const ss = 4; // supersampling
  const rows = [];
  const bg = [79, 70, 229]; // indigo-600
  const fg = [255, 255, 255];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      let cover = 0;
      let spark = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size - 0.5;
          const v = (y + (sy + 0.5) / ss) / size - 0.5;
          const r = 0.22, h = 0.5 - r;
          const dx = Math.max(Math.abs(u) - h, 0), dy = Math.max(Math.abs(v) - h, 0);
          if (dx * dx + dy * dy <= r * r) {
            cover++;
            // four-point star: |u|^p + |v|^p <= R^p with p < 1
            const p = 0.55, R = 0.36;
            if (Math.abs(u) ** p + Math.abs(v) ** p <= R ** p) spark++;
          }
        }
      }
      const n = ss * ss;
      const a = cover / n, s = cover ? spark / cover : 0;
      const c = bg.map((b, i) => Math.round(b + (fg[i] - b) * s));
      row.push(...c, Math.round(a * 255));
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

for (const size of [16, 32, 48, 128]) writeFileSync(`public/icons/icon-${size}.png`, render(size));
console.log('icons written');
