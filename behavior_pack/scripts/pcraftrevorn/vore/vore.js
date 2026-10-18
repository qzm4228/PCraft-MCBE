// P3/P4 vore core: swallow -> struggle (hotbar keys) -> digest -> release/death.
//
// Struggle input is item based: on swallow the prey's whole carried inventory
// (36 slots + armour + offhand) is stashed slot-for-slot and four locked,
// undiscardable "struggle key" items are placed in hotbar slots 0..3 -- one per
// direction. The prey escapes by *using* the direction key the prompt asks for.
// (Bedrock addons cannot register keybinds and inventory-UI buttons cannot call
//  scripts, so server-watched item use is the only reliable interaction.)
//
// The on-screen HUD (acid bar + direction arrows) is drawn by JSON-UI from two
// things the game already exposes per boss bar: the digestion-bar entity's health
// (the bar fill) and its nameTag (the struggle state bus, see constants.js).
import { world, system, EntityDamageCause, EquipmentSlot } from "@minecraft/server";
import { assignSkin, playAnim, getNum, setNum, localId } from "../skin/assign.js";
import { getCfg } from "../game/config.js";
import { addWgProgress } from "../game/wg.js";
import { newPrompt, pressDir, failPrompt, animFor, allOff } from "./struggle.js";
import {
  dirOfItem, giveStruggleItems, ensureStruggleItems,
  clearStruggleItems, stashInventory, unstashInventory, isStruggleItem,
  STASH_ENTITY, STASH_KEY
} from "./prey_items.js";
import { buildHudBus, hudMarker } from "../constants.js";
import { COMMUNITY } from "../data/community.js";
import { VCM } from "../data/vcm.js";

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
  // struggle prompts: the original asks every 40-100 ticks inside a 60 tick window.
  // Item input costs the prey an extra tap, so the base window is 80 ticks and the
  // difficulty settings tighten it (defaults land back on ~59 = the source window).
  struggleTimer: 80,
  struggleTimerMin: 40,
  promptCooldownMin: 40,
  promptCooldownMax: 100,
  // a successful struggle also churns the acid back down; enough of them and the
  // predator throws the prey back up
  struggleReduction: 25,
  failPenalty: 15,
  // passive hunt: how far a predator looks for a mob to eat, and how strongly the
  // per-2s roll is weighted by its `pc:swallow` (0..1) chance
  huntRadius: 8,
  huntChance: 0.5
};

const sessions = new Map(); // playerId -> session

// A predator swaps its "aggressive" component group (melee_attack / hurt_by_target /
// nearest_attackable_target) for the rideable-only "prey_holder" group while a meal is
// inside it; only the on_release event swaps it back. So *every* path that ends a meal
// (digested, released, prey logged out / despawned, predator repaired) must fire
// on_release again -- otherwise the predator stays unable to attack and never hunts
// again after its first digestion.
const HELD_TAG = "pc_prey_holder";
function unswallow(pred) {
  if (!pred) return;
  try { pred.removeTag(HELD_TAG); } catch { /* ignore */ }
  try { pred.triggerEvent("pcraftrevorn:on_release"); } catch { /* ignore */ }
}

const PREDATORS = new Set([
  "pcraftrevorn:basaltmite", "pcraftrevorn:gilded_basaltmite", "pcraftrevorn:silverfish",
  "pcraftrevorn:vinemaiden", "pcraftrevorn:zombie", "pcraftrevorn:scarecrow",
  "pcraftrevorn:rabbit_wizard", "pcraftrevorn:piglin_royal_knight"
]);
for (const id of COMMUNITY.predatorIds ?? []) PREDATORS.add(`pcraftrevorn:${id}`);
for (const id of VCM.predatorIds ?? []) PREDATORS.add(`pcraftrevorn:${id}`);
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

// The digestion bar doubles as the HUD channel: the boss bar's fill comes from
// the entity's health and its nameTag carries the struggle state bus that
// hud/pcraftrevorn_hud.json reads back (see constants.js). The bus itself is
// formatting codes only, so it never prints; the readable suffix after it is
// what the plain vanilla bar shows while the custom HUD is disabled.
const BAR_ID = "pcraftrevorn:digestion_bar";
const BAR_SUFFIX = "§7消化中";
const barName = (bus) => bus + BAR_SUFFIX;

/** Per-direction HUD state; the resolved frame lingers briefly before clearing. */
function hudStates(session, now) {
  if (session.awaiting) return session.hud ?? allOff();
  return now < (session.hudUntil ?? 0) ? (session.hud ?? allOff()) : allOff();
}

