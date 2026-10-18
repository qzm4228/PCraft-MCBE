"use strict";
// Multi-version packer (Node toolchain). Mirrors tools_py/build_config.py:
// reads config/packs.json + config/targets.json, resolves every dist.json via
// tools/dist_resolver.js, applies the target manifest in memory and writes
// dist/<output>_<target>.mcpack + dist/PCraftRevorn_<ver>_<target>.mcaddon.
//
// Usage: node tools/build.js [--target <id>]... [--list] [<versionOveride>]
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const resolver = require("./dist_resolver.js");

const ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(ROOT, "config", "packs.json");
const TARGETS = path.join(ROOT, "config", "targets.json");
const DIST = path.join(ROOT, "dist");
const LANGS = ["en_US", "zh_CN", "zh_TW"];

// --------------------------------------------------------------------------- //
// zip (store/deflate, explicit entries, forward-slash names)
// --------------------------------------------------------------------------- //
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}
function crc32(buf) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function newZip(outFile, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : fs.readFileSync(e.src);
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(data);
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const store = comp.length >= data.length;
    const payload = store ? data : comp;
    const method = store ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01 (deterministic)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, payload);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + payload.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.concat([Buffer.concat(chunks), centralBuf, eocd]));
}

// --------------------------------------------------------------------------- //
// config
// --------------------------------------------------------------------------- //
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function jsonBytes(o) { return Buffer.from(JSON.stringify(o, null, 2) + "\n", "utf8"); }

function parseVersion(v) {
  const s = String(v).trim();
  let m = s.match(/^(\d{6})-beta-(\d+)$/);
  if (m) return [Number(m[1]), 0, Number(m[2])];
  m = s.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  throw new Error("[build] bad version string: " + s);
}

function buildManifest(pack, target, baseline) {
  const base = path.join(ROOT, pack.base_dir);
  const manifest = readJson(path.join(base, "manifest.json"));
  const version = parseVersion(pack.version);
  const header = (manifest.header = manifest.header || {});
  header.name = "pack.name";
  header.description = "pack.description";
  header.version = version;
  if (pack.uuid) header.uuid = pack.uuid;
  const mev = baseline ? pack.min_engine_version : (target.min_engine_version || pack.min_engine_version);
  if (mev) header.min_engine_version = mev.slice();
  for (const mod of manifest.modules || []) mod.version = version;
  for (const dep of manifest.dependencies || []) {
    if (Array.isArray(dep.version)) dep.version = version;
    if (dep.module_name && target.modules && target.modules[dep.module_name]) {
      dep.version = target.modules[dep.module_name];
    }
  }
  return manifest;
}

// mirror Python's str.splitlines(): no trailing empty element for a trailing newline
function splitLines(text) {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function updateLang(file, entries) {
  const lines = fs.existsSync(file) ? splitLines(fs.readFileSync(file, "utf8")) : [];
  const keys = new Set(Object.keys(entries));
  const kept = lines.filter((l) => !l.includes("=") || !keys.has(l.split("=", 1)[0].trim()));
  for (const [k, v] of Object.entries(entries)) kept.push(k + "=" + v);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, kept.join("\n") + "\n", "utf8");
}

function writeSourceManifest(pack) {
  const base = path.join(ROOT, pack.base_dir);
  fs.writeFileSync(path.join(base, "manifest.json"), jsonBytes(buildManifest(pack, {}, true)), "utf8");
  const display = pack.display_name || {};
  const desc = pack.description || {};
  const texts = path.join(base, "texts");
  const langPath = path.join(texts, "languages.json");
  let existing = [];
  if (fs.existsSync(langPath)) { try { existing = JSON.parse(fs.readFileSync(langPath, "utf8")); } catch { existing = []; } }
  // rewrite pack.name / pack.description for EVERY language (fallback en_US) so a
  // stale translated name can never linger.
  const langs = [...new Set([...LANGS, ...existing, ...Object.keys(display), ...Object.keys(desc)])];
  const union = [...new Set([...existing, ...langs])];
  fs.mkdirSync(texts, { recursive: true });
  fs.writeFileSync(langPath, "[" + union.map((s) => JSON.stringify(s)).join(", ") + "]", "utf8");
  for (const lang of langs) {
    updateLang(path.join(texts, lang + ".lang"), {
      "pack.name": display[lang] || display.en_US || "",
      "pack.description": desc[lang] || desc.en_US || "",
    });
  }
}

