// The prey's "keys".
//
// Bedrock addons cannot register keybinds and inventory-UI buttons cannot call
// scripts, so the escape interaction ships as four hotbar items -- one per
// direction. On swallow everything the prey carries (36 inventory slots plus
// armour and the offhand) is moved slot-for-slot into an invisible container so
// an escape can put it back exactly where it was, and the four keys are placed
// in hotbar slots 0..3, locked in place so they cannot be dropped or moved.
import { ItemStack, EquipmentSlot } from "@minecraft/server";

/** item id -> direction */
export const STRUGGLE_DIR_BY_ITEM = new Map([
  ["pcraftrevorn:struggle_up", "up"],
  ["pcraftrevorn:struggle_down", "down"],
  ["pcraftrevorn:struggle_left", "left"],
  ["pcraftrevorn:struggle_right", "right"],
]);
export const STRUGGLE_DIRS = ["up", "down", "left", "right"];
/** hotbar slot each direction lives in (also the on-screen order) */
export const SLOT_FOR_DIR = { up: 0, down: 1, left: 2, right: 3 };

export const STASH_ENTITY = "pcraftrevorn:belly_storage";
export const STASH_KEY = "pc:stash";        // container dynamic property -> prey id
const INV_SLOTS = 36;                       // the prey's inventory
const EQ_BASE = 36;                         // stashed equipment starts here
const EQ_SLOTS = [
  EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs,
  EquipmentSlot.Feet, EquipmentSlot.Offhand,
];

export const isStruggleItem = (item) => !!item && STRUGGLE_DIR_BY_ITEM.has(item.typeId);
export const dirOfItem = (item) => (item ? STRUGGLE_DIR_BY_ITEM.get(item.typeId) : undefined);

function makeItem(dir) {
  const stack = new ItemStack(`pcraftrevorn:struggle_${dir}`, 1);
  // "lock_in_slot" (ItemLockMode.slot): cannot be dropped, moved, removed from the
  // slot, or used in crafting. Written as the raw enum value so the script keeps
  // loading on module versions that do not export the enum.
  try { stack.lockMode = "slot"; } catch { /* engine too old to lock */ }
  return stack;
}

const invOf = (entity) => {
  try { return entity.getComponent("minecraft:inventory")?.container; } catch { return undefined; }
};

const itemAt = (container, slot) => {
  try { return container.getItem(slot) ?? undefined; } catch { return undefined; }
};

/**
 * Clears a slot, unlocking a lock_in_slot item first.
 *
 * A locked item cannot be moved or dropped *by the player*; to be safe the slot is
 * re-written as unlocked before it is emptied, so the key can never end up stuck in
 * a slot and block the real inventory from being put back.
 */
function forceClear(container, slot) {
  const cur = itemAt(container, slot);
  if (!cur) return;
  try { cur.lockMode = "none"; container.setItem(slot, cur); } catch { /* ignore */ }
  try { container.setItem(slot, undefined); } catch { /* ignore */ }
}

/** Puts the four keys in hotbar slots 0..3 and selects the first one. */
export function giveStruggleItems(player) {
  const inv = invOf(player);
  if (!inv) return false;
  for (const dir of STRUGGLE_DIRS) inv.setItem(SLOT_FOR_DIR[dir], makeItem(dir));
  try { player.selectedSlotIndex = 0; } catch { /* ignore */ }
  return true;
}

/** Re-places keys that went missing and drops any that wandered out of its slot. */
export function ensureStruggleItems(player) {
  const inv = invOf(player);
  if (!inv) return;
  for (let i = 0; i < inv.size; i++) {
    const dir = dirOfItem(itemAt(inv, i));
    if (!dir) continue;
    // locked items should never move, but never let a key end up in the wrong slot
    if (i !== SLOT_FOR_DIR[dir]) forceClear(inv, i);
  }
  for (const dir of STRUGGLE_DIRS) {
    const slot = SLOT_FOR_DIR[dir];
    if (itemAt(inv, slot)?.typeId !== `pcraftrevorn:struggle_${dir}`) inv.setItem(slot, makeItem(dir));
  }
}

/** Removes every key the prey still holds. */
export function clearStruggleItems(player) {
  const inv = invOf(player);
  if (!inv) return;
  for (let i = 0; i < inv.size; i++) {
    if (isStruggleItem(itemAt(inv, i))) forceClear(inv, i);
  }
}

/** Moves the prey's carried inventory into `container`, preserving slots. */
export function stashInventory(player, container) {
  const dst = invOf(container);
  const src = invOf(player);
  if (!dst || !src) return false;
  const eq = player.getComponent("minecraft:equippable");
  for (let i = 0; i < INV_SLOTS; i++) {
    // the stash is freshly spawned and empty, so this is a plain move
    try { dst.setItem(i, itemAt(src, i)); } catch { /* ignore */ }
    try { src.setItem(i, undefined); } catch { /* ignore */ }
  }
  EQ_SLOTS.forEach((slot, k) => {
    try { dst.setItem(EQ_BASE + k, eq?.getEquipment(slot)); } catch { /* ignore */ }
    try { eq?.setEquipment(slot, undefined); } catch { /* ignore */ }
  });
  return true;
}

/** Puts the stashed inventory back, slot for slot. */
export function unstashInventory(player, container) {
  const src = invOf(container);
  const dst = invOf(player);
  if (!src || !dst) return false;
  const eq = player.getComponent("minecraft:equippable");
  for (let i = 0; i < INV_SLOTS; i++) {
    // the hotbar still holds the keys: clear (and unlock) them before restoring
    if (isStruggleItem(itemAt(dst, i))) forceClear(dst, i);
    try { dst.setItem(i, itemAt(src, i)); } catch { /* spilled by the caller */ }
    try { src.setItem(i, undefined); } catch { /* ignore */ }
  }
  EQ_SLOTS.forEach((slot, k) => {
    try { eq?.setEquipment(slot, itemAt(src, EQ_BASE + k)); } catch { /* ignore */ }
    try { src.setItem(EQ_BASE + k, undefined); } catch { /* ignore */ }
  });
  return true;
}
