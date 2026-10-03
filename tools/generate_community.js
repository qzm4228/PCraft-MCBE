'use strict';
/*
 * Community resource-pack importer (independent creatures).
 *
 * Reads assets copied into .work/community/<pack>/assets/pcraftrevorn and emits
 * full Bedrock entities for the packs classified as "new creature" (not a rework):
 *   zarachnus's lamia , plantPACK , CathylFunni , eeveelution (x5)
 *
 * Also writes behavior_pack/scripts/pcraftrevorn/data/community.js, which the
 * runtime scripts merge into their registries.
 *
 * Run via generate_entities.js (called at the end of main), or directly:
 *   node tools/generate_community.js
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const COMM = path.join(ROOT, '.work', 'community');
const BP = path.join(ROOT, 'behavior_pack');
const RP = path.join(ROOT, 'resource_pack');
const NS = 'pcraftrevorn';

const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });
const writeText = (f, t) => { ensureDir(path.dirname(f)); fs.writeFileSync(f, t); };
const writeJSON = (f, o) => writeText(f, JSON.stringify(o, null, 2) + '\n');
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const copy = (s, d) => { ensureDir(path.dirname(d)); fs.copyFileSync(s, d); };
const LOOP_ANIMS = new Set(['idle', 'walk', 'sprint', 'hidden']);

// ---- PNG writer (Poké Ball spawn-egg icon) ----
const CRC_TABLE = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePng(file, w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]));
}
// ---- vanilla spawn-egg art (Java spawn_egg.png + overlay, tinted) ----
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
  } catch { /* ignore */ }
  return null;
})();
function eggRgba(base, overlay) {
  const { w, h, data } = EGG_ART.base; const od = EGG_ART.overlay.data; const out = Buffer.alloc(w * h * 4, 0);
  for (let i = 0; i < w * h * 4; i += 4) {
    let r = data[i] * base.r / 255, g = data[i + 1] * base.g / 255, bl = data[i + 2] * base.b / 255, a = data[i + 3];
    if (od[i + 3] > 0) {
      const oa = od[i + 3] / 255;
      r = od[i] * overlay.r / 255 * oa + r * (1 - oa);
      g = od[i + 1] * overlay.g / 255 * oa + g * (1 - oa);
      bl = od[i + 2] * overlay.b / 255 * oa + bl * (1 - oa);
      a = Math.max(a, od[i + 3]);
    }
    out[i] = Math.round(r); out[i + 1] = Math.round(g); out[i + 2] = Math.round(bl); out[i + 3] = a;
  }
  return { w, h, data: out };
}
// most frequent opaque colours of a texture (4-bit buckets), most common first
function mainColours(img) {
  const buckets = new Map();
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 128) continue;
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let e = buckets.get(key); if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, e); }
    e.n++; e.r += r; e.g += g; e.b += b;
  }
  return [...buckets.values()].sort((a, b) => b.n - a.n).map((e) => ({ r: Math.round(e.r / e.n), g: Math.round(e.g / e.n), b: Math.round(e.b / e.n) }));
}
// build a vanilla-style egg tinted with the creature texture's dominant + accent colours
function makeTextureEgg(file, texFile) {
  let cols = null;
  try { cols = mainColours(decodePngRgba(fs.readFileSync(texFile))); } catch { /* ignore */ }
  if (!EGG_ART || !cols || !cols.length) return false;
  const base = cols[0];
  let over = cols.find((c) => (c.r - base.r) ** 2 + (c.g - base.g) ** 2 + (c.b - base.b) ** 2 > 6000);
  if (!over) over = { r: Math.round(base.r * 0.45), g: Math.round(base.g * 0.45), b: Math.round(base.b * 0.45) };
  const { w, h, data } = eggRgba(base, over);
  writePng(file, w, h, data);
  return true;
}