function packEntries(pack, target, prefix) {
  const base = path.join(ROOT, pack.base_dir);
  const fmap = resolver.resolve(base, target.id);
  const manifest = jsonBytes(buildManifest(pack, target, false));
  const entries = [{ name: prefix ? prefix + "/manifest.json" : "manifest.json", data: manifest }];
  for (const [rel, src] of Object.entries(fmap)) {
    if (rel === "manifest.json") continue;
    entries.push({ name: prefix ? prefix + "/" + rel : rel, src });
  }
  return entries;
}

function loadTargets() {
  if (!fs.existsSync(TARGETS)) return { def: "default", targets: [{ id: "default", min_engine_version: [1, 21, 100], modules: {} }] };
  const data = readJson(TARGETS);
  if (!data.targets || !data.targets.length) throw new Error("config/targets.json has no targets");
  return { def: data.default_target || data.targets[0].id, targets: data.targets };
}

function main() {
  const argv = process.argv.slice(2);
  const only = [];
  let versionOverride = null;
  let doList = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") doList = true;
    else if (a === "--target") only.push(argv[++i]);
    else if (a.startsWith("--target=")) only.push(a.split("=")[1]);
    else versionOverride = a;
  }
  const config = readJson(CONFIG);
  // config/version.json wins over the per-pack entries (single source of truth)
  let globalVersion = null;
  try { globalVersion = String(readJson(path.join(ROOT, "config", "version.json")).version || "").trim() || null; } catch { /* optional */ }
  if (globalVersion) for (const p of Object.values(config)) p.version = globalVersion;
  if (versionOverride) for (const p of Object.values(config)) p.version = versionOverride;
  const { targets } = loadTargets();

  if (doList) {
    for (const t of targets) {
      console.log(t.id, "min_engine", JSON.stringify(t.min_engine_version), "modules", JSON.stringify(t.modules || {}));
      for (const pack of Object.values(config)) {
        for (const r of resolver.selections(path.join(ROOT, pack.base_dir), t.id)) {
          console.log("   " + pack.output_name.padEnd(22) + " " + r.file.padEnd(40) + " [" + (r.fallback ? "fallback" : r.key) + "]");
        }
      }
    }
    return 0;
  }

  fs.mkdirSync(DIST, { recursive: true });
  console.log("[build] applying baseline config to source manifests ...");
  for (const pack of Object.values(config)) writeSourceManifest(pack);

  const chosen = only.length ? targets.filter((t) => only.includes(t.id)) : targets;
  if (only.length && !chosen.length) throw new Error("[build] unknown target(s): " + only.join(", "));
  const label = String(Object.values(config)[0].version);
  const built = [];
  for (const target of chosen) {
    console.log("[build] === target " + target.id + " (min_engine " + JSON.stringify(target.min_engine_version) + ") ===");
    for (const pack of Object.values(config)) {
      const warns = resolver.validate(path.join(ROOT, pack.base_dir));
      for (const w of warns) console.log("   WARN " + pack.output_name + ": " + w);
      const out = path.join(DIST, pack.output_name + "_" + target.id + ".mcpack");
      newZip(out, packEntries(pack, target, ""));
      console.log("   " + path.basename(out));
    }
    const entries = [];
    for (const pack of Object.values(config)) entries.push(...packEntries(pack, target, pack.folder_name));
    const bundle = path.join(DIST, "PCraftRevorn_" + label + "_" + target.id + ".mcaddon");
    newZip(bundle, entries);
    built.push(bundle);
    console.log("   " + path.basename(bundle));
  }
  console.log("\n[build] " + Object.keys(config).length + " packs x " + chosen.length + " target(s) built.");
  for (const f of built.sort()) console.log((fs.statSync(f).size / 1024).toFixed(0).padStart(10) + " KB  " + path.basename(f));
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { newZip, buildManifest, packEntries, parseVersion };