function spawnBar(player, session) {
  try {
    const bar = player.dimension.spawnEntity(BAR_ID, player.location);
    bar.nameTag = barName(buildHudBus(allOff()));
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
  const now = system.currentTick;
  try {
    bar.teleport(player.location, { dimension: player.dimension });
    const pct = Math.max(1, Math.min(100, Math.round((session.digest / session.maxTimer) * 100)));
    const hp = bar.getComponent("minecraft:health");
    if (hp) hp.setCurrentValue(pct);
    const bus = barName(buildHudBus(hudStates(session, now)));
    if (bar.nameTag !== bus) bar.nameTag = bus;
  } catch { /* ignore */ }
}

function removeBar(session) {
  if (!session?.barId) return;
  try { world.getEntity(session.barId)?.remove(); } catch { /* ignore */ }
  session.barId = undefined;
}

// ---- prey stash ------------------------------------------------------------
// Everything the prey carries is moved into an invisible container (the same
// entity the belly loot uses) so that escaping puts every item back in the slot
// it came from, and a finished digestion can fold the lot into the predator.
function createStash(pred, player) {
  let c;
  try { c = pred.dimension.spawnEntity(STASH_ENTITY, pred.location); } catch { return undefined; }
  try { c.setDynamicProperty(STASH_KEY, player.id); } catch { /* ignore */ }
  return c;
}

function resolveStash(session) {
  const c = validEntity(session?.stashId);
  return c && c.typeId === STASH_ENTITY ? c : undefined;
}

/** Keeps each prey stash on its owner and spills orphans (owner gone). */
function followStash() {
  for (const dimId of DIMENSIONS) {
    let list;
    try { list = world.getDimension(dimId).getEntities({ families: ["belly_storage"] }); } catch { continue; }
    for (const c of list) {
      const preyId = c.getDynamicProperty(STASH_KEY);
      if (!preyId) continue;
      const player = world.getAllPlayers().find((p) => p.id === preyId);
      if (player) { try { c.teleport(player.location, { dimension: player.dimension }); } catch { /* ignore */ } }
      else spillBelly(c);
    }
  }
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

// ---- struggle HUD bus (JSON-UI) --------------------------------------------
// Bedrock exposes exactly one HUD string globally, #hud_title_text_string, so the
// script writes the HUD state into a *title* packet - but the title never shows
// it: ui/pcraftrevorn_hud.json path-patches hud_title_text/title_frame/title with
// a #visible binding that rejects strings starting with "pcr|" (the documented
// way to conditionally hide a title; other packs' titles are untouched).
//
//   "pcr|"                       ASCII gate: hides the title text, enables the HUD
//   + 4 x "§2§r§<hex>§r"         per-direction state (dir*4 + state)
//   + "§7挣脱 §fNN%[ · Ns]"      readable text, drawn by the corner label
const PROMPT_DIRS = ["up", "down", "left", "right"];
// ASCII token; the fixed-width fields after it are sliced by the UI with %.Ns
const BLACK_GATE = "__pcr:";
const PCT_MARKER = BLACK_GATE;

const pad3 = (n) => String(Math.max(0, n | 0)).padStart(3, " ");

/** Escape progress, 0..100 (good struggles out of the required count). */
function strugglePct(session) {
  const need = Math.max(1, session.needed ?? 1);
  return Math.max(0, Math.min(100, Math.round(((session.struggles ?? 0) / need) * 100)));
}

/** Bus string: token + 3 fixed-width numbers + the four direction markers.
 *
 * __pcr:<timer><score><needed><markers>
 * The UI slices the numbers with %.6s/.9s/.12s/.15s (see the hud file), so no
 * variable-length text ever crosses the boundary.
 */
function hudBus(session) {
  const marks = PROMPT_DIRS.map((d) => hudMarker(d, session.hud?.[d] ?? "off")).join("");
  const left = session.awaiting
    ? Math.ceil((session.promptTick + session.promptTimer - system.currentTick) / 20)
    : 0;
  return `${BLACK_GATE}${pad3(left)}${pad3(session.struggles ?? 0)}${pad3(session.needed ?? 0)}${marks}`;
}

function showPrompt(player, session) {
  // The whole HUD rides the action bar (poggy's pattern): the RP replaces
  // hud_actionbar_text, which receives $actionbar_text from the engine, so the
  // arrow and the percentage are drawn there and no /title is involved at all.
  try {
    player.onScreenDisplay.setActionBar(hudBus(session));
  } catch { /* ignore */ }
}

/** Clears the HUD bus (release / escape / death). */
function clearPrompt(player) {
  try { player.onScreenDisplay.setActionBar(" "); } catch { /* ignore */ }
}

/**
 * Reaction window for a struggle prompt, in ticks.
 *
 * `cfg.timer` is the prey's base window; `cfg.difficulty` (player setting) and the
 * predator's `pc:difficulty` (0..1) each tighten it by up to 40 %. The defaults
 * (80 ticks / 40 % / 0.3) land on ~59 ticks -- the original mod's 60 tick window.
 */
function promptWindow(cfg, predator) {
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const playerDiff = clamp01((cfg.difficulty ?? 40) / 100);
  const predDiff = clamp01(getNum(predator, "pc:difficulty", 0.3));
  const base = cfg.timer ?? CONFIG.struggleTimer;
  return Math.max(
    CONFIG.struggleTimerMin,
    Math.round(base * (1 - 0.4 * predDiff) * (1 - 0.4 * playerDiff))
  );
}

/** Feeds one pressed direction into the open prompt. */
function handlePress(player, session, dir, pred, now) {
  const outcome = pressDir(session, dir, now);
  // repaint the subtitle at once so the press feedback (correct/incorrect) shows
  showPrompt(player, session);
  if (outcome.result === "success") {
    session.struggles += 1;
    session.digest = Math.max(0, session.digest - CONFIG.struggleReduction);
    session.level = levelOf(session);
    playAnim(pred, outcome.anim ?? "struggleup");
    // enough good struggles and the predator coughs the prey back up
    if (session.struggles >= session.needed) { release(player, true); return true; }
  } else if (outcome.result === "wrong") {
    // wrong key: the HUD flashes it red and the slip costs acid progress
    playAnim(pred, animFor([dir]));
    session.digest += CONFIG.failPenalty;
  }
  return false;
}

/** Item-use input: the prey used one of the struggle keys. */
export function strugglePress(player, dir) {
  const session = sessions.get(player.id);
  if (!session || !session.awaiting) return false;
  const pred = resolvePredator(session);
  if (!pred) return false;
  return handlePress(player, session, dir, pred, system.currentTick);
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
    promptDir: undefined,
    wrongDirs: new Set(),
    correctDir: undefined,
    hud: allOff(),
    hudUntil: 0,
    promptTick: 0,
    promptTimer: promptWindow(cfg, predator),
    cooldown: 20,
    difficulty: getNum(predator, "pc:difficulty", 0.3),
    struggles: 0,
    needed: getNum(predator, "pc:struggles", 7),
    digestKey: "digest",
    msgTimer: 0,
    bellyAt: 0,
    swallowEndAt: 0,
    digestPlayed: false,
    stashId: undefined
  };
  sessions.set(pid, session);
  assignSkin(predator, false);
  setNum(predator, "pc:full", 0);
  const now0 = system.currentTick;
  session.swallowEndAt = now0 + swallowTicks(predator);
  // belly bulge shows 1 second (20 ticks) after the swallow starts
  session.bellyAt = now0 + 20;
  try { predator.triggerEvent("pcraftrevorn:on_swallow"); } catch { /* ignore */ }
  try { predator.addTag(HELD_TAG); } catch { /* ignore */ }
  try { player.setDynamicProperty("pc:pred", predator.id); } catch { /* ignore */ }

  // Stash everything the prey carries (slot for slot) and hand it the four keys.
  // A failed escape therefore costs it nothing; a completed digestion keeps the lot.
  const stash = createStash(predator, player);
  if (stash && stashInventory(player, stash)) session.stashId = stash.id;
  else { try { stash?.remove(); } catch { /* ignore */ } }
  giveStruggleItems(player);

  setThirdPerson(player, true);
  safeEffect(player, "invisibility", 40, 0, false);
  safeEffect(player, "resistance", 60, 4);
  try { player.onScreenDisplay.setTitle("§r", { subtitle: "§4被吞入", fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 10 }); } catch { /* ignore */ }
  player.sendMessage("§4[掠食者] §c你被吞入腹中！§7看屏幕上的提示，用快捷栏里的 §f方向道具 §7挣扎。§8(/scriptevent pcraftrevorn:release 脱身)");

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
    if (!player) { sessions.delete(pid); unswallow(resolvePredator(session)); continue; }
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
      ensureStruggleItems(player); // keys are locked, but never leave the prey stuck
      // the arrow row + percentage refresh on their own timer so they stay on
      // screen between prompts
      session.msgTimer = (session.msgTimer + 1) % 10;
      if (session.msgTimer === 0) showPrompt(player, session);
      if (session.awaiting) {
        if (now - session.promptTick > session.promptTimer) playAnim(pred, failPrompt(session, now));
      } else if (session.cooldown > 0) {
        session.cooldown -= 1;
      } else {
        playAnim(pred, newPrompt(session, now, session.promptTimer));
        showPrompt(player, session);
        session.cooldown = CONFIG.promptCooldownMin + Math.floor(Math.random() * (CONFIG.promptCooldownMax - CONFIG.promptCooldownMin));
      }
    }

    if (session.digest >= session.maxTimer) {
      session.alive = false;
      sessions.delete(pid);
      dismount(player, session);
      removeBar(session);
      clearPrompt(player);
      try { player.setDynamicProperty("pc:pred", ""); } catch { /* ignore */ }
      clearEffects(player);
      setThirdPerson(player, false);
      addWgProgress(pred, 1);
      setNum(pred, "pc:full", 0);
      assignSkin(pred, false); // after digesting, belly returns to normal (with new WG stage)
      // a finished meal must not leave the predator stuck in `prey_holder`:
      // restore the hunting behaviors so it keeps preying
      unswallow(pred);
      // PCraftGeneralConfiguration: pred recovers 30% max health + belch after digesting
      try {
        const hp = pred.getComponent("minecraft:health");
        if (hp) hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + hp.effectiveMax * 0.3));
      } catch { /* ignore */ }
      try { pred.dimension.playSound("pcraftrevorn.burp", pred.location, { volume: 0.8 }); } catch { /* ignore */ }
      try { collectStash(pred, session, player); } catch { /* ignore */ }
      // VCM ships its own vcm:digestion damage type for the "was digested" death
      // message; Bedrock cannot register damage types, so the closest thing is an
      // entityAttack from the predator ("<prey> was slain by <predator>") instead
      // of the flavourless magic kill this used to be.
      try { player.applyDamage(1000000, { cause: EntityDamageCause.entityAttack, damagingEntity: pred }); } catch { /* ignore */ }
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
  clearPrompt(player);

  // hand the prey its belongings back: keys out first, then the stash, slot for slot
  clearStruggleItems(player);
  const stash = resolveStash(session);
  if (stash) { unstashInventory(player, stash); spillBelly(stash); }

  const pred = session ? resolvePredator(session) : undefined;
  if (pred) {
    setNum(pred, "pc:full", 0);
    assignSkin(pred, false);
    unswallow(pred);
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

/**
 * A finished meal: fold the prey's stashed belongings into the predator's belly
 * store (food is digested, the rest is kept), then remove the keys.
 */
function collectStash(pred, session, player) {
  clearStruggleItems(player);
  const stash = resolveStash(session);
  if (!stash) { collectBelly(pred, player); return; }
  const dst = bellyContainer(pred)?.getComponent("minecraft:inventory")?.container;
  const src = stash.getComponent("minecraft:inventory")?.container;
  if (dst && src) {
    for (let i = 0; i < src.size; i++) {
      let item;
      try { item = src.getItem(i); } catch { item = undefined; }
      if (!item) continue;
      if (!isFood(item)) { try { dst.addItem(item); } catch { /* ignore */ } }
      try { src.setItem(i, undefined); } catch { /* ignore */ }
    }
  }
  spillBelly(stash); // anything that did not fit (or no belly store) drops out
  collectBelly(pred, player); // plus whatever the prey picked up mid-meal
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
      if (c.getDynamicProperty(STASH_KEY)) continue; // prey stash: handled by followStash
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

// Which families each predator goes after, mirroring the generated
// `minecraft:behavior.nearest_attackable_target` lists
// (tools_py/generate_entities.py -> TARGETS and generate_community.py ->
//  TARGETS_BY_BASE, taken from the original entity goals). The passive hunt is
// filtered by the same lists so a predator only takes what its goals targeted.
// `player` is left out on purpose: players are only swallowed through the
// attack/struggle path.
const VINEMAIDEN_PREY = ["cow", "sheep", "pig", "goat", "wolf", "zombie", "pillager", "vindicator"];
const ZOMBIE_PREY = ["villager"];
const SILVERFISH_PREY = ["villager", "pillager", "vindicator", "witch"];
const PREY_FAMILIES = {
  basaltmite: ["magma_cube"],
  gilded_basaltmite: ["magma_cube"],
  vinemaiden: VINEMAIDEN_PREY,
  zombie: ZOMBIE_PREY,
  silverfish: SILVERFISH_PREY,
  scarecrow: ["monster"],
  rabbit_wizard: ["monster"],
  piglin_royal_knight: ["monster"],
  // imported reskins hunt exactly like the creature they reskin
  plant_maiden: VINEMAIDEN_PREY,
  eevee_vinemaiden: VINEMAIDEN_PREY,
  lamia: ZOMBIE_PREY,
  predatopia: ZOMBIE_PREY,
  predatopia_v2: ZOMBIE_PREY,
  eevee_zombie: ZOMBIE_PREY,
  eevee_silverfish: SILVERFISH_PREY,
  cathyl_rabbit: ["monster"],
  eevee_rabbit: ["monster"],
  eevee_scarecrow: ["monster"],
  // VCM import: the girls go for villagers and animals (players come through the
  // attack/struggle path), the druid only hunts hostile monsters.
  bat_girl: ["villager", "animal"],
  bunny_girl: ["villager", "animal"],
  cat_girl: ["villager", "animal"],
  slime_girl: ["villager", "animal"],
  lamia_vcm: ["villager", "animal"],
  druid: ["monster"]
};
// anything not listed (the community creatures) keeps hunting whatever mob is around
const DEFAULT_PREY_FAMILIES = ["animal", "monster", "villager"];
const huntFamilies = (pred) => PREY_FAMILIES[localId(pred.typeId)] ?? DEFAULT_PREY_FAMILIES;

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
  try { pred.addTag(HELD_TAG); } catch { /* ignore */ }
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
      if (pred) { setNum(pred, "pc:full", 0); assignSkin(pred, false); unswallow(pred); }
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
      unswallow(pred); // restore hunting behaviors after the meal
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
      // safety net: if a meal ended without restoring the hunt behaviors (prey
      // unloaded, predator reloaded mid-meal, ...), repair it here
      let held = false;
      try { held = pred.hasTag(HELD_TAG); } catch { held = false; }
      if (held && !predatorBusy(pred.id)) {
        setNum(pred, "pc:full", 0);
        assignSkin(pred, false);
        unswallow(pred);
      }
      if (predatorBusy(pred.id)) continue;
      let prey;
      try {
        prey = pred.dimension.getEntities({
          location: pred.location,
          maxDistance: CONFIG.huntRadius,
          closest: 1,
          families: huntFamilies(pred),
          excludeFamilies: ["predator"],
          excludeTypes: ["minecraft:player", BELLY_ENTITY, "pcraftrevorn:digestion_bar"]
        })[0];
      } catch { prey = undefined; }
      if (!prey || !isPreyMob(prey) || prey.hasTag(MOB_PREY_TAG)) continue;
      if (Math.random() > getNum(pred, "pc:swallow", 0.25) * CONFIG.huntChance) continue;
      startMobSwallow(pred, prey);
    }
  }
}