// Tracked Poké Ball sprites (from Cobblemon). Each creature can name its ball.
const BALL_DIR = path.join(ROOT, 'tools', 'assets', 'balls');
const BALL_SRC = [
  path.join(ROOT, 'tools', 'assets', 'pokeball.png'),
  path.join(ROOT, '.work', 'pokeball.png')
].find((p) => fs.existsSync(p));
function ballPng(file, ball, size = 16) {
  const themed = ball && ball !== true && fs.existsSync(path.join(BALL_DIR, ball + '.png')) ? path.join(BALL_DIR, ball + '.png') : null;
  const src = themed || BALL_SRC;
  if (src) { copy(src, file); return; }
  const rgba = Buffer.alloc(size * size * 4, 0);
  const c = (size - 1) / 2, R = size / 2 - 0.6, btnR = size * 0.21;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c, dy = y - c, d = Math.sqrt(dx * dx + dy * dy), o = (y * size + x) * 4;
      if (d > R) continue;
      let col;
      if (d > R - 1.0) col = [20, 20, 20];                       // outline
      else if (d < btnR) col = [242, 242, 242];                  // button
      else if (d < btnR + 1.0) col = [20, 20, 20];               // button ring
      else if (Math.abs(dy) < size * 0.10) col = [20, 20, 20];   // band
      else if (dy < 0) col = [216, 44, 44];                      // top: red
      else col = [242, 242, 242];                                // bottom: white
      rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
    }
  }
  writePng(file, size, size, rgba);
}

function convertAnimObject(j) {
  const unwrap = (v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (Array.isArray(v.vector)) return v.vector;
      if (v.pre !== undefined || v.post !== undefined || v.lerp_mode !== undefined) {
        const o = {};
        if (v.pre !== undefined) o.pre = (v.pre && Array.isArray(v.pre.vector)) ? v.pre.vector : v.pre;
        if (v.post !== undefined) o.post = (v.post && Array.isArray(v.post.vector)) ? v.post.vector : v.post;
        if (v.lerp_mode !== undefined) o.lerp_mode = v.lerp_mode;
        return o;
      }
    }
    return v;
  };
  const convertChannel = (ch) => {
    if (ch === null || typeof ch !== 'object' || Array.isArray(ch)) return ch;
    if (Array.isArray(ch.vector)) return ch.vector;
    const out = {};
    for (const [t, v] of Object.entries(ch)) out[t] = unwrap(v);
    return out;
  };
  delete j.geckolib_format_version;
  for (const [name, anim] of Object.entries(j.animations || {})) {
    const declared = anim.loop;
    anim.loop = (declared === true || declared === false || declared === 'hold_on_last_frame') ? declared : LOOP_ANIMS.has(name.split('.').pop());
    for (const bd of Object.values(anim.bones || {})) {
      for (const ch of ['rotation', 'position', 'scale']) if (bd[ch] !== undefined) bd[ch] = convertChannel(bd[ch]);
    }
  }
  return j;
}

// Bedrock bone names must be [A-Za-z_][A-Za-z0-9_.]*; community models use names
// with spaces / '&', which can make Bedrock ignore the animation. Rename the bad
// names identically in the geometry and the animation so they still match.
function sanitizeBones(geo, anim) {
  const g = geo['minecraft:geometry'][0];
  const gb = g.bones || [];
  const names = new Set(gb.map((b) => b.name));
  for (const a of Object.values((anim && anim.animations) || {})) for (const k of Object.keys(a.bones || {})) names.add(k);
  const valid = /^[A-Za-z][A-Za-z0-9_.]*$/;
  const used = new Set([...names].filter((n) => valid.test(n)));
  const map = new Map();
  for (const n of names) {
    if (valid.test(n)) continue;
    let base = String(n).replace(/[^A-Za-z0-9_.]/g, '_');
    if (!/^[A-Za-z_]/.test(base)) base = '_' + base;
    let cand = base, i = 1;
    while (used.has(cand) && cand !== n) cand = `${base}_${i++}`;
    used.add(cand);
    map.set(n, cand);
  }
  if (!map.size) return 0;
  for (const b of gb) {
    if (map.has(b.name)) b.name = map.get(b.name);
    if (b.parent && map.has(b.parent)) b.parent = map.get(b.parent);
  }
  for (const a of Object.values((anim && anim.animations) || {})) {
    const nb = {};
    for (const [k, v] of Object.entries(a.bones || {})) nb[map.get(k) ?? k] = v;
    a.bones = nb;
  }
  return map.size;
}

