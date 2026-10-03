/*
 * PCraftRevorn -> Bedrock content generator (Phase 0 + Phase 1).
 *
 * PREREQUISITE: the original Forge jar must be extracted to ./.work/mod
 *   (see tools/extract.ps1, or extract the jar manually preserving paths).
 *
 * This script produces, from the decompiled/original assets:
 *   behavior_pack/   blocks, items, recipes, loot_tables, texts
 *   resource_pack/   textures, sounds, item/terrain atlases, block geometry, texts
 *
 * Namespace: pcraftrevorn
 *
 * Run:  node tools/generate.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const MOD = path.join(ROOT, '.work', 'mod');
const SRC_ASSETS = path.join(MOD, 'assets', 'pcraftrevorn');
const SRC_DATA = path.join(MOD, 'data', 'pcraftrevorn');
const BP = path.join(ROOT, 'behavior_pack');
const RP = path.join(ROOT, 'resource_pack');
const NS = 'pcraftrevorn';

// ---------------------------------------------------------------- helpers
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeText(file, text) { ensureDir(path.dirname(file)); fs.writeFileSync(file, text); }
function writeJSON(file, obj) { writeText(file, JSON.stringify(obj, null, 2) + '\n'); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function exists(p) { return fs.existsSync(p); }
function rmrf(p) { if (exists(p)) fs.rmSync(p, { recursive: true, force: true }); }
function copy(src, dst) { ensureDir(path.dirname(dst)); fs.copyFileSync(src, dst); }
function rgb(javaInt) { const n = (javaInt >>> 0) & 0xFFFFFF; return '#' + n.toString(16).padStart(6, '0'); }

// ---------------------------------------------------------------- png writer
const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePng(file, width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  ensureDir(path.dirname(file)); fs.writeFileSync(file, png);
}
function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
// ---- vanilla spawn-egg art (Java spawn_egg.png + overlay, tinted by colour) ----
function decodePngRgba(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504E47) return null;
  let off = 8, w = 0, h = 0, bit = 0, color = 0, interlace = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), d = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bit = d[8]; color = d[9]; interlace = d[12]; }
    else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bit !== 8 || interlace) return null;
  const ch = { 2: 3, 6: 4 }[color]; if (!ch) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = w * ch; const out = Buffer.alloc(w * h * 4, 0); const prev = Buffer.alloc(stride); let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++]; const line = Buffer.from(raw.slice(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0; let v = line[i];
      if (ft === 1) v = (v + a) & 255; else if (ft === 2) v = (v + b) & 255; else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      line[i] = v;
    }
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, s = x * ch; if (color === 6) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = line[s + 3]; } else { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = 255; } }
    line.copy(prev);
  }
  return { w, h, data: out };
}
const EGG_DIR = path.join(ROOT, 'tools', 'assets', 'egg');
const EGG_ART = (() => {
  try {
    const b = decodePngRgba(fs.readFileSync(path.join(EGG_DIR, 'spawn_egg.png')));
    const o = decodePngRgba(fs.readFileSync(path.join(EGG_DIR, 'spawn_egg_overlay.png')));
    if (b && o && b.w === o.w && b.h === o.h) return { base: b, overlay: o };
  } catch { /* fall through */ }
  return null;
})();
function makeEggPng(file, base, overlay) {
  const [br, bg, bb] = hexToRgb(base), [or, og, ob] = hexToRgb(overlay);
  if (EGG_ART) {
    const { w, h, data } = EGG_ART.base; const od = EGG_ART.overlay.data; const out = Buffer.alloc(w * h * 4, 0);
    for (let i = 0; i < w * h * 4; i += 4) {
      let r = data[i] * br / 255, g = data[i + 1] * bg / 255, bl = data[i + 2] * bb / 255, a = data[i + 3];
      if (od[i + 3] > 0) {
        const oa = od[i + 3] / 255;
        r = od[i] * or / 255 * oa + r * (1 - oa);
        g = od[i + 1] * og / 255 * oa + g * (1 - oa);
        bl = od[i + 2] * ob / 255 * oa + bl * (1 - oa);
        a = Math.max(a, od[i + 3]);
      }
      out[i] = Math.round(r); out[i + 1] = Math.round(g); out[i + 2] = Math.round(bl); out[i + 3] = a;
    }
    writePng(file, w, h, out);
    return;
  }
  // fallback: simple egg silhouette
  const W = 16, H = 16, buf = Buffer.alloc(W * H * 4, 0);
  const set = (x, y, r, g, b, a = 255) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a; };
  const rows = [[2, 7, 8], [3, 6, 9], [4, 5, 10], [5, 5, 10], [6, 4, 11], [7, 4, 11], [8, 4, 11], [9, 4, 11], [10, 4, 11], [11, 5, 10], [12, 5, 10], [13, 6, 9]];
  for (const [y, x0, x1] of rows) { const shade = y <= 7 ? 1.0 : y <= 10 ? 0.85 : 0.7; for (let x = x0; x <= x1; x++) set(x, y, Math.round(br * shade), Math.round(bg * shade), Math.round(bb * shade)); }
  for (const [x, y] of [[6, 4], [9, 5], [6, 7], [10, 8], [5, 9], [8, 10], [11, 7], [7, 12]]) set(x, y, or, og, ob);
  writePng(file, W, H, buf);
}

