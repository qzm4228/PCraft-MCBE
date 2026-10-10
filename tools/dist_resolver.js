"use strict";
// dist.json resolver — per-version file selection for Bedrock packs.
// Mirror of `tools_py/dist_resolver.py`; keep both in sync (see tools/check_dist.js).
const fs = require("fs");
const path = require("path");

const DIST_FILE = "dist.json";
const WILDCARD = "x";
const RANGE_RE = /^\s*(<=|>=|<|>)\s*(\d+(?:\.\d+)*)\s*$/;
const NUM_RE = /^\d+$/;

function parseVersion(value) {
  if (Array.isArray(value)) return value.map(Number);
  const m = String(value).trim().match(/^(\d+(?:\.\d+)*)/);
  if (!m) throw new Error("bad version: " + value);
  return m[1].split(".").map(Number);
}

function compareVersions(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function isRangeKey(key) { return RANGE_RE.test(key); }

function keyMatches(key, target) {
  key = String(key).trim();
  const m = key.match(RANGE_RE);
  if (m) {
    const ver = m[2].split(".").map(Number);
    const c = compareVersions(target, ver);
    if (m[1] === "<=") return c <= 0;
    if (m[1] === ">=") return c >= 0;
    if (m[1] === "<") return c < 0;
    return c > 0;
  }
  const core = key.toLowerCase().split(".");
  while (core.length && core[core.length - 1] === WILDCARD) core.pop();
  if (core.length > target.length) return false;
  for (let i = 0; i < core.length; i++) {
    const c = core[i];
    if (c === WILDCARD) continue;
    if (!NUM_RE.test(c) || Number(c) !== target[i]) return false;
  }
  return true;
}

function keySpecificity(key) {
  key = String(key).trim();
  const m = key.match(RANGE_RE);
  if (m) return [1, m[2].split(".").length];
  const parts = key.split(".");
  const literals = parts.filter((p) => p.toLowerCase() !== WILDCARD && NUM_RE.test(p)).length;
  return [2, literals];
}

function keyValue(key) {
  key = String(key).trim();
  const m = key.match(RANGE_RE);
  const s = m ? m[2] : key;
  return s.split(".").filter((p) => NUM_RE.test(p)).map(Number);
}

function cmpArr(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

// descending priority
function cmpKey(k1, k2) {
  const s1 = keySpecificity(k1), s2 = keySpecificity(k2);
  if (s1[0] !== s2[0]) return s2[0] - s1[0];
  if (s1[1] !== s2[1]) return s2[1] - s1[1];
  const c = cmpArr(keyValue(k1), keyValue(k2));
  if (c !== 0) return -c;
  if (k1 === k2) return 0;
  return k1 < k2 ? 1 : -1;
}

function pickVariant(variants, target) {
  const keys = Object.keys(variants).filter((k) => keyMatches(k, target));
  if (!keys.length) return null;
  keys.sort(cmpKey);
  return [keys[0], variants[keys[0]]];
}

function loadSpec(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(file + ": top level must be an object");
  }
  const out = {};
  for (const [outName, variants] of Object.entries(data)) {
    if (outName.startsWith("_") || outName.startsWith("//")) continue;
    if (typeof variants !== "object" || variants === null || Array.isArray(variants)) {
      throw new Error(file + ": '" + outName + "' must map version keys to a source");
    }
    const v = {};
    for (const [key, src] of Object.entries(variants)) {
      if (key.startsWith("_") || key.startsWith("//")) continue;
      if (src === true || src === null) v[key] = outName + "." + key;
      else if (typeof src === "string") v[key] = src;
      else throw new Error(file + ": '" + outName + "." + key + "' value must be a string or true");
    }
    out[outName] = v;
  }
  return out;
}

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function collectRules(packRoot) {
  packRoot = path.resolve(packRoot);
  const rules = {};
  const sources = new Set();
  const dists = walk(packRoot, []).filter((p) => path.basename(p) === DIST_FILE).sort();
  for (const dist of dists) {
    const d = path.dirname(dist);
    const spec = loadSpec(dist);
    for (const [outName, variants] of Object.entries(spec)) {
      const outRel = path.relative(packRoot, path.resolve(d, outName)).split(path.sep).join("/");
      const m = {};
      for (const [key, src] of Object.entries(variants)) {
        const srcRel = path.relative(packRoot, path.resolve(d, src)).split(path.sep).join("/");
        m[key] = srcRel;
        sources.add(srcRel);
      }
      rules[outRel] = m;
    }
  }
  return { rules, sources };
}

function resolve(packRoot, target) {
  packRoot = path.resolve(packRoot);
  const tgt = parseVersion(target);
  const { rules, sources } = collectRules(packRoot);
  const out = {};
  for (const f of walk(packRoot, []).sort()) {
    const rel = path.relative(packRoot, f).split(path.sep).join("/");
    if (path.basename(f) === DIST_FILE || sources.has(rel)) continue;
    const rule = rules[rel];
    if (rule) {
      const pick = pickVariant(rule, tgt);
      out[rel] = pick ? path.resolve(packRoot, pick[1]) : f;
    } else {
      out[rel] = f;
    }
  }
  return out;
}

function selections(packRoot, target) {
  packRoot = path.resolve(packRoot);
  const tgt = parseVersion(target);
  const { rules } = collectRules(packRoot);
  const rows = [];
  for (const rel of Object.keys(rules).sort()) {
    const pick = pickVariant(rules[rel], tgt);
    rows.push({
      file: rel,
      key: pick ? pick[0] : null,
      source: pick ? pick[1] : rel,
      fallback: !pick,
    });
  }
  return rows;
}

function validate(packRoot) {
  packRoot = path.resolve(packRoot);
  const { rules, sources } = collectRules(packRoot);
  const warns = [];
  for (const rel of Object.keys(rules).sort()) {
    if (!fs.existsSync(path.join(packRoot, rel))) {
      warns.push(rel + ": output file missing (needed as universal fallback)");
    }
    for (const [key, src] of Object.entries(rules[rel])) {
      if (!fs.existsSync(path.join(packRoot, src))) {
        warns.push(rel + ": variant '" + key + "' -> '" + src + "' not found");
      }
    }
  }
  for (const f of walk(packRoot, []).sort()) {
    const rel = path.relative(packRoot, f).split(path.sep).join("/");
    if (path.basename(f) === DIST_FILE || sources.has(rel)) continue;
    if (/\.\d+\.\d*\.[\dx]+(\.|$)|\.x(\.|$)/.test(path.basename(f))) {
      warns.push(rel + ": looks like a variant but is not referenced by any dist.json");
    }
  }
  return warns;
}

module.exports = {
  DIST_FILE,
  parseVersion,
  compareVersions,
  isRangeKey,
  keyMatches,
  keySpecificity,
  keyValue,
  pickVariant,
  loadSpec,
  collectRules,
  resolve,
  selections,
  validate,
};

if (require.main === module) {
  const pack = process.argv[2] || process.cwd();
  const target = process.argv[3] || "1.21.100";
  for (const w of validate(pack)) console.log("WARN", w);
  console.log("# " + pack + " @ " + target);
  for (const r of selections(pack, target)) {
    console.log("  " + r.file.padEnd(48) + " -> " + r.source + "   [" + (r.fallback ? "fallback" : r.key) + "]");
  }
}
