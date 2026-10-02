// P3/P4 vore core: swallow -> struggle (native input) -> digest -> release/death.
//
// Struggle input uses native controls (no UI, view stays free):
//   Jump  = up, Sneak = down, strafe Left/Right = left/right
// (Bedrock addons cannot register keybinds and inventory-UI buttons cannot call
//  scripts, so native input is the only non-blocking option on stable APIs.)
import { world, system, EntityDamageCause, EquipmentSlot } from "@minecraft/server";
import { assignSkin, playAnim, getNum, setNum, localId } from "../skin/assign.js";
import { getCfg } from "../game/config.js";
import { addWgProgress } from "../game/wg.js";
import { newPrompt, pressDir, labelFor, animFor, DIRS } from "./struggle.js";
import { COMMUNITY } from "../data/community.js";

export const CONFIG = {
  digestTicksToKill: 3000,
  acidRate: 0.5,
  acidRateMax: 4,
  acidIncr: 0.01,
  maxLevel: 15,
  bellyFraction: 0.35,
  lockDistance: 4,
  digestAnimInterval: 60,
  slowRefresh: 40,
  struggleDifficulty: 0.4,
  struggleTimer: 90,
  promptCooldownMin: 30,
  promptCooldownMax: 80,
  struggleReduction: 25,
  strugglesNeeded: 6,
  failPenalty: 15
};

const sessions = new Map(); // playerId -> session

const PREDATORS = new Set([
  "pcraftrevorn:basaltmite", "pcraftrevorn:gilded_basaltmite", "pcraftrevorn:silverfish",
  "pcraftrevorn:vinemaiden", "pcraftrevorn:zombie", "pcraftrevorn:bibaso_zombie", "pcraftrevorn:scarecrow",
  "pcraftrevorn:rabbit_wizard", "pcraftrevorn:piglin_royal_knight"
]);
for (const id of COMMUNITY.predatorIds ?? []) PREDATORS.add(`pcraftrevorn:${id}`);
const isPredator = (entity) => !!entity && PREDATORS.has(entity.typeId);
export { isPredator };

const resolvePredator = (session) => {
  try { return world.getEntity(session.predatorId); } catch { return undefined; }
};

const safeEffect = (player, id, ticks, amp = 0, particles = false) => {
  try { player.addEffect(id, ticks, { amplifier: amp, showParticles: particles }); } catch { /* ignore */ }
};
const clearEffects = (player) => {
  for (const id of ["slowness", "weakness", "nausea", "blindness", "invisibility"]) {
    try { player.removeEffect(id); } catch { /* ignore */ }
  }
};

const levelOf = (s) => Math.max(0, Math.min(CONFIG.maxLevel, Math.floor((s.digest / s.maxTimer) * CONFIG.maxLevel)));
// belly texture is only applied after the swallow AND the first digest animation
const SWALLOW_TICKS = { rabbit_wizard: 108, scarecrow: 105 };
const DIGEST_TICKS = { rabbit_wizard: 133, scarecrow: 147 };
const swallowTicks = (pred) => SWALLOW_TICKS[localId(pred.typeId)] ?? 80;
const digestTicks = (pred) => DIGEST_TICKS[localId(pred.typeId)] ?? 140;
// rabbit_wizard / scarecrow have weight-gain-specific swallow/digest animations
const digestSuffix = (pred) => {
  const id = localId(pred.typeId);
  if (id === "rabbit_wizard") {
    const wg = getNum(pred, "pc:wg");
    if (wg >= 2) return "digestWG2";
    if (wg === 1) return "digestWG1";
    return "digest";
  }
  if (id === "scarecrow") {
    // scarecrow has no base digest animation
    return getNum(pred, "pc:wg") >= 2 ? "digestWG2" : "digestWG1";
  }
  return "digest";
};
const swallowSuffix = (pred) => {
  const id = localId(pred.typeId);
  if (id === "rabbit_wizard" || id === "scarecrow") {
    const wg = getNum(pred, "pc:wg");
    if (wg >= 2) return "swallowWG2";
    if (wg === 1) return "swallowWG1";
  }
  return "swallow";
};
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

