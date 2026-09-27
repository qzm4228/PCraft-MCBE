// P3/P4 vore core: swallow -> struggle (native input) -> digest -> release/death.
//
// Struggle input uses native controls (no UI, view stays free):
//   Jump  = up, Sneak = down, strafe Left/Right = left/right
// (Bedrock addons cannot register keybinds and inventory-UI buttons cannot call
//  scripts, so native input is the only non-blocking option on stable APIs.)
import { world, system, EntityDamageCause } from "@minecraft/server";
import { assignSkin, playAnim, getNum, setNum, localId } from "../skin/assign.js";
import { getCfg } from "../game/config.js";
import { addWgProgress } from "../game/wg.js";
import { newPrompt, pressDir, labelFor, animFor, DIRS } from "./struggle.js";

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
  "pcraftrevorn:vinemaiden", "pcraftrevorn:zombie", "pcraftrevorn:scarecrow",
  "pcraftrevorn:rabbit_wizard", "pcraftrevorn:piglin_royal_knight"
]);
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
// rabbit_wizard / scarecrow have weight-gain-specific digest animations
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
  // show the prey bulge for the whole swallowed state (no delay)
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
    msgTimer: 0
  };
  sessions.set(pid, session);
  assignSkin(predator, true);
  setNum(predator, "pc:full", 1);
  try { predator.triggerEvent("pcraftrevorn:on_swallow"); } catch { /* ignore */ }
  try { player.setDynamicProperty("pc:pred", predator.id); } catch { /* ignore */ }

  setThirdPerson(player, true);
  safeEffect(player, "invisibility", 40, 0, false);
  safeEffect(player, "resistance", 60, 4);
  try { player.onScreenDisplay.setTitle("§4被吞入", { fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 10 }); } catch { /* ignore */ }
  player.sendMessage("§4[掠食者] §c你被吞入腹中！§7按提示用 §f跳跃/潜行/左右移动 §7方向挣扎。§8(/scriptevent pcraftrevorn:release 脱身)");

  spawnBar(player, session);
  prepareRide(player, predator, session);
  playAnim(predator, "swallow");
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

    session.animTimer = (session.animTimer + 1) % CONFIG.digestAnimInterval;
    if (session.animTimer === 0 && !session.awaiting) playAnim(pred, digestSuffix(pred));

    // struggle prompt scheduling
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

export function wireVoreEvents() {
  system.runInterval(digestTick, 1);

  world.afterEvents.entityHurt.subscribe((ev) => {
    const predator = ev.damageSource?.damagingEntity;
    const victim = ev.hurtEntity;
    if (!predator || !victim) return;
    if (victim.typeId !== "minecraft:player") return;
    if (!isPredator(predator)) return;
    if (sessions.has(victim.id)) return;
    const chance = getNum(predator, "pc:swallow", (getCfg(victim).swallow ?? 25) / 100);
    if (Math.random() > chance) return;
    startSwallow(victim, predator);
  });

  world.afterEvents.entityDie.subscribe((ev) => {
    const dead = ev.deadEntity;
    if (dead?.typeId === "minecraft:player" && sessions.has(dead.id)) {
      const s = sessions.get(dead.id);
      if (s) { s.alive = false; removeBar(s); }
      sessions.delete(dead.id);
      try { dead.camera?.clear?.(); } catch { /* ignore */ }
    }
  });
}

export { sessions };