// base predator stats (mirrors skin/assign.js PRED_STATS)
const BASE_STATS = {
  rabbit_wizard: { swallow: 0.15, struggles: 11, difficulty: 0.30, acid: 3.2, acidMax: 13.0, acidIncr: 0.04, wg1: 1, wg2: 4 },
  vinemaiden: { swallow: 0.32, struggles: 7, difficulty: 0.15, acid: 3.0, acidMax: 15.0, acidIncr: 0.03, wg1: 1, wg2: 4 },
  zombie: { swallow: 0.12, struggles: 7, difficulty: 0.15, acid: 4.0, acidMax: 12.0, acidIncr: 0.04, wg1: 1, wg2: 4 },
  scarecrow: { swallow: 0.34, struggles: 15, difficulty: 0.40, acid: 2.0, acidMax: 14.0, acidIncr: 0.01, wg1: 1, wg2: 4 },
  silverfish: { swallow: 0.30, struggles: 7, difficulty: 0.10, acid: 2.2, acidMax: 18.8, acidIncr: 0.02, wg1: 1, wg2: 4 },
  piglin_royal: { swallow: 0.30, struggles: 13, difficulty: 0.65, acid: 5.0, acidMax: 14.35, acidIncr: 0.055, wg1: 999, wg2: 999 }
};