// ---------------------------------------------------------------- item data
// kind: item | food | armor | spawn_egg
const FOOD = {
  glowberry_juice_bottle: { nutrition: 12, saturation: 0.3, alwaysEat: true },
  fermented_glowberry_juice_bottle: { nutrition: 12, saturation: 0.5, alwaysEat: true }
};
const ARMOR = {
  silverfish_plating_helmet: { slot: 'slot.armor.head', protection: 2, durability: 165 },
  silverfish_plating_chestplate: { slot: 'slot.armor.chest', protection: 6, durability: 240 },
  silverfish_plating_leggings: { slot: 'slot.armor.legs', protection: 5, durability: 225 },
  silverfish_plating_boots: { slot: 'slot.armor.feet', protection: 2, durability: 195 }
};
const SPAWN_EGGS = {
  zombie_spawn_egg: { entity: 'zombie', base: -11363863, overlay: -13677023 },
  piglin_royal_spawn_egg: { entity: 'piglin_royal', base: -2978963, overlay: -3098555 },
  vinemaiden_spawn_egg: { entity: 'vinemaiden', base: -8403377, overlay: -3846321 },
  piglin_royal_knight_spawn_egg: { entity: 'piglin_royal_knight', base: -6133183, overlay: -3298757 },
  silverfish_spawn_egg: { entity: 'silverfish', base: -10066330, overlay: -13421773 },
  basaltmite_spawn_egg: { entity: 'basaltmite', base: -14343893, overlay: -13425901 },
  rabbit_wizard_spawn_egg: { entity: 'rabbit_wizard', base: -10066177, overlay: -52 },
  gilded_basaltmite_spawn_egg: { entity: 'gilded_basaltmite', base: -14343893, overlay: -13312 },
  scarecrow_spawn_egg: { entity: 'scarecrow', base: -3407872, overlay: -13312 }
};
// name: [textureFile, stack, category, tags]
const ITEMS = [
  ['attuned_binding_ring', 'attuned_binding_ring', 1, 'equipment'],
  ['basaltmite_plated_soles', 'basaltmite_plated_soles', 1, 'equipment'],
  ['basaltmite_scale', 'basaltmite_scale', 64, 'items', ['pcraftrevorn:basaltmite_scale']],
  ['bejeweled_upgrade_kit', 'jeweled_upgrade_template', 64, 'items'],
  ['carbonated_water_bottle', 'carbonated_water_bottle', 1, 'items'],
  ['cupids_arrow', 'cupid_arrow', 1, 'items'],
  ['debugging_item', 'pufferfish_bucket', 64, 'items', null, true],
  ['fermented_glowberry_juice_bottle', 'fermented_glowberry_bottle', 1, 'nature'],
  ['gilded_basaltmite_scale', 'basaltmite_plate_gilded', 64, 'items', ['pcraftrevorn:basaltmite_scale']],
  ['gilded_shield', 'gilded_shield', 1, 'equipment'],
  ['glowberry_juice_bottle', 'glowberry_bottle', 1, 'nature'],
  ['golden_bone_meal', 'golden_bone_meal', 64, 'nature'],
  ['golden_piglin_armor_kit', 'golden_piglin_armor_kit', 1, 'items'],
  ['hyperdense_porkchop', 'hyperdense_porkchop', 1, 'nature'],
  ['netherite_piglin_armor_kit', 'netherite_piglin_armor_kit', 1, 'items'],
  ['neutralizing_water', 'neutralizing_water_bottle', 1, 'items'],
  ['peculiar_mirror', 'peculiar_mirror', 1, 'items'],
  ['piglin_might_talisman', 'piglin_might_talisman', 1, 'equipment'],
  ['piglin_royal_talisman', 'piglin_royal_talisman', 1, 'equipment'],
  ['pred_guidebook_item', 'pred_guidebook', 1, 'items'],
  ['rabbit_staff', 'rabbit_staff0', 1, 'equipment'],
  ['rabbit_staff_bloodlust', 'rabbit_staff2', 1, 'equipment'],
  ['rabbit_staff_gold', 'rabbit_staff1', 1, 'equipment'],
  ['silverfish_plate', 'silverfish_scale', 64, 'items'],
  ['silverfish_plating_helmet', 'silverfish_plating_helmet', 1, 'equipment'],
  ['silverfish_plating_chestplate', 'silverfish_plating_chestplate', 1, 'equipment'],
  ['silverfish_plating_leggings', 'silverfish_plating_leggings', 1, 'equipment'],
  ['silverfish_plating_boots', 'silverfish_plating_boots', 1, 'equipment'],
  ['sugar_glass_bottle', 'sugar_glass_bottle', 64, 'items'],
  ['sugar_neutralizing_water', 'neutralizing_sugar_bottle', 1, 'items'],
  ['vibrant_elixir', 'vibrant_tonic', 1, 'items']
];
const HAND_EQUIPPED = new Set(['rabbit_staff', 'rabbit_staff_bloodlust', 'rabbit_staff_gold', 'gilded_shield']);

// Custom potions: Bedrock can't register new mob effects, so these are custom
// drinkable items (bottle recoloured to a similar hue + custom name) whose
// effect is applied by script.
const POTIONS = [
  { id: 'fragrance_potion', color: '#c9a0dc' },
  { id: 'stench_potion', color: '#556b2f' },
  { id: 'fortitude_potion', color: '#7f8fa6' },
  { id: 'pacifying_potion', color: '#8fd0e8' },
  { id: 'rotten_stench_potion', color: '#3b4020' }
];

