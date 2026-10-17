// VCM (Internalised) combat wiring: druid staves, their seasonal projectiles,
// the vampiric dagger's lifesteal and the two script-side mob drops.
//
// The projectile entity owns the flight model (`minecraft:projectile`: damage 1,
// 5 blocks/tick, no gravity drop worth mentioning); the particles live here
// because Bedrock's `particle_on_hit` only accepts vanilla particle enums, and
// because the trail/burst counts (2 per tick, 35 on impact) are VCM's own.
import { world, system, EquipmentSlot, ItemStack } from "@minecraft/server";
import { VCM } from "../data/vcm.js";
import { getNum, localId } from "../skin/assign.js";

const STAFFS = VCM.staffs ?? {};
const PROJ = VCM.projectiles ?? {};
const PARTICLES = VCM.particles ?? {};

const DAGGER = "pcraftrevorn:vampiric_dagger";
const DAGGER_DAMAGE = 3; // the item's minecraft:damage component
const MAX_AGE = 200; // 10 s; VCM's arrows never stick, this is a safety net

// Drops: bat girl 1/8 blood shard, druid 1/3 its own seasonal staff. VCM's
// variant order is base/autumn/winter/spring while our skins are
// base/autumn/spring/winter, so the skin index lines up 1:1 with this table.
const DRUID_STAFFS = [
  "pcraftrevorn:druid_staff",
  "pcraftrevorn:autumn_druid_staff",
  "pcraftrevorn:spring_druid_staff",
  "pcraftrevorn:winter_druid_staff"
];

/** id -> { particle, age, loc, vel, dimension, missing } */
const inflight = new Map();

function track(entity) {
  const info = PROJ[entity?.typeId];
  if (!info) return;
  inflight.set(entity.id, {
    particle: info.particle,
    age: 0,
    loc: entity.location,
    vel: { x: 0, y: 0, z: 0 },
    dimension: entity.dimension,
    missing: false
  });
}

function burstAt(dimension, particle, loc) {
  const info = PARTICLES[particle];
  if (!info || !dimension || !loc) return;
  try { dimension.spawnParticle(info.burst, { x: loc.x, y: loc.y + 1, z: loc.z }); } catch { /* unloaded */ }
}

function spawnLoot(dimension, loc, typeId, amount = 1) {
  try { dimension.spawnItem(new ItemStack(typeId, amount), loc); } catch { /* ignore */ }
}

function wearHeld(player) {
  try {
    const eq = player.getComponent("minecraft:equippable");
    const item = eq.getEquipment(EquipmentSlot.Mainhand);
    const dur = item?.getComponent("minecraft:durability");
    if (!dur || dur.damage >= dur.maxDurability) return;
    dur.damage += 1;
    if (dur.damage >= dur.maxDurability) {
      eq.setEquipment(EquipmentSlot.Mainhand, undefined);
      player.playSound("random.break", { location: player.location });
    } else {
      eq.setEquipment(EquipmentSlot.Mainhand, item);
    }
  } catch { /* ignore */ }
}

function heal(entity, amount) {
  const hp = entity?.getComponent("minecraft:health");
  if (!hp) return 0;
  const before = hp.currentValue;
  const gain = Math.min(amount, hp.effectiveMax - before);
  if (gain <= 0) return 0;
  try { hp.setCurrentValue(before + gain); } catch { return 0; }
  return gain;
}

/** VCM staff: 5 blocks/tick down the view vector, amethyst chime, 1 durability. */
function fireStaff(player, itemId) {
  const staff = STAFFS[itemId];
  if (!staff) return;
  const view = player.getViewDirection();
  const head = player.getHeadLocation();
  let proj;
  try {
    proj = player.dimension.spawnEntity(staff.projectile, { x: head.x, y: head.y - 0.1, z: head.z });
  } catch { return; }
  const vel = { x: view.x * 5, y: view.y * 5, z: view.z * 5 };
  try {
    const pc = proj.getComponent("minecraft:projectile");
    if (pc?.shoot) pc.shoot(vel);
    else proj.applyImpulse(vel);
  } catch {
    try { proj.applyImpulse(vel); } catch { /* ignore */ }
  }
  // Java: volume 1, pitch 1/(rand*0.5+1) + power/2 with power 5
  try {
    player.playSound("block.amethyst_block.chime", {
      location: player.location,
      pitch: 1 / (Math.random() * 0.5 + 1) + 2.5
    });
  } catch { /* ignore */ }
  wearHeld(player);
  try { player.startItemCooldown?.(staff.cooldown, 60); } catch { /* ignore */ }
}

