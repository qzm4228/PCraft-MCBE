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
const fs = require('fs'), path = require('path');
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

// base predator stats (mirrors skin/assign.js PRED_STATS)
const BASE_STATS = {
  rabbit_wizard: { swallow: 0.15, struggles: 11, difficulty: 0.30, acid: 3.2, acidMax: 13.0, acidIncr: 0.04, wg1: 1, wg2: 4 },
  vinemaiden: { swallow: 0.32, struggles: 7, difficulty: 0.15, acid: 3.0, acidMax: 15.0, acidIncr: 0.03, wg1: 1, wg2: 4 },
  zombie: { swallow: 0.12, struggles: 7, difficulty: 0.15, acid: 4.0, acidMax: 12.0, acidIncr: 0.04, wg1: 1, wg2: 4 },
  scarecrow: { swallow: 0.34, struggles: 15, difficulty: 0.40, acid: 2.0, acidMax: 14.0, acidIncr: 0.01, wg1: 1, wg2: 4 },
  silverfish: { swallow: 0.30, struggles: 7, difficulty: 0.10, acid: 2.2, acidMax: 18.8, acidIncr: 0.02, wg1: 1, wg2: 4 }
};

// creature specs
const CREATURES = [
  { id: 'cathyl_rabbit', pack: 'CathylFunni', srcMob: 'rabbit', texBase: 'cathyl_rabbit',
    variants: [0, 1, 2], gendered: false, endKind: null, counterMax: 1, egg: 'rabbit_wizard',
    name: 'Cathyl 兔', lore: '受委托重制的兔法师，外观与原版截然不同，仍是掠食者。',
    behavior: { hp: 24, speed: 0.25, dmg: 3, follow: 16, size: [0.6, 1.8], loot: null, tameable: true, baseStats: 'rabbit_wizard', undead: false } },
  { id: 'plant_maiden', pack: 'plantPACK', srcMob: 'vinemaiden', texBase: 'plant_maiden',
    variants: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 31, 99], gendered: false, endKind: null, counterMax: 1, egg: 'vinemaiden',
    name: '植物娘', lore: '藤娘的植物化变体，依然会埋伏与吞食。',
    behavior: { hp: 30, speed: 0.3, dmg: 5, follow: 12, size: [0.7, 1.9], loot: null, tameable: true, baseStats: 'vinemaiden', undead: false },
    skip: [/_buried/, /_seedling/] },
  { id: 'lamia', pack: 'lamia', srcMob: 'zombie', texBase: 'lamia',
    variants: [0, 1, 2, 13], gendered: true, endKind: 'decor', counterMax: 5, egg: 'zombie',
    name: '拉米亚', lore: '取代僵尸的蛇身掠食者，拥有多套装饰外观。',
    behavior: { hp: 20, speed: 0.23, dmg: 3, follow: 35, size: [0.6, 1.8], loot: 'zombie', tameable: false, baseStats: 'zombie', undead: true } },
  { id: 'eevee_rabbit', pack: 'eeveelution', srcMob: 'rabbit', texBase: 'eevee_rabbit',
    variants: [0, 1, 2], gendered: false, endKind: null, counterMax: 1, egg: 'rabbit_wizard',
    name: '伊布兔', lore: '伊布化的兔法师。', behavior: { hp: 24, speed: 0.25, dmg: 3, follow: 16, size: [0.6, 1.8], loot: null, tameable: true, baseStats: 'rabbit_wizard', undead: false } },
  { id: 'eevee_scarecrow', pack: 'eeveelution', srcMob: 'scarecrow', texBase: 'eevee_scarecrow',
    variants: [0], gendered: true, endKind: 'health', counterMax: 3, egg: 'scarecrow',
    name: '伊布稻草人', lore: '伊布化的稻草人。', behavior: { hp: 50, speed: 0.3, dmg: 3, follow: 64, size: [0.8, 2.4], loot: null, tameable: true, baseStats: 'scarecrow', undead: false } },
  { id: 'eevee_silverfish', pack: 'eeveelution', srcMob: 'silverfish', texBase: 'eevee_silverfish',
    variants: [0], gendered: true, endKind: null, counterMax: 1, egg: 'silverfish',
    name: '伊布蠹虫', lore: '伊布化的吞食蠹虫。', behavior: { hp: 12, speed: 0.3, dmg: 4, follow: 16, size: [0.6, 1.8], loot: null, tameable: false, baseStats: 'silverfish', undead: false } },
  { id: 'eevee_vinemaiden', pack: 'eeveelution', srcMob: 'vinemaiden', texBase: 'eevee_vinemaiden',
    variants: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 31, 99], gendered: false, endKind: null, counterMax: 1, egg: 'vinemaiden',
    name: '伊布藤娘', lore: '伊布化的藤娘。', behavior: { hp: 30, speed: 0.3, dmg: 5, follow: 12, size: [0.7, 1.9], loot: null, tameable: true, baseStats: 'vinemaiden', undead: false },
    skip: [/_buried/, /_seedling/] },
  { id: 'eevee_zombie', pack: 'eeveelution', srcMob: 'zombie', texBase: 'eevee_zombie',
    variants: [0, 1, 2, 13], gendered: true, endKind: 'decor', counterMax: 5, egg: 'zombie',
    name: '伊布僵尸', lore: '伊布化的吞食僵尸。', behavior: { hp: 20, speed: 0.23, dmg: 3, follow: 35, size: [0.6, 1.8], loot: 'zombie', tameable: false, baseStats: 'zombie', undead: true } }
];

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
  const extraLang = [];

  for (const c of CREATURES) {
    const root = path.join(COMM, c.pack, 'assets', 'pcraftrevorn');
    if (!fs.existsSync(root)) { console.warn(`skip ${c.id}: missing ${root}`); continue; }

    // geometry
    const geo = readJSON(path.join(root, 'geo', c.srcMob + '.geo.json'));
    geo['minecraft:geometry'][0].description.identifier = 'geometry.' + c.id;
    writeJSON(path.join(RP, 'models', 'entity', c.id + '.geo.json'), geo);

    // animation (rename prefix; drop names illegal in Bedrock)
    const anim = convertAnimObject(readJSON(path.join(root, 'animations', c.srcMob + '.animation.json')));
    const renamed = {};
    const shorts = [];
    for (const [k, v] of Object.entries(anim.animations || {})) {
      const short = k.split('.').pop();
      if (!validSeg(short)) continue;
      const nk = `animation.${c.id}.${short}`;
      renamed[nk] = v; shorts.push(short);
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

    // spawn egg
    const itemId = c.id + '_spawn_egg';
    eggPng(c.id, c.egg);
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
    extraLang.push(
      `entity.${NS}:${c.id}.name=${c.name}`,
      `item.${NS}:${itemId}.name=${c.name}生成蛋`,
      `item.${NS}:${itemId}=${c.name}生成蛋`,
      `item.spawn_egg.entity.${NS}:${c.id}.name=${c.name}生成蛋`
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

  writeText(path.join(BP, 'texts', 'en_US.lang'), fs.readFileSync(bpTexts[0], 'utf8').trimEnd() + '\n' + extraLang.join('\n') + '\n');
  writeText(path.join(BP, 'texts', 'zh_CN.lang'), fs.readFileSync(bpTexts[1], 'utf8').trimEnd() + '\n' + extraLang.join('\n') + '\n');
  writeJSON(path.join(RP, 'textures', 'item_texture.json'), atlas);

  const js = '// AUTO-GENERATED by tools/generate_community.js. Community creature registries.\n'
    + 'export const COMMUNITY = ' + JSON.stringify(reg, null, 2) + ';\n';
  writeText(path.join(BP, 'scripts', 'pcraftrevorn', 'data', 'community.js'), js);
  console.log(`Community creatures generated: ${reg.predatorIds.length} (${reg.predatorIds.join(', ')})`);
}

module.exports = { generateCommunity };
if (require.main === module) generateCommunity();