// creature specs
const CREATURES = [
  { id: 'cathyl_rabbit', pack: 'CathylFunni', srcMob: 'rabbit', texBase: 'cathyl_rabbit',
    variants: [0, 1, 2], gendered: false, endKind: null, counterMax: 1, egg: 'rabbit_wizard',
    name: '哞妮', lore: '受委托重制的兔法师，外观与原版截然不同，仍是掠食者。',
    behavior: { hp: 24, speed: 0.25, dmg: 3, follow: 16, size: [0.6, 1.8], loot: null, tameable: true, baseStats: 'rabbit_wizard', undead: false } },
  { id: 'plant_maiden', pack: 'plantPACK', srcMob: 'vinemaiden', texBase: 'plant_maiden',
    variants: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 31, 99], gendered: false, endKind: null, counterMax: 1, egg: 'vinemaiden',
    name: '猪笼草', lore: '藤娘的植物化变体，依然会埋伏与吞食。',
    behavior: { hp: 30, speed: 0.3, dmg: 5, follow: 12, size: [0.7, 1.9], loot: null, tameable: true, baseStats: 'vinemaiden', undead: false },
    skip: [/_buried/, /_seedling/] },
  { id: 'lamia', pack: 'lamia', srcMob: 'zombie', texBase: 'lamia',
    variants: [0, 1, 2, 13], gendered: true, endKind: 'decor', counterMax: 5, egg: 'zombie',
    name: '拉米亚', lore: '取代僵尸的蛇身掠食者，拥有多套装饰外观。',
    behavior: { hp: 20, speed: 0.23, dmg: 3, follow: 35, size: [0.6, 1.8], loot: 'zombie', tameable: false, baseStats: 'zombie', undead: true } },
  { id: 'predatopia_v2', pack: 'v_predatopiaV2', srcMob: 'zombie', texBase: 'predatopia_v2',
    variants: [0, 1, 2, 13], gendered: true, endKind: 'decor', counterMax: 5, egg: 'zombie',
    name: '人鱼', lore: 'Predatopia 多掠食者包 V2 —— 由僵娘换皮而来的独立掠食者。',
    behavior: { hp: 20, speed: 0.23, dmg: 3, follow: 35, size: [0.6, 1.8], loot: 'zombie', tameable: false, baseStats: 'zombie', undead: true } },
  { id: 'predatopia', pack: 'v_predatopiazombie', srcMob: 'zombie', texBase: 'predatopia',
    variants: [0, 1, 2, 13], gendered: true, endKind: 'decor', counterMax: 5, egg: 'zombie',
    name: '喵呜', lore: 'Predatopia 多掠食者包 —— 由僵娘换皮而来的独立掠食者。',
    behavior: { hp: 20, speed: 0.23, dmg: 3, follow: 35, size: [0.6, 1.8], loot: 'zombie', tameable: false, baseStats: 'zombie', undead: true } },
  { id: 'piglin_dragon', pack: 'piglin_dragon', srcMob: 'piglin_royal', texBase: 'piglin_dragon',
    variants: [0], gendered: true, endKind: null, counterMax: 1, egg: 'piglin_royal',
    name: '熄', lore: 'PCraft 原版里被替换成“龙娘”的猪灵王模型，独立出来的掠食者。',
    behavior: { hp: 150, speed: 0.3, dmg: 3, follow: 16, size: [1.5, 3.4], loot: 'piglin_royal', tameable: false, baseStats: 'piglin_royal', undead: false } },
  { id: 'eevee_rabbit', pack: 'eeveelution', srcMob: 'rabbit', texBase: 'eevee_rabbit',
    variants: [0, 1, 2], gendered: false, endKind: null, counterMax: 1, egg: 'rabbit_wizard', ball: 'dream_ball',
    name: '太阳伊布', lore: '紫色宝可梦 · 太阳伊布（Espeon）——换皮的兔法师掠食者。', behavior: { hp: 24, speed: 0.25, dmg: 3, follow: 16, size: [0.6, 1.8], loot: null, tameable: true, baseStats: 'rabbit_wizard', undead: false } },
  { id: 'eevee_scarecrow', pack: 'eeveelution', srcMob: 'scarecrow', texBase: 'eevee_scarecrow',
    variants: [0], gendered: true, endKind: 'health', counterMax: 3, egg: 'scarecrow', ball: 'dive_ball',
    name: '水伊布', lore: '青蓝色宝可梦 · 水伊布（Vaporeon）——换皮的稻草人掠食者。', behavior: { hp: 50, speed: 0.3, dmg: 3, follow: 64, size: [0.8, 2.4], loot: null, tameable: true, baseStats: 'scarecrow', undead: false } },
  { id: 'eevee_silverfish', pack: 'eeveelution', srcMob: 'silverfish', texBase: 'eevee_silverfish',
    variants: [0], gendered: true, endKind: null, counterMax: 1, egg: 'silverfish', ball: 'moon_ball',
    name: '月亮伊布', lore: '黑色宝可梦 · 月亮伊布（Umbreon）——换皮的吞食蠹虫掠食者。', behavior: { hp: 12, speed: 0.3, dmg: 4, follow: 16, size: [0.6, 1.8], loot: null, tameable: false, baseStats: 'silverfish', undead: false } },
  { id: 'eevee_vinemaiden', pack: 'eeveelution', srcMob: 'vinemaiden', texBase: 'eevee_vinemaiden',
    variants: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 31, 99], gendered: false, endKind: null, counterMax: 1, egg: 'vinemaiden', ball: 'quick_ball',
    name: '雷伊布', lore: '黄色宝可梦 · 雷伊布（Jolteon）——换皮的藤娘掠食者。', behavior: { hp: 30, speed: 0.3, dmg: 5, follow: 12, size: [0.7, 1.9], loot: null, tameable: true, baseStats: 'vinemaiden', undead: false },
    skip: [/_buried/, /_seedling/] },
  { id: 'eevee_zombie', pack: 'eeveelution', srcMob: 'zombie', texBase: 'eevee_zombie',
    variants: [0, 1, 2, 13], gendered: true, endKind: 'decor', counterMax: 5, egg: 'zombie', ball: 'repeat_ball',
    name: '火伊布', lore: '橙红色宝可梦 · 火伊布（Flareon）——换皮的吞食僵尸掠食者。', behavior: { hp: 20, speed: 0.23, dmg: 3, follow: 35, size: [0.6, 1.8], loot: 'zombie', tameable: false, baseStats: 'zombie', undead: true } }
];