function lockTo(player, session) {
  const pred = resolvePredator(session);
  if (!pred) return false;
  try {
    // teleport onto the predator every tick; do NOT pass rotation so the player
    // can still look around freely (passing rotation snapped/locked the camera)
    player.teleport(pred.location, { dimension: pred.dimension });
  } catch { /* ignore */ }
  return true;
}

const BAR_ID = "pcraftrevorn:digestion_bar";
function spawnBar(player, session) {
  try {
    const bar = player.dimension.spawnEntity(BAR_ID, player.location);
    bar.nameTag = "§c消化进度";
    const hp = bar.getComponent("minecraft:health");
    if (hp) hp.setCurrentValue(1);
    session.barId = bar.id;
  } catch { /* ignore */ }
}
function updateBar(player, session) {
  if (!session.barId) return;
  let bar;
  try { bar = world.getEntity(session.barId); } catch { bar = undefined; }
  if (!bar) { session.barId = undefined; return; }
  try {
    bar.teleport(player.location, { dimension: player.dimension });
    const pct = Math.max(1, Math.min(100, Math.round((session.digest / session.maxTimer) * 100)));
    const hp = bar.getComponent("minecraft:health");
    if (hp) hp.setCurrentValue(pct);
  } catch { /* ignore */ }
}
function removeBar(session) {
  if (!session?.barId) return;
  try { world.getEntity(session.barId)?.remove(); } catch { /* ignore */ }
  session.barId = undefined;
}

// Tag the predator once; the actual ride is attempted every tick (see digestTick)
// because component-group changes apply one tick later.
function prepareRide(player, predator, session) {
  try {
    session.rideTag = "pc_ride_" + player.id.replace(/[^a-zA-Z0-9_]/g, "");
    predator.addTag(session.rideTag);
  } catch { session.rideTag = undefined; }
}
function tryRide(player, session) {
  if (!session.rideTag) return;
  try { player.runCommand(`ride @s start_riding @e[tag=${session.rideTag},c=1]`); } catch { /* already riding / not yet rideable */ }
}
function dismount(player, session) {
  try { player.runCommand("ride @s stop_riding"); } catch { /* ignore */ }
  if (session?.rideTag) {
    const pred = resolvePredator(session);
    try { pred?.removeTag(session.rideTag); } catch { /* ignore */ }
    session.rideTag = undefined;
  }
}

function setThirdPerson(player, on) {
  try { if (on) player.camera.setCamera("minecraft:third_person"); else player.camera.clear(); } catch { /* ignore */ }
}

function refreshBelly(session) {
  const pred = resolvePredator(session);
  if (!pred) return;
  // wait for the swallow animation to finish before showing the prey bulge
  if (system.currentTick < session.bellyAt) {
    if (getNum(pred, "pc:full") !== 0) { setNum(pred, "pc:full", 0); assignSkin(pred, false); }
    return;
  }
  if (getNum(pred, "pc:full") !== 1) { setNum(pred, "pc:full", 1); assignSkin(pred, true); }
}

const pressed = (state) => String(state) === "Pressed";

/** Returns a direction if the player just pressed a native input this tick. */
function readInput(player, session) {
  let info;
  try { info = player.inputInfo; } catch { return undefined; }
  if (!info) return undefined;
  let jump = false, sneak = false, strafe = 0;
  try {
    jump = pressed(info.getButtonState("Jump"));
    sneak = pressed(info.getButtonState("Sneak"));
    const mv = info.getMovementVector();
    strafe = mv.x;
  } catch { return undefined; }

  let dir;
  if (jump && !session.prevJump) dir = "up";
  else if (sneak && !session.prevSneak) dir = "down";
  else if (strafe > 0.5 && !(session.prevStrafe > 0.5)) dir = "right";
  else if (strafe < -0.5 && !(session.prevStrafe < -0.5)) dir = "left";

  session.prevJump = jump;
  session.prevSneak = sneak;
  session.prevStrafe = strafe;
  return dir;
}

