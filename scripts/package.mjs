// `npm run package`: production build into release/ (dist/ is left alone for
// `npm run dev`), then zips it to site/downloads/ for the website download.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { build } from 'vite';

const OUT = 'release/nichespark';
const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
const zipPath = `site/downloads/nichespark-${manifest.version}.zip`;

delete process.env.NS_DEV_RELOAD_PORT; // never ship the dev auto-reload client
process.env.NS_OUT_DIR = OUT;
rmSync('release', { recursive: true, force: true });
await build({ configFile: 'vite.config.ts', mode: 'production', logLevel: 'warn' });
await build({ configFile: 'vite.content.config.ts', mode: 'production', logLevel: 'warn' });

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
})(OUT);

for (const f of files) {
  if (f.endsWith('.js') && /dev\.lastBuildId|ws:\/\/localhost/.test(readFileSync(f, 'utf8'))) {
    throw new Error(`Refusing to package: dev reload code found in ${f}`);
  }
}

// Minimal ZIP writer (deflate), so packaging needs no extra dependencies.
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

const locals = [];
const centrals = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(relative(OUT, file).split('\\').join('/'));
  const data = readFileSync(file);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(0, 10); // time/date
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);
  offset += 30 + name.length + packed.length;
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync('site/downloads', { recursive: true });
for (const old of readdirSync('site/downloads')) if (old.endsWith('.zip')) rmSync(join('site/downloads', old));
writeFileSync(zipPath, Buffer.concat([...locals, ...centrals, end]));
console.log(`Packaged ${files.length} files -> ${zipPath}`);
