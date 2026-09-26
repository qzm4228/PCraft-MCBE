import { system, world } from "@minecraft/server";
import { showPcForm } from "./pcraftrevorn/ui/forms.js";
import { initPredator, localId } from "./pcraftrevorn/skin/assign.js";
import { wireVoreEvents, isPredator, startSwallow } from "./pcraftrevorn/vore/vore.js";
import { wireInteractEvents } from "./pcraftrevorn/game/interact.js";
import { wireFermentEvents } from "./pcraftrevorn/game/ferment.js";
import { wireBaubles } from "./pcraftrevorn/game/baubles.js";
import { openSettings } from "./pcraftrevorn/game/config.js";
import { openGuide } from "./pcraftrevorn/game/guide.js";

wireVoreEvents();
wireInteractEvents();
wireFermentEvents();
wireBaubles();

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

world.afterEvents.itemUse.subscribe((ev) => {
  const player = ev.source;
  if (player?.typeId !== "minecraft:player") return;
  if (ev.itemStack?.typeId === "minecraft:stick") void runFormDemo(player);
});

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const player = ev.sourceEntity;
  if (player?.typeId !== "minecraft:player") return;
  switch (ev.id) {
    case "pcraftrevorn:form": void runFormDemo(player); break;
    case "pcraftrevorn:guide": void openGuide(player); break;
    case "pcraftrevorn:settings": void openSettings(player); break;
    case "pcraftrevorn:swallow": {
      const pred = nearestPredator(player);
      if (pred) startSwallow(player, pred);
      else player.sendMessage("§7[PCraftRevorn] 附近没有掠食者。");
      break;
    }
    default: break;
  }
}, { namespaces: ["pcraftrevorn"] });

console.warn(`[PCraftRevorn] scripts loaded. player="${localId("minecraft:player")}"`);