function promptBar(session) {
  const left = Math.max(0, Math.ceil((session.promptTick + session.promptTimer - system.currentTick) / 20));
  return `§e按要求按键：§f${labelFor(session.required)} §7(${left}s)  §8[跳=↑ 潜=↓ 左右移=←→]`;
}

function handlePress(player, session, dir, pred, now) {
  const outcome = pressDir(session, dir, now);
  if (outcome.result === "success") {
    session.struggles += 1;
    session.digest = Math.max(0, session.digest - CONFIG.struggleReduction);
    session.level = levelOf(session);
    playAnim(pred, outcome.anim ?? "struggleup");
    if (session.struggles >= session.needed && session.digest <= 0) { release(player, true); return true; }
  } else if (outcome.result === "partial") {
    playAnim(pred, outcome.anim ?? animFor([dir]));
  } else if (outcome.result === "fail") {
    playAnim(pred, "strugglefail");
    session.digest += CONFIG.failPenalty;
  }
  return false;
}

export function startSwallow(player, predator) {
  const pid = player.id;
  if (sessions.has(pid)) return;
  const cfg = getCfg(player);
  const session = {
    predatorId: predator.id,
    digest: 0,
    maxTimer: 12000, // PCraftGeneralConfiguration DIGESTIONGOAL
    rate: getNum(predator, "pc:acid", 2.0),
    rateMax: getNum(predator, "pc:acidMax", 15),
    incr: getNum(predator, "pc:acidIncr", 0.02),
    level: 0,
    alive: true,
    slowTimer: 0,
    animTimer: 0,
    awaiting: false,
    required: [],
    pressed: new Set(),
    promptTick: 0,
    promptTimer: cfg.timer ?? CONFIG.struggleTimer,
    cooldown: 20,
    difficulty: getNum(predator, "pc:difficulty", 0.3),
    struggles: 0,
    needed: getNum(predator, "pc:struggles", 7),
    digestKey: "digest",
    prevJump: false,
    prevSneak: false,
    prevStrafe: 0,
    msgTimer: 0,
    bellyAt: 0,
    swallowEndAt: 0,
    digestPlayed: false
  };
  sessions.set(pid, session);
  assignSkin(predator, false);
  setNum(predator, "pc:full", 0);
  const now0 = system.currentTick;
  session.swallowEndAt = now0 + swallowTicks(predator);
  // belly bulge shows 1 second (20 ticks) after the swallow starts
  session.bellyAt = now0 + 20;
  try { predator.triggerEvent("pcraftrevorn:on_swallow"); } catch { /* ignore */ }
  try { player.setDynamicProperty("pc:pred", predator.id); } catch { /* ignore */ }

  setThirdPerson(player, true);
  safeEffect(player, "invisibility", 40, 0, false);
  safeEffect(player, "resistance", 60, 4);
  try { player.onScreenDisplay.setTitle("§4被吞入", { fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 10 }); } catch { /* ignore */ }
  player.sendMessage("§4[掠食者] §c你被吞入腹中！§7按提示用 §f跳跃/潜行/左右移动 §7方向挣扎。§8(/scriptevent pcraftrevorn:release 脱身)");

  spawnBar(player, session);
  prepareRide(player, predator, session);
  playAnim(predator, swallowSuffix(predator));
}

