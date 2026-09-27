/*
 * PCraftRevorn -> Bedrock Phase 2: entities.
 *
 * Reads the extracted original mod (.work/mod) and generates:
 *   resource_pack/models/entity/*.geo.json        (copied, GeckoLib geo == Bedrock geo)
 *   resource_pack/animations/*.animation.json     (copied, GeckoLib anim == Bedrock anim)
 *   resource_pack/textures/entity/pcraftrevorn/*  (copied)
 *   resource_pack/entity/*.entity.json            (client entities + skin arrays)
 *   resource_pack/render_controllers/*.json       (skin selection via pc:skin property)
 *   resource_pack/animation_controllers/*.json    (idle/walk)
 *   behavior_pack/entities/*.json                 (behaviors + entity properties)
 *   behavior_pack/spawn_rules/*.json              (from forge biome modifiers)
 *
 * Run after tools/extract.ps1:  node tools/generate_entities.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const MOD = path.join(ROOT, '.work', 'mod');
const SRC_GEO = path.join(MOD, 'assets', 'pcraftrevorn', 'geo');
const SRC_ANIM = path.join(MOD, 'assets', 'pcraftrevorn', 'animations');
const SRC_TEX = path.join(MOD, 'assets', 'pcraftrevorn', 'textures', 'entities');
const BP = path.join(ROOT, 'behavior_pack');
const RP = path.join(ROOT, 'resource_pack');
const NS = 'pcraftrevorn';

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function writeJSON(f, o) { ensureDir(path.dirname(f)); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); }
function readJSON(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function exists(p) { return fs.existsSync(p); }
function rmrf(p) { if (exists(p)) fs.rmSync(p, { recursive: true, force: true }); }
function copy(s, d) { ensureDir(path.dirname(d)); fs.copyFileSync(s, d); }

// ---- minimal png writer (transparent placeholder icon) ----
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const b = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b), 0); return Buffer.concat([l, b, c]); }
function writePng(f, w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  ensureDir(path.dirname(f));
  fs.writeFileSync(f, Buffer.concat([sig, chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ---- entity table ----
// skins: regex applied to texture basenames (without extension)
const ENTITIES = [
  { id: 'basaltmite', geo: 'basaltmite', anim: 'basaltmite', skins: /^basaltmite_/, kind: 'monster', hp: 40, speed: 0.18, dmg: 3, follow: 16, kbr: 0.4, size: [0.6, 1.8], hostile: true, families: ['basaltmite', 'predator', 'monster', 'arthropod'], pop: 'monster' },
  { id: 'gilded_basaltmite', geo: 'basaltmite', anim: 'basaltmite', skins: /^gilded_basaltmite_/, kind: 'monster', hp: 70, speed: 0.21, dmg: 3, follow: 16, kbr: 0.6, size: [0.6, 1.8], hostile: true, families: ['basaltmite', 'gilded_basaltmite', 'predator', 'monster', 'arthropod'], pop: 'monster' },
  { id: 'silverfish', geo: 'silverfish', anim: 'silverfish', skins: /^silverfish_/, kind: 'monster', hp: 12, speed: 0.3, dmg: 4, follow: 16, kbr: 0.4, size: [0.6, 1.8], hostile: true, families: ['silverfish', 'predator', 'monster', 'arthropod'], pop: 'monster' },
  { id: 'vinemaiden', geo: 'vinemaiden', anim: 'vinemaiden', skins: /^vinemaiden(\d|_buried)/, kind: 'creature', hp: 30, speed: 0.3, dmg: 5, follow: 12, kbr: 0, size: [0.7, 1.9], hostile: true, families: ['vinemaiden', 'predator', 'monster'], pop: 'monster' },
  { id: 'vinemaiden_seedling', geo: 'vinemaiden_seedling', anim: 'vinemaiden_seedling', skins: /^vinemaiden_seedling/, kind: 'creature', hp: 8, speed: 0.3, dmg: 3, follow: 16, kbr: 0, size: [0.6, 1.8], hostile: false, families: ['vinemaiden', 'monster'], pop: 'monster' },
  { id: 'zombie', geo: 'zombiegirl', anim: 'zombiegirl', skins: /^zombie(\d|_girl)/, kind: 'monster', hp: 20, speed: 0.23, dmg: 3, follow: 35, kbr: 0, size: [0.6, 1.8], hostile: true, families: ['zombie', 'predator', 'undead', 'monster'], pop: 'monster', loot: 'zombie' },
  { id: 'scarecrow', geo: 'scarecrow', anim: 'scarecrow', skins: /^scarecrow_(?!glow)/, kind: 'monster', hp: 50, speed: 0.3, dmg: 3, follow: 64, kbr: 0, size: [0.8, 2.4], hostile: true, families: ['scarecrow', 'predator', 'monster'], pop: 'monster' },
  { id: 'rabbit_wizard', geo: 'rabbit', anim: 'rabbit', skins: /^rabbit\d/, kind: 'creature', hp: 24, speed: 0.25, dmg: 3, follow: 16, kbr: 0, size: [0.6, 1.8], hostile: true, families: ['rabbit_wizard', 'predator', 'village_protector'], pop: 'animal' },
  { id: 'piglin_royal', geo: 'piglin_royalty', anim: 'piglin_royalty', skins: /^piglin_royal_(?!knight)/, kind: 'monster', hp: 150, speed: 0.3, dmg: 3, follow: 16, kbr: 1, size: [1.5, 3.4], hostile: false, families: ['piglin', 'piglin_royal', 'monster'], pop: 'monster', loot: 'piglin_royal' },
  { id: 'piglin_royal_knight', geo: 'piglin_royal_knight', anim: 'piglin_royal_knight', skins: /^piglin_royal_knight_/, kind: 'monster', hp: 32, speed: 0.32, dmg: 5, follow: 16, kbr: 0, size: [0.6, 1.8], hostile: true, families: ['piglin', 'piglin_royal_knight', 'predator', 'monster'], pop: 'monster' },
  { id: 'binding_ring', geo: 'binding_ring', anim: 'shielding_ring', skins: /^binding_ring$/, kind: 'monster', hp: 10, speed: 0.6, dmg: 3, follow: 16, kbr: 0.35, size: [0.6, 1.8], hostile: false, families: ['binding_ring', 'accessory'], pop: 'monster' },
  { id: 'shielding_ring', geo: 'shielding_ring', anim: 'shielding_ring', skins: /^shielding_ring$/, kind: 'monster', hp: 20, speed: 0.45, dmg: 3, follow: 16, kbr: 2, size: [0.6, 1.8], hostile: false, families: ['shielding_ring', 'accessory'], pop: 'monster' }
];
const SPECIAL = [
  { id: 'piglin_royal_spawner', hp: 10, size: [0, 0], families: ['piglin_royal_spawner', 'spawner'] },
  { id: 'piglin_throneroom_spawner', hp: 10, size: [0, 0], families: ['piglin_throneroom_spawner', 'spawner'] },
  { id: 'rabbit_player_projectile', projectile: true, families: ['projectile'] },
  { id: 'rabbit_projectile_bloodlust', projectile: true, families: ['projectile'] },
  { id: 'digestion_bar', boss: true, hp: 100, size: [0, 0], families: ['digestion_bar'] }
];
const INVISIBLE_GEO = 'geometry.pcraftrevorn.invisible';
const INVISIBLE_TEX = 'textures/entity/pcraftrevorn/invisible';
// preds that can be tamed (pcraftrevorn:tameable_preds tag)
const TAMEABLE = new Set(['gilded_basaltmite', 'piglin_royal_knight', 'rabbit_wizard', 'scarecrow', 'vinemaiden']);
// entities that ship a spawn egg item
const SPAWN_EGG = new Set(['zombie', 'piglin_royal', 'vinemaiden', 'piglin_royal_knight', 'silverfish', 'basaltmite', 'rabbit_wizard', 'gilded_basaltmite', 'scarecrow']);
// entities with a separate emissive glow texture (drawn as a 2nd render controller)
const GLOW = { binding_ring: 'binding_ring_glow', shielding_ring: 'shielding_ring_glow', scarecrow: 'scarecrow_glow' };
// temporary/loop animations (short name): only these loop, the rest play once
const LOOP_ANIMS = new Set(['idle', 'walk', 'sprint', 'hidden']);

// ---- helpers ----
const texFiles = () => fs.readdirSync(SRC_TEX).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4));
const geoIdent = (file) => {
  if (file === 'vinemaiden_seedling') return 'geometry.vinemaiden_seedling';
  const j = readJSON(path.join(SRC_GEO, file + '.geo.json'));
  return j['minecraft:geometry'][0].description.identifier;
};
const animNames = (file) => {
  const j = readJSON(path.join(SRC_ANIM, file + '.animation.json'));
  return Object.keys(j.animations);
};

const allTex = texFiles();

function genTextureAndGeometry() {
  // geometries
  for (const f of fs.readdirSync(SRC_GEO)) {
    if (!f.endsWith('.geo.json')) continue;
    const src = path.join(SRC_GEO, f);
    const j = readJSON(src);
    // fix bad identifier
    if (f === 'vinemaiden_seedling.geo.json') j['minecraft:geometry'][0].description.identifier = 'geometry.vinemaiden_seedling';
    writeJSON(path.join(RP, 'models', 'entity', f), j);
  }
  // animations: GeckoLib keyframes are {"vector":[...],"easing":...} which Bedrock
  // does NOT understand (Bedrock uses plain arrays / molang / {pre,post}). Convert.
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
    if (ch === null || typeof ch !== 'object' || Array.isArray(ch)) return ch; // constant or molang
    if (Array.isArray(ch.vector)) return ch.vector; // constant channel written as {"vector":[...]}
    const out = {};
    for (const [t, v] of Object.entries(ch)) out[t] = unwrap(v);
    return out;
  };
  for (const f of fs.readdirSync(SRC_ANIM)) {
    if (!f.endsWith('.animation.json')) continue;
    const j = readJSON(path.join(SRC_ANIM, f));
    delete j.geckolib_format_version; // GeckoLib-only root field
    for (const [name, anim] of Object.entries(j.animations || {})) {
      anim.loop = LOOP_ANIMS.has(name.split('.').pop());
      for (const bd of Object.values(anim.bones || {})) {
        for (const ch of ['rotation', 'position', 'scale']) {
          if (bd[ch] !== undefined) bd[ch] = convertChannel(bd[ch]);
        }
      }
    }
    writeJSON(path.join(RP, 'animations', f), j);
  }
  // textures
  for (const f of fs.readdirSync(SRC_TEX)) {
    if (!f.endsWith('.png')) continue;
    copy(path.join(SRC_TEX, f), path.join(RP, 'textures', 'entity', 'pcraftrevorn', f));
  }
  // invisible placeholder texture + geometry
  writePng(path.join(RP, 'textures', 'entity', 'pcraftrevorn', 'invisible.png'), 16, 16, Buffer.alloc(16 * 16 * 4, 0));
  writeJSON(path.join(RP, 'models', 'entity', 'invisible.geo.json'), {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { identifier: INVISIBLE_GEO, texture_width: 16, texture_height: 16, visible_bounds_width: 0.1, visible_bounds_height: 0.1, visible_bounds_offset: [0, 0, 0] },
      bones: [{ name: 'root', pivot: [0, 0, 0], cubes: [{ origin: [-0.01, 0, -0.01], size: [0.02, 0.02, 0.02], uv: [0, 0] }] }]
    }]
  });
  // simple projectile model (rabbit staff projectiles)
  writeJSON(path.join(RP, 'models', 'entity', 'projectile.geo.json'), {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { identifier: 'geometry.pcraftrevorn.projectile', texture_width: 16, texture_height: 16, visible_bounds_width: 0.6, visible_bounds_height: 0.6, visible_bounds_offset: [0, 0.3, 0] },
      bones: [{ name: 'root', pivot: [0, 0, 0], cubes: [{ origin: [-2, 2, -7], size: [4, 4, 14], uv: [0, 0] }] }]
    }]
  });
}

// ---- entities ----
function genMobs() {
  for (const e of ENTITIES) {
    const skins = allTex.filter(n => e.skins.test(n)).sort();
    const n = skins.length;
    const textureMap = {}; const arrayEntries = [];
    skins.forEach((s, i) => { textureMap['skin' + i] = 'textures/entity/pcraftrevorn/' + s; arrayEntries.push('Texture.skin' + i); });

    const anims = animNames(e.anim);
    const short = (a) => a.split('.').pop();
    const animMap = {};
    for (const a of anims) animMap[short(a)] = a;
    const animKeys = anims.map(short);
    const idleKey = animKeys.includes('idle') ? 'idle' : animKeys[0];
    const walkKey = animKeys.includes('walk') ? 'walk' : idleKey;
    // vanilla-style direct animate (no animation controller -> fewer failure points)
    const animate = [{ [idleKey]: '1.0 - math.min(1.0, query.modified_move_speed * 4.0)' }];
    if (walkKey !== idleKey) animate.push({ [walkKey]: 'math.min(1.0, query.modified_move_speed * 4.0)' });

    // client entity
    const materials = { default: 'entity_alphatest' };
    const textures = { ...textureMap };
    const renderControllers = [`controller.render.${NS}.${e.id}`];
    const glowTex = GLOW[e.id];
    if (glowTex) {
      materials.glow = 'entity_emissive_alpha';
      textures.glow = 'textures/entity/pcraftrevorn/' + glowTex;
      renderControllers.push(`controller.render.${NS}.${e.id}.glow`);
    }
    const desc = {
      identifier: `${NS}:${e.id}`,
      min_engine_version: '1.8.0',
      materials,
      textures,
      geometry: { default: geoIdent(e.geo) },
      animations: animMap,
      scripts: { animate },
      render_controllers: renderControllers
    };
    // modern per-entity spawn egg texture (1.21+ format)
    if (SPAWN_EGG.has(e.id)) desc.spawn_egg = { texture: `${NS}_${e.id}_spawn_egg` };
    writeJSON(path.join(RP, 'entity', e.id + '.entity.json'), {
      format_version: '1.10.0',
      'minecraft:client_entity': { description: desc }
    });
    // render controller(s)
    const rc = {
      [`controller.render.${NS}.${e.id}`]: {
        geometry: 'Geometry.default',
        materials: [{ '*': 'Material.default' }],
        arrays: { textures: { 'Array.skins': arrayEntries } },
        textures: [`Array.skins[q.property('${NS}:skin')]`]
      }
    };
    if (glowTex) {
      rc[`controller.render.${NS}.${e.id}.glow`] = {
        geometry: 'Geometry.default',
        materials: [{ '*': 'Material.glow' }],
        textures: ['Texture.glow']
      };
    }
    writeJSON(path.join(RP, 'render_controllers', e.id + '.render_controllers.json'), {
      format_version: '1.10.0',
      render_controllers: rc
    });
    // behavior
    genBehavior(e, n - 1);
  }
}

function genBehavior(e, skinMax) {
  const components = {
    'minecraft:type_family': { family: e.families },
    'minecraft:health': { value: e.hp, max: e.hp },
    'minecraft:movement': { value: e.speed },
    'minecraft:navigation.walk': { can_path_over_water: true, avoid_water: true },
    'minecraft:movement.basic': {},
    'minecraft:jump.static': {},
    'minecraft:physics': {},
    'minecraft:collision_box': { width: e.size[0], height: e.size[1] },
    'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
    'minecraft:breathable': { total_supply: 15, suffocate_time: 0 },
    'minecraft:nameable': {},
    'minecraft:damage_sensor': { triggers: [{ cause: 'fall', deals_damage: false }] }
  };
  if (e.dmg) components['minecraft:attack'] = { damage: e.dmg };
  if (e.follow) components['minecraft:follow_range'] = { value: e.follow, max: e.follow };
  if (e.kbr) components['minecraft:knockback_resistance'] = { value: e.kbr };
  components['minecraft:behavior.float'] = { priority: 0 };
  components['minecraft:behavior.random_stroll'] = { priority: 4, speed_multiplier: 1 };
  components['minecraft:behavior.random_look_around'] = { priority: 5 };
  if (e.loot) components['minecraft:loot'] = { table: `loot_tables/entities/${e.loot}.json` };

  const componentGroups = {};
  const events = {};
  // aggressive behaviors live in a group so the script can disable them while the
  // predator is swallowing (fixes "the mob keeps hitting me after being eaten")
  if (e.hostile) {
    componentGroups[`${NS}:aggressive`] = {
      'minecraft:behavior.melee_attack': { priority: 1, speed_multiplier: 1.2 },
      'minecraft:behavior.nearest_attackable_target': {
        priority: 3, must_see: true, reselect_targets: true, within_radius: e.follow || 16,
        entity_types: [
          { filters: { test: 'is_family', subject: 'other', value: 'player' }, max_dist: e.follow || 16 },
          { filters: { test: 'is_family', subject: 'other', value: 'villager' }, max_dist: e.follow || 16 }
        ]
      },
      'minecraft:behavior.hurt_by_target': { priority: 2 }
    };
    // during swallow the prey rides the predator (free look, position follows)
    componentGroups[`${NS}:prey_holder`] = {
      'minecraft:rideable': {
        seat_count: 1,
        family_types: ['player'],
        seats: [{ position: [0, 0, 0] }]
      }
    };
    events['minecraft:entity_spawned'] = { add: { component_groups: [`${NS}:aggressive`] } };
    events[`${NS}:on_swallow`] = { remove: { component_groups: [`${NS}:aggressive`] }, add: { component_groups: [`${NS}:prey_holder`] } };
    events[`${NS}:on_release`] = { add: { component_groups: [`${NS}:aggressive`] }, remove: { component_groups: [`${NS}:prey_holder`] } };
  }
  if (TAMEABLE.has(e.id)) {
    components['minecraft:tameable'] = {
      probability: 1.0,
      tame_items: [`${NS}:cupids_arrow`],
      tame_event: { event: `${NS}:on_tame`, target: 'self' }
    };
    componentGroups[`${NS}:tamed`] = {
      'minecraft:is_tamed': {},
      'minecraft:behavior.follow_owner': { priority: 6, speed_multiplier: 1, start_distance: 10, stop_distance: 2 }
    };
    events[`${NS}:on_tame`] = { add: { component_groups: [`${NS}:tamed`] } };
  }

  writeJSON(path.join(BP, 'entities', e.id + '.json'), {
    format_version: '1.21.0',
    'minecraft:entity': {
      description: {
        identifier: `${NS}:${e.id}`,
        is_spawnable: true,
        is_summonable: true,
        properties: { [`${NS}:skin`]: { type: 'int', range: [0, Math.max(0, skinMax)], default: 0, client_sync: true } }
      },
      component_groups: componentGroups,
      components,
      events
    }
  });
}

function genSpecial() {
  for (const s of SPECIAL) {
    const geometry = s.projectile ? 'geometry.pcraftrevorn.projectile' : INVISIBLE_GEO;
    const texture = s.projectile ? 'textures/items/pcraftrevorn/cupid_arrow' : INVISIBLE_TEX;
    // client entity
    writeJSON(path.join(RP, 'entity', s.id + '.entity.json'), {
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: `${NS}:${s.id}`,
          materials: { default: 'entity_alphatest' },
          textures: { default: texture },
          geometry: { default: geometry },
          render_controllers: [`controller.render.${NS}.${s.id}`]
        }
      }
    });
    writeJSON(path.join(RP, 'render_controllers', s.id + '.render_controllers.json'), {
      format_version: '1.10.0',
      render_controllers: {
        [`controller.render.${NS}.${s.id}`]: { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] }
      }
    });
    const components = s.projectile ? {
      'minecraft:type_family': { family: s.families },
      'minecraft:collision_box': { width: 0.25, height: 0.25 },
      'minecraft:physics': {},
      'minecraft:pushable': { is_pushable: false, is_pushable_by_piston: false }
    } : s.boss ? {
      'minecraft:type_family': { family: s.families },
      'minecraft:boss': { hud_range: 100, should_darken_sky: false },
      'minecraft:health': { value: s.hp, max: s.hp },
      'minecraft:collision_box': { width: 0, height: 0 },
      'minecraft:physics': { has_gravity: false, has_collision: false },
      'minecraft:pushable': { is_pushable: false, is_pushable_by_piston: false },
      'minecraft:fire_immune': {},
      'minecraft:persistent': {},
      'minecraft:damage_sensor': { triggers: [{ on_damage: { filters: { test: 'always', value: true } }, deals_damage: false }] }
    } : {
      'minecraft:type_family': { family: s.families },
      'minecraft:health': { value: s.hp, max: s.hp },
      'minecraft:collision_box': { width: s.size[0], height: s.size[1] },
      'minecraft:physics': {},
      'minecraft:pushable': { is_pushable: false, is_pushable_by_piston: false },
      'minecraft:fire_immune': {},
      'minecraft:damage_sensor': { triggers: [{ on_damage: { filters: { test: 'always', value: true } }, deals_damage: false }] }
    };
    writeJSON(path.join(BP, 'entities', s.id + '.json'), {
      format_version: '1.21.0',
      'minecraft:entity': {
        description: { identifier: `${NS}:${s.id}`, is_spawnable: false, is_summonable: true },
        components
      }
    });
  }
}

// ---- spawn rules ----
function genSpawnRules() {
  const rules = [
    { id: 'basaltmite', weight: 40, min: 1, max: 1, biome: { test: 'has_biome_tag', value: 'basalt' }, pop: 'monster' },
    { id: 'silverfish', weight: 75, min: 4, max: 4, anyBiome: true, pop: 'monster' },
    { id: 'vinemaiden', weight: 18, min: 1, max: 1, anyBiome: true, pop: 'monster' },
    { id: 'zombie', weight: 100, min: 1, max: 4, anyBiome: true, pop: 'monster' }
  ];
  const anyFilter = { any_of: [{ test: 'has_biome_tag', value: 'overworld' }, { test: 'has_biome_tag', value: 'nether' }, { test: 'has_biome_tag', value: 'the_end' }] };
  for (const r of rules) {
    const cond = {
      'minecraft:spawns_on_surface': {},
      'minecraft:brightness_filter': { min: 0, max: 15, adjust_for_weather: false },
      'minecraft:difficulty_filter': { min: 'easy', max: 'hard' },
      'minecraft:weight': { default: r.weight },
      'minecraft:herd': { min_size: r.min, max_size: r.max },
      'minecraft:biome_filter': r.anyBiome ? anyFilter : r.biome
    };
    writeJSON(path.join(BP, 'spawn_rules', r.id + '.json'), {
      format_version: '1.8.0',
      'minecraft:spawn_rules': {
        description: { identifier: `${NS}:${r.id}`, population_control: r.pop },
        conditions: [cond]
      }
    });
  }
}

// ---- skin index data (for scripts) ----
function genSkinData() {
  const out = {};
  for (const e of ENTITIES) {
    const skins = allTex.filter(n => e.skins.test(n)).sort();
    const map = {};
    skins.forEach((s, i) => { map[s] = i; });
    out[e.id] = map;
  }
  const js = '// AUTO-GENERATED by tools/generate_entities.js. Texture base name -> pcraftrevorn:skin index.\n'
    + 'export const SKINS = ' + JSON.stringify(out, null, 2) + ';\n';
  ensureDir(path.join(BP, 'scripts', 'pcraftrevorn', 'data'));
  fs.writeFileSync(path.join(BP, 'scripts', 'pcraftrevorn', 'data', 'skins.js'), js);
}

// ---- attachables (custom armor + held 3D items) ----
function genAttachables() {
  const pieces = [
    { item: 'silverfish_plating_helmet', piece: 'helmet', layer: 1, vis: 'helmet' },
    { item: 'silverfish_plating_chestplate', piece: 'chestplate', layer: 1, vis: 'chest' },
    { item: 'silverfish_plating_leggings', piece: 'leggings', layer: 2, vis: 'leg' },
    { item: 'silverfish_plating_boots', piece: 'boots', layer: 1, vis: 'boot' }
  ];
  for (const p of pieces) {
    const tex = `textures/models/armor/silverfish_plating_layer_${p.layer}`;
    writeJSON(path.join(RP, 'attachables', p.item + '.json'), {
      format_version: '1.8.0',
      'minecraft:attachable': {
        description: {
          identifier: `${NS}:${p.item}`,
          materials: { default: 'armor', enchanted: 'armor_enchanted' },
          textures: { default: tex, enchanted: 'textures/misc/enchanted_actor_glint' },
          geometry: { default: `geometry.humanoid.armor.${p.piece}` },
          scripts: { parent_setup: `variable.${p.vis}_layer_visible = 0.0;` },
          render_controllers: ['controller.render.armor']
        }
      }
    });
    writeJSON(path.join(RP, 'attachables', p.item + '.player.json'), {
      format_version: '1.10.0',
      'minecraft:attachable': {
        description: {
          identifier: `${NS}:${p.item}.player`,
          item: { [`${NS}:${p.item}`]: "query.owner_identifier == 'minecraft:player'" },
          materials: { default: 'armor', enchanted: 'armor_enchanted' },
          textures: { default: tex, enchanted: 'textures/misc/enchanted_actor_glint' },
          geometry: { default: `geometry.player.armor.${p.piece}` },
          scripts: { parent_setup: `variable.${p.vis}_layer_visible = 0.0;`, animate: ['offset'] },
          animations: { offset: `animation.armor.${p.piece}.offset` },
          render_controllers: ['controller.render.armor']
        }
      }
    });
  }

  // rabbit staffs use a 3D geo model -> held-item attachables
  const staffs = [
    { item: 'rabbit_staff', tex: 'rabbit_staff0' },
    { item: 'rabbit_staff_gold', tex: 'rabbit_staff1' },
    { item: 'rabbit_staff_bloodlust', tex: 'rabbit_staff2' }
  ];
  const rc = {};
  for (const s of staffs) {
    const rcName = `controller.render.${NS}.${s.item}`;
    rc[rcName] = { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] };
    writeJSON(path.join(RP, 'attachables', s.item + '.json'), {
      format_version: '1.10.0',
      'minecraft:attachable': {
        description: {
          identifier: `${NS}:${s.item}`,
          materials: { default: 'entity_alphatest', enchanted: 'entity_alphatest_glint' },
          textures: { default: `textures/items/pcraftrevorn/${s.tex}`, enchanted: 'textures/misc/enchanted_item_glint' },
          geometry: { default: 'geometry.rabbit_staff' },
          animations: { idle: 'animation.rabbit_staff.idle' },
          scripts: { animate: ['idle'] },
          render_controllers: [rcName]
        }
      }
    });
  }
  writeJSON(path.join(RP, 'render_controllers', 'staffs.render_controllers.json'), { format_version: '1.10.0', render_controllers: rc });
}

function main() {
  if (!exists(MOD)) { console.error('Missing .work/mod. Run tools/extract.ps1 first.'); process.exit(1); }
  for (const d of [
    path.join(BP, 'entities'), path.join(BP, 'spawn_rules'),
    path.join(BP, 'scripts', 'pcraftrevorn', 'data'),
    path.join(RP, 'entity'), path.join(RP, 'models', 'entity'),
    path.join(RP, 'animations'), path.join(RP, 'animation_controllers'),
    path.join(RP, 'render_controllers'), path.join(RP, 'attachables'),
    path.join(RP, 'textures', 'entity', 'pcraftrevorn')
  ]) rmrf(d);
  genTextureAndGeometry();
  genMobs();
  genSpecial();
  genSpawnRules();
  genSkinData();
  genAttachables();
  console.log('Phase 2 entities generated.');
}
main();
