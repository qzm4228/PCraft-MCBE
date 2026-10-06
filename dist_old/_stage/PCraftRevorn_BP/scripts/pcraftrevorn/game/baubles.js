// Curios replacement: scan the player's inventory for "bauble" items and apply
// their passive effects (port of the *WhileBaubleIsEquippedTick procedures).
import { world, system } from "@minecraft/server";

const BAUBLES = {
  "pcraftrevorn:gilded_shield": { effect: "resistance", amp: 0 },
  "pcraftrevorn:basaltmite_plated_soles": { effect: "fire_resistance", amp: 0 },
  "pcraftrevorn:piglin_might_talisman": { effect: "regeneration", amp: 0 },
  "pcraftrevorn:piglin_royal_talisman": { effect: "regeneration", amp: 1 },
  "pcraftrevorn:silverfish_plating_boots": { effect: "speed", amp: 0 }
};

function hasItem(player, id) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return false;
  for (let i = 0; i < inv.size; i += 1) {
    if (inv.getItem(i)?.typeId === id) return true;
  }
  return false;
}

export function wireBaubles() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      for (const [id, b] of Object.entries(BAUBLES)) {
        if (hasItem(player, id)) {
          try { player.addEffect(b.effect, 60, { amplifier: b.amp, showParticles: false }); } catch { /* ignore */ }
        }
      }
    }
  }, 40);
}
