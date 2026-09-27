/*
 * Converts Java structure .nbt (big-endian, gzip) into a compact JS data table
 * that scripts can place with BlockPermutation.resolve().
 * Avoids the binary .mcstructure format entirely.
 *
 * Usage: node tools/nbt_to_data.js
 * Output: behavior_pack/scripts/pcraftrevorn/data/structures.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const MOD = path.join(ROOT, '.work', 'mod');
const SRC = path.join(MOD, 'data', 'pcraftrevorn', 'structures');
const OUT = path.join(ROOT, 'behavior_pack', 'scripts', 'pcraftrevorn', 'data', 'structures.js');

// ---------- big-endian NBT reader ----------
function readNbt(buf) {
  let i = 0;
  const u8 = () => buf[i++];
  const i16 = () => { const v = buf.readInt16BE(i); i += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(i); i += 4; return v; };
  const i64 = () => { const v = buf.readBigInt64BE(i); i += 8; return v; };
  const f32 = () => { const v = buf.readFloatBE(i); i += 4; return v; };
  const f64 = () => { const v = buf.readDoubleBE(i); i += 8; return v; };
  const str = () => { const n = buf.readUInt16BE(i); i += 2; const s = buf.toString('utf8', i, i + n); i += n; return s; };
  function payload(t) {
    switch (t) {
      case 0: return null;
      case 1: return u8();
      case 2: return i16();
      case 3: return i32();
      case 4: return i64();
      case 5: return f32();
      case 6: return f64();
      case 7: { const n = i32(); const a = buf.slice(i, i + n); i += n; return a; }
      case 8: return str();
      case 9: { const et = u8(); const n = i32(); const a = []; for (let k = 0; k < n; k++) a.push(payload(et)); return a; }
      case 10: { const o = {}; for (;;) { const et = u8(); if (et === 0) break; o[str()] = payload(et); } return o; }
      case 11: { const n = i32(); const a = []; for (let k = 0; k < n; k++) a.push(i32()); return a; }
      case 12: { const n = i32(); const a = []; for (let k = 0; k < n; k++) a.push(i64()); return a; }
      default: throw new Error('bad tag ' + t);
    }
  }
  const t = u8();
  if (t !== 10) throw new Error('root not compound');
  str();
  return payload(10);
}

// ---------- Java -> Bedrock state mapping ----------
const STAIR_DIR = { east: 0, west: 1, south: 2, north: 3 };
const FACE_DIR = { north: 'north', east: 'east', south: 'south', west: 'west' };
const WALL_CONN = { none: 'none', low: 'short', tall: 'tall' };

function mapBlock(javaName, props) {
  const states = {};
  if (props) {
    if (javaName.endsWith('_stairs')) {
      if (props.half !== undefined) states.upside_down_bit = props.half === 'top' ? 1 : 0;
      if (props.facing !== undefined) states.weirdo_direction = STAIR_DIR[props.facing] ?? 0;
    } else if (javaName.endsWith('_wall')) {
      for (const d of ['east', 'north', 'south', 'west']) {
        if (props[d] !== undefined) states[`wall_connection_type_${d}`] = WALL_CONN[props[d]] ?? 'none';
      }
      if (props.up !== undefined) states.wall_post_bit = props.up === 'true' ? 1 : 0;
    } else if (javaName === 'minecraft:basalt' || javaName === 'minecraft:chain') {
      if (props.axis) states.pillar_axis = props.axis;
    } else if (javaName === 'minecraft:chest') {
      if (props.facing) states['minecraft:cardinal_direction'] = FACE_DIR[props.facing];
    } else if (javaName.startsWith('pcraftrevorn:piglin_throne')) {
      if (props.facing) states['minecraft:cardinal_direction'] = FACE_DIR[props.facing];
    } else if (javaName === 'minecraft:lava') {
      states.liquid_depth = Number(props.level || 0);
    }
  }
  return { name: javaName, states };
}

// ---------- convert ----------
function convert(file) {
  let buf = fs.readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const root = readNbt(buf);
  const [sx, sy, sz] = root.size;
  const palette = (root.palette || []).map((p) => mapBlock(p.Name, p.Properties));
  const blocks = [];
  for (const b of root.blocks || []) {
    const [x, y, z] = b.pos;
    const idx = b.state | 0;
    if (palette[idx] && palette[idx].name === 'minecraft:air') continue;
    blocks.push([x, y, z, idx]);
  }
  // strip air from palette to compact (remap indices)
  const remap = new Map();
  const newPalette = [];
  for (let i = 0; i < palette.length; i++) {
    if (palette[i].name === 'minecraft:air') continue;
    remap.set(i, newPalette.length);
    newPalette.push(palette[i]);
  }
  const compact = blocks.map(([x, y, z, i]) => [x, y, z, remap.get(i)]);
  const entities = (root.entities || []).map((e) => {
    const id = e.nbt?.id;
    if (!id || String(id).startsWith('minecraft:experience_orb')) return null;
    return { id: String(id), x: Number(e.pos[0]), y: Number(e.pos[1]), z: Number(e.pos[2]) };
  }).filter(Boolean);
  return { size: [sx, sy, sz], palette: newPalette, blocks: compact, entities };
}

const targets = { remnant_throne_room: 'remnant_throne_room.nbt' };
const out = {};
for (const [name, file] of Object.entries(targets)) {
  const full = path.join(SRC, file);
  if (!fs.existsSync(full)) { console.error('missing ' + full); process.exit(1); }
  out[name] = convert(full);
  console.log(`${name}: ${out[name].blocks.length} blocks, ${out[name].palette.length} palette, ${out[name].entities.length} entities, size ${out[name].size.join('x')}`);
}

const js = '// AUTO-GENERATED by tools/nbt_to_data.js. Java structure -> Bedrock placeable data.\n'
  + '// blocks: [x, y, z, paletteIndex]; entities: {id, x, y, z}\n'
  + 'export const STRUCTURES = ' + JSON.stringify(out) + ';\n';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, js);
console.log('wrote ' + path.relative(ROOT, OUT));