// English display names for the community creatures (mirrors generate.js EN_* maps).
const EN_COMMUNITY = {
  cathyl_rabbit: 'Moony', plant_maiden: 'Nepenthes', lamia: 'Lamia',
  predatopia: 'Meow', predatopia_v2: 'Siren', piglin_dragon: 'Extinguish',
  eevee_rabbit: 'Espeon', eevee_scarecrow: 'Vaporeon', eevee_silverfish: 'Umbreon',
  eevee_vinemaiden: 'Jolteon', eevee_zombie: 'Flareon'
};

const validSeg = (s) => /^[A-Za-z][A-Za-z0-9_.]*$/.test(s);

function behavior(c, skinMax) {
  const b = c.behavior;
  const fam = [c.id, 'predator'];
  if (b.undead) fam.push('undead');
  fam.push('monster');
  const components = {
    'minecraft:type_family': { family: fam },
    'minecraft:health': { value: b.hp, max: b.hp },
    'minecraft:movement': { value: b.speed },
    'minecraft:navigation.walk': { can_path_over_water: true, avoid_water: true },
    'minecraft:movement.basic': {}, 'minecraft:jump.static': {}, 'minecraft:physics': {},
    'minecraft:collision_box': { width: b.size[0], height: b.size[1] },
    'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
    'minecraft:breathable': { total_supply: 15, suffocate_time: 0 },
    'minecraft:nameable': {},
    'minecraft:damage_sensor': { triggers: [{ cause: 'fall', deals_damage: false }] },
    'minecraft:attack': { damage: b.dmg },
    'minecraft:follow_range': { value: b.follow, max: b.follow },
    'minecraft:behavior.float': { priority: 0 },
    'minecraft:behavior.random_stroll': { priority: 4, speed_multiplier: 1 },
    'minecraft:behavior.random_look_around': { priority: 5 }
  };
  if (b.loot) components['minecraft:loot'] = { table: `loot_tables/entities/${b.loot}.json` };
  const groups = {
    'pcraftrevorn:aggressive': {
      'minecraft:behavior.melee_attack': { priority: 1, speed_multiplier: 1.2 },
      'minecraft:behavior.hurt_by_target': { priority: 2 },
      'minecraft:behavior.nearest_attackable_target': {
        priority: 3, must_see: true, reselect_targets: true, within_radius: b.follow,
        entity_types: [
          { filters: { test: 'is_family', subject: 'other', value: 'player' }, max_dist: b.follow },
          { filters: { test: 'is_family', subject: 'other', value: 'villager' }, max_dist: b.follow }
        ]
      }
    },
    'pcraftrevorn:prey_holder': { 'minecraft:rideable': { seat_count: 1, family_types: ['player'], seats: [{ position: [0, 0, 0] }] } }
  };
  const events = {
    'minecraft:entity_spawned': { add: { component_groups: ['pcraftrevorn:aggressive'] } },
    'pcraftrevorn:on_swallow': { remove: { component_groups: ['pcraftrevorn:aggressive'] }, add: { component_groups: ['pcraftrevorn:prey_holder'] } },
    'pcraftrevorn:on_release': { add: { component_groups: ['pcraftrevorn:aggressive'] }, remove: { component_groups: ['pcraftrevorn:prey_holder'] } }
  };
  if (b.tameable) {
    components['minecraft:tameable'] = { probability: 1.0, tame_items: ['pcraftrevorn:cupids_arrow'], tame_event: { event: 'pcraftrevorn:on_tame', target: 'self' } };
    groups['pcraftrevorn:tamed'] = { 'minecraft:is_tamed': {}, 'minecraft:behavior.follow_owner': { priority: 6, speed_multiplier: 1, start_distance: 10, stop_distance: 2 } };
    events['pcraftrevorn:on_tame'] = { add: { component_groups: ['pcraftrevorn:tamed'] } };
  }
  return {
    format_version: '1.21.0',
    'minecraft:entity': {
      description: { identifier: `${NS}:${c.id}`, is_spawnable: true, is_summonable: true, properties: { [`${NS}:skin`]: { type: 'int', range: [0, skinMax], default: 0, client_sync: true } } },
      component_groups: groups, components, events
    }
  };
}