function digestTick() {
  if (sessions.size === 0) return;
  const now = system.currentTick;
  for (const [pid, session] of sessions) {
    if (!session.alive) { sessions.delete(pid); continue; }
    const player = world.getAllPlayers().find((p) => p.id === pid);
    if (!player) { sessions.delete(pid); continue; }
    const pred = resolvePredator(session);
    if (!pred) { release(player, false); continue; }

    tryRide(player, session); // retry every tick (component-group change applies one tick later)
    if (dist2(player.location, pred.location) > 24 * 24) lockTo(player, session); // fallback if riding fails
    updateBar(player, session);

    session.slowTimer = (session.slowTimer + 1) % 20;
    if (session.slowTimer === 0) { safeEffect(player, "invisibility", 40, 0, false); safeEffect(player, "resistance", 60, 4); }

    // digestion
    session.digest += session.rate;
    if (session.rate < session.rateMax) session.rate += session.incr;
    session.level = levelOf(session);
    refreshBelly(session);

    // swallow animation -> one digest animation -> then belly texture appears
    if (!session.digestPlayed && now >= session.swallowEndAt) {
      playAnim(pred, digestSuffix(pred));
      session.digestPlayed = true;
    }
    session.animTimer = (session.animTimer + 1) % CONFIG.digestAnimInterval;
    if (session.digestPlayed && session.animTimer === 0 && !session.awaiting && now >= session.bellyAt) playAnim(pred, digestSuffix(pred));

    // struggle only starts after the swallow animation has finished
    if (now >= session.swallowEndAt) {
      if (session.awaiting) {
        if (now - session.promptTick > session.promptTimer) {
          session.awaiting = false;
          playAnim(pred, "strugglefail");
        } else {
          const dir = readInput(player, session);
          if (dir && handlePress(player, session, dir, pred, now)) continue;
        }
        session.msgTimer = (session.msgTimer + 1) % 10;
        if (session.msgTimer === 0) { try { player.onScreenDisplay.setActionBar(promptBar(session)); } catch { /* ignore */ } }
      } else {
        readInput(player, session); // keep edge state fresh
        if (session.cooldown > 0) {
          session.cooldown -= 1;
        } else {
          playAnim(pred, newPrompt(session, now, session.difficulty, session.promptTimer));
          session.cooldown = CONFIG.promptCooldownMin + Math.floor(Math.random() * (CONFIG.promptCooldownMax - CONFIG.promptCooldownMin));
        }
      }
    }

    if (session.digest >= session.maxTimer) {
      session.alive = false;
      sessions.delete(pid);
      dismount(player, session);
      removeBar(session);
      try { player.setDynamicProperty("pc:pred", ""); } catch { /* ignore */ }
      clearEffects(player);
      setThirdPerson(player, false);
      addWgProgress(pred, 1);
      setNum(pred, "pc:full", 0);
      assignSkin(pred, false); // after digesting, belly returns to normal (with new WG stage)
      // PCraftGeneralConfiguration: pred recovers 30% max health + belch after digesting
      try {
        const hp = pred.getComponent("minecraft:health");
        if (hp) hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + hp.effectiveMax * 0.3));
      } catch { /* ignore */ }
      try { pred.dimension.playSound("pcraftrevorn.burp", pred.location, { volume: 0.8 }); } catch { /* ignore */ }
      try { collectBelly(pred, player); } catch { /* ignore */ }
      try { player.applyDamage(1000000, { cause: EntityDamageCause.magic, damagingEntity: pred }); } catch { /* ignore */ }
      // safety net: make sure the prey actually dies
      system.runTimeout(() => {
        try {
          const hp = player.getComponent("minecraft:health");
          if (hp && hp.currentValue > 0) player.kill();
        } catch { /* ignore */ }
      }, 5);
    }
  }
}

export function release(player, regurgitate) {
  const pid = player.id;
  const session = sessions.get(pid);
  if (session) session.alive = false;
  sessions.delete(pid);
  dismount(player, session);
  removeBar(session);
  try { player.setDynamicProperty("pc:pred", ""); } catch { /* ignore */ }
  clearEffects(player);
  setThirdPerson(player, false);
  try { player.onScreenDisplay.setActionBar(" "); } catch { /* ignore */ }

  const pred = session ? resolvePredator(session) : undefined;
  if (pred) {
    setNum(pred, "pc:full", 0);
    assignSkin(pred, false);
    try { pred.triggerEvent("pcraftrevorn:on_release"); } catch { /* ignore */ }
  }
  if (regurgitate) safeEffect(player, "regeneration", 80, 1);
  player.sendMessage(regurgitate ? "§a你挣脱了，从胃袋里滑了出来。" : "§7[掠食者] §e你被放了出来。");
}

