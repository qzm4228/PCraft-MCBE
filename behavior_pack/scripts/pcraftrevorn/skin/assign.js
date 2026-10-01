// Port of TextureAssignerGenderedProcedure: computes the original texture base
// name from entity state, then maps it to the pcraftrevorn:skin index used by
// the render controller.
import { SKINS } from "../data/skins.js";

const TEX_BASE = {
  basaltmite: "basaltmite",
  gilded_basaltmite: "gilded_basaltmite",
  silverfish: "silverfish",
  scarecrow: "scarecrow",
  piglin_royal: "piglin_royal",
  piglin_royal_knight: "piglin_royal_knight",
  rabbit_wizard: "rabbit",
  zombie: "zombie",
  vinemaiden: "vinemaiden",
  vinemaiden_seedling: "vinemaiden_seedling"
};
// gendered preds (have _male/_female in the texture name)
export const GENDERED = new Set(["basaltmite", "gilded_basaltmite", "silverfish", "scarecrow", "piglin_royal", "piglin_royal_knight"]);
// preds with an extra "_scaleN"/"_healthN"/"_armorN" segment
const END_KIND = { basaltmite: "scale", gilded_basaltmite: "scale", scarecrow: "health", piglin_royal_knight: "armor" };
// random variants present in the mod textures
const VARIANTS = {
  rabbit_wizard: [0, 1, 2],
  zombie: [0, 1, 2, 3],
  vinemaiden: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  piglin_royal_knight: [0, 1]
};
// animation name prefixes
export const ANIM_PREFIX = {
  basaltmite: "basaltmite",
  gilded_basaltmite: "basaltmite",
  silverfish: "silverfish",
  vinemaiden: "vinemaiden",
  zombie: "zombiegirl",
  scarecrow: "scarecrow",
  rabbit_wizard: "rabbit",
  piglin_royal_knight: "piglin_royal_knight",
  piglin_royal: "piglin_royalty"
};

export const localId = (typeId) => (typeId.includes(":") ? typeId.split(":")[1] : typeId);

export function getNum(entity, key, def = 0) {
  try { const v = entity.getDynamicProperty(key); return typeof v === "number" ? v : def; } catch { return def; }
}
export function setNum(entity, key, v) { try { entity.setDynamicProperty(key, v); } catch { /* ignore */ } }

export function buildSkinName(id, variant, gender, counter, wg, belly) {
  const base = TEX_BASE[id] ?? id;
  const middle = GENDERED.has(id) ? (gender === 1 ? "_male" : "_female") : "";
  const end = END_KIND[id] ? `_${END_KIND[id]}${counter}` : "";
  const wgSuffix = wg === 2 ? "_wg2" : wg === 1 ? "_wg" : "";
  return `${base}${middle}${variant}${end}${wgSuffix}${belly ? "_belly" : ""}`;
}

export function assignSkin(entity, belly = false) {
  const id = localId(entity.typeId);
  const map = SKINS[id];
  if (!map) return;
  // share a "digesting" marker so VCraft won't prey on a busy predator
  try { if (belly) entity.addTag("vore_digesting"); else entity.removeTag("vore_digesting"); } catch { /* ignore */ }
  const variant = getNum(entity, "pc:variant");
  const gender = getNum(entity, "pc:gender");
  const counter = getNum(entity, "pc:counter");
  const wg = getNum(entity, "pc:wg");
  const name = buildSkinName(id, variant, gender, counter, wg, belly);
  const fallback = buildSkinName(id, variant, gender, counter, 0, false);
  const idx = map[name] ?? map[fallback] ?? 0;
  try { entity.setProperty("pcraftrevorn:skin", idx); } catch { /* property out of range / unsupported */ }
}

const randOf = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Per-predator combat/digestion stats (from the mod's PCraftSpecific* configs).
// wg1/wg2 = weight-gain progress thresholds (999 = never gains weight).
export const PRED_STATS = {
  basaltmite: { swallow: 0.25, struggles: 11, difficulty: 0.30, acid: 2.8, acidMax: 26.0, acidIncr: 0.008, wg1: 1, wg2: 4 },
  gilded_basaltmite: { swallow: 0.25, struggles: 12, difficulty: 0.75, acid: 2.2, acidMax: 22.0, acidIncr: 0.005, wg1: 999, wg2: 999 },
  silverfish: { swallow: 0.30, struggles: 7, difficulty: 0.10, acid: 2.2, acidMax: 18.8, acidIncr: 0.02, wg1: 1, wg2: 4 },
  vinemaiden: { swallow: 0.32, struggles: 7, difficulty: 0.15, acid: 3.0, acidMax: 15.0, acidIncr: 0.03, wg1: 1, wg2: 4 },
  zombie: { swallow: 0.12, struggles: 7, difficulty: 0.15, acid: 4.0, acidMax: 12.0, acidIncr: 0.04, wg1: 1, wg2: 4 },
  scarecrow: { swallow: 0.34, struggles: 15, difficulty: 0.40, acid: 2.0, acidMax: 14.0, acidIncr: 0.01, wg1: 1, wg2: 4 },
  rabbit_wizard: { swallow: 0.15, struggles: 11, difficulty: 0.30, acid: 3.2, acidMax: 13.0, acidIncr: 0.04, wg1: 1, wg2: 4 },
  piglin_royal: { swallow: 0.30, struggles: 13, difficulty: 0.65, acid: 5.0, acidMax: 14.35, acidIncr: 0.055, wg1: 999, wg2: 999 },
  piglin_royal_knight: { swallow: 0.28, struggles: 9, difficulty: 0.23, acid: 4.4, acidMax: 13.6, acidIncr: 0.04, wg1: 1, wg2: 4 }
};

export function initPredator(entity) {
  const id = localId(entity.typeId);
  if (!SKINS[id]) return;
  if (getNum(entity, "pc:init", 0) === 1) return;
  setNum(entity, "pc:init", 1);
  setNum(entity, "pc:gender", GENDERED.has(id) ? (Math.random() < 0.5 ? 0 : 1) : 0);
  setNum(entity, "pc:variant", randOf(VARIANTS[id] ?? [0]));
  setNum(entity, "pc:counter", 0);
  setNum(entity, "pc:wg", 0);
  setNum(entity, "pc:wg_progress", 0);
  setNum(entity, "pc:full", 0);
  const st = PRED_STATS[id];
  if (st) {
    setNum(entity, "pc:swallow", st.swallow);
    setNum(entity, "pc:struggles", st.struggles);
    setNum(entity, "pc:difficulty", st.difficulty);
    setNum(entity, "pc:acid", st.acid);
    setNum(entity, "pc:acidMax", st.acidMax);
    setNum(entity, "pc:acidIncr", st.acidIncr);
    setNum(entity, "pc:wg1", st.wg1);
    setNum(entity, "pc:wg2", st.wg2);
  }
  if (id === "vinemaiden") {
    setNum(entity, "pc:buried", 0);
    setNum(entity, "pc:lost", 0);
    setNum(entity, "pc:burrowCd", 40 + Math.floor(Math.random() * 80));
  }
  assignSkin(entity, false);
}

export function playAnim(entity, suffix) {
  if (!entity) return;
  const prefix = ANIM_PREFIX[localId(entity.typeId)];
  if (!prefix) return;
  try { entity.playAnimation(`animation.${prefix}.${suffix}`); } catch { /* ignore */ }
}