function eggPng(id, eggKind) {
  const src = path.join(RP, 'textures', 'items', 'pcraftrevorn', eggKind + '_spawn_egg.png');
  if (fs.existsSync(src)) copy(src, path.join(RP, 'textures', 'items', 'pcraftrevorn', id + '_spawn_egg.png'));
}

function generateCommunity() {
  const reg = { texBase: {}, gendered: [], variants: {}, endKind: {}, animPrefix: {}, counterMax: {}, stats: {}, names: {}, lore: {}, predatorIds: [], skins: {}, texMax: {} };
  const atlas = readJSON(path.join(RP, 'textures', 'item_texture.json'));
  const bpTexts = [path.join(BP, 'texts', 'en_US.lang'), path.join(BP, 'texts', 'zh_CN.lang')];
  const extraEn = [], extraZh = [];

  for (const c of CREATURES) {
    const root = path.join(COMM, c.pack, 'assets', 'pcraftrevorn');
    if (!fs.existsSync(root)) { console.warn(`skip ${c.id}: missing ${root}`); continue; }

    // geometry + animation
    const geo = readJSON(path.join(root, 'geo', c.srcMob + '.geo.json'));
    const anim = convertAnimObject(readJSON(path.join(root, 'animations', c.srcMob + '.animation.json')));
    sanitizeBones(geo, anim);
    geo['minecraft:geometry'][0].description.identifier = 'geometry.' + c.id;
    writeJSON(path.join(RP, 'models', 'entity', c.id + '.geo.json'), geo);

    // rename animation identifiers; drop names illegal in Bedrock
    const renamed = {};
    const shorts = [];
    for (const [k, v] of Object.entries(anim.animations || {})) {
      const short = k.split('.').pop();
      if (!validSeg(short)) continue;
      renamed[`animation.${c.id}.${short}`] = v;
      shorts.push(short);
    }
    anim.animations = renamed;
    writeJSON(path.join(RP, 'animations', c.id + '.animation.json'), anim);

    // textures
    const texDir = path.join(root, 'textures', 'entities');
    const list = [];
    for (const f of fs.readdirSync(texDir).filter((f) => f.endsWith('.png'))) {
      const base = f.replace('.png', '');
      if (!base.startsWith(c.srcMob)) continue; // shared folders: only this mob's textures
      if (c.skip && c.skip.some((r) => r.test(base))) continue;
      const nn = base.replace(new RegExp('^' + c.srcMob), c.texBase);
      copy(path.join(texDir, f), path.join(RP, 'textures', 'entity', 'pcraftrevorn', nn + '.png'));
      list.push(nn);
    }
    list.sort();
    const skinMax = Math.max(0, list.length - 1);

    // client entity
    const textures = {}, arr = [];
    list.forEach((n, i) => { textures['skin' + i] = `textures/entity/pcraftrevorn/${n}`; arr.push('Texture.skin' + i); });
    const animMap = {}; for (const s of shorts) animMap[s] = `animation.${c.id}.${s}`;
    const animate = [{ idle: '1.0 - math.min(1.0, query.modified_move_speed * 4.0)' }];
    if (shorts.includes('walk')) animate.push({ walk: 'math.min(1.0, query.modified_move_speed * 4.0)' });
    writeJSON(path.join(RP, 'entity', c.id + '.entity.json'), {
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: `${NS}:${c.id}`, min_engine_version: '1.8.0',
          materials: { default: 'entity_alphatest' }, textures,
          geometry: { default: 'geometry.' + c.id }, animations: animMap,
          scripts: { animate }, render_controllers: [`controller.render.${NS}.${c.id}`],
          spawn_egg: { texture: `${NS}_${c.id}_spawn_egg` }
        }
      }
    });
    writeJSON(path.join(RP, 'render_controllers', c.id + '.render_controllers.json'), {
      format_version: '1.10.0',
      render_controllers: {
        [`controller.render.${NS}.${c.id}`]: {
          geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }],
          arrays: { textures: { 'Array.skins': arr } },
          textures: [`Array.skins[q.property('${NS}:skin')]`]
        }
      }
    });

    // behavior entity
    writeJSON(path.join(BP, 'entities', c.id + '.json'), behavior(c, skinMax));

    // spawn egg (Poké Ball for the eeveelution reskins)
    const itemId = c.id + '_spawn_egg';
    if (c.ball) ballPng(path.join(RP, 'textures', 'items', 'pcraftrevorn', itemId + '.png'), c.ball, 16);
    else {
      const skin = list.includes(c.texBase) ? c.texBase : list[0];
      const ok = skin && makeTextureEgg(
        path.join(RP, 'textures', 'items', 'pcraftrevorn', itemId + '.png'),
        path.join(RP, 'textures', 'entity', 'pcraftrevorn', skin + '.png')
      );
      if (!ok) eggPng(c.id, c.egg);
    }
    writeJSON(path.join(BP, 'items', itemId + '.json'), {
      format_version: '1.21.0',
      'minecraft:item': {
        description: { identifier: `${NS}:${itemId}`, menu_category: { category: 'nature' } },
        components: {
          'minecraft:icon': { textures: { default: `${NS}_${itemId}` } },
          'minecraft:max_stack_size': 64,
          'minecraft:entity_placer': { entity: `${NS}:${c.id}` }
        }
      }
    });
    atlas.texture_data[`${NS}_${itemId}`] = { textures: `textures/items/pcraftrevorn/${itemId}` };
    const nameEn = EN_COMMUNITY[c.id] || c.name;
    // Poké-Ball items are named after the Pokémon; other creatures get a spawn-egg name.
    const eggEn = c.ball ? nameEn : nameEn + ' Spawn Egg';
    const eggZh = c.ball ? c.name : c.name + '生成蛋';
    extraEn.push(
      `entity.${NS}:${c.id}.name=${nameEn}`,
      `item.${NS}:${itemId}.name=${eggEn}`,
      `item.${NS}:${itemId}=${eggEn}`,
      `item.spawn_egg.entity.${NS}:${c.id}.name=${eggEn}`
    );
    extraZh.push(
      `entity.${NS}:${c.id}.name=${c.name}`,
      `item.${NS}:${itemId}.name=${eggZh}`,
      `item.${NS}:${itemId}=${eggZh}`,
      `item.spawn_egg.entity.${NS}:${c.id}.name=${eggZh}`
    );

    // registry
    const st = BASE_STATS[c.behavior.baseStats];
    reg.texBase[c.id] = c.texBase;
    if (c.gendered) reg.gendered.push(c.id);
    reg.variants[c.id] = c.variants;
    if (c.endKind) reg.endKind[c.id] = c.endKind;
    reg.animPrefix[c.id] = c.id;
    reg.counterMax[c.id] = c.counterMax;
    reg.stats[c.id] = { ...st };
    reg.names[c.id] = c.name;
    reg.lore[c.id] = c.lore;
    reg.predatorIds.push(c.id);
    reg.skins[c.id] = Object.fromEntries(list.map((n, i) => [n, i]));
    reg.texMax[c.id] = skinMax;
  }

  writeText(path.join(BP, 'texts', 'en_US.lang'), fs.readFileSync(bpTexts[0], 'utf8').trimEnd() + '\n' + extraEn.join('\n') + '\n');
  writeText(path.join(BP, 'texts', 'zh_CN.lang'), fs.readFileSync(bpTexts[1], 'utf8').trimEnd() + '\n' + extraZh.join('\n') + '\n');
  writeJSON(path.join(RP, 'textures', 'item_texture.json'), atlas);

  const js = '// AUTO-GENERATED by tools/generate_community.js. Community creature registries.\n'
    + 'export const COMMUNITY = ' + JSON.stringify(reg, null, 2) + ';\n';
  writeText(path.join(BP, 'scripts', 'pcraftrevorn', 'data', 'community.js'), js);
  console.log(`Community creatures generated: ${reg.predatorIds.length} (${reg.predatorIds.join(', ')})`);
}

module.exports = { generateCommunity };
if (require.main === module) generateCommunity();
