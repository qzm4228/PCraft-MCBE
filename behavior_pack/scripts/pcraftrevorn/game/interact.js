// Right-click interactions with predators (port of the mod's item procedures).
import { world, system } from "@minecraft/server";
import { assignSkin, getNum, setNum, localId, GENDERED } from "../skin/assign.js";
import { isPredator } from "../vore/vore.js";
import { openGuide } from "./guide.js";
import { addWgProgress } from "./wg.js";

const SCALE_ITEMS = new Set([
  "pcraftrevorn:basaltmite_scale",
  "pcraftrevorn:gilded_basaltmite_scale",
  "pcraftrevorn:silverfish_plate"
]);
const VARIANTS = {
  rabbit_wizard: [0, 1, 2],
  zombie: [0, 1, 2, 3],
  vinemaiden: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  piglin_royal_knight: [0, 1]
};

function heldContainer(player) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return undefined;
  return { inv, slot: player.selectedSlotIndex ?? 0 };
}
function consumeHeld(player) {
  const h = heldContainer(player);
  if (!h) return;
  const item = h.inv.getItem(h.slot);
  if (!item) return;
  if (item.amount > 1) { item.amount -= 1; h.inv.setItem(h.slot, item); }
  else h.inv.setItem(h.slot, undefined);
}
function healFull(entity) {
  try {
    const hp = entity.getComponent("minecraft:health");
    if (hp) hp.setCurrentValue(hp.effectiveMax);
  } catch { /* ignore */ }
}
function isTamed(entity) {
  try { return !!entity.getComponent("minecraft:is_tamed"); } catch { return false; }
}
// Peculiar mirror: toggles a gendered predator. Guarded so the entity-interact
// event and the item-use fallback don't both fire on the same press.
const mirrorGuard = new Map(); // playerId -> tick
function toggleMirror(player, target) {
  const now = system.currentTick;
  if ((mirrorGuard.get(player.id) ?? -999) > now - 6) return;
  mirrorGuard.set(player.id, now);
  const id = localId(target.typeId);
  if (GENDERED.has(id)) {
    setNum(target, "pc:gender", getNum(target, "pc:gender") === 1 ? 0 : 1);
    assignSkin(target, getNum(target, "pc:full") === 1);
    player.sendMessage("§d[奇异之镜] 性别已转换。");
  } else {
    player.sendMessage("§7[奇异之镜] 这个生物无法转换性别。");
  }
}

function cycleVariant(entity, id) {
  const list = VARIANTS[id];
  if (list) {
    const cur = getNum(entity, "pc:variant");
    const i = list.indexOf(cur);
    setNum(entity, "pc:variant", list[(i + 1 + list.length) % list.length]);
  }
  assignSkin(entity, getNum(entity, "pc:full") === 1);
}

export function wireInteractEvents() {
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    const player = ev.player;
    const target = ev.target;
    if (!player || !target || !isPredator(target)) return;
    const id = localId(target.typeId);
    const item = ev.itemStack?.typeId;

    if (item === "pcraftrevorn:pred_guidebook_item") { void openGuide(player); return; }

    if (item === "pcraftrevorn:peculiar_mirror") { toggleMirror(player, target); return; }

    if (item === "pcraftrevorn:vibrant_elixir") {
      cycleVariant(target, id);
      player.sendMessage("§d[奇物] 已切换掠食者的变种。");
      return;
    }

    if (item === "pcraftrevorn:hyperdense_porkchop") {
      const up = addWgProgress(target, 3);
      consumeHeld(player);
      player.sendMessage(up ? "§d[超密猪排] 体重阶段提升！" : "§7[超密猪排] 体重持续增长中……");
      return;
    }

    if (SCALE_ITEMS.has(item)) {
      healFull(target);
      player.sendMessage("§a[喂食] 掠食者恢复了生命。");
      return;
    }

    player.sendMessage(`§7[${id}] 变种 §f${getNum(target, "pc:variant")}§7 · 体重阶段 §f${getNum(target, "pc:wg")}§7 · 驯服 §f${isTamed(target) ? "是" : "否"}`);
  });

  // Fallback trigger for the mirror: some platforms/devices don't raise
  // playerInteractWithEntity for plain items, so also handle item use while a
  // predator is within reach.
  world.afterEvents.itemUse.subscribe((ev) => {
    const player = ev.source;
    if (player?.typeId !== "minecraft:player") return;
    if (ev.itemStack?.typeId !== "pcraftrevorn:peculiar_mirror") return;
    let pred;
    try {
      pred = player.dimension.getEntities({ families: ["predator"], location: player.location, maxDistance: 4, closest: 1 })[0];
    } catch { pred = undefined; }
    if (pred) toggleMirror(player, pred);
  });
}