// ---- belly loot ----
// A digested player's belongings are moved into an invisible container entity
// (pcraftrevorn:belly_storage) instead of dropping on death; food is digested
// (discarded). The stash follows the predator and spills out when it dies.
const BELLY_ENTITY = "pcraftrevorn:belly_storage";
const BELLY_KEY = "pc:belly";   // predator dynamic property -> container entity id
const OWNER_KEY = "pc:owner";   // container dynamic property -> predator entity id
const EQUIP_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];
const DIMENSIONS = ["overworld", "nether", "the_end"];

function validEntity(id) {
  try { return typeof id === "string" && id ? world.getEntity(id) : undefined; } catch { return undefined; }
}
function isFood(item) {
  try { return !!item.getComponent("minecraft:food"); } catch { return false; }
}

/** Gets (or spawns) the predator's belly container. */
function bellyContainer(pred) {
  const existing = validEntity(pred.getDynamicProperty(BELLY_KEY));
  if (existing && existing.typeId === BELLY_ENTITY) return existing;
  let c;
  try { c = pred.dimension.spawnEntity(BELLY_ENTITY, pred.location); } catch { return undefined; }
  try { c.setDynamicProperty(OWNER_KEY, pred.id); } catch { /* ignore */ }
  try { pred.setDynamicProperty(BELLY_KEY, c.id); } catch { /* ignore */ }
  return c;
}

/** Moves the digested player's items into the predator's belly (food is destroyed). */
function collectBelly(pred, player) {
  const inv = bellyContainer(pred)?.getComponent("minecraft:inventory")?.container;
  if (!inv) return; // storage unavailable -> leave items to drop normally
  const pInv = player.getComponent("minecraft:inventory")?.container;
  if (pInv) {
    for (let i = 0; i < pInv.size; i++) {
      let item;
      try { item = pInv.getItem(i); } catch { item = undefined; }
      if (!item) continue;
      if (!isFood(item)) { try { inv.addItem(item); } catch { /* ignore */ } }
      try { pInv.setItem(i, undefined); } catch { /* ignore */ }
    }
  }
  const eq = player.getComponent("minecraft:equippable");
  if (eq) {
    for (const slot of EQUIP_SLOTS) {
      let item;
      try { item = eq.getEquipment(slot); } catch { item = undefined; }
      if (!item) continue;
      if (!isFood(item)) { try { inv.addItem(item); } catch { /* ignore */ } }
      try { eq.setEquipment(slot, undefined); } catch { /* ignore */ }
    }
  }
}

/** Spills a container's contents into the world and removes it. */
function spillBelly(container) {
  const inv = container.getComponent("minecraft:inventory")?.container;
  if (inv) {
    for (let i = 0; i < inv.size; i++) {
      let item;
      try { item = inv.getItem(i); } catch { item = undefined; }
      if (!item) continue;
      try { container.dimension.spawnItem(item, container.location); } catch { /* ignore */ }
      try { inv.setItem(i, undefined); } catch { /* ignore */ }
    }
  }
  try { container.remove(); } catch { /* ignore */ }
}

/** Drops (and clears) the predator's stored belly loot. */
function dropBelly(pred) {
  const c = validEntity(pred.getDynamicProperty(BELLY_KEY));
  if (c && c.typeId === BELLY_ENTITY) spillBelly(c);
  try { pred.setDynamicProperty(BELLY_KEY, ""); } catch { /* ignore */ }
}

