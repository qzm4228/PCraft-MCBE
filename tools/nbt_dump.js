/*
 * Minimal NBT reader + dumper for inspecting Java structure files.
 * Usage: node tools/nbt_dump.js <file.nbt>
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');

function readNbt(buf) {
  let i = 0;
  const u8 = () => buf[i++];
  const i16 = () => { const v = buf.readInt16BE(i); i += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(i); i += 4; return v; };
  const i64 = () => { const v = buf.readBigInt64BE(i); i += 8; return v; };
  const f32 = () => { const v = buf.readFloatBE(i); i += 4; return v; };
  const f64 = () => { const v = buf.readDoubleBE(i); i += 8; return v; };
  const str = () => { const n = buf.readUInt16BE(i); i += 2; const s = buf.toString('utf8', i, i + n); i += n; return s; };
  function payload(type) {
    switch (type) {
      case 0: return null;
      case 1: return u8();
      case 2: return i16();
      case 3: return i32();
      case 4: return i64();
      case 5: return f32();
      case 6: return f64();
      case 7: { const n = i32(); const a = buf.slice(i, i + n); i += n; return a; }
      case 8: return str();
      case 9: {
        const t = u8(); const n = i32(); const a = [];
        for (let k = 0; k < n; k++) a.push(payload(t));
        return a;
      }
      case 10: {
        const o = {};
        for (;;) { const t = u8(); if (t === 0) break; const name = str(); o[name] = payload(t); }
        return o;
      }
      case 11: { const n = i32(); const a = []; for (let k = 0; k < n; k++) a.push(i32()); return a; }
      case 12: { const n = i32(); const a = []; for (let k = 0; k < n; k++) a.push(i64()); return a; }
      default: throw new Error('bad tag ' + type + ' at ' + i);
    }
  }
  const t = u8();
  if (t !== 10) throw new Error('root not compound: ' + t);
  str();
  return payload(10);
}

const file = process.argv[2];
if (!file) { console.error('usage: node tools/nbt_dump.js <file.nbt>'); process.exit(1); }
let buf = fs.readFileSync(file);
if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
const root = readNbt(buf);

const out = {};
if (root.size) out.size = root.size;
if (root.DataVersion !== undefined) out.DataVersion = root.DataVersion;
if (root.palette) out.palette = root.palette.map((p) => p.Name + (p.Properties ? ' ' + JSON.stringify(p.Properties) : ''));
if (root.blocks) {
  out.blockCount = root.blocks.length;
  out.blocksSample = root.blocks.slice(0, 40).map((b) => ({ pos: b.pos, state: b.state, nbt: b.nbt ? Object.keys(b.nbt) : undefined }));
}
if (root.entities) {
  out.entityCount = root.entities.length;
  out.entitiesSample = root.entities.slice(0, 10).map((e) => ({ pos: e.pos, id: e.nbt?.id }));
}
console.log(JSON.stringify(out, null, 2));