/** The dagger drinks from the victim: heal damage/4 and trail the siphon. */
function drain(attacker, victim) {
  const gain = heal(attacker, DAGGER_DAMAGE / 4);
  if (gain <= 0) return;
  const from = victim.location;
  const to = attacker.location;
  const dim = attacker.dimension;
  for (let i = 0; i < 16; i++) {
    const p = {
      x: to.x + (from.x - to.x) * (i / 16),
      y: to.y + 1 + (from.y - to.y) * (i / 16),
      z: to.z + (from.z - to.z) * (i / 16)
    };
    try { dim.spawnParticle(PARTICLES.siphon?.trail ?? "pcraftrevorn:siphon", p); } catch { /* ignore */ }
  }
}

function holdsDagger(player) {
  try {
    const eq = player.getComponent("minecraft:equippable");
    if (eq.getEquipment(EquipmentSlot.Mainhand)?.typeId === DAGGER) return true;
    return eq.getEquipment(EquipmentSlot.Offhand)?.typeId === DAGGER;
  } catch { return false; }
}

export function wireVcmCombat() {
  world.afterEvents.itemUse.subscribe((ev) => {
    const player = ev.source;
    if (player?.typeId !== "minecraft:player") return;
    const id = ev.itemStack?.typeId;
    if (id && STAFFS[id]) fireStaff(player, id);
  });

  // every druid projectile is registered on spawn, no matter who shot it
  world.afterEvents.entitySpawn.subscribe((ev) => {
    if (ev.entity?.typeId && PROJ[ev.entity.typeId]) track(ev.entity);
  });

  world.afterEvents.entityHitEntity.subscribe((ev) => {
    const projectile = inflight.get(ev.damagingEntity?.id);
    if (projectile) {
      burstAt(ev.damagingEntity.dimension, projectile.particle,
        ev.hitEntity?.location ?? projectile.loc);
      inflight.delete(ev.damagingEntity.id);
      return;
    }
    // melee: the vampiric dagger
    const attacker = ev.damagingEntity;
    if (attacker?.typeId !== "minecraft:player" || !holdsDagger(attacker)) return;
    if (!ev.hitEntity || ev.hitEntity.typeId === "minecraft:player") return;
    drain(attacker, ev.hitEntity);
  });

  world.afterEvents.entityHitBlock.subscribe((ev) => {
    const projectile = inflight.get(ev.damagingEntity?.id);
    if (!projectile) return;
    const b = ev.hitBlock?.location;
    burstAt(ev.damagingEntity.dimension, projectile.particle,
      b ? { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 } : projectile.loc);
    inflight.delete(ev.damagingEntity.id);
  });

  world.afterEvents.entityDie.subscribe((ev) => {
    const dead = ev.deadEntity;
    const id = localId(dead?.typeId ?? "");
    if (id === "bat_girl") {
      if (Math.random() < 1 / 8) spawnLoot(dead.dimension, dead.location, "pcraftrevorn:blood_shard");
    } else if (id === "druid") {
      if (Math.random() < 1 / 3) {
        const i = Math.max(0, Math.min(DRUID_STAFFS.length - 1, getNum(dead, "pc:variant")));
        spawnLoot(dead.dimension, dead.location, DRUID_STAFFS[i]);
      }
    }
  });

  // trail + lifetime. The burst is normally fired from the hit events (they know
  // the exact impact point); this only catches projectiles that vanish without
  // one, so it waits a tick and then predicts one step ahead of the last sample.
  system.runInterval(() => {
    if (inflight.size === 0) return;
    for (const [id, t] of inflight) {
      const e = world.getEntity(id);
      if (!e) {
        if (!t.missing) {
          t.missing = true;
          continue;
        }
        burstAt(t.dimension, t.particle,
          { x: t.loc.x + t.vel.x, y: t.loc.y + t.vel.y, z: t.loc.z + t.vel.z });
        inflight.delete(id);
        continue;
      }
      t.missing = false;
      if (++t.age > MAX_AGE) {
        try { e.remove(); } catch { /* ignore */ }
        inflight.delete(id);
        continue;
      }
      t.loc = e.location;
      t.dimension = e.dimension;
      try { t.vel = e.getVelocity(); } catch { /* ignore */ }
      const info = PARTICLES[t.particle];
      if (info) {
        try { e.dimension.spawnParticle(info.trail, e.location); } catch { /* ignore */ }
      }
    }
  }, 1);
}
