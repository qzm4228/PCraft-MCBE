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
const GENDERED = new Set(["basaltmite", "gilded_basaltmite", "silverfish", "scarecrow", "piglin_royal", "piglin_royal_knight"]);
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

export function initPredator(entity) {
  const id = localId(entity.typeId);
  if (!SKINS[id]) return;
  if (getNum(entity, "pc:init", 0) === 1) return;
  setNum(entity, "pc:init", 1);
  setNum(entity, "pc:gender", GENDERED.has(id) ? (Math.random() < 0.5 ? 0 : 1) : 0);
  setNum(entity, "pc:variant", randOf(VARIANTS[id] ?? [0]));
  setNum(entity, "pc:counter", 0);
  setNum(entity, "pc:wg", 0);
  setNum(entity, "pc:full", 0);
  assignSkin(entity, false);
}

export function playAnim(entity, suffix) {
  if (!entity) return;
  const prefix = ANIM_PREFIX[localId(entity.typeId)];
  if (!prefix) return;
  try { entity.playAnimation(`animation.${prefix}.${suffix}`); } catch { /* ignore */ }
}
