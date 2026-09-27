// P6: nether worldgen for the piglin throneroom.
// Java used a jigsaw structure_set (random_spread spacing 16, separation 11).
// Bedrock addons cannot use jigsaw, so we approximate: periodically spawn a
// "piglin_throneroom_spawner" near a player in the nether (which then builds
// the throne room via structure.js).
import { world, system } from "@minecraft/server";

const TAG = "pc_throneroom_spawner";
const INTERVAL = 400;   // 20 s
const CHANCE = 0.5;
const MIN_R = 32;
const MAX_R = 80;
const AVOID_R = 96;

function findSurface(dimension, x, z) {
  for (let y = 120; y > 6; y -= 1) {
    try {
      const b = dimension.getBlock({ x, y, z });
      if (b && !b.isAir && !b.isLiquid) return y + 1;
    } catch { /* unloaded */ }
  }
  return undefined;
}

export function wireWorldgen() {
  system.runInterval(() => {
    if (Math.random() > CHANCE) return;
    const players = world.getAllPlayers().filter((p) => p.dimension.id === "minecraft:nether");
    if (players.length === 0) return;
    const player = players[Math.floor(Math.random() * players.length)];
    const dim = player.dimension;
    try {
      if (dim.getEntities({ tags: [TAG], location: player.location, maxDistance: AVOID_R }).length > 0) return;
    } catch { return; }

    const angle = Math.random() * Math.PI * 2;
    const r = MIN_R + Math.random() * (MAX_R - MIN_R);
    const x = Math.floor(player.location.x + Math.cos(angle) * r);
    const z = Math.floor(player.location.z + Math.sin(angle) * r);
    const y = findSurface(dim, x, z);
    if (y === undefined) return;
    try {
      const e = dim.spawnEntity("pcraftrevorn:piglin_throneroom_spawner", { x: x + 0.5, y, z: z + 0.5 });
      e.addTag(TAG);
      player.sendMessage("§8[PCraftRevorn] 远处传来一阵骚动……");
    } catch { /* ignore */ }
  }, INTERVAL);
}
