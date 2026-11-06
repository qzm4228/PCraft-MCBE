// Cupid's arrow: fired like an arrow (right click), and whatever cute creature
// it hits is tamed. The right-click "bribe" items (golden apple / golden carrot
// / piglin talisman / slime ball) still work through minecraft:tameable; this
// module handles the projectile side.
import { world, system, EquipmentSlot } from "@minecraft/server";
import { TAME } from "../data/tame.js";
import { localId, refreshTamed } from "../skin/assign.js";

const ARROW_ITEM = "pcraftrevorn:cupids_arrow";
const ARROW_ENTITY = "pcraftrevorn:cupids_arrow";
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
  let proj;
  try {
    proj = player.dimension.spawnEntity(ARROW_ENTITY, {
      x: head.x + dir.x * 0.6,
      y: head.y + dir.y * 0.6,
      z: head.z + dir.z * 0.6,
    });
  } catch { return; }

  let shot = false;
  try {
    const comp = proj.getComponent("minecraft:projectile");
    if (comp) { comp.shoot({ x: dir.x * SPEED, y: dir.y * SPEED, z: dir.z * SPEED }); shot = true; }
  } catch { /* older API */ }
  if (!shot) {
    try { proj.applyImpulse({ x: dir.x * 0.5, y: dir.y * 0.5 + 0.02, z: dir.z * 0.5 }); } catch { /* ignore */ }
  }
  consumeOne(player);
}

function tame(target) {
  if (!target?.isValid) return;
  if (target.typeId === "minecraft:player") return;
  if (!TAMEABLE.has(localId(target.typeId))) return;
  try { if (target.getComponent("minecraft:is_tamed")) return; } catch { /* ignore */ }
  try { target.triggerEvent("pcraftrevorn:on_tame"); } catch { return; }
  try { target.setProperty("pcraftrevorn:tamed", true); } catch { /* not every version exposes it */ }
  try { refreshTamed(target); } catch { /* ignore */ }
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

  const onHit = (ev) => {
    if (ev.projectile?.typeId !== ARROW_ENTITY) return;
    let target;
    try { target = ev.getEntityHit?.()?.entity; } catch { /* API shape */ }
    if (target) tame(target);
  };
  try { world.afterEvents.projectileHitEntity.subscribe(onHit); } catch { /* older versions */ }

  // Backup path: some builds report projectile impacts through entityHitEntity.
  // Duplicate tames are harmless (tame() bails once is_tamed is set).
  try {
    world.afterEvents.entityHitEntity.subscribe((ev) => {
      if (ev.damagingEntity?.typeId === ARROW_ENTITY) tame(ev.hitEntity);
    });
  } catch { /* ignore */ }
}
