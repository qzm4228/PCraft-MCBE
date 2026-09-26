// P3/P4 vore core: swallow -> struggle -> digest -> regurgitate/death.
// Ported from MobEatPlayerProcedure / EntitySwallowHandlerProcedure /
// Struggle*Procedure (keybinds replaced by form buttons).
import { world, system, EntityDamageCause } from "@minecraft/server";
import { showPcForm } from "../ui/forms.js";
import { assignSkin, playAnim, getNum, setNum } from "../skin/assign.js";
import { newPrompt, pressDir, labelFor, DIRS } from "./struggle.js";
import { getCfg } from "../game/config.js";
import { addWgProgress } from "../game/wg.js";

export const CONFIG = {
  swallowChance: 0.35,
  digestTicksToKill: 1600,
  acidRate: 0.5,
  acidRateMax: 4,
  acidIncr: 0.01,
  struggleReduction: 25,
  strugglesNeeded: 6,
  maxLevel: 15,
  bellyFraction: 0.35,
  struggleDifficulty: 0.4,   // chance a prompt needs a 2-direction combo
  struggleTimer: 60,         // ticks allowed per prompt
  promptCooldownMin: 30,
  promptCooldownMax: 80
};

const sessions = new Map(); // playerId -> session

const wait = (ticks) =>
  new Promise((resolve) => (ticks > 0 ? system.runTimeout(resolve, ticks) : resolve()));

const isPredator = (entity) => {
  try { return entity?.matches({ family: "predator" }) ?? false; } catch { return false; }
};
export { isPredator };

const resolvePredator = (session) => {
  try { return world.getEntity(session.predatorId); } catch { return undefined; }
};

const safeEffect = (player, id, ticks, amp = 0, particles = false) => {
  try { player.addEffect(id, ticks, { amplifier: amp, showParticles: particles }); } catch { /* ignore */ }
};
const clearEffects = (player) => {
  for (const id of ["slowness", "weakness", "nausea", "blindness"]) {
    try { player.removeEffect(id); } catch { /* ignore */ }
  }
};

const levelOf = (s) => Math.max(0, Math.min(CONFIG.maxLevel, Math.floor((s.digest / s.maxTimer) * CONFIG.maxLevel)));

function lockTo(player, session) {
  const pred = resolvePredator(session);
  if (!pred) return false;
  try {
    player.teleport(pred.location, { dimension: pred.dimension, rotation: player.getRotation() });
  } catch { /* chunk not loaded */ }
  return true;
}

function refreshBelly(session) {
  const pred = resolvePredator(session);
  if (!pred) return;
  const belly = session.digest / session.maxTimer >= CONFIG.bellyFraction;
  const want = belly ? 1 : 0;
  if (getNum(pred, "pc:full") !== want) {
    setNum(pred, "pc:full", want);
    assignSkin(pred, belly);
  }
}

function rollCooldown() {
  return CONFIG.promptCooldownMin + Math.floor(Math.random() * (CONFIG.promptCooldownMax - CONFIG.promptCooldownMin));
}

export function startSwallow(player, predator) {
  const pid = player.id;
  if (sessions.has(pid)) return;
  const session = {
    predatorId: predator.id,
    digest: 0,
    maxTimer: CONFIG.digestTicksToKill,
    rate: CONFIG.acidRate,
    rateMax: CONFIG.acidRateMax,
    incr: CONFIG.acidIncr,
    struggles: 0,
    needed: CONFIG.strugglesNeeded,
    level: 0,
    alive: true,
    awaiting: false,
    required: [],
    pressed: new Set(),
    promptTick: 0,
    promptTimer: CONFIG.struggleTimer,
    cooldown: 30,
    difficulty: CONFIG.struggleDifficulty,
    anim: "struggleup"
  };
  sessions.set(pid, session);
  const cfg = getCfg(player);
  session.difficulty = (cfg.difficulty ?? 40) / 100;
  session.promptTimer = cfg.timer ?? CONFIG.struggleTimer;
  assignSkin(predator, false);
  setNum(predator, "pc:full", 0);
  try { player.setDynamicProperty("pc:pred", predator.id); } catch { /* ignore */ }

  safeEffect(player, "slowness", CONFIG.digestTicksToKill, 3);
  safeEffect(player, "weakness", CONFIG.digestTicksToKill, 1);
  safeEffect(player, "nausea", 200, 0);
  try { player.onScreenDisplay.setTitle("§4被吞入", { fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 10 }); } catch { /* ignore */ }
  player.sendMessage("§4[掠食者] §c你被吞入腹中！按提示选择正确方向挣扎。");

  lockTo(player, session);
  playAnim(predator, "swallow");
  void runStomachLoop(player, session);
}