/** Keeps each belly container on its predator; spills orphans (owner gone). */
function followBelly() {
  for (const dimId of DIMENSIONS) {
    let list;
    try { list = world.getDimension(dimId).getEntities({ families: ["belly_storage"] }); } catch { continue; }
    for (const c of list) {
      const owner = validEntity(c.getDynamicProperty(OWNER_KEY));
      if (owner) { try { c.teleport(owner.location, { dimension: owner.dimension }); } catch { /* ignore */ } }
      else spillBelly(c);
    }
  }
}

// ---- mob vore mob ----
// Predators can also swallow non-player mobs (simplified port of MobEatMob):
// the prey is tethered inside the predator, digested over time, then killed and
// the predator gains weight + recovers health. State is kept per predator.
const mobSessions = new Map(); // predatorId -> session
const MOB_PREY_TAG = "pc_mobprey";

function isPreyMob(e) {
  if (!e) return false;
  const t = e.typeId;
  if (t === "minecraft:player" || t === BELLY_ENTITY || t === "pcraftrevorn:digestion_bar") return false;
  if (isPredator(e)) return false;
  try { return !!e.getComponent("minecraft:health"); } catch { return false; }
}
function predatorBusy(predId) {
  if (mobSessions.has(predId)) return true;
  for (const s of sessions.values()) if (s.predatorId === predId) return true;
  return false;
}

function startMobSwallow(pred, prey) {
  const pid = pred.id;
  if (mobSessions.has(pid) || predatorBusy(pid)) return;
  const now = system.currentTick;
  mobSessions.set(pid, {
    predatorId: pid,
    preyId: prey.id,
    digest: 0,
    maxTimer: 12000,
    rate: getNum(pred, "pc:acid", 2.0),
    rateMax: getNum(pred, "pc:acidMax", 15),
    incr: getNum(pred, "pc:acidIncr", 0.02),
    swallowEndAt: now + swallowTicks(pred),
    bellyAt: now + 20,
    digestPlayed: false,
    animTimer: 0
  });
  try { prey.addTag(MOB_PREY_TAG); } catch { /* ignore */ }
  assignSkin(pred, false);
  setNum(pred, "pc:full", 0);
  playAnim(pred, swallowSuffix(pred));
  try { pred.triggerEvent("pcraftrevorn:on_swallow"); } catch { /* ignore */ }
}

function endMobSession(pid) { mobSessions.delete(pid); }

function mobDigestTick() {
  if (mobSessions.size === 0) return;
  const now = system.currentTick;
  for (const [pid, s] of mobSessions) {
    const pred = validEntity(pid);
    const prey = validEntity(s.preyId);
    if (!pred || !prey) {
      endMobSession(pid, false);
      if (prey) { try { prey.removeTag(MOB_PREY_TAG); } catch { /* ignore */ } try { prey.removeEffect("invisibility"); } catch { /* ignore */ } }
      if (pred) { setNum(pred, "pc:full", 0); assignSkin(pred, false); }
      continue;
    }

    // keep the prey tucked inside the predator (invisible + protected)
    try { prey.teleport(pred.location, { dimension: pred.dimension }); } catch { /* ignore */ }
    safeEffect(prey, "invisibility", 20, 0, false);
    safeEffect(prey, "resistance", 20, 4, false);

    s.digest += s.rate;
    if (s.rate < s.rateMax) s.rate += s.incr;

    if (now >= s.bellyAt && getNum(pred, "pc:full") !== 1) { setNum(pred, "pc:full", 1); assignSkin(pred, true); }
    if (!s.digestPlayed && now >= s.swallowEndAt) { playAnim(pred, digestSuffix(pred)); s.digestPlayed = true; }
    s.animTimer = (s.animTimer + 1) % CONFIG.digestAnimInterval;
    if (s.digestPlayed && s.animTimer === 0) playAnim(pred, digestSuffix(pred));

    if (s.digest >= s.maxTimer) {
      endMobSession(pid, true);
      try { prey.removeTag(MOB_PREY_TAG); } catch { /* ignore */ }
      addWgProgress(pred, 1);
      setNum(pred, "pc:full", 0);
      assignSkin(pred, false);
      try {
        const hp = pred.getComponent("minecraft:health");
        if (hp) hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + hp.effectiveMax * 0.3));
      } catch { /* ignore */ }
      try { pred.dimension.playSound("pcraftrevorn.burp", pred.location, { volume: 0.8 }); } catch { /* ignore */ }
      try { prey.kill(); } catch { try { prey.remove(); } catch { /* ignore */ } }
    }
  }
}