// ---------------------------------------------------------------- items
function genItems() {
  const textureData = {};
  for (const [name, tex, stack, category, tags, vanillaTex] of ITEMS) {
    const components = {};
    if (vanillaTex) components['minecraft:icon'] = { textures: { default: tex } };
    else { textureData['pcraftrevorn_' + name] = { textures: 'textures/items/pcraftrevorn/' + tex }; components['minecraft:icon'] = { textures: { default: 'pcraftrevorn_' + name } }; }
    components['minecraft:max_stack_size'] = ARMOR[name] ? 1 : stack;
    if (HAND_EQUIPPED.has(name)) components['minecraft:hand_equipped'] = true;
    if (tags) components['minecraft:tags'] = { tags };
    if (FOOD[name]) {
      const f = FOOD[name];
      components['minecraft:food'] = { nutrition: f.nutrition, saturation_modifier: f.saturation };
      if (f.alwaysEat) components['minecraft:food'].can_always_eat = true;
      components['minecraft:use_animation'] = { value: 'eat' };
      components['minecraft:use_modifiers'] = { start_using: 'always', use_duration: 1.6, movement_modifier: 0.35 };
    }
    if (ARMOR[name]) {
      const a = ARMOR[name];
      components['minecraft:wearable'] = { slot: a.slot, protection: a.protection };
      components['minecraft:durability'] = { max_durability: a.durability };
      components['minecraft:repairable'] = { repair_items: [{ items: ['pcraftrevorn:silverfish_plate'], repair_amount: 60 }] };
      const encSlot = { 'slot.armor.head': 'armor_head', 'slot.armor.chest': 'armor_torso', 'slot.armor.legs': 'armor_legs', 'slot.armor.feet': 'armor_feet' }[a.slot];
      components['minecraft:enchantable'] = { value: 16, slot: encSlot };
    }
    const def = {
      format_version: '1.21.0',
      'minecraft:item': {
        description: { identifier: `${NS}:${name}`, menu_category: { category } },
        components
      }
    };
    writeJSON(path.join(BP, 'items', name + '.json'), def);
  }
  // spawn eggs
  for (const [name, s] of Object.entries(SPAWN_EGGS)) {
    genSpawnEgg(name, s, textureData);
  }
  writeJSON(path.join(RP, 'textures', 'item_texture.json'), {
    resource_pack_name: 'pcraftrevorn',
    texture_name: 'atlas.items',
    texture_data: textureData
  });
}
function genSpawnEgg(name, s, textureData) {  const texKey = 'pcraftrevorn_' + name;
  textureData[texKey] = { textures: 'textures/items/pcraftrevorn/' + name };
  writeJSON(path.join(BP, 'items', name + '.json'), {
    format_version: '1.21.0',
    'minecraft:item': {
      description: { identifier: `${NS}:${name}`, menu_category: { category: 'nature' } },
      components: {
        'minecraft:icon': { textures: { default: texKey } },
        'minecraft:max_stack_size': 64,
        'minecraft:entity_placer': { entity: `${NS}:${s.entity}` }
      }
    }
  });
  makeEggPng(path.join(RP, 'textures', 'items', 'pcraftrevorn', name + '.png'), rgb(s.base), rgb(s.overlay));
}

// ---------------------------------------------------------------- block geometry
function javaElementToBedrock(el, texKeyMap) {
  const from = el.from, to = el.to;
  const size = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const faceNames = ['north', 'east', 'south', 'west', 'up', 'down'];
  const uv = {};
  for (const fn of faceNames) {
    const f = el.faces && el.faces[fn];
    if (!f || !f.uv) { uv[fn] = { uv: [0, 0], uv_size: [1, 1] }; continue; }
    const [u1, v1, u2, v2] = f.uv;
    uv[fn] = { uv: [Math.min(u1, u2), Math.min(v1, v2)], uv_size: [u2 - u1, v2 - v1] };
  }
  const cube = {
    origin: [from[0] - 8, from[1], from[2] - 8],
    size: [size[0], size[1], size[2]],
    uv
  };
  // element-level rotation (single axis) -> bedrock rotation + pivot
  if (el.rotation) {
    const r = el.rotation;
    const pivot = [r.origin[0] - 8, r.origin[1], r.origin[2] - 8];
    const rot = [0, 0, 0];
    if (r.axis === 'x') rot[0] = r.angle;
    if (r.axis === 'y') rot[1] = r.angle;
    if (r.axis === 'z') rot[2] = r.angle;
    cube.pivot = pivot;
    cube.rotation = rot;
  }
  // material from the texture the element's faces reference
  if (el.faces && el.faces.north && el.faces.north.texture) {
    cube.material = el.faces.north.texture.replace('#', '');
    if (cube.material === 'all') delete cube.material;
  }
  return cube;
}
function convertJavaModel(srcFile, identifier, overrideSize) {
  const m = readJSON(srcFile);
  const cubes = (m.elements || []).map(el => javaElementToBedrock(el)).filter(Boolean);
  const size = overrideSize || [64, 64];
  const geo = {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: {
        identifier,
        texture_width: size[0],
        texture_height: size[1],
        visible_bounds_width: 8,
        visible_bounds_height: 4,
        visible_bounds_offset: [0, 1, 0]
      },
      bones: [{ name: 'root', pivot: [0, 0, 0], cubes }]
    }]
  };
  return geo;
}

