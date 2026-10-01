// Generates a 9-slice frame texture for the gender menu (dark fill + beveled
// grey border). Stretch it with nineslice_size so it fits any content size.
// Run: node tools/gen_gender_frame.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'gender_pack', 'resource_pack', 'textures', 'pcraftrevorn_gender', 'gui', 'frame.png');

// ---- minimal PNG writer (RGBA) ----
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'ascii'); const body = Buffer.concat([t, data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); }
function writePng(file, w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4; const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ---- draw a 24x24 beveled frame; nineslice_size 8 ----
const W = 24, H = 24;
const px = Buffer.alloc(W * H * 4, 0);
const set = (x, y, r, g, b, a = 255) => { const i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const m = Math.min(x, y, W - 1 - x, H - 1 - y);
  const topLeft = Math.min(x, y) <= Math.min(W - 1 - x, H - 1 - y);
  let c;
  if (m === 0) c = [0x18, 0x18, 0x1c];                       // outer black line
  else if (m === 1) c = topLeft ? [0xd6, 0xd6, 0xda] : [0x3a, 0x3a, 0x42]; // bevel
  else if (m === 2) c = [0x8a, 0x8a, 0x92];
  else if (m === 3) c = [0x2a, 0x2a, 0x30];
  else c = [0x16, 0x16, 0x1a];                               // dark fill
  set(x, y, c[0], c[1], c[2]);
}
writePng(OUT, W, H, px);
console.log('wrote', OUT);
