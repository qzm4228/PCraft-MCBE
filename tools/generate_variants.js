'use strict';
/*
 * Community "rework" importer: adds alternative look-sets to EXISTING creatures,
 * switched at runtime by the in-game menu (game/variants.js).
 *
 * For each species it appends, to the generated client entity:
 *   - geometry array  (Array.geos indexed by pcraftrevorn:set)
 *   - texture array   (base skins + each set's skins, indexed by pcraftrevorn:skin)
 *   - set-specific idle/walk animations (gated by pcraftrevorn:set)
 * and widens the BP entity's skin range + adds the pcraftrevorn:set property.
 * Writes behavior_pack/scripts/pcraftrevorn/data/variants.js for the scripts.
 *
 * Called at the end of generate_entities.js (after generate_community.js).
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
const validSeg = (s) => /^[A-Za-z][A-Za-z0-9_.]*$/.test(s);

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

// parse a rework texture basename into its variant/gender/counter/wg/belly state
function parseTex(name) {
  let n = name, belly = 0, wg = 0, counter = 0, gender = '-', variant = 0;
  if (/_belly$/.test(n)) { belly = 1; n = n.replace(/_belly$/, ''); }
  if (/_wg2$/.test(n)) { wg = 2; n = n.replace(/_wg2$/, ''); } else if (/_wg$/.test(n)) { wg = 1; n = n.replace(/_wg$/, ''); }
  let m = n.match(/_(decor|health|scale|armor)(\d+)$/); if (m) { counter = +m[2]; n = n.slice(0, m.index); }
  m = n.match(/_(male|female)(\d+)$/);
  if (m) { gender = m[1] === 'male' ? 1 : 0; variant = +m[2]; }
  else { m = n.match(/(\d+)$/); if (m) variant = +m[1]; }
  return { variant, gender, counter, wg, belly };
}
const stateKey = (t) => `${t.variant}|${t.gender}|${t.counter}|${t.wg}|${t.belly}`;

// rename Bedrock-illegal bone names identically in geo + anim (see generate_community)
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
  if (!map.size) return;
  for (const b of gb) {
    if (map.has(b.name)) b.name = map.get(b.name);
    if (b.parent && map.has(b.parent)) b.parent = map.get(b.parent);
  }
  for (const a of Object.values((anim && anim.animations) || {})) {
    const nb = {};
    for (const [k, v] of Object.entries(a.bones || {})) nb[map.get(k) ?? k] = v;
    a.bones = nb;
  }
}

const SPECIES = [
  { species: 'zombie', baseGeo: 'zombiegirl', sets: [
    { id: 'bibaso', pack: 'bibaso', geo: 'zombiegirl', anim: 'zombiegirl', tex: /^zombie/, prefix: 'pcv_bibaso_', name: 'Bibaso' }
  ] },
  { species: 'piglin_royal', baseGeo: 'piglin_royalty', sets: [
    { id: 'royalrump', pack: 'v_royalrump', geo: 'piglin_royalty', anim: 'piglin_royalty', tex: /^piglin_royal_/, prefix: 'pcv_royalrump_', name: 'Royal Rump' }
  ] },
  { species: 'silverfish', baseGeo: 'silverfish', sets: [
    { id: 'silverfishrework', pack: 'v_silverfish', geo: 'silverfish', anim: 'silverfish', tex: /^silverfish_/, prefix: 'pcv_silverfish_', name: 'Silverfish 重绘' }
  ] },
  { species: 'scarecrow', baseGeo: 'scarecrow', sets: [
    { id: 'scarecrowtaste', pack: 'v_scarecrowtaste', geo: 'scarecrow', anim: null, tex: /^scarecrow_/, prefix: 'pcv_scarecrow_', name: 'TasteTested' }
  ] }
];

function generateVariants() {
  const reg = {};
  const atlas = readJSON(path.join(RP, 'textures', 'item_texture.json'));
  for (const sp of SPECIES) {
    const entPath = path.join(RP, 'entity', sp.species + '.entity.json');
    const rcPath = path.join(RP, 'render_controllers', sp.species + '.render_controllers.json');
    const bpPath = path.join(BP, 'entities', sp.species + '.json');
    if (!fs.existsSync(entPath) || !fs.existsSync(rcPath) || !fs.existsSync(bpPath)) { console.warn(`skip variant ${sp.species}: base files missing`); continue; }
    const ent = readJSON(entPath);
    const rc = readJSON(rcPath);
    const bp = readJSON(bpPath);
    const desc = ent['minecraft:client_entity'].description;
    const rcName = desc.render_controllers[0];
    const rcDef = rc.render_controllers[rcName];
    // index base must be the render-controller skin-array length, NOT the texture-key
    // count (entities with a glow layer have an extra non-skin texture key).
    const baseCount = rcDef.arrays.textures['Array.skins'].length;
    const allHaveAnim = sp.sets.every((s) => s.anim);

    let offset = baseCount;
    const sets = [];
    // geometry array entries must reference the client-entity geometry map
    // (Geometry.<key>), not raw identifiers, or Bedrock renders nothing.
    const geoArray = ['Geometry.default'];
    const skinsArray = rcDef.arrays.textures['Array.skins'].slice();
    for (const s of sp.sets) {
      const root = path.join(COMM, s.pack, 'assets', 'pcraftrevorn');
      // geo
      // geo + anim (sanitize illegal bone names consistently across both)
      const geo = readJSON(path.join(root, 'geo', s.geo + '.geo.json'));
      const anim = s.anim ? convertAnimObject(readJSON(path.join(root, 'animations', s.anim + '.animation.json'))) : null;
      sanitizeBones(geo, anim); // always: a set with no animation can still carry illegal bone names (e.g. scarecrow "Head-neck")
      geo['minecraft:geometry'][0].description.identifier = `geometry.${sp.species}.v_${s.id}`;
      writeJSON(path.join(RP, 'models', 'entity', `${sp.species}.v_${s.id}.geo.json`), geo);
      desc.geometry[`v_${s.id}`] = `geometry.${sp.species}.v_${s.id}`;
      geoArray.push(`Geometry.v_${s.id}`);
      // anim
      let idleKey = null, walkKey = null;
      if (anim) {
        const renamed = {};
        for (const [k, v] of Object.entries(anim.animations || {})) {
          const short = k.split('.').pop();
          if (!validSeg(short)) continue;
          renamed[`animation.${sp.species}.v_${s.id}.${short}`] = v;
          if (short === 'idle') idleKey = `${s.id}_idle`;
          if (short === 'walk') walkKey = `${s.id}_walk`;
        }
        anim.animations = renamed;
        writeJSON(path.join(RP, 'animations', `${sp.species}.v_${s.id}.animation.json`), anim);
        if (idleKey) desc.animations[idleKey] = `animation.${sp.species}.v_${s.id}.idle`;
        if (walkKey) desc.animations[walkKey] = `animation.${sp.species}.v_${s.id}.walk`;
      }
      // textures
      const texDir = path.join(root, 'textures', 'entities');
      const byState = {};
      const names = fs.readdirSync(texDir).filter((f) => f.endsWith('.png') && s.tex.test(f.replace('.png', '')));
      names.sort();
      for (const f of names) {
        const base = f.replace('.png', '');
        const nn = s.prefix + base;
        copy(path.join(texDir, f), path.join(RP, 'textures', 'entity', 'pcraftrevorn', nn + '.png'));
        const key = 'skin' + offset;
        desc.textures[key] = `textures/entity/pcraftrevorn/${nn}`;
        skinsArray.push(`Texture.${key}`);
        byState[stateKey(parseTex(base))] = offset;
        offset++;
      }
      sets.push({ id: s.id, name: s.name, geoId: `geometry.${sp.species}.v_${s.id}`, byState, idleKey, walkKey, count: names.length });
    }
    // render controller
    rcDef.arrays.textures['Array.skins'] = skinsArray;
    rcDef.arrays.geometries = { 'Array.geos': geoArray };
    // point every controller in this file (incl. glow layers) at the set-selected
    // geometry, and give each one its own Array.geos definition.
    for (const def of Object.values(rc.render_controllers)) {
      def.arrays = { ...(def.arrays || {}), geometries: { 'Array.geos': geoArray } };
      if (def.geometry === 'Geometry.default') def.geometry = `Array.geos[q.property('${NS}:set')]`;
    }
    // scripts.animate gating
    if (allHaveAnim) {
      desc.scripts.animate = [
        { idle: `q.property('${NS}:set') == 0 ? (1.0 - math.min(1.0, query.modified_move_speed * 4.0)) : 0.0` },
        { walk: `q.property('${NS}:set') == 0 ? math.min(1.0, query.modified_move_speed * 4.0) : 0.0` }
      ];
      for (let i = 0; i < sets.length; i++) {
        if (sets[i].idleKey) desc.scripts.animate.push({ [sets[i].idleKey]: `q.property('${NS}:set') == ${i + 1} ? (1.0 - math.min(1.0, query.modified_move_speed * 4.0)) : 0.0` });
        if (sets[i].walkKey) desc.scripts.animate.push({ [sets[i].walkKey]: `q.property('${NS}:set') == ${i + 1} ? math.min(1.0, query.modified_move_speed * 4.0) : 0.0` });
      }
    }
    writeJSON(entPath, ent);
    writeJSON(rcPath, rc);
    // BP entity: add set property + widen skin range
    bp['minecraft:entity'].description.properties[`${NS}:set`] = { type: 'int', range: [0, sets.length], default: 0, client_sync: true };
    bp['minecraft:entity'].description.properties[`${NS}:skin`].range = [0, Math.max(0, offset - 1)];
    writeJSON(bpPath, bp);

    reg[sp.species] = { baseCount, total: offset, sets };
  }
  const js = '// AUTO-GENERATED by tools/generate_variants.js. Per-species rework look-sets.\n'
    + 'export const VARIANTS = ' + JSON.stringify(reg, null, 2) + ';\n';
  writeText(path.join(BP, 'scripts', 'pcraftrevorn', 'data', 'variants.js'), js);
  console.log(`Variant sets generated: ${Object.entries(reg).map(([k, v]) => `${k}(${v.sets.length})`).join(', ')}`);
}

module.exports = { generateVariants };
if (require.main === module) generateVariants();
