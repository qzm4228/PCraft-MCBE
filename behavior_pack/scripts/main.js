import { system, world } from "@minecraft/server";
import { showPcForm } from "./pcraftrevorn/ui/forms.js";
import { initPredator, localId } from "./pcraftrevorn/skin/assign.js";
import { wireVoreEvents, isPredator, startSwallow, release, strugglePress } from "./pcraftrevorn/vore/vore.js";
import { dirOfItem } from "./pcraftrevorn/vore/prey_items.js";
import { wireInteractEvents } from "./pcraftrevorn/game/interact.js";
import { wireFermentEvents } from "./pcraftrevorn/game/ferment.js";
import { wireBaubles } from "./pcraftrevorn/game/baubles.js";
import { openSettings } from "./pcraftrevorn/game/config.js";
import { openGuide } from "./pcraftrevorn/game/guide.js";
import { wireStructure } from "./pcraftrevorn/game/structure.js";
import { wireWorldgen } from "./pcraftrevorn/game/worldgen.js";
import { wireVinemaiden } from "./pcraftrevorn/game/vinemaiden.js";
import { openVariants, wireVariants } from "./pcraftrevorn/game/variants.js";

wireVoreEvents();
wireInteractEvents();
wireFermentEvents();
wireBaubles();
wireStructure();
wireWorldgen();
wireVinemaiden();
wireVariants();

// Assign skins to predators when they spawn / are summoned.
world.afterEvents.entitySpawn.subscribe((ev) => {
  if (isPredator(ev.entity)) initPredator(ev.entity);
});

// Re-init nearby predators when a player joins.
world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  try {
    for (const e of ev.player.dimension.getEntities({ families: ["predator"], location: ev.player.location, maxDistance: 64 })) {
      initPredator(e);
    }
  } catch { /* ignore */ }
});

/** Form UI demo (no predator): validates the form + progress-bar state bus. */
async function runFormDemo(player) {
  let level = 0;
  while (true) {
    const res = await showPcForm(player, {
      title: "界面演示",
      body: "§7表单按钮 + 标题状态总线进度条演示。",
      level,
      buttons: [
        { id: "up", label: "§f↑ §7向上" },
        { id: "down", label: "§f↓ §7向下" },
        { id: "digest", label: "§8进度 +1" },
        { id: "close", label: "§a关闭" }
      ]
    });
    if (res.canceled || res.id === "close") break;
    if (res.id === "digest") level = Math.min(15, level + 1);
  }
  player.sendMessage("§7[PCraftRevorn] §a演示结束。");
}

function nearestPredator(player, radius = 12) {
  try {
    return player.dimension.getEntities({ families: ["predator"], location: player.location, maxDistance: radius, closest: 1 })[0];
  } catch { return undefined; }
}

// Custom potions: vanilla-effect approximations (Bedrock has no custom effects)
const POTION_EFFECTS = {
  "pcraftrevorn:fragrance_potion": { effect: "speed", amp: 0, dur: 1800 },
  "pcraftrevorn:stench_potion": { effect: "nausea", amp: 0, dur: 600 },
  "pcraftrevorn:fortitude_potion": { effect: "resistance", amp: 1, dur: 1800 },
  "pcraftrevorn:pacifying_potion": { effect: "slowness", amp: 0, dur: 600 },
  "pcraftrevorn:rotten_stench_potion": { effect: "nausea", amp: 1, dur: 900 }
};

function consumeHeld(player) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  const slot = player.selectedSlotIndex ?? 0;
  const item = inv.getItem(slot);
  if (!item) return;
  if (item.amount > 1) { item.amount -= 1; inv.setItem(slot, item); }
  else inv.setItem(slot, undefined);
}

// Struggle keys: the prey escapes by *using* the direction item the HUD asks for.
world.afterEvents.itemUse.subscribe((ev) => {
  const player = ev.source;
  if (player?.typeId !== "minecraft:player") return;
  const dir = dirOfItem(ev.itemStack);
  if (dir && strugglePress(player, dir)) return;
});

world.afterEvents.itemUse.subscribe((ev) => {
  const player = ev.source;
  if (player?.typeId !== "minecraft:player") return;
  const potion = POTION_EFFECTS[ev.itemStack?.typeId];
  if (potion) {
    try { player.addEffect(potion.effect, potion.dur, { amplifier: potion.amp, showParticles: true }); } catch { /* ignore */ }
    player.sendMessage("§b[药水] 你饮下了药水。");
    return;
  }
  if (ev.itemStack?.typeId === "minecraft:stick") void runFormDemo(player);
});

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const player = ev.sourceEntity;
  if (player?.typeId !== "minecraft:player") return;
  switch (ev.id) {
    case "pcraftrevorn:form": void runFormDemo(player); break;
    case "pcraftrevorn:guide": void openGuide(player); break;
    case "pcraftrevorn:variants": void openVariants(player); break;
    case "pcraftrevorn:settings": void openSettings(player); break;
    case "pcraftrevorn:swallow": {
      const pred = nearestPredator(player);
      if (pred) startSwallow(player, pred);
      else player.sendMessage("§7[PCraftRevorn] 附近没有掠食者。");
      break;
    }
    case "pcraftrevorn:release": release(player, true); break;
    default: break;
  }
}, { namespaces: ["pcraftrevorn"] });

console.warn(`[PCraftRevorn] scripts loaded. player="${localId("minecraft:player")}"`);