// Occasional passive hunt so predators actually eat nearby mobs.
function mobHuntTick() {
  for (const dimId of DIMENSIONS) {
    let preds;
    try { preds = world.getDimension(dimId).getEntities({ families: ["predator"] }); } catch { continue; }
    for (const pred of preds) {
      if (predatorBusy(pred.id)) continue;
      let prey;
      try {
        prey = pred.dimension.getEntities({
          location: pred.location,
          maxDistance: 3.5,
          closest: 1,
          excludeFamilies: ["predator"],
          excludeTypes: ["minecraft:player", BELLY_ENTITY, "pcraftrevorn:digestion_bar"]
        })[0];
      } catch { prey = undefined; }
      if (!prey || !isPreyMob(prey) || prey.hasTag(MOB_PREY_TAG)) continue;
      if (Math.random() > getNum(pred, "pc:swallow", 0.25) * 0.1) continue;
      startMobSwallow(pred, prey);
    }
  }
}

export function wireVoreEvents() {
  system.runInterval(digestTick, 1);
  system.runInterval(mobDigestTick, 1);
  system.runInterval(followBelly, 5);
  system.runInterval(mobHuntTick, 40);



  world.afterEvents.entityHurt.subscribe((ev) => {
    const predator = ev.damageSource?.damagingEntity;
    const victim = ev.hurtEntity;
    if (!predator || !victim) return;
    if (!isPredator(predator)) return;
    // don't (re)swallow something already dying from digestion
    try { if ((victim.getComponent("minecraft:health")?.currentValue ?? 1) <= 0) return; } catch { /* ignore */ }
    // VCraft: a target already being swallowed/digested can't be preyed on again
    try { if (victim.hasTag("vcraft_prey") || victim.hasTag("vcraft_pprey") || victim.hasTag("vore_digesting")) return; } catch { /* ignore */ }

    if (victim.typeId === "minecraft:player") {
      if (sessions.has(victim.id)) return;
      const chance = getNum(predator, "pc:swallow", (getCfg(victim).swallow ?? 25) / 100);
      if (Math.random() > chance) return;
      startSwallow(victim, predator);
      return;
    }

    // mob prey
    if (!isPreyMob(victim) || predatorBusy(predator.id) || victim.hasTag(MOB_PREY_TAG)) return;
    if (Math.random() > getNum(predator, "pc:swallow", 0.25)) return;
    startMobSwallow(predator, victim);
  });

  world.afterEvents.entityDie.subscribe((ev) => {
    const dead = ev.deadEntity;
    if (dead && isPredator(dead)) {
      try { dropBelly(dead); } catch { /* ignore */ }
      if (mobSessions.has(dead.id)) {
        const ms = mobSessions.get(dead.id);
        const prey = validEntity(ms.preyId);
        endMobSession(dead.id);
        if (prey) {
          try { prey.removeTag(MOB_PREY_TAG); } catch { /* ignore */ }
          try { prey.removeEffect("invisibility"); } catch { /* ignore */ }
        }
      }
    }
    if (dead?.typeId === "minecraft:player" && sessions.has(dead.id)) {
      const s = sessions.get(dead.id);
      if (s) { s.alive = false; removeBar(s); }
      sessions.delete(dead.id);
      try { dead.camera?.clear?.(); } catch { /* ignore */ }
    }
  });
}

export { sessions };
