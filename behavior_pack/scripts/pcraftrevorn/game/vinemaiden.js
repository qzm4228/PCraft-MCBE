// Vinemaiden (藤娘) burrow disguise — port of VinemaidenOnEntityTickUpdateProcedure.
// She periodically buries herself in burrowable ground (buried texture + bury anim)
// and pops up when a valid target comes within 3 blocks.
import { world, system } from "@minecraft/server";
import { assignSkin, getNum, setNum } from "../skin/assign.js";
import { SKINS } from "../data/skins.js";

const BURROWABLE = new Set([
  "minecraft:grass_block", "minecraft:dirt_path", "minecraft:mycelium", "minecraft:dirt",
  "minecraft:coarse_dirt", "minecraft:podzol", "minecraft:rooted_dirt", "minecraft:mud",
  "minecraft:sand", "minecraft:red_sand", "minecraft:suspicious_sand",
  "minecraft:gravel", "minecraft:suspicious_gravel"
]);
const TARGETS = new Set([
  "minecraft:cow", "minecraft:sheep", "minecraft:pig", "minecraft:wolf",
  "minecraft:goat", "minecraft:zombie", "minecraft:pillager", "minecraft:vindicator"
]);
const STEP = 10; // interval (ticks)

function playAnim(entity, suffix) {
  try { entity.playAnimation(`animation.vinemaiden.${suffix}`); } catch { /* ignore */ }
}
function isBurrowable(entity) {
  try {
    const b = entity.dimension.getBlock({ x: Math.floor(entity.location.x), y: Math.floor(entity.location.y) - 1, z: Math.floor(entity.location.z) });
    return !!b && BURROWABLE.has(b.typeId);
  } catch { return false; }
}
function isSurvivalish(o) {
  try { return o.matches({ gameMode: "survival" }) || o.matches({ gameMode: "adventure" }); } catch { return true; }
}
function findTarget(entity) {
  try {
    for (const o of entity.dimension.getEntities({ location: entity.location, maxDistance: 3 })) {
      if (o.id === entity.id) continue;
      if (o.typeId === "minecraft:player") { if (isSurvivalish(o)) return o; }
      else if (TARGETS.has(o.typeId)) return o;
    }
  } catch { /* ignore */ }
  return undefined;
}
function setBuriedSkin(entity, buried) {
  if (buried) {
    const name = `vinemaiden_buried${getNum(entity, "pc:variant")}`;
    const idx = (SKINS.vinemaiden || {})[name];
    if (idx !== undefined) { try { entity.setProperty("pcraftrevorn:skin", idx); return; } catch { /* ignore */ } }
  }
  assignSkin(entity, getNum(entity, "pc:full") === 1);
}

export function wireVinemaiden() {
  system.runInterval(() => {
    for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
      let list;
      try { list = world.getDimension(dimId).getEntities({ type: "pcraftrevorn:vinemaiden" }); } catch { continue; }
      for (const e of list) {
        try { tick(e); } catch { /* ignore */ }
      }
    }
  }, STEP);
}

function tick(e) {
  // while it has prey inside, do not bury
  if (getNum(e, "pc:full", 0) === 1 && getNum(e, "pc:burrowCd", 0) < 300) setNum(e, "pc:burrowCd", 300);

  if (getNum(e, "pc:buried", 0) === 1) {
    setNum(e, "pc:hidden", 0);
    if (findTarget(e)) {
      playAnim(e, "popup");
      setNum(e, "pc:buried", 0);
      setNum(e, "pc:burrowCd", 260);
      setBuriedSkin(e, false);
    }
    return;
  }

  let cd = getNum(e, "pc:burrowCd", -1);
  if (cd < 0) { cd = 60 + Math.floor(Math.random() * 60); setNum(e, "pc:burrowCd", cd); return; }

  if (getNum(e, "pc:lost", 0) === 1 && isBurrowable(e)) setNum(e, "pc:lost", 0);

  if (cd > 0) {
    const prev = cd;
    cd = Math.max(0, cd - STEP);
    setNum(e, "pc:burrowCd", cd);
    if (prev > 61 && cd <= 61) {
      if (isBurrowable(e)) {
        setNum(e, "pc:buried", 1);
        // switch to buried texture + bury animation shortly after
        playAnim(e, "bury");
        setBuriedSkin(e, true);
      } else {
        setNum(e, "pc:lost", 1);
        setNum(e, "pc:burrowCd", 80);
      }
    }
  }
}
