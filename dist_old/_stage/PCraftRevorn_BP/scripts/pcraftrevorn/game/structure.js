// P6: places the konverted throne-room structure (ported from
// PiglinThroneroomSpawnerOnEntityTickUpdateProcedure, which loaded the
// "remnant_throne_room" structure template).
import { world, system, BlockPermutation } from "@minecraft/server";
import { STRUCTURES } from "../data/structures.js";

const BATCH = 300;
const BUILT_TAG = "pc_throneroom_built";

function permFor(entry) {
  try { return BlockPermutation.resolve(entry.name, entry.states); }
  catch { try { return BlockPermutation.resolve(entry.name); } catch { return undefined; } }
}

export function placeStructure(dimension, origin, key, onDone) {
  const data = STRUCTURES[key];
  if (!data) return;
  const perms = data.palette.map(permFor);
  const blocks = data.blocks;
  let i = 0;
  const runId = system.runInterval(() => {
    const end = Math.min(blocks.length, i + BATCH);
    for (; i < end; i += 1) {
      const [x, y, z, p] = blocks[i];
      try {
        const b = dimension.getBlock({ x: origin.x + x, y: origin.y + y, z: origin.z + z });
        if (b && perms[p]) b.setPermutation(perms[p]);
      } catch { /* unloaded chunk */ }
    }
    if (i >= blocks.length) {
      system.clearRun(runId);
      for (const e of data.entities) {
        try { dimension.spawnEntity(e.id, { x: origin.x + e.x + 0.5, y: origin.y + e.y, z: origin.z + e.z + 0.5 }); } catch { /* ignore */ }
      }
      if (onDone) onDone();
    }
  }, 1);
}

export function wireStructure() {
  world.afterEvents.entitySpawn.subscribe((ev) => {
    const e = ev.entity;
    if (e?.typeId !== "pcraftrevorn:piglin_throneroom_spawner") return;
    if (e.hasTag(BUILT_TAG)) return;
    e.addTag(BUILT_TAG);
    const origin = { x: Math.floor(e.location.x), y: Math.floor(e.location.y), z: Math.floor(e.location.z) };
    const dimension = e.dimension;
    system.runTimeout(() => {
      let valid = true;
      try { valid = e.isValid; } catch { valid = false; }
      if (!valid) return;
      placeStructure(dimension, origin, "remnant_throne_room", () => {
        try { e.remove(); } catch { /* ignore */ }
      });
    }, 40);
  });
}