// ---------------------------------------------------------------- potions
function makeBottlePng(file, hex) {
  const W = 16, H = 16, buf = Buffer.alloc(W * H * 4, 0);
  const [r, g, b] = hexToRgb(hex);
  const set = (x, y, cr, cg, cb, a = 255) => { const i = (y * W + x) * 4; buf[i] = cr; buf[i + 1] = cg; buf[i + 2] = cb; buf[i + 3] = a; };
  for (let y = 6; y <= 14; y++) for (let x = 5; x <= 10; x++) set(x, y, 222, 232, 238, 200); // glass body
  for (let y = 8; y <= 13; y++) for (let x = 6; x <= 9; x++) set(x, y, r, g, b);            // liquid
  for (let y = 3; y <= 6; y++) for (let x = 7; x <= 8; x++) set(x, y, 222, 232, 238, 200); // neck
  for (let y = 2; y <= 3; y++) for (let x = 6; x <= 9; x++) set(x, y, 139, 90, 43);        // cork
  for (let y = 8; y <= 12; y++) set(6, y, 255, 255, 255, 120);                             // highlight
  writePng(file, W, H, buf);
}
function genPotions() {
  const atlasPath = path.join(RP, 'textures', 'item_texture.json');
  const atlas = exists(atlasPath) ? readJSON(atlasPath) : { resource_pack_name: 'pcraftrevorn', texture_name: 'atlas.items', texture_data: {} };
  for (const p of POTIONS) {
    const key = 'pcraftrevorn_' + p.id;
    atlas.texture_data[key] = { textures: 'textures/items/pcraftrevorn/' + p.id };
    writeJSON(path.join(BP, 'items', p.id + '.json'), {
      format_version: '1.21.0',
      'minecraft:item': {
        description: { identifier: `${NS}:${p.id}`, menu_category: { category: 'equipment' } },
        components: {
          'minecraft:icon': { textures: { default: key } },
          'minecraft:max_stack_size': 1,
          'minecraft:food': { nutrition: 0, saturation_modifier: 0, can_always_eat: true },
          'minecraft:use_animation': { value: 'drink' },
          'minecraft:use_modifiers': { start_using: 'always', use_duration: 1.6, movement_modifier: 0.35 }
        }
      }
    });
    makeBottlePng(path.join(RP, 'textures', 'items', 'pcraftrevorn', p.id + '.png'), p.color);
  }
  writeJSON(atlasPath, atlas);
}

// ---------------------------------------------------------------- blocks
// file -> resource path (relative to textures/)
const BLOCK_TEX = {
  glowberry_fermentation_barrel_top: 'blocks/pcraftrevorn/glowberry_fermentation_barrel_top',
  glowberry_fermentation_barrel_bottom: 'blocks/pcraftrevorn/glowberry_fermentation_barrel_bottom',
  glowberry_fermentation_barrel_front: 'blocks/pcraftrevorn/glowberry_fermentation_barrel_front',
  glowberry_fermentation_barrel_back: 'blocks/pcraftrevorn/glowberry_fermentation_barrel_back',
  glowberry_fermentation_barrel_side: 'blocks/pcraftrevorn/glowberry_fermentation_barrel_side',
  glowberry_fermentation_barrel_side2: 'blocks/pcraftrevorn/glowberry_fermentation_barrel_side2',
  soul_jack_o_lantern: 'blocks/pcraftrevorn/soul_jack_o_lantern',
  pumpkin_top: 'blocks/pumpkin_top',
  pumpkin_side: 'blocks/pumpkin_side',
  piglin_throne_base: 'blocks/pcraftrevorn/piglin_throne_base',
  piglin_throne_diagonals: 'blocks/pcraftrevorn/piglin_throne_diagonals',
  piglin_throne_backing: 'blocks/pcraftrevorn/piglin_throne_backing',
  piglin_throne_arm: 'blocks/pcraftrevorn/piglin_throne_arm',
  blaze_rod_supports: 'blocks/pcraftrevorn/blaze_rod_supports',
  skull_decoration: 'blocks/pcraftrevorn/skull_decoration',
  cloth_backing: 'blocks/pcraftrevorn/cloth_backing'
};
const BLOCKS = [
  { name: 'glowberry_fermentation_barrel', light: 0, loot: 'glowberry_fermentation_barrel', lootItem: 'pcraftrevorn:glowberry_fermentation_barrel', faces: { up: 'glowberry_fermentation_barrel_top', down: 'glowberry_fermentation_barrel_bottom', north: 'glowberry_fermentation_barrel_front', south: 'glowberry_fermentation_barrel_back', east: 'glowberry_fermentation_barrel_side', west: 'glowberry_fermentation_barrel_side2' } },
  { name: 'soul_jack_o_lantern', light: 10, loot: 'soul_jack_o_lantern', lootItem: 'pcraftrevorn:soul_jack_o_lantern', faces: { up: 'pumpkin_top', down: 'pumpkin_top', north: 'soul_jack_o_lantern', south: 'pumpkin_side', east: 'pumpkin_side', west: 'pumpkin_side' } },
  { name: 'piglin_throne_1', geo: 'custom/piglin_throne1', texSize: [16, 16], light: 0, loot: 'gilded_blackstone', lootItem: 'minecraft:gilded_blackstone', materials: { '1': 'piglin_throne_diagonals', '2': 'blaze_rod_supports', '3': 'skull_decoration', '4': 'piglin_throne_base' }, defaultTex: 'piglin_throne_base' },
  { name: 'piglin_throne_2', geo: 'custom/piglin_throne2', texSize: [64, 64], light: 0, loot: 'gilded_blackstone', lootItem: 'minecraft:gilded_blackstone', materials: { '1': 'piglin_throne_backing', '2': 'cloth_backing', '3': 'piglin_throne_arm' }, defaultTex: 'piglin_throne_backing' }
];
function genBlocks() {
  const terrain = { resource_pack_name: 'pcraftrevorn', texture_name: 'atlas.terrain', padding: 8, num_mip_levels: 4, texture_data: {} };
  const texKey = (file) => { const k = `${NS}_${file}`; if (!terrain.texture_data[k]) terrain.texture_data[k] = { textures: 'textures/' + BLOCK_TEX[file] }; return k; };
  for (const b of BLOCKS) {
    const ident = `${NS}:${b.name}`;
    const mi = {};
    if (b.faces) for (const [face, file] of Object.entries(b.faces)) mi[face] = { texture: texKey(file), render_method: 'opaque' };
    else {
      mi['*'] = { texture: texKey(b.defaultTex), render_method: 'opaque' };
      for (const [key, file] of Object.entries(b.materials)) mi[key] = { texture: texKey(file), render_method: 'opaque' };
    }
    const components = {
      'minecraft:geometry': b.geo ? { identifier: 'geometry.pcraftrevorn.' + b.name } : 'minecraft:geometry.full_block',
      'minecraft:material_instances': mi,
      'minecraft:destructible_by_mining': { seconds_to_destroy: 2 },
      'minecraft:destructible_by_explosion': { explosion_resistance: 10 },
      'minecraft:loot': `loot_tables/blocks/${b.loot}.json`,
      'minecraft:map_color': '#5c4a37'
    };
    if (b.light) components['minecraft:light_emission'] = b.light;
    const writeBlock = (permissions) => writeJSON(path.join(BP, 'blocks', b.name + '.json'), {
      format_version: '1.21.0',
      'minecraft:block': {
        description: { identifier: ident, menu_category: { category: 'construction' }, states: { 'minecraft:cardinal_direction': { values: ['north', 'east', 'south', 'west'] } } },
        components,
        permutations: [
          { condition: "q.block_state('minecraft:cardinal_direction') == 'north'", components: { 'minecraft:transformation': { rotation: [0, 0, 0] } } },
          { condition: "q.block_state('minecraft:cardinal_direction') == 'east'", components: { 'minecraft:transformation': { rotation: [0, 90, 0] } } },
          { condition: "q.block_state('minecraft:cardinal_direction') == 'south'", components: { 'minecraft:transformation': { rotation: [0, 180, 0] } } },
          { condition: "q.block_state('minecraft:cardinal_direction') == 'west'", components: { 'minecraft:transformation': { rotation: [0, 270, 0] } } }
        ]
      }
    });
    writeBlock();
    writeJSON(path.join(BP, 'loot_tables', 'blocks', b.loot + '.json'), {
      pools: [{ rolls: 1, conditions: [{ condition: 'minecraft:survives_explosion' }], entries: [{ type: 'item', name: b.lootItem, weight: 1 }] }]
    });
    if (b.geo) {
      const geo = convertJavaModel(path.join(SRC_ASSETS, 'models', b.geo + '.json'), 'geometry.pcraftrevorn.' + b.name, b.texSize);
      writeJSON(path.join(RP, 'models', 'blocks', b.name + '.geo.json'), geo);
    }
  }
  writeJSON(path.join(RP, 'textures', 'terrain_texture.json'), terrain);
}