function stomachBody(s) {
  const pct = Math.round((s.digest / s.maxTimer) * 100);
  const bars = Math.min(CONFIG.maxLevel, Math.floor(pct / (100 / CONFIG.maxLevel)));
  const lines = [
    `§7消化进度：§c${pct}%`,
    `§7挣扎成功：§f${s.struggles}/${s.needed}`,
    `§8${"█".repeat(bars)}${"░".repeat(Math.max(0, CONFIG.maxLevel - bars))}`
  ];
  if (s.awaiting) {
    const left = Math.max(0, Math.ceil((s.promptTick + s.promptTimer - system.currentTick) / 20));
    lines.push("", `§e要按方向：§f${labelFor(s.required)}§7  （§c剩余 ${left}s§7）`);
  } else {
    lines.push("", "§8等待下一次挣扎时机……");
  }
  return lines.join("\n");
}

async function runStomachLoop(player, session) {
  while (session.alive && sessions.get(player.id) === session) {
    const res = await showPcForm(player, {
      title: "被吞入",
      body: stomachBody(session),
      level: session.level,
      buttons: [
        { id: "up", label: "§f↑ §7向上挣扎" },
        { id: "down", label: "§f↓ §7向下挣扎" },
        { id: "left", label: "§f← §7向左挣扎" },
        { id: "right", label: "§f→ §7向右挣扎" }
      ]
    });

    if (!session.alive || sessions.get(player.id) !== session) break;
    if (res.canceled) { await wait(10); continue; }
    if (!res.id || !DIRS.includes(res.id)) continue;

    const pred = resolvePredator(session);
    const outcome = pressDir(session, res.id, system.currentTick);

    if (outcome.result === "success") {
      session.struggles += 1;
      session.digest = Math.max(0, session.digest - CONFIG.struggleReduction);
      session.level = levelOf(session);
      playAnim(pred, outcome.anim ?? "struggleup");
      player.sendMessage(`§a[挣扎] §f成功！§7(${session.struggles}/${session.needed})`);
      if (session.struggles >= session.needed && session.digest <= 0) { release(player, true); break; }
    } else if (outcome.result === "partial") {
      playAnim(pred, outcome.anim ?? `struggle${res.id}`);
      player.sendMessage(`§7[挣扎] 已按 §f${res.id}§7，继续！`);
    } else if (outcome.result === "fail") {
      playAnim(pred, "strugglefail");
      session.digest += 15;
      player.sendMessage("§c[挣扎] 方向错误或太慢，失败！");
    }
  }
}

export function release(player, regurgitate) {
  const pid = player.id;
  const session = sessions.get(pid);
  if (session) session.alive = false;
  sessions.delete(pid);
  try { player.setDynamicProperty("pc:pred", ""); } catch { /* ignore */ }
  clearEffects(player);

  const pred = session ? resolvePredator(session) : undefined;
  if (pred) {
    setNum(pred, "pc:full", 0);
    assignSkin(pred, false);
  }

  if (regurgitate) {
    safeEffect(player, "regeneration", 80, 1);
    player.sendMessage("§a你挣脱了，从胃袋里滑了出来。");
  } else {
    player.sendMessage("§7[掠食者] §e你被放了出来。");
  }
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

    lockTo(player, session);
    session.digest += session.rate;
    if (session.rate < session.rateMax) session.rate += session.incr;
    session.level = levelOf(session);
    refreshBelly(session);

    // struggle prompt scheduling
    if (session.awaiting) {
      if (now - session.promptTick > session.promptTimer) {
        session.awaiting = false;
        playAnim(pred, "strugglefail");
      }
    } else if (session.cooldown > 0) {
      session.cooldown -= 1;
    } else {
      const anim = newPrompt(session, now, session.difficulty, session.promptTimer);
      playAnim(pred, anim);
      session.cooldown = rollCooldown();
    }

    if (session.digest >= session.maxTimer) {
      session.alive = false;
      sessions.delete(pid);
      try { player.setDynamicProperty("pc:pred", ""); } catch { /* ignore */ }
      clearEffects(player);
      addWgProgress(pred, 1);
      try { player.applyDamage(9999, { cause: EntityDamageCause.magic, damagingEntity: pred }); } catch { /* ignore */ }
    }
  }
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
    const chance = (getCfg(victim).swallow ?? 25) / 100;
    if (Math.random() > chance) return;
    startSwallow(victim, predator);
  });

  world.afterEvents.entityDie.subscribe((ev) => {
    const dead = ev.deadEntity;
    if (dead?.typeId === "minecraft:player" && sessions.has(dead.id)) {
      const s = sessions.get(dead.id);
      if (s) s.alive = false;
      sessions.delete(dead.id);
    }
  });
}

export { sessions };