export function wireVoreEvents() {
  system.runInterval(digestTick, 1);
  system.runInterval(mobDigestTick, 1);
  system.runInterval(followBelly, 5);
  system.runInterval(followStash, 5);
  system.runInterval(mobHuntTick, 40);

  // struggle keys are locked in the hotbar, so a dropped key means something got
  // around the lock (a death drop, a chunk reload, an engine without item locks):
  // remove it rather than let the prey stash it away outside the minigame
  world.afterEvents.entitySpawn.subscribe((ev) => {
    const spawned = ev.entity;
    if (!spawned || spawned.typeId !== "minecraft:item") return;
    try {
      const item = spawned.getComponent("minecraft:item")?.itemStack;
      if (isStruggleItem(item)) spawned.remove();
    } catch { /* ignore */ }
  });



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
      // VCM swallows outright as soon as the prey is down to 10 HP; the port
      // keeps a per-hit chance above that and guarantees it at or below 10.
      let chance = getNum(predator, "pc:swallow", (getCfg(victim).swallow ?? 25) / 100);
      try {
        const hp = victim.getComponent("minecraft:health");
        if (hp && hp.currentValue <= 10) chance = 1;
      } catch { /* ignore */ }
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
      if (s) {
        s.alive = false;
        removeBar(s);
        const pred = resolvePredator(s);
        // dying inside a predator means the predator keeps everything the prey had
        try { collectStash(pred, s, dead); } catch { /* ignore */ }
        unswallow(pred);
      }
      sessions.delete(dead.id);
      try { dead.camera?.clear?.(); } catch { /* ignore */ }
    }
  });
}

export { sessions };
