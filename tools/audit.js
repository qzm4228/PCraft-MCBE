/*
 * Full project audit: cross-references every generated file for consistency.
 * Run: node tools/audit.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BP = path.join(ROOT, 'behavior_pack');
const RP = path.join(ROOT, 'resource_pack');
const NS = 'pcraftrevorn';

const errors = [];
const warns = [];
const info = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const exists = (f) => fs.existsSync(f);
const list = (d, ext) => (exists(d) ? fs.readdirSync(d).filter((f) => f.endsWith(ext)) : []);
const base = (f) => f.replace(/\.[^.]+$/, '');

// ---- collect definitions ----
const bpItems = new Map();   // id -> file
for (const f of list(path.join(BP, 'items'), '.json')) {
  const j = readJSON(path.join(BP, 'items', f));
  const id = j['minecraft:item']?.description?.identifier;
  if (id) bpItems.set(id, f);
}
const bpBlocks = new Map();
for (const f of list(path.join(BP, 'blocks'), '.json')) {
  const id = readJSON(path.join(BP, 'blocks', f))['minecraft:block']?.description?.identifier;
  if (id) bpBlocks.set(id, f);
}
const bpEntities = new Map();
for (const f of list(path.join(BP, 'entities'), '.json')) {
  const id = readJSON(path.join(BP, 'entities', f))['minecraft:entity']?.description?.identifier;
  if (id) bpEntities.set(id, f);
}
const rpClient = new Map();
for (const f of list(path.join(RP, 'entity'), '.json')) {
  const id = readJSON(path.join(RP, 'entity', f))['minecraft:client_entity']?.description?.identifier;
  if (id) rpClient.set(id, f);
}
const renderControllers = new Set();
for (const f of list(path.join(RP, 'render_controllers'), '.json')) {
  const j = readJSON(path.join(RP, 'render_controllers', f));
  for (const k of Object.keys(j.render_controllers || {})) renderControllers.add(k);
}
const animControllers = new Set();
const animControllerDefs = new Map();
for (const f of list(path.join(RP, 'animation_controllers'), '.json')) {
  const j = readJSON(path.join(RP, 'animation_controllers', f));
  for (const [k, v] of Object.entries(j.animation_controllers || {})) { animControllers.add(k); animControllerDefs.set(k, v); }
}
const animations = new Set();
for (const f of list(path.join(RP, 'animations'), '.json')) {
  const j = readJSON(path.join(RP, 'animations', f));
  for (const k of Object.keys(j.animations || {})) animations.add(k);
}
const geoms = new Set();
for (const f of list(path.join(RP, 'models', 'entity'), '.json')) {
  const j = readJSON(path.join(RP, 'models', 'entity', f));
  for (const g of j['minecraft:geometry'] || []) geoms.add(g.description?.identifier);
}
for (const f of list(path.join(RP, 'models', 'blocks'), '.json')) {
  const j = readJSON(path.join(RP, 'models', 'blocks', f));
  for (const g of j['minecraft:geometry'] || []) geoms.add(g.description?.identifier);
}

// ---- atlases ----
const itemAtlas = readJSON(path.join(RP, 'textures', 'item_texture.json')).texture_data || {};
const terrainAtlas = readJSON(path.join(RP, 'textures', 'terrain_texture.json')).texture_data || {};
function checkTexRef(where, ref, atlas, rpRoot) {
  if (!ref) return;
  if (ref.startsWith('textures/')) {
    // only our own textures can be verified; vanilla paths (e.g. textures/blocks/pumpkin_top) are external
    if (ref.includes('/pcraftrevorn/') && !exists(path.join(RP, ref + '.png'))) err(`${where}: missing texture file ${ref}.png`);
    return;
  }
  const entry = atlas[ref];
  if (!entry) { err(`${where}: texture key '${ref}' not in atlas`); return; }
  const p = entry.textures;
  if (typeof p === 'string' && p.includes('/pcraftrevorn/') && !exists(path.join(RP, p + '.png'))) err(`${where}: atlas '${ref}' -> missing ${p}.png`);
}

// ---- items ----
for (const [id, f] of bpItems) {
  const desc = readJSON(path.join(BP, 'items', f))['minecraft:item'].description;
  const comps = readJSON(path.join(BP, 'items', f))['minecraft:item'].components || {};
  const icon = comps['minecraft:icon'];
  if (icon?.textures?.default) {
    const key = icon.textures.default;
    if (key.startsWith(NS + '_')) checkTexRef(`item ${id}`, key, itemAtlas, RP);
  }
  const placer = comps['minecraft:entity_placer'];
  if (placer?.entity && !bpEntities.has(placer.entity)) err(`item ${id}: entity_placer target '${placer.entity}' has no entity`);
  if (!desc.menu_category) warn(`item ${id}: no menu_category`);
}

// ---- blocks ----
for (const [id, f] of bpBlocks) {
  const j = readJSON(path.join(BP, 'blocks', f))['minecraft:block'];
  const mi = j.components?.['minecraft:material_instances'] || {};
  for (const [face, m] of Object.entries(mi)) {
    const tex = typeof m === 'string' ? m : m.texture;
    checkTexRef(`block ${id}.${face}`, tex, terrainAtlas, RP);
  }
  const loot = j.components?.['minecraft:loot'];
  if (loot && !exists(path.join(BP, loot))) err(`block ${id}: missing loot table ${loot}`);
  const geo = j.components?.['minecraft:geometry'];
  if (geo && typeof geo === 'object' && geo.identifier && !geoms.has(geo.identifier)) err(`block ${id}: missing geometry ${geo.identifier}`);
}

// ---- entities ----
for (const [id, f] of bpEntities) {
  if (!rpClient.has(id)) err(`entity ${id}: no matching client entity`);
}
for (const [id, f] of rpClient) {
  const d = readJSON(path.join(RP, 'entity', f))['minecraft:client_entity'].description;
  if (!bpEntities.has(id)) warn(`client entity ${id}: no matching BP entity`);
  for (const g of Object.values(d.geometry || {})) if (!geoms.has(g)) err(`client ${id}: missing geometry ${g}`);
  for (const rc of d.render_controllers || []) if (!renderControllers.has(rc)) err(`client ${id}: missing render controller ${rc}`);
  // scripts.animate entries reference the animations map, which may point to a controller
  const resolveCtrl = (entry) => {
    const v = (d.animations || {})[entry];
    return typeof v === 'string' && v.startsWith('controller.') ? v : entry;
  };
  for (const entry of (d.scripts?.animate || [])) {
    if (typeof entry !== 'string' && !Array.isArray(entry)) continue; // {animKey: weight} blend object
    const ctrl = resolveCtrl(entry);
    if (!animControllers.has(ctrl)) { err(`client ${id}: animate entry '${entry}' -> controller '${ctrl}' not found`); continue; }
    const def = animControllerDefs.get(ctrl);
    for (const st of Object.values(def.states || {})) {
      for (const a of st.animations || []) {
        if (!(a in (d.animations || {}))) err(`client ${id}: controller ${ctrl} state animation key '${a}' not in animations map`);
      }
    }
  }
  for (const a of Object.values(d.animations || {})) if (!a.startsWith('controller.') && !animations.has(a)) err(`client ${id}: missing animation ${a}`);
  // texture skins
  for (const [k, p] of Object.entries(d.textures || {})) {
    if (typeof p === 'string' && p.startsWith('textures/') && !exists(path.join(RP, p + '.png'))) err(`client ${id}: missing texture ${p}.png`);
  }
  // render controller arrays reference texture keys
  for (const rc of d.render_controllers || []) {
    const rcFile = list(path.join(RP, 'render_controllers'), '.json').find((x) => readJSON(path.join(RP, 'render_controllers', x)).render_controllers?.[rc]);
    if (!rcFile) continue;
    const rcDef = readJSON(path.join(RP, 'render_controllers', rcFile)).render_controllers[rc];
    for (const arr of Object.values(rcDef.arrays?.textures || {})) {
      for (const t of arr) {
        const key = t.replace(/^Texture\./, '');
        if (!(key in (d.textures || {}))) err(`client ${id}/${rc}: array texture '${t}' not in textures map`);
      }
    }
  }
}

// ---- entity loot ----
for (const [id, f] of bpEntities) {
  const loot = readJSON(path.join(BP, 'entities', f))['minecraft:entity'].components?.['minecraft:loot']?.table;
  if (loot && !exists(path.join(BP, loot))) err(`entity ${id}: missing loot ${loot}`);
}

// ---- recipes ----
for (const f of list(path.join(BP, 'recipes'), '.json')) {
  const j = readJSON(path.join(BP, 'recipes', f));
  const body = j['minecraft:recipe_shaped'] || j['minecraft:recipe_shapeless'] || j['minecraft:recipe_furnace'] || j['minecraft:recipe_smithing_transform'];
  if (!body) { err(`recipe ${f}: unknown type`); continue; }
  const items = [];
  const push = (v) => { if (!v) return; if (typeof v === 'string') items.push(v); else if (v.item) items.push(v.item); };
  if (body.key) for (const v of Object.values(body.key)) push(v);
  if (body.ingredients) for (const v of body.ingredients) push(v);
  if (body.template) push(body.template);
  if (body.base) push(body.base);
  if (body.addition) push(body.addition);
  if (body.input) push(body.input);
  if (body.result?.item) items.push(body.result.item); else if (typeof body.result === 'string') items.push(body.result);
  for (const it of items) {
    if (it.startsWith(NS + ':')) {
      if (!bpItems.has(it) && !bpBlocks.has(it)) err(`recipe ${f}: unknown custom item ${it}`);
    } else if (!it.startsWith('minecraft:')) err(`recipe ${f}: bad identifier ${it}`);
  }
}

// ---- manifests ----
const bpMan = readJSON(path.join(BP, 'manifest.json'));
const rpMan = readJSON(path.join(RP, 'manifest.json'));
if (!bpMan.dependencies.find((d) => d.uuid === rpMan.header.uuid)) err('BP does not depend on RP header uuid');
if (!bpMan.modules.find((m) => m.type === 'script')) warn('BP has no script module');
for (const dep of bpMan.dependencies.filter((d) => d.module_name)) info.push(`script dep ${dep.module_name}@${dep.version}`);
for (const f of ['manifest.json', 'blocks', 'items', 'entities', 'recipes', 'loot_tables', 'texts', 'scripts', 'spawn_rules']) {
  if (!exists(path.join(BP, f))) warn(`BP missing ${f}`);
}
for (const f of ['manifest.json', 'entity', 'models', 'animations', 'render_controllers', 'textures', 'sounds', 'ui', 'texts']) {
  if (!exists(path.join(RP, f))) warn(`RP missing ${f}`);
}
// ui defs
const uiDefs = readJSON(path.join(RP, 'ui', '_ui_defs.json')).ui_defs || [];
for (const u of uiDefs) if (!exists(path.join(RP, u))) err(`ui_defs references missing ${u}`);

// ---- script imports ----
function checkImports(dir) {
  for (const f of list(dir, '.js')) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /import\s+[^'"]*['"](\.\/[^'"]+|\.\.\/[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) {
      const rel = m[1];
      const target = path.resolve(dir, rel);
      if (!exists(target) && !exists(target + '.js')) err(`script ${path.relative(ROOT, path.join(dir, f))}: unresolved import ${rel}`);
    }
    checkImports(path.join(dir, f) === path.join(dir, f) ? dir : dir); // no-op
  }
}
// walk scripts recursively
(function walkScripts(d) {
  for (const f of fs.readdirSync(d)) {
    const fp = path.join(d, f);
    if (fs.statSync(fp).isDirectory()) walkScripts(fp);
    else if (f.endsWith('.js')) {
      const src = fs.readFileSync(fp, 'utf8');
      const re = /from\s+['"]([^'"]+)['"]/g;
      let m;
      while ((m = re.exec(src))) {
        const rel = m[1];
        if (rel.startsWith('@minecraft/')) continue;
        if (rel.startsWith('.')) {
          const target = path.resolve(path.dirname(fp), rel);
          if (!exists(target) && !exists(target + '.js')) err(`script ${path.relative(ROOT, fp)}: unresolved import ${rel}`);
        } else err(`script ${path.relative(ROOT, fp)}: non-relative import ${rel}`);
      }
    }
  }
})(path.join(BP, 'scripts'));

// ---- counts ----
info.push(`items=${bpItems.size} blocks=${bpBlocks.size} entities=${bpEntities.size} clientEntities=${rpClient.size}`);
info.push(`renderControllers=${renderControllers.size} animControllers=${animControllers.size} animations=${animations.size} geoms=${geoms.size}`);
info.push(`itemAtlas=${Object.keys(itemAtlas).length} terrainAtlas=${Object.keys(terrainAtlas).length}`);
info.push(`recipes=${list(path.join(BP, 'recipes'), '.json').length} lootBlocks=${list(path.join(BP, 'loot_tables', 'blocks'), '.json').length} lootEntities=${list(path.join(BP, 'loot_tables', 'entities'), '.json').length}`);

// ---- report ----
console.log('=== INFO ===');
for (const i of info) console.log('  ' + i);
console.log(`\n=== WARN (${warns.length}) ===`);
for (const w of warns) console.log('  ! ' + w);
console.log(`\n=== ERRORS (${errors.length}) ===`);
for (const e of errors) console.log('  x ' + e);
process.exit(errors.length ? 1 : 0);
