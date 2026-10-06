// Fermentation barrel interaction (port of GlowberryFermentationBarrel + FermentationMenu).
import { world, ItemStack } from "@minecraft/server";

function consumeHeld(player) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  const slot = player.selectedSlotIndex ?? 0;
  const item = inv.getItem(slot);
  if (!item) return;
  if (item.amount > 1) { item.amount -= 1; inv.setItem(slot, item); }
  else inv.setItem(slot, undefined);
}
function give(player, typeId, amount = 1) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  inv?.addItem(new ItemStack(typeId, amount));
}

export function wireFermentEvents() {
  world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
    const block = ev.block;
    if (block?.typeId !== "pcraftrevorn:glowberry_fermentation_barrel") return;
    const player = ev.player;
    if (!player || player.typeId !== "minecraft:player") return;

    if (ev.itemStack?.typeId === "pcraftrevorn:glowberry_juice_bottle") {
      consumeHeld(player);
      give(player, "pcraftrevorn:fermented_glowberry_juice_bottle");
      player.sendMessage("§a[发酵桶] 荧光浆果汁已发酵为「发酵荧光浆果汁」。");
      try { block.dimension.playSound("pcraftrevorn.gurgle", block.location, { volume: 0.6 }); } catch { /* ignore */ }
    } else if (ev.itemStack?.typeId === "pcraftrevorn:fermented_glowberry_juice_bottle") {
      player.sendMessage("§7[发酵桶] 这瓶已经发酵好了。");
    } else {
      player.sendMessage("§7[发酵桶] 手持「荧光浆果汁瓶」交互即可发酵。");
    }
  });
}
