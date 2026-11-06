/*
 * Deep self-check for the generated addon:
 *  - animation root keys / easing values (Bedrock compatibility sanity)
 *  - animation bone names vs the entity geometry's bones
 *  - loop flags
 *  - hostile predators have the aggressive group + swallow/release events
 *  - script isPredator set matches entities that define on_swallow
 * Run: node tools/check.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BP = path.join(ROOT, 'behavior_pack');
const RP = path.join(ROOT, 'resource_pack');
const problems = [];
const warnings = [];
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'));
const list = (d, ext) => fs.readdirSync(d).filter((f) => f.endsWith(ext));

// ---- geometry bones ----
const geoBones = new Map();
for (const f of list(path.join(RP, 'models', 'entity'), '.json')) {
  const j = readJSON(path.join(RP, 'models', 'entity', f));
  for (const g of j['minecraft:geometry'] || []) geoBones.set(g.description.identifier, new Set((g.bones || []).map((b) => b.name)));
}

// ---- animations ----
const animInfo = new Map(); // name -> { bones:Set, rootKeys:Set, easing:Set, loop }
const easings = new Set();
const rootKeys = new Set();
const boneKeys = new Set();
for (const f of list(path.join(RP, 'animations'), '.json')) {
  const j = readJSON(path.join(RP, 'animations', f));
  for (const [name, anim] of Object.entries(j.animations || {})) {
    const bones = new Set();
    for (const [bn, bd] of Object.entries(anim.bones || {})) {
      bones.add(bn);
      for (const k of Object.keys(bd)) boneKeys.add(k);
      for (const v of Object.values(bd)) {
        if (v && typeof v === 'object') for (const fr of Object.values(v)) {
          if (fr && fr.easing) easings.add(fr.easing);
          if (fr && typeof fr === 'object' && Array.isArray(fr.vector)) problems.push(`anim ${name} bone ${bn}: still uses GeckoLib {"vector":...} keyframe (Bedrock ignores it)`);
        }
      }
    }
    for (const k of Object.keys(anim)) if (k !== 'bones') rootKeys.add(k);
    animInfo.set(name, { bones, loop: anim.loop });
  }
}

// ---- client entities: animation bones must exist in geometry ----
const clientAnimNames = new Set();
for (const f of list(path.join(RP, 'entity'), '.json')) {
  const d = readJSON(path.join(RP, 'entity', f))['minecraft:client_entity'].description;
  if (d.identifier === 'minecraft:player') continue;
  // Union every geometry the entity can wear (default + named rework variants),
  // not just the default: an animation may be written for a variant rig.
  const geoIds = [];
  for (const v of Object.values(d.geometry || {})) {
    if (typeof v === 'string') geoIds.push(v);
    else if (Array.isArray(v)) geoIds.push(...v.filter((x) => typeof x === 'string'));
  }
  let bones = new Set();
  for (const geoId of geoIds) {
    const b = geoBones.get(geoId);
    if (b) { for (const x of b) bones.add(x); continue; }
    if (!/\[|\]/.test(geoId) && !geoId.startsWith('Array.')) continue;
    // geometry selected by an array (e.g. rework sets): union all listed geometries
    const arrName = geoId.match(/^Array\.([A-Za-z0-9_]+)/)?.[1];
    let geoList = [];
    for (const rcName of d.render_controllers || []) {
      const rcFile = list(path.join(RP, 'render_controllers'), '.json').find((x) => readJSON(path.join(RP, 'render_controllers', x)).render_controllers?.[rcName]);
      if (!rcFile) continue;
      const rcDef = readJSON(path.join(RP, 'render_controllers', rcFile)).render_controllers[rcName];
      const arr = rcDef.arrays?.geometries?.[`Array.${arrName}`];
      if (arr) { geoList = arr; break; }
    }
    for (const gid of geoList) { const b2 = geoBones.get(gid); if (b2) for (const x of b2) bones.add(x); }
  }
  if (!bones.size) { problems.push(`client ${d.identifier}: geometry ${geoIds[0] ?? '?'} not found`); continue; }
  for (const [key, animName] of Object.entries(d.animations || {})) {
    if (animName.startsWith('controller.')) continue;
    clientAnimNames.add(animName);
    const info = animInfo.get(animName);
    if (!info) { problems.push(`client ${d.identifier}: animation ${animName} not found`); continue; }
    for (const b of info.bones) if (!bones.has(b)) warnings.push(`client ${d.identifier}: anim ${animName} uses bone '${b}' not in geometry (ignored by Bedrock)`);
  }
}
// unused animations are fine but report count
let unused = 0;
for (const name of animInfo.keys()) if (!clientAnimNames.has(name)) unused++;

// ---- our asset references must resolve (attachables included) ----
// Only engine-provided paths are exempt: enchant glints, the humanoid/player
// armor geometry + its offset animations. Everything else has to exist in RP.
const VANILLA_GEO = /^geometry\.(humanoid|player)\./;
const VANILLA_ANIM = /^animation\.armor\./;
const ENCHANT_TEX = /^textures\/misc\/enchanted_/;
function checkRefs(kind, file, d) {
  const geo = d.geometry?.default;
  if (typeof geo === 'string' && !geoBones.has(geo) && !/^Array\.|\[/.test(geo) && !VANILLA_GEO.test(geo)) {
    problems.push(`${kind} ${d.identifier} (${file}): geometry ${geo} not found`);
  }
  for (const [k, v] of Object.entries(d.textures || {})) {
    if (typeof v !== 'string' || !v.startsWith('textures/') || ENCHANT_TEX.test(v)) continue;
    if (!fs.existsSync(path.join(RP, v + '.png')) && !fs.existsSync(path.join(RP, v))) {
      problems.push(`${kind} ${d.identifier} (${file}): texture ${k}=${v} not found`);
    }
  }
  for (const [k, v] of Object.entries(d.animations || {})) {
    if (typeof v !== 'string' || v.startsWith('controller.') || animInfo.has(v) || VANILLA_ANIM.test(v)) continue;
    problems.push(`${kind} ${d.identifier} (${file}): animation ${k}=${v} not found`);
  }
}
for (const f of list(path.join(RP, 'attachables'), '.json')) {
  const d = readJSON(path.join(RP, 'attachables', f))['minecraft:attachable']?.description;
  if (d) checkRefs('attachable', f, d);
}
for (const f of list(path.join(RP, 'entity'), '.json')) {
  const d = readJSON(path.join(RP, 'entity', f))['minecraft:client_entity']?.description;
  if (d && d.identifier !== 'minecraft:player') checkRefs('client', f, d);
}

// ---- hostile predators: aggressive group + events ----
const hostiles = [];
for (const f of list(path.join(BP, 'entities'), '.json')) {
  const e = readJSON(path.join(BP, 'entities', f))['minecraft:entity'];
  const id = e.description.identifier;
  const hasAggro = !!e.component_groups?.['pcraftrevorn:aggressive'];
  const hasSwallow = !!e.events?.['pcraftrevorn:on_swallow'];
  const hasRelease = !!e.events?.['pcraftrevorn:on_release'];
  const spawned = !!e.events?.['minecraft:entity_spawned'];
  const baseMelee = !!e.components?.['minecraft:behavior.melee_attack'];
  if (hasAggro) {
    hostiles.push(id);
    if (!hasSwallow) problems.push(`${id}: aggressive but no on_swallow event`);
    if (!hasRelease) problems.push(`${id}: aggressive but no on_release event`);
    if (!spawned) problems.push(`${id}: aggressive but no minecraft:entity_spawned event`);
    if (baseMelee) problems.push(`${id}: melee_attack still in base components (should be in group)`);
  } else if (baseMelee) {
    problems.push(`${id}: melee_attack in base without aggressive group`);
  }
}

// ---- script isPredator set vs entities with on_swallow ----
const vore = fs.readFileSync(path.join(BP, 'scripts', 'pcraftrevorn', 'vore', 'vore.js'), 'utf8');
const predBlock = vore.match(/PREDATORS = new Set\(\[([\s\S]*?)\]\)/);
const scriptPreds = new Set((predBlock?.[1] || '').match(/"[^"]+"/g)?.map((s) => s.replace(/"/g, '')) || []);
// imported predators are merged at runtime from the data/*.js registries
// (community.js = resource-pack imports, vcm.js = the Internalised merge)
for (const reg of ['community.js', 'vcm.js']) {
  const regPath = path.join(BP, 'scripts', 'pcraftrevorn', 'data', reg);
  if (!fs.existsSync(regPath)) continue;
  const rm = fs.readFileSync(regPath, 'utf8').match(/"predatorIds":\s*\[([\s\S]*?)\]/);
  for (const s of (rm?.[1] || '').match(/"[^"]+"/g) || []) scriptPreds.add(`pcraftrevorn:${s.replace(/"/g, '')}`);
}
const eventPreds = new Set(hostiles);
for (const p of scriptPreds) if (!eventPreds.has(p)) problems.push(`script PREDATORS has ${p} but it has no aggressive group/events`);
for (const p of eventPreds) if (!scriptPreds.has(p)) problems.push(`entity ${p} has aggressive group but is not in script PREDATORS`);

// ---- loop sanity ----
const loopTrue = [...animInfo.entries()].filter(([, v]) => v.loop === true).map(([k]) => k);
const loopMissing = [...animInfo.entries()].filter(([, v]) => v.loop === undefined).map(([k]) => k);
if (loopMissing.length) problems.push(`${loopMissing.length} animations missing an explicit loop flag`);

// ---- report ----
console.log('animations:', animInfo.size, '| geo identifiers:', geoBones.size, '| unused animations:', unused);
console.log('animation root keys:', [...rootKeys].join(', '));
console.log('bone keys:', [...boneKeys].join(', '));
console.log('easing values:', [...easings].join(', '));
console.log('loop=true:', loopTrue.join(', '));
console.log('hostile predators:', hostiles.join(', '));
console.log('script PREDATORS :', [...scriptPreds].join(', '));
console.log(`\nWARNINGS (${warnings.length}):`);
for (const w of warnings) console.log('  ~ ' + w);
console.log('\nPROBLEMS (' + problems.length + '):');
for (const p of problems) console.log('  x ' + p);
process.exit(problems.length ? 1 : 0);