// ---------------------------------------------------------------- recipes
const TAG_ITEMS = { 'pcraftrevorn:basaltmite_scale': ['pcraftrevorn:basaltmite_scale', 'pcraftrevorn:gilded_basaltmite_scale'] };
function convertKey(ing) {
  if (ing.item) return { item: ing.item };
  if (ing.tag) return { tag: ing.tag };
  return ing;
}
function genRecipes() {
  const dir = path.join(SRC_DATA, 'recipes');
  if (!exists(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    const src = readJSON(path.join(dir, file));
    const id = `${NS}:${path.basename(file, '.json')}`;
    let out = { format_version: '1.20.10' };
    if (src.type === 'minecraft:crafting_shaped') {
      const key = {};
      for (const [k, v] of Object.entries(src.key)) key[k] = convertKey(v);
      out['minecraft:recipe_shaped'] = {
        description: { identifier: id }, tags: ['crafting_table'],
        pattern: src.pattern, key,
        result: { item: src.result.item, count: src.result.count || 1 }
      };
    } else if (src.type === 'minecraft:crafting_shapeless') {
      out['minecraft:recipe_shapeless'] = {
        description: { identifier: id }, tags: ['crafting_table'],
        ingredients: src.ingredients.map(convertKey),
        result: { item: src.result.item, count: src.result.count || 1 }
      };
    } else if (src.type === 'minecraft:smithing_transform') {
      // Bedrock's smithing table only accepts a fixed netherite recipe shape
      // (template must be a tempate item, addition must be netherite_ingot,
      // base must be vanilla armor/tool). Custom smithing cannot be expressed,
      // so port it as a temporary crafting-table recipe; P5 restores the real
      // interaction via script.
      out['minecraft:recipe_shapeless'] = {
        description: { identifier: id }, tags: ['crafting_table'],
        ingredients: [convertKey(src.template), convertKey(src.base), convertKey(src.addition)],
        result: { item: src.result.item, count: src.result.count || 1 }
      };
    } else if (src.type === 'minecraft:smelting') {
      out['minecraft:recipe_furnace'] = {
        description: { identifier: id }, tags: ['furnace'],
        input: src.ingredient.item || src.ingredient.tag, output: src.result
      };
    } else { continue; }
    writeJSON(path.join(BP, 'recipes', path.basename(file)), out);
  }
}

// ---------------------------------------------------------------- entity loot (ported for later entity phase)
function genEntityLoot() {
  const map = { 'entities/zombie.json': 'zombie', 'entities/piglin_royal.json': 'piglin_royal' };
  for (const [rel, name] of Object.entries(map)) {
    const srcFile = path.join(SRC_DATA, 'loot_tables', rel);
    if (!exists(srcFile)) continue;
    const src = readJSON(srcFile);
    const pools = src.pools.map(p => ({ rolls: p.rolls, entries: p.entries.filter(e => e.name !== 'minecraft:air').map(e => ({ type: 'item', name: e.name, weight: e.weight || 1, functions: e.functions })) }));
    writeJSON(path.join(BP, 'loot_tables', 'entities', name + '.json'), { pools });
  }
}

// ---------------------------------------------------------------- lang
// English display names. The bundled source lang is the Chinese-localised build,
// so zh_CN keeps the source text and these supply the en_US equivalents.
const EN_ENTITY = {
  rabbit_wizard: 'Rabbit Wizard', shielding_ring: 'Shielding Ring', scarecrow: 'Scarecrow',
  basaltmite: 'Basaltmite', silverfish: 'Silverfish Maiden', piglin_royal: 'Piglin Royal',
  piglin_throneroom_spawner: 'Piglin Throne Room Spawner', gilded_basaltmite: 'Gilded Basaltmite',
  piglin_royal_spawner: 'Piglin Royal Spawner', zombie: 'Starved', vinemaiden: 'Vinemaiden',
  piglin_royal_knight: 'Piglin Royal Knight', binding_ring: 'Binding Ring', vinemaiden_seedling: 'Vinemaiden Seedling'
};
const EN_EFFECT = {
  regurgitation_armor: 'Regurgitation Armor', acid_resistance: 'Acid Resistance', softened: 'Softened',
  delectable_scent: 'Delectable Scent', visual_fx: 'Visual FX', warded: 'Warded',
  regurgitation_stench: 'Regurgitation Stench', rotten_stench: 'Rotten Stench',
  regurgitation_sickness: 'Regurgitation Sickness', shielded: 'Shielded', neutralized_acids: 'Neutralized Acids',
  rabbit_marked: 'Rabbit Marked', glowberry_high: 'Glowberry High', play_sound: 'Play Sound',
  piglins_decree: "Piglin's Decree", bound: 'Bound', bloodlust: 'Bloodlust', carbonated: 'Carbonated'
};
const EN_BLOCK = {
  soul_jack_o_lantern: "Soul Jack o'Lantern", glowberry_fermentation_barrel: 'Glowberry Fermentation Barrel',
  piglin_throne_2: 'Piglin Throne', piglin_throne_1: 'Piglin Throne'
};
const EN_ITEM = {
  shielding_ring_spawn_egg: 'Shielding Ring Spawn Egg', scarecrow_spawn_egg: 'Scarecrow Spawn Egg',
  neutralizing_water: 'Neutralizing Water', debugging_item: 'Debug Item',
  netherite_piglin_armor_kit: 'Netherite Piglin Armor Kit', piglin_royal_talisman: 'Piglin Royal Talisman',
  bejeweled_upgrade_kit: 'Bejeweled Upgrade Kit', rabbit_staff_gold: 'Rabbit Staff',
  piglin_might_talisman: 'Piglin Might Talisman', golden_piglin_armor_kit: 'Golden Piglin Armor Kit',
  pred_guidebook_item: 'Predator Guidebook', peculiar_mirror: 'Peculiar Mirror',
  fermented_glowberry_juice_bottle: 'Fermented Glowberry Juice Bottle',
  piglin_royal_knight_spawn_egg: 'Piglin Royal Knight Spawn Egg', rabbit_staff: 'Rabbit Staff',
  rabbit_wizard_spawn_egg: 'Rabbit Wizard Spawn Egg', silverfish_plating_boots: 'Silverfish Maiden Plating Boots',
  hyperdense_porkchop: 'Hyperdense Porkchop', glowberry_juice_bottle: 'Glowberry Juice Bottle',
  gilded_shield: 'Gilded Shield', cupids_arrow: "Cupid's Arrow", binding_ring_spawn_egg: 'Binding Ring Spawn Egg',
  silverfish_plate: 'Silverfish Maiden Plate', sugar_neutralizing_water: 'Sugar Neutralizing Water',
  carbonated_water_bottle: 'Carbonated Water Bottle', piglin_royal_spawn_egg: 'Piglin Royal Spawn Egg',
  silverfish_plating_helmet: 'Silverfish Maiden Plating Helmet', vibrant_elixir: 'Vibrant Elixir',
  gilded_basaltmite_spawn_egg: 'Gilded Basaltmite Spawn Egg', silverfish_plating_leggings: 'Silverfish Maiden Plating Leggings',
  basaltmite_plated_soles: 'Basaltmite Plated Soles', zombie_spawn_egg: 'Starved Spawn Egg',
  gilded_basaltmite_scale: 'Gilded Basaltmite Scale', vinemaiden_seedling_spawn_egg: 'Vinemaiden Seedling Spawn Egg',
  golden_bone_meal: 'Golden Bone Meal', basaltmite_spawn_egg: 'Basaltmite Spawn Egg',
  silverfish_spawn_egg: 'Silverfish Maiden Spawn Egg', basaltmite_scale: 'Basaltmite Scale',
  sugar_glass_bottle: 'Sugar Glass Bottle', vinemaiden_spawn_egg: 'Vinemaiden Spawn Egg',
  attuned_binding_ring: 'Attuned Binding Ring', silverfish_plating_chestplate: 'Silverfish Maiden Plating Chestplate',
  rabbit_staff_bloodlust: 'Rabbit Staff'
};
const EN_DEATH = {
  'death.attack.digestion.item': "%1 was digested by %2's writhing stomach walls while holding %3",
  'death.attack.digestion.player': "%1 couldn't escape %2's slick, wet, soft stomach",
  'death.attack.digestion': "%1 sank into %2's soft stomach..."
};
const EN_SUBTITLE = {
  'subtitles.burp': 'Burp',
  'subtitles.gurgle': 'Stomach Gurgle',
  'subtitles.large_gurgle': 'Large Stomach Gurgle',
  'subtitles.large_squelch': 'Large Stomach Squelch',
  'subtitles.slosh': 'Stomach Slosh',
  'subtitles.swallow': 'Swallow'
};
// The localised source occasionally carries a stray trailing quote; the zombie
// and silverfish were renamed in-game (饿殍 / 蠹虫娘), so normalise those too.
const langValue = (v) => String(v).trim().replace(/['"]+$/, '').trim()
  .replace(/吞食蠹虫|蠹虫/g, '蠹虫娘').replace(/吞食僵尸|僵尸/g, '饿殍');

function genLang() {
  const en = readJSON(path.join(SRC_ASSETS, 'lang', 'en_us.json'));
  const bpEn = [], bpZh = [], rpEn = [], rpZh = [];
  const emit = (lines, k, v) => lines.push(`${k}=${v}`);
  for (const [k, v] of Object.entries(en)) {
    const cv = langValue(v);
    if (k.startsWith('item.pcraftrevorn.')) {
      const n = k.slice('item.pcraftrevorn.'.length);
      const ev = EN_ITEM[n] || cv;
      emit(bpEn, `item.pcraftrevorn:${n}`, ev); emit(bpZh, `item.pcraftrevorn:${n}`, cv);
      emit(bpEn, `item.pcraftrevorn:${n}.name`, ev); emit(bpZh, `item.pcraftrevorn:${n}.name`, cv);
      if (n.endsWith('_spawn_egg')) {
        const sk = `item.spawn_egg.entity.pcraftrevorn:${n.slice(0, -'_spawn_egg'.length)}.name`;
        emit(bpEn, sk, ev); emit(bpZh, sk, cv);
      }
    } else if (k.startsWith('entity.pcraftrevorn.')) {
      const n = k.slice('entity.pcraftrevorn.'.length);
      emit(bpEn, `entity.pcraftrevorn:${n}.name`, EN_ENTITY[n] || cv);
      emit(bpZh, `entity.pcraftrevorn:${n}.name`, cv);
    } else if (k.startsWith('block.pcraftrevorn.')) {
      const n = k.slice('block.pcraftrevorn.'.length);
      const ev = EN_BLOCK[n] || cv;
      emit(bpEn, `tile.pcraftrevorn:${n}.name`, ev); emit(bpZh, `tile.pcraftrevorn:${n}.name`, cv);
      emit(bpEn, `tile.pcraftrevorn:${n}`, ev); emit(bpZh, `tile.pcraftrevorn:${n}`, cv);
    } else if (k.startsWith('subtitles.')) {
      emit(rpEn, k, EN_SUBTITLE[k] || cv); emit(rpZh, k, cv);
    } else if (k.startsWith('death.attack.')) {
      const dv = cv.replace(/%1\$s/g, '%1').replace(/%2\$s/g, '%2').replace(/%3\$s/g, '%3');
      emit(bpEn, k, EN_DEATH[k] || dv); emit(bpZh, k, dv);
    } else if (k.startsWith('effect.pcraftrevorn.')) {
      const n = k.slice('effect.pcraftrevorn.'.length);
      emit(bpEn, k, EN_EFFECT[n] || cv); emit(bpZh, k, cv); // consumed by scripts later
    }
  }
  const header = '# Generated from PCraftRevorn 3.1.1 (author: MysticSummoner)\n';
  writeText(path.join(BP, 'texts', 'en_US.lang'), header + bpEn.sort().join('\n') + '\n');
  writeText(path.join(BP, 'texts', 'zh_CN.lang'), header + bpZh.sort().join('\n') + '\n');
  writeText(path.join(RP, 'texts', 'en_US.lang'), header + rpEn.sort().join('\n') + '\n');
  writeText(path.join(RP, 'texts', 'zh_CN.lang'), header + rpZh.sort().join('\n') + '\n');
  // register the locales the pack ships
  const langs = JSON.stringify(['en_US', 'zh_CN']);
  writeText(path.join(RP, 'texts', 'languages.json'), langs);
  writeText(path.join(BP, 'texts', 'languages.json'), langs);
}

// ---------------------------------------------------------------- assets
function genAssets() {
  // item textures
  for (const [name, tex, , , , vanillaTex] of ITEMS) {
    if (vanillaTex) continue;
    const src = path.join(SRC_ASSETS, 'textures', 'item', tex + '.png');
    if (exists(src)) copy(src, path.join(RP, 'textures', 'items', 'pcraftrevorn', tex + '.png'));
  }
  // block textures
  for (const [file, rel] of Object.entries(BLOCK_TEX)) {
    if (!rel.startsWith('blocks/pcraftrevorn/')) continue;
    const src = path.join(SRC_ASSETS, 'textures', 'block', file + '.png');
    if (exists(src)) copy(src, path.join(RP, 'textures', 'blocks', 'pcraftrevorn', file + '.png'));
  }
  // pumpkin textures used by soul jack o lantern come from vanilla; also copy our soul front already done.
  // armor textures
  for (const t of ['silverfish_plating__layer_1', 'silverfish_plating__layer_2']) {
    const src = path.join(SRC_ASSETS, 'textures', 'models', 'armor', t + '.png');
    if (exists(src)) copy(src, path.join(RP, 'textures', 'models', 'armor', t.replace('__', '_') + '.png'));
  }
  // sounds
  const soundDefs = { format_version: '1.14.0', sound_definitions: {} };
  const soundDir = path.join(SRC_ASSETS, 'sounds');
  if (exists(soundDir)) {
    for (const f of fs.readdirSync(soundDir)) {
      if (!f.endsWith('.ogg')) continue;
      copy(path.join(soundDir, f), path.join(RP, 'sounds', 'pcraftrevorn', f));
    }
    const srcSounds = readJSON(path.join(SRC_ASSETS, 'sounds.json'));
    for (const [name, def] of Object.entries(srcSounds)) {
      soundDefs.sound_definitions['pcraftrevorn.' + name] = {
        category: 'neutral',
        subtitle: def.subtitle,
        sounds: def.sounds.map(s => ({ name: 'sounds/pcraftrevorn/' + s.name.split(':').pop(), stream: !!s.stream }))
      };
    }
  }
  // Replace the vanilla zombie sounds with the mod's (female) ones. A custom
  // sound_definitions.json overrides the vanilla events of the same name.
  const zDir = path.join(MOD, 'assets', 'minecraft', 'sounds', 'mob', 'zombie');
  if (exists(zDir)) {
    for (const f of fs.readdirSync(zDir)) {
      if (f.endsWith('.ogg')) copy(path.join(zDir, f), path.join(RP, 'sounds', 'mob', 'zombie', f));
    }
    const zmap = {
      'mob.zombie.say': ['say1', 'say2', 'say3'],
      'mob.zombie.hurt': ['hurt1', 'hurt2'],
      'mob.zombie.death': ['death']
    };
    for (const [ev, files] of Object.entries(zmap)) {
      soundDefs.sound_definitions[ev] = { category: 'hostile', sounds: files.map((n) => ({ name: 'sounds/mob/zombie/' + n })) };
    }
  }
  writeJSON(path.join(RP, 'sounds', 'sound_definitions.json'), soundDefs);
}

// ---------------------------------------------------------------- manifests
const UUID = {
  bpHeader: 'b6f5c2a1-7d3e-4a91-9c2f-1a2b3c4d5e6f',
  bpData: 'c7e6d3b2-8e4f-4ba2-8d3e-2b3c4d5e6f70',
  bpScript: 'd8f7e4c3-9f50-4cb3-9e4f-3c4d5e6f7081',
  rpHeader: 'e9a8f5d4-a061-4dc4-af50-4d5e6f708192',
  rpRes: 'fab9a6e5-b172-4ed5-b061-5e6f70819203'
};
// Build version: date-based beta. Bedrock v2 manifests require an integer triple,
// so "261003-beta-3" is encoded as [261002, 0, 1] with the label kept in the name.
const PACK_VERSION = [261003, 0, 3];
function genManifests() {
  writeJSON(path.join(BP, 'manifest.json'), {
    format_version: 2,
    header: { name: 'PCraftRevorn §2砂墨§r §7· 261003-beta-3', description: '掠食工艺 Bedrock 移植 · 二次修改作品 · 作者 砂墨SandMo（Bilibili: 砂墨）· 原创模组 MysticSummoner · 详见 README.txt', uuid: UUID.bpHeader, version: PACK_VERSION, min_engine_version: [1, 21, 100] },
    modules: [
      { type: 'data', uuid: UUID.bpData, version: PACK_VERSION },
      { type: 'script', language: 'javascript', uuid: UUID.bpScript, entry: 'scripts/main.js', version: PACK_VERSION }
    ],
    dependencies: [
      { uuid: UUID.rpHeader, version: PACK_VERSION },
      { module_name: '@minecraft/server', version: '2.0.0' },
      { module_name: '@minecraft/server-ui', version: '2.0.0' }
    ],
    metadata: { authors: ['砂墨SandMo', 'Bilibili: 砂墨', '原创: MysticSummoner'], license: 'AFL-3.0' }
  });
  writeJSON(path.join(RP, 'manifest.json'), {
    format_version: 2,
    header: { name: 'PCraftRevorn 资源 §2砂墨§r §7· 261003-beta-3', description: '掠食工艺 Bedrock 移植 · 二次修改作品 · 作者 砂墨SandMo（Bilibili: 砂墨）· 原创模组 MysticSummoner · 详见 README.txt', uuid: UUID.rpHeader, version: PACK_VERSION, min_engine_version: [1, 21, 100] },
    modules: [{ type: 'resources', uuid: UUID.rpRes, version: PACK_VERSION }],
    metadata: { authors: ['砂墨SandMo', 'Bilibili: 砂墨', '原创: MysticSummoner'], license: 'AFL-3.0' }
  });
  // pack icons
  const icon = path.join(SRC_ASSETS, 'textures', 'item', 'pred_guidebook.png');
  if (exists(icon)) { copy(icon, path.join(BP, 'pack_icon.png')); copy(icon, path.join(RP, 'pack_icon.png')); }
}

// ---------------------------------------------------------------- main
function main() {
  if (!exists(MOD)) { console.error('Missing .work/mod. Extract the jar first (tools/extract.ps1).'); process.exit(1); }
  // clean owned output so stale files never linger
  for (const d of [
    path.join(BP, 'blocks'), path.join(BP, 'items'), path.join(BP, 'recipes'),
    path.join(BP, 'loot_tables'), path.join(BP, 'texts'),
    path.join(RP, 'textures', 'items', 'pcraftrevorn'),
    path.join(RP, 'textures', 'blocks', 'pcraftrevorn'),
    path.join(RP, 'textures', 'models', 'armor'),
    path.join(RP, 'models', 'blocks'),
    path.join(RP, 'sounds'), path.join(RP, 'texts')
  ]) rmrf(d);
  genItems();
  genPotions();
  genBlocks();
  genRecipes();
  genEntityLoot();
  genLang();
  genAssets();
  genManifests();
  console.log('Generated behavior_pack/ and resource_pack/.');
}
main();
