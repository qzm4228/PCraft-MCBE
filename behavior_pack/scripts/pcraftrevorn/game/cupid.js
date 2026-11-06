// Cupid's arrow: fired like an arrow (right click) and a normal Minecraft arrow
// is spawned with the "pcr_cupid" tag. Whatever cute creature it hits is tamed.
// Using the vanilla arrow keeps the trajectory / shake / impact sound identical
// to a bow shot; the tag is what tells our arrows apart.
import { world, system, EquipmentSlot } from "@minecraft/server";
import { TAME } from "../data/tame.js";
import { localId, refreshTamed } from "../skin/assign.js";

const ARROW_ITEM = "pcraftrevorn:cupids_arrow";
const ARROW_ENTITY = "minecraft:arrow";
const ARROW_TAG = "pcr_cupid";
const SPEED = 2.6;
const TAMEABLE = new Set(Object.keys(TAME));

const lastFire = new Map();

function consumeOne(player) {
  try {
    const eq = player.getComponent("minecraft:equippable");
    const held = eq.getEquipment(EquipmentSlot.Mainhand);
    if (!held || held.typeId !== ARROW_ITEM) return;
    if (held.amount > 1) {
      held.amount -= 1;
      eq.setEquipment(EquipmentSlot.Mainhand, held);
    } else {
      eq.setEquipment(EquipmentSlot.Mainhand, undefined);
    }
  } catch { /* ignore */ }
}

function fire(player) {
  const now = system.currentTick;
  if (now - (lastFire.get(player.id) ?? -100) < 4) return; // itemUse + itemUseOn both fire
  lastFire.set(player.id, now);

  const dir = player.getViewDirection();
  const head = player.getHeadLocation();
  let arrow;
  try {
    arrow = player.dimension.spawnEntity(ARROW_ENTITY, {
      x: head.x + dir.x * 0.7,
      y: head.y + dir.y * 0.7,
      z: head.z + dir.z * 0.7,
    });
  } catch { return; }

  try { arrow.addTag(ARROW_TAG); } catch { /* ignore */ }
  let shot = false;
  try {
    const comp = arrow.getComponent("minecraft:projectile");
    if (comp) { comp.shoot({ x: dir.x * SPEED, y: dir.y * SPEED, z: dir.z * SPEED }); shot = true; }
  } catch { /* older API */ }
  if (!shot) {
    try { arrow.applyImpulse({ x: dir.x * 0.5, y: dir.y * 0.5 + 0.02, z: dir.z * 0.5 }); } catch { /* ignore */ }
  }
  consumeOne(player);
}

function tame(target) {
  if (!target?.isValid) return;
  if (target.typeId === "minecraft:player") return;
  if (!TAMEABLE.has(localId(target.typeId))) return;
  try { if (target.getComponent("minecraft:is_tamed")) return; } catch { /* ignore */ }
  try { target.triggerEvent("pcraftrevorn:on_tame"); } catch { return; }
  try { target.setProperty("pcraftrevorn:tamed", true); } catch { /* not every entity has it */ }
  try { refreshTamed(target); } catch { /* ignore */ }
  // The vanilla arrow still deals 1-5 damage; heal the new companion back up.
  try {
    const hp = target.getComponent("minecraft:health");
    if (hp) hp.setCurrentValue(hp.effectiveMax);
  } catch { /* ignore */ }
  try {
    target.dimension.spawnParticle("minecraft:heart_particle", {
      x: target.location.x,
      y: target.location.y + 1,
      z: target.location.z,
    });
  } catch { /* ignore */ }
  try { target.dimension.playSound("random.orb", target.location, { volume: 0.5, pitch: 1.4 }); } catch { /* ignore */ }
}

export function wireCupid() {
  const onUse = (ev) => {
    if (ev.itemStack?.typeId !== ARROW_ITEM) return;
    const p = ev.source;
    if (p?.typeId === "minecraft:player") fire(p);
  };
  world.afterEvents.itemUse.subscribe(onUse);
  try { world.afterEvents.itemUseOn.subscribe(onUse); } catch { /* older versions */ }

  // Bow support: holding the cupid's arrow in the OFFHAND while shooting a bow
  // turns the arrow into a cupid arrow (the bow still consumes a normal arrow;
  // one cupid's arrow is taken from the offhand). The vanilla tipped-arrow route
  // cannot work: variants are data values that the script API neither exposes
  // on the arrow entity nor lets us create reliably.
  world.afterEvents.entitySpawn.subscribe((ev) => {
    const arrow = ev.entity;
    if (arrow?.typeId !== ARROW_ENTITY) return;
    let near;
    try { near = arrow.dimension.getPlayers({ location: arrow.location, maxDistance: 4 }); } catch { return; }
    for (const p of near) {
      try {
        const eq = p.getComponent("minecraft:equippable");
        const main = eq.getEquipment(EquipmentSlot.Mainhand)?.typeId;
        if (main !== "minecraft:bow" && main !== "minecraft:crossbow") continue;
        const off = eq.getEquipment(EquipmentSlot.Offhand);
        if (!off || off.typeId !== ARROW_ITEM) continue;
        arrow.addTag(ARROW_TAG);
        if (off.amount > 1) {
          off.amount -= 1;
          eq.setEquipment(EquipmentSlot.Offhand, off);
        } else {
          eq.setEquipment(EquipmentSlot.Offhand, undefined);
        }
        break;
      } catch { continue; }
    }
  });

  const onHit = (ev) => {
    if (ev.projectile?.typeId !== ARROW_ENTITY) return;
    try { if (!ev.projectile.hasTag(ARROW_TAG)) return; } catch { return; }
    let target;
    try { target = ev.getEntityHit?.()?.entity; } catch { /* API shape */ }
    if (target) tame(target);
  };
  try { world.afterEvents.projectileHitEntity.subscribe(onHit); } catch { /* older versions */ }

  // Backup path: some builds report projectile impacts through entityHitEntity.
  try {
    world.afterEvents.entityHitEntity.subscribe((ev) => {
      if (ev.damagingEntity?.typeId !== ARROW_ENTITY) return;
      try { if (!ev.damagingEntity.hasTag(ARROW_TAG)) return; } catch { return; }
      tame(ev.hitEntity);
    });
  } catch { /* ignore */ }
}
