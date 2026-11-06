// VCraft Reborn - Bedrock port (player-as-predator vore).
//
// Gut design (Bedrock-friendly): an invisible, player-following carrier entity
// (vcraft:gut) with 5 seats. Swallowed mobs are made invisible and ride it.
// The belly mesh (owned by the gender pack's minecraft:player) is driven by the
// pc_belly scoreboard (0 = flat .. 8 = full), derived from the prey's health.
import { world, system, DisplaySlotId, CommandPermissionLevel, CustomCommandStatus, ItemStack, EntityDamageCause } from "@minecraft/server";
import { ActionFormData, uiManager } from "@minecraft/server-ui";

// The PCraft HUD button bar is a persistent form (see the gender pack); only
// one form can be open per player, so close it before opening a VCraft menu.
function closeHud(player) {
  try { uiManager.closeAllForms(player); } catch { /* older ui module */ }
}

const GUT_ENTITY = "vcraft:gut";
const MAW_ITEM = "vcraft:maw";   // hold + right-click to swallow what you aim at
const GUT_PROP = "vcraft:gut";   // player dynamic property -> gut entity id
const BELLY_OBJ = "pc_belly";    // 0..BELLY_MAX (continuous belly level)
const MAX_PREY = 5;
const PREY_TAG = "vcraft_prey";
const DIGEST_PROP = "vcraft:digest"; // 0..100 progress toward digesting one prey
const ABSORB_PROP = "vcraft:absorb"; // accumulated absorption; every 5 grants +1 capacity

// Accessory registry. Each accessory occupies one slot (stored on the player as
// a dynamic property; the item is taken out of the inventory while equipped).
const ACCESSORIES = {
  "vcraft:acid_ring": { slot: "ring", name: "酸液戒指", icon: "textures/vcraft/items/acid_ring" },
  "vcraft:expansion_ring": { slot: "ring", name: "扩容戒指", icon: "textures/vcraft/items/expansion_ring" },
  "vcraft:maxima": { slot: "ring", name: "Maxima", icon: "textures/vcraft/items/maxima" },
  "vcraft:creativa": { slot: "ring", name: "Creativa", icon: "textures/vcraft/items/creativa" },
  "vcraft:wither_pendant": { slot: "necklace", name: "凋灵吊坠", icon: "textures/vcraft/items/wither_pendant" }
};
const SLOTS = { ring: "戒指", necklace: "吊坠" };

// Per-player settings (dynamic properties).
const CFG = { belly: "vcraft:cfg_belly", sounds: "vcraft:cfg_sounds", digest: "vcraft:cfg_digest", keep: "vcraft:cfg_keep", grow: "vcraft:cfg_grow" };
// Same invisible marker the PCraft/JSON-UI shell keys on (server_form.long_form).
const PCRAFT_MARKER = "§0§r§1§r";
function cfgGet(player, key, def) { try { const v = player.getDynamicProperty(key); return typeof v === "boolean" ? v : def; } catch { return def; } }
function cfgSet(player, key, val) { try { player.setDynamicProperty(key, !!val); } catch { /* ignore */ } }

function objective() {
  try {
    return world.scoreboard.getObjective(BELLY_OBJ) ?? world.scoreboard.addObjective(BELLY_OBJ, "腹部");
  } catch { return undefined; }
}
// Plan B: belly visibility is driven per-player by a server-side /playanimation,
// so every client sees it without depending on query.scoreboard.
//
// Original VCraft drives the belly from a *continuous* `bellySize` value and
// scrubs the CPM animation with it. Bedrock cannot scrub a player animation from
// a variable, so the CPM belly is sampled into BELLY_MAX static poses with
// matching grow/up/down transitions (see gender_pack .../vcraft_belly.animation.json).
const BELLY_MAX = 8;
const BELLY_OFF = "animation.vcraft.belly.off";
const bellyPose = (k) => `animation.vcraft.belly.s${k}`;
function playAnim(entity, anim) {
  // Server-side only: client Molang can't read scoreboards here. Use a dedicated
  // controller so the belly animation stacks on top of the gender pack's chest
  // animation instead of replacing it (one animation per controller).
  try { entity.playAnimation(anim, { players: world.getAllPlayers(), blendOutTime: 999999, controller: "pcraftrevorn:belly" }); return; } catch { /* fallthrough */ }
  try { entity.runCommand(`playanimation @s ${anim} none 999999 "0" pcraftrevorn:belly`); } catch { /* ignore */ }
}
const lastBelly = new Map();
// Safety net: the very first /playanimation after a spawn/relog is sometimes
// dropped by the client, which used to leave an empty belly visible forever
// (applyBelly caches its state and never retries). Track when the level last
// changed so bellyRefresh() can re-assert the settled state periodically.
let bellyTick = 0;
const bellySettle = new Map();
function applyBelly(player, n, force) {
  const k = Math.max(0, Math.min(BELLY_MAX, n | 0));
  const prev = lastBelly.get(player.id);
  if (prev === k && !force) return;
  lastBelly.set(player.id, k);
  bellySettle.set(player.id, bellyTick);
  // scoreboard mirrors the *displayed* level (not the target) so nothing else
  // tries to hide the belly while it is still shrinking.
  try { objective()?.setScore(player, k); } catch { /* ignore */ }
  let anim;
  if (k <= 0) anim = prev === 1 ? "animation.vcraft.belly.down0" : BELLY_OFF; // shrink out, don't snap
  else if (prev === undefined || prev === 0) anim = `animation.vcraft.belly.grow${k}`;
  else if (k === prev + 1) anim = `animation.vcraft.belly.up${k}`;
  else if (k === prev - 1) anim = `animation.vcraft.belly.down${k}`;
  else anim = bellyPose(k); // multi-step jump: snap to the new pose
  playAnim(player, anim);
}
const bellyTarget = new Map();
function setBelly(player, n) {
  const v = Math.max(0, Math.min(BELLY_MAX, n | 0));
  bellyTarget.set(player.id, v);
  // First time we see this player, snap straight to the level. After that the
  // ease interval walks the belly one step at a time (see bellyEase).
  if (!lastBelly.has(player.id)) applyBelly(player, v);
}
// Walk the displayed belly level toward the target one step at a time, so a jump
// of several levels (capacity change / several prey at once) still animates
// instead of snapping.
function bellyEase() {
  for (const player of world.getAllPlayers()) {
    if (rubbing.has(player.id)) continue;
    const target = bellyTarget.get(player.id);
    if (target === undefined) continue;
    const cur = lastBelly.get(player.id) ?? 0;
    if (cur === target) continue;
    applyBelly(player, cur + Math.sign(target - cur));
  }
}
// Re-assert the settled belly state every couple of seconds (see bellySettle).
// This is what guarantees an empty belly is actually hidden after joining.
function bellyRefresh() {
  for (const player of world.getAllPlayers()) {
    if (rubbing.has(player.id)) continue;
    const cur = lastBelly.get(player.id);
    if (cur === undefined) continue;
    if (cur !== (bellyTarget.get(player.id) ?? 0)) continue; // mid-ease
    if (bellyTick - (bellySettle.get(player.id) ?? 0) < 40) continue; // last transition may still be running
    playAnim(player, cur <= 0 ? BELLY_OFF : bellyPose(cur));
    bellySettle.set(player.id, bellyTick);
  }
}
// belly size comes from the total health of the prey: every HP_PER_STEP health
// of swallowed mobs = one belly step (a chicken is 4 HP = half a step, a cow
// 10 HP, an iron golem 100 HP).
const HP_PER_STEP = 8;
function bellyLevel(totalHp) {
  if (totalHp <= 0) return 0;
  return Math.max(1, Math.min(BELLY_MAX, Math.round(totalHp / HP_PER_STEP)));
}
function preyHealth(e) {
  try { const hp = e.getComponent("minecraft:health"); return hp && hp.effectiveMax > 0 ? hp.effectiveMax : 1; } catch { return 1; }
}
// Belly rub (ported from BellyRubProcedure): empty hands + sneaking + looking
// down >50 deg -> play a wobbling belly + apply nausea. Rubbing also slows the
// swallow rate (bellyRubModifier 0.65 in the original).
const rubbing = new Set();
const rubLevel = new Map();
function updateRub(player, level) {
  const rubbingNow = level > 0 && sneakPressed(player) && viewPitch(player) > 50 && handsEmpty(player);
  const was = rubbing.has(player.id);
  if (rubbingNow) {
    if (!was || rubLevel.get(player.id) !== level) {
      rubbing.add(player.id);
      rubLevel.set(player.id, level);
      playAnim(player, `animation.vcraft.belly.rub${level}`);
    }
    try { player.addEffect("nausea", 20, { amplifier: 2, showParticles: false }); } catch { /* ignore */ }
  } else if (was) {
    rubbing.delete(player.id);
    rubLevel.delete(player.id);
    applyBelly(player, level, true); // restore the held pose
  }
}
function entById(id) {
  try { return typeof id === "string" && id ? world.getEntity(id) : undefined; } catch { return undefined; }
}
function getGutExisting(player) {
  const e = entById(player.getDynamicProperty(GUT_PROP));
  return (e && e.typeId === GUT_ENTITY) ? e : undefined;
}
function getGut(player) {
  let e = entById(player.getDynamicProperty(GUT_PROP));
  if (e && e.typeId === GUT_ENTITY) return e;
  try {
    e = player.dimension.spawnEntity(GUT_ENTITY, player.location);
    player.setDynamicProperty(GUT_PROP, e.id);
    return e;
  } catch { return undefined; }
}
function riders(gut) {
  try { return gut.getComponent("minecraft:rideable")?.getRiders() ?? []; } catch { return []; }
}
function isDead(e) {
  try { const hp = e.getComponent("minecraft:health"); return !!hp && hp.currentValue <= 0; } catch { return false; }
}
// True if the player is sneaking, read from both the entity state and the raw
// input state (isSneaking can read false during the interact event).
function sneakPressed(player) {
  try { if (player.isSneaking) return true; } catch { /* ignore */ }
  try { return String(player.inputInfo.getButtonState("Sneak")) === "Pressed"; } catch { /* ignore */ }
  return false;
}
// View pitch in degrees, positive = looking down (matches MC Java getXRot()).
function viewPitch(player) {
  try { return Math.asin(Math.max(-1, Math.min(1, -player.getViewDirection().y))) * (180 / Math.PI); } catch { return 0; }
}
// Both hands empty (the belly-rub gesture requires it, as in the original).
function handsEmpty(player) {
  try {
    const eq = player.getComponent("minecraft:equippable");
    if (!eq) return false;
    return !eq.getEquipment("Mainhand") && !eq.getEquipment("Offhand");
  } catch { return false; }
}
function aliveRiders(gut) {
  return riders(gut).filter((r) => !isDead(r));
}
function hasItem(player, typeId) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;
    for (let i = 0; i < inv.size; i++) {
      if (inv.getItem(i)?.typeId === typeId) return true;
    }
  } catch { /* ignore */ }
  return false;
}

// ---- accessories ----
function getEquipped(player, slot) {
  try { const v = player.getDynamicProperty("vcraft:" + slot); return typeof v === "string" ? v : ""; } catch { return ""; }
}
function setEquipped(player, slot, item) {
  try { player.setDynamicProperty("vcraft:" + slot, item || ""); } catch { /* ignore */ }
}
function hasEquipped(player, itemId) {
  return getEquipped(player, "ring") === itemId || getEquipped(player, "necklace") === itemId;
}
function getAbsorb(player) {
  try { const v = player.getDynamicProperty(ABSORB_PROP); return typeof v === "number" ? v : 0; } catch { return 0; }
}
function capacity(player) {
  if (hasEquipped(player, "vcraft:expansion_ring") || hasEquipped(player, "vcraft:maxima")) return 20;
  return MAX_PREY + Math.min(5, Math.floor(getAbsorb(player) / 5));
}
function digestionDisabled(player) { return hasEquipped(player, "vcraft:acid_ring"); }
function digestRate(player) {
  if (hasEquipped(player, "vcraft:maxima")) return 16;
  if (hasEquipped(player, "vcraft:creativa")) return 8;
  return 4;
}
function bossBlacklisted(t) { return t === "minecraft:ender_dragon" || t === "minecraft:wither" || t === "minecraft:warden"; }

// Shares the gender pack's pc_state objective: value = skin * 10 + sex
// (sex 0 = male, 1..5 = female with chest size sex-1). Used to grow the chest.
const STATE_OBJ = "pc_state";
function getState(player) {
  try {
    const o = world.scoreboard.getObjective(STATE_OBJ);
    if (!o) return undefined;
    const s = o.getScore(player.scoreboardIdentity);
    return typeof s === "number" ? s : undefined;
  } catch { return undefined; }
}
function setState(player, v) {
  try {
    const o = world.scoreboard.getObjective(STATE_OBJ) ?? world.scoreboard.addObjective(STATE_OBJ, "性别");
    o.setScore(player, Math.max(0, v | 0));
  } catch { /* ignore */ }
}
function growChest(player) {
  const st = getState(player);
  if (typeof st !== "number") return;
  const skin = Math.floor(st / 10);
  const sex = st % 10;
  if (sex > 0 && sex < 5) setState(player, skin * 10 + (sex + 1));
}
function equipFromInventory(player, itemId) {
  const meta = ACCESSORIES[itemId];
  if (!meta) return;
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  let removed = false;
  for (let i = 0; i < inv.size; i++) {
    const it = inv.getItem(i);
    if (it?.typeId === itemId) {
      if (it.amount > 1) { it.amount -= 1; inv.setItem(i, it); } else inv.setItem(i, undefined);
      removed = true;
      break;
    }
  }
  if (!removed) { player.sendMessage("§7[VCraft] 背包里没有这个饰品。"); return; }
  const cur = getEquipped(player, meta.slot);
  if (cur) { try { inv.addItem(new ItemStack(cur, 1)); } catch { /* ignore */ } }
  setEquipped(player, meta.slot, itemId);
  player.sendMessage(`§a[VCraft] 已装备 ${meta.name}。`);
}
function unequip(player, slot) {
  const cur = getEquipped(player, slot);
  if (!cur) return;
  try { player.getComponent("minecraft:inventory")?.container?.addItem(new ItemStack(cur, 1)); } catch { /* ignore */ }
  setEquipped(player, slot, "");
  player.sendMessage("§a[VCraft] 已卸下饰品。");
}
function openTrinketMenu(player) {
  const form = new ActionFormData().title(PCRAFT_MARKER + "饰品 / Trinkets");
  form.body(`§f戒指：§7${getEquipped(player, "ring") ? ACCESSORIES[getEquipped(player, "ring")]?.name ?? getEquipped(player, "ring") : "空"}\n§f吊坠：§7${getEquipped(player, "necklace") ? ACCESSORIES[getEquipped(player, "necklace")]?.name ?? getEquipped(player, "necklace") : "空"}`);
  const actions = [];
  const eqRing = getEquipped(player, "ring");
  const eqNeck = getEquipped(player, "necklace");
  if (eqRing) { form.button("§c卸下：" + (ACCESSORIES[eqRing]?.name ?? eqRing), ACCESSORIES[eqRing]?.icon); actions.push({ op: "unequip", slot: "ring" }); }
  if (eqNeck) { form.button("§c卸下：" + (ACCESSORIES[eqNeck]?.name ?? eqNeck), ACCESSORIES[eqNeck]?.icon); actions.push({ op: "unequip", slot: "necklace" }); }
  const inv = player.getComponent("minecraft:inventory")?.container;
  const seen = new Set();
  if (inv) {
    for (let i = 0; i < inv.size; i++) {
      const it = inv.getItem(i);
      if (!it || seen.has(it.typeId)) continue;
      const meta = ACCESSORIES[it.typeId];
      if (!meta) continue;
      seen.add(it.typeId);
      form.button(`§a装备 ${meta.name} §7(${SLOTS[meta.slot]})`, meta.icon);
      actions.push({ op: "equip", item: it.typeId });
    }
  }
  form.button("§7关闭"); actions.push({ op: "close" });
  closeHud(player);
  form.show(player).then((r) => {
    if (r.canceled) return;
    const a = actions[r.selection];
    if (!a || a.op === "close") return;
    if (a.op === "equip") equipFromInventory(player, a.item);
    else if (a.op === "unequip") unequip(player, a.slot);
    system.run(() => openTrinketMenu(player));
  }).catch(() => { /* ignore */ });
}
function hide(e) {
  try { e.addEffect("invisibility", 200, { showParticles: false, amplifier: 0 }); } catch { /* ignore */ }
  try { e.nameTag = ""; } catch { /* ignore */ }
}
function isPreyCandidate(e, player) {
  if (!e || e.id === player.id) return false;
  const t = e.typeId;
  if (t === "minecraft:player" || t === GUT_ENTITY) return false;
  if (t.startsWith("vcraft:")) return false;
  // boss blacklist (Wither Pendant allows swallowing the Wither)
  if (bossBlacklisted(t) && !(t === "minecraft:wither" && hasEquipped(player, "vcraft:wither_pendant"))) return false;
  // already being swallowed/digested, or busy digesting -> not preyable
  try { if (e.hasTag(PREY_TAG) || e.hasTag(PV_TAG) || e.hasTag("vore_digesting")) return false; } catch { /* ignore */ }
  try { if (!e.getComponent("minecraft:health")) return false; } catch { return false; }
  return true;
}
function nearestPrey(player, radius) {
  let list;
  try {
    list = player.dimension.getEntities({
      location: player.location,
      maxDistance: radius,
      closest: 1,
      excludeTypes: ["minecraft:player", GUT_ENTITY],
      excludeFamilies: ["vcraft_gut"]
    });
  } catch { list = []; }
  for (const e of list) if (isPreyCandidate(e, player)) return e;
  return undefined;
}

function swallow(player, target) {
  const gut = getGut(player);
  if (!gut) { player.sendMessage("§c[VCraft] 胃袋实体创建失败。"); return; }
  const cap = capacity(player);
  if (aliveRiders(gut).length >= cap) { player.sendMessage(`§c[VCraft] 已经满了（上限 ${cap}）。`); return; }
  target = target ?? nearestPrey(player, 4);
  if (!target || !isPreyCandidate(target, player)) { player.sendMessage("§7[VCraft] 附近没有可吞的生物。"); return; }
  try {
    target.addTag(PREY_TAG);
    gut.runCommand(`ride @e[tag=${PREY_TAG},c=1] start_riding @s`);
  } catch { /* ignore */ }
  hide(target);
  if (cfgGet(player, CFG.sounds, true)) { try { player.dimension.playSound("vcraft.swallow", player.location, { volume: 0.9 }); } catch { /* ignore */ } }
  player.sendMessage(`§d[VCraft] 吞入 §f${target.typeId.replace("minecraft:", "")}§d。`);
}

function lookTarget(player, dist) {
  try {
    const hits = player.getEntitiesFromViewDirection({ maxDistance: dist });
    for (const h of hits) {
      const e = h?.entity;
      if (e && e.id !== player.id && e.typeId !== GUT_ENTITY) return e;
    }
  } catch { /* ignore */ }
  return undefined;
}

// Instant swallow: you must be aiming at the target, but there is no timed
// progress bar and you do not have to keep looking at it while it fills.
function instantSwallow(player) {
  if (!player || player.typeId !== "minecraft:player") return;
  const target = lookTarget(player, 6);
  if (!target) { player.sendMessage("§7[VCraft] 没有对准可吞的生物。"); return; }
  if (target.typeId === "minecraft:player") { swallowPlayer(player, target); return; }
  if (!isPreyCandidate(target, player)) { player.sendMessage("§7[VCraft] 这个目标不能吞。"); return; }
  swallow(player, target);
}
// Hold vcraft:maw and right-click to start swallowing whatever you are aiming at.
// Ported from the original: swallowing is a timed progress (0..60) that fills at
// a rate depending on where you look (SwallowCalcProcedure) and on your rings.
const SWALLOW_NEEDED = 60;
const swallowState = new Map(); // playerId -> { targetId, progress }
function swallowRate(player) {
  // (0.2 + 0.8 * |pitch + (-90)| / 180) * swallowSpeed * ringSwallowModifier
  const pitch = viewPitch(player);
  const ring = hasEquipped(player, "vcraft:maxima") ? 1.6 : hasEquipped(player, "vcraft:expansion_ring") ? 1.3 : 1.0;
  const rub = rubbing.has(player.id) ? 0.65 : 1.0;
  return (0.2 + 0.8 * (Math.abs(pitch - 90) / 180)) * 2.5 * ring * rub;
}
function beginSwallow(player) {
  if (!player || player.typeId !== "minecraft:player") return;
  if (swallowState.has(player.id)) return;
  const target = lookTarget(player, 5);
  if (!target) { player.sendMessage("§7[VCraft] 没有对准可以吞的生物。"); return; }
  if (target.typeId !== "minecraft:player" && !isPreyCandidate(target, player)) { player.sendMessage("§7[VCraft] 这个目标不能吞。"); return; }
  swallowState.set(player.id, { targetId: target.id, progress: 0 });
}
function swallowTick() {
  if (swallowState.size === 0) return;
  for (const [pid, s] of swallowState) {
    const player = entById(pid);
    if (!player) { swallowState.delete(pid); continue; }
    const target = entById(s.targetId);
    const looked = lookTarget(player, 5);
    if (!target || !looked || looked.id !== target.id || (target.typeId !== "minecraft:player" && !isPreyCandidate(target, player))) {
      swallowState.delete(pid);
      try { player.onScreenDisplay.setActionBar(" "); } catch { /* ignore */ }
      continue;
    }
    s.progress += swallowRate(player);
    if (s.progress >= SWALLOW_NEEDED) {
      swallowState.delete(pid);
      if (target.typeId === "minecraft:player") swallowPlayer(player, target);
      else swallow(player, target);
      continue;
    }
    try { player.onScreenDisplay.setActionBar(`§d吞咽 §f${Math.round((s.progress / SWALLOW_NEEDED) * 100)}% §7· 看向目标`); } catch { /* ignore */ }
  }
}

function digestTick() {  for (const player of world.getAllPlayers()) {
    const gut = getGut(player);
    if (!gut) continue;
    if (!cfgGet(player, CFG.digest, true)) continue;
    if (digestionDisabled(player)) continue; // Acid Ring: prey stay, no digestion
    const rs = aliveRiders(gut);
    if (rs.length === 0) {
      try { player.setDynamicProperty(DIGEST_PROP, 0); } catch { /* ignore */ }
      continue;
    }
    let d = 0;
    try { const v = player.getDynamicProperty(DIGEST_PROP); d = typeof v === "number" ? v : 0; } catch { /* ignore */ }
    d += digestRate(player);
    if (d >= 100) {
      d = 0;
      const prey = rs[0];
      try { prey.kill(); } catch { try { prey.remove(); } catch { /* ignore */ } }
      if (cfgGet(player, CFG.sounds, true)) { try { player.dimension.playSound("vcraft.burp", player.location, { volume: 0.8 }); } catch { /* ignore */ } }
      try {
        const hp = player.getComponent("minecraft:health");
        if (hp) hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + 4));
      } catch { /* ignore */ }
      try { player.dimension.spawnItem(new ItemStack("vcraft:bone_bits", 1 + Math.floor(Math.random() * 2)), player.location); } catch { /* ignore */ }
      try { player.setDynamicProperty(ABSORB_PROP, getAbsorb(player) + 1); } catch { /* ignore */ }
      if (cfgGet(player, CFG.grow, false)) growChest(player);
      player.sendMessage(`§7[VCraft] 消化了一只猎物。吸收 ${getAbsorb(player)}（容量 ${capacity(player)}）`);
    }
    try { player.setDynamicProperty(DIGEST_PROP, d); } catch { /* ignore */ }
  }
}

function releaseAll(player) {
  const gut = getGutExisting(player);
  if (!gut) return;
  for (const r of riders(gut)) {
    try { r.runCommand("ride @s stop_riding"); } catch { /* ignore */ }
    try { r.removeTag(PREY_TAG); } catch { /* ignore */ }
    try { r.removeEffect("invisibility"); } catch { /* ignore */ }
  }
  player.sendMessage("§a[VCraft] 已吐出所有猎物。");
}

// ---- player as prey (PvP vore) ----
// A player-predator swallows another player; the prey rides the predator's gut,
// struggles with jump/sneak, and is either regurgitated (enough struggles) or
// digested (killed). Ported in spirit from PCraft's player-prey handling.
const PV = new Map(); // preyId -> session
const PV_TAG = "vcraft_pprey";
const PV_MAX = 6000;
const pvPressed = (state) => String(state) === "Pressed";

function swallowPlayer(predator, prey) {
  if (!predator || !prey || predator.id === prey.id) return;
  if (PV.has(prey.id)) return;
  // already being digested (by PCraft or VCraft), or busy digesting -> skip
  try { if (prey.hasTag("vore_digesting")) { predator.sendMessage("§7[VCraft] 对方正在消化猎物。"); return; } } catch { /* ignore */ }
  try { const pr = prey.getDynamicProperty("pc:pred"); if (typeof pr === "string" && pr) { predator.sendMessage("§7[VCraft] 对方正在被消化。"); return; } } catch { /* ignore */ }
  const gut = getGut(predator);
  if (!gut) return;
  if (aliveRiders(gut).length >= capacity(predator)) { predator.sendMessage("§c[VCraft] 已经满了。"); return; }
  try {
    prey.addTag(PV_TAG);
    gut.runCommand(`ride @e[tag=${PV_TAG},c=1] start_riding @s`);
  } catch { /* ignore */ }
  PV.set(prey.id, { predatorId: predator.id, digest: 0, maxTimer: PV_MAX, rate: 2, struggles: 0, needed: 8, prevJump: false, prevSneak: false, msgTimer: 0 });
  try { prey.addEffect("invisibility", 1000000, { showParticles: false, amplifier: 0 }); } catch { /* ignore */ }
  try { prey.addEffect("resistance", 1000000, { showParticles: false, amplifier: 4 }); } catch { /* ignore */ }
  try { prey.onScreenDisplay.setTitle("§4被吞入", { fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 10 }); } catch { /* ignore */ }
  prey.sendMessage("§4[VCraft] 你被吞入腹中！按 §f跳跃/潜行 §4方向挣扎。");
  predator.sendMessage(`§d[VCraft] 吞入了玩家 §f${prey.name}§d。`);
  if (cfgGet(predator, CFG.sounds, true)) { try { predator.dimension.playSound("vcraft.swallow", predator.location, { volume: 0.9 }); } catch { /* ignore */ } }
}

function releasePlayerPrey(prey, msg) {
  PV.delete(prey.id);
  try { prey.runCommand("ride @s stop_riding"); } catch { /* ignore */ }
  try { prey.removeTag(PV_TAG); } catch { /* ignore */ }
  try { prey.removeEffect("invisibility"); } catch { /* ignore */ }
  try { prey.removeEffect("resistance"); } catch { /* ignore */ }
  try { prey.onScreenDisplay.setActionBar(" "); } catch { /* ignore */ }
  if (msg) prey.sendMessage(msg);
}

function playerPreyTick() {
  if (PV.size === 0) return;
  for (const [pid, s] of PV) {
    const prey = entById(pid);
    const predator = entById(s.predatorId);
    if (!prey || !predator) { if (prey) releasePlayerPrey(prey, "§7[VCraft] 你被放了出来。"); else PV.delete(pid); continue; }
    const gut = getGut(predator);
    if (gut) { try { gut.runCommand(`ride @e[tag=${PV_TAG},c=1] start_riding @s`); } catch { /* ignore */ } }
    let jump = false, sneak = false;
    try { const info = prey.inputInfo; jump = pvPressed(info.getButtonState("Jump")); sneak = pvPressed(info.getButtonState("Sneak")); } catch { /* ignore */ }
    if ((jump && !s.prevJump) || (sneak && !s.prevSneak)) {
      s.struggles += 1;
      s.digest = Math.max(0, s.digest - 150);
      if (cfgGet(predator, CFG.sounds, true)) { try { predator.dimension.playSound("vcraft.struggle", predator.location, { volume: 0.6 }); } catch { /* ignore */ } }
      if (s.struggles >= s.needed && s.digest <= 0) { releasePlayerPrey(prey, "§a你挣脱了，从胃袋里滑了出来！"); continue; }
    }
    s.prevJump = jump; s.prevSneak = sneak;
    s.digest += s.rate;
    if (s.digest >= s.maxTimer) {
      PV.delete(pid);
      try { prey.removeTag(PV_TAG); } catch { /* ignore */ }
      try { prey.removeEffect("resistance"); } catch { /* ignore */ }
      try { prey.applyDamage(1000000, { cause: EntityDamageCause.magic, damagingEntity: predator }); } catch { try { prey.kill(); } catch { /* ignore */ } }
      if (cfgGet(predator, CFG.sounds, true)) { try { predator.dimension.playSound("vcraft.burp", predator.location, { volume: 0.8 }); } catch { /* ignore */ } }
      try { predator.setDynamicProperty(ABSORB_PROP, getAbsorb(predator) + 1); } catch { /* ignore */ }
      if (cfgGet(predator, CFG.grow, false)) growChest(predator);
      predator.sendMessage("§7[VCraft] 消化了一名玩家猎物。");
      continue;
    }
    s.msgTimer = (s.msgTimer + 1) % 10;
    if (s.msgTimer === 0) {
      const left = Math.max(0, Math.round(((s.maxTimer - s.digest) / s.maxTimer) * 100));
      try { prey.onScreenDisplay.setActionBar(`§c消化中 §f${left}% §7· 挣扎 §f${s.struggles}/${s.needed} §8[按方向道具]`); } catch { /* ignore */ }
    }
  }
}

// Overwhelmed: too much prey slows / sickens the predator.
function overwhelmTick() {
  for (const player of world.getAllPlayers()) {
    const gut = getGut(player);
    if (!gut) continue;
    const n = aliveRiders(gut).length;
    if (n >= 5) { try { player.addEffect("nausea", 80, { amplifier: 0, showParticles: false }); } catch { /* ignore */ } }
    if (n >= 3) { try { player.addEffect("slowness", 80, { amplifier: Math.min(1, n - 3), showParticles: false }); } catch { /* ignore */ } }
  }
}

function openMainMenu(player) {
  const form = new ActionFormData().title(PCRAFT_MARKER + "VCraft");
  form.button("§f设置");
  form.button("§f胃袋");
  form.button("§f饰品");
  form.button("§7关闭");
  closeHud(player);
  form.show(player).then((r) => {
    if (r.canceled) return;
    if (r.selection === 0) system.run(() => openConfigMenu(player));
    else if (r.selection === 1) system.run(() => openPreyMenu(player));
    else if (r.selection === 2) system.run(() => openTrinketMenu(player));
  }).catch(() => { /* ignore */ });
}

const VCFG_ROWS = [
  { key: CFG.belly, label: "显示腹部", def: true },
  { key: CFG.sounds, label: "音效（吞咽/挣扎/打嗝）", def: true },
  { key: CFG.digest, label: "自动消化", def: true },
  { key: CFG.keep, label: "死亡时保留猎物", def: false },
  { key: CFG.grow, label: "消化后增大胸部（体型）", def: false },
];

function openConfigMenu(player) {
  const actions = [];
  const form = new ActionFormData().title(PCRAFT_MARKER + "VCraft 设置");
  form.body("§7点一下即可切换，立即保存。");
  for (const r of VCFG_ROWS) {
    const on = !!cfgGet(player, r.key, r.def);
    form.button(`§f${r.label}  ${on ? "§a开" : "§c关"}`);
    actions.push(r);
  }
  form.button("§7关闭"); actions.push(null);
  closeHud(player);
  form.show(player).then((res) => {
    if (res.canceled) return;
    const row = actions[res.selection];
    if (!row) return;
    cfgSet(player, row.key, !cfgGet(player, row.key, row.def));
    system.run(() => openConfigMenu(player));
  }).catch(() => { /* ignore */ });
}

function ambientTick() {
  for (const player of world.getAllPlayers()) {
    const gut = getGut(player);
    const rs = gut ? aliveRiders(gut) : [];
    if (rs.length > 0 && cfgGet(player, CFG.sounds, true) && Math.random() < 0.3) {
      try { player.dimension.playSound("vcraft.struggle", player.location, { volume: 0.5 }); } catch { /* ignore */ }
    }
    if (rs.length > 0 && Math.random() < 0.02) {
      const prey = rs[Math.floor(Math.random() * rs.length)];
      try { prey.runCommand("ride @s stop_riding"); } catch { /* ignore */ }
      try { prey.removeTag(PREY_TAG); } catch { /* ignore */ }
      try { prey.removeEffect("invisibility"); } catch { /* ignore */ }
      player.sendMessage(`§e[VCraft] 一只 ${prey.typeId.replace("minecraft:", "")} 挣脱了！`);
    }
  }
}

const PREY_PAGE = 6;

function openPreyMenu(player, page = 0) {
  const gut = getGut(player);
  const rs = gut ? riders(gut) : [];
  const form = new ActionFormData().title(PCRAFT_MARKER + "胃袋");
  if (rs.length === 0) {
    form.body("§7胃袋是空的。");
    form.button("§7关闭");
    closeHud(player);
    form.show(player).catch(() => { /* ignore */ });
    return;
  }

  // capacity() goes up to 20, so the list needs pages: 6 rows + prev/next + 关闭
  // still fits the 300x340 JSON-UI panel.
  const pages = Math.max(1, Math.ceil(rs.length / PREY_PAGE));
  page = Math.max(0, Math.min(pages - 1, page | 0));
  const start = page * PREY_PAGE;
  const slice = rs.slice(start, start + PREY_PAGE);
  const actions = [];

  form.body(`§f猎物 ${rs.length}/${capacity(player)} · 吸收 ${getAbsorb(player)}` +
    (pages > 1 ? `\n§8第 ${page + 1} / ${pages} 页` : ""));
  for (const r of slice) {
    form.button(`§f放出：§7${r.typeId.replace("minecraft:", "")}`);
    actions.push({ op: "free", prey: r });
  }
  if (pages > 1) {
    form.button("§7◀ 上一页"); actions.push({ op: "page", page: (page + pages - 1) % pages });
    form.button("§7下一页 ▶"); actions.push({ op: "page", page: (page + 1) % pages });
  }
  form.button("§7关闭"); actions.push({ op: "close" });

  closeHud(player);
  form.show(player).then((res) => {
    if (res.canceled) return;
    const a = actions[res.selection];
    if (!a || a.op === "close") return;
    if (a.op === "page") { system.run(() => openPreyMenu(player, a.page)); return; }
    const prey = a.prey;
    try { prey.runCommand("ride @s stop_riding"); } catch { /* ignore */ }
    try { prey.removeTag(PREY_TAG); } catch { /* ignore */ }
    try { prey.removeEffect("invisibility"); } catch { /* ignore */ }
    player.sendMessage(`§a[VCraft] 放出了 §f${prey.typeId.replace("minecraft:", "")}§a。`);
    system.run(() => openPreyMenu(player, page));
  }).catch(() => { /* ignore */ });
}

export function wireVcraft() {
  // Entry used by the PCraft HUD button bar (gender pack).
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      if (player.hasTag("vcraft:want_swallow")) {
        try { player.removeTag("vcraft:want_swallow"); } catch { /* ignore */ }
        system.run(() => { try { instantSwallow(player); } catch { /* ignore */ } });
      }
      if (!player.hasTag("vcraft:open_menu")) continue;
      try { player.removeTag("vcraft:open_menu"); } catch { /* ignore */ }
      system.run(() => openMainMenu(player));
    }
  }, 10);
  // Belly rendering is command-driven (Plan B) and no longer uses query.scoreboard,
  // so we must NOT claim a display slot here — that would clobber the gender pack's
  // pc_state objective (still used for skin selection). The pc_belly objective is
  // still created lazily by setBelly().
  // /playanimation state resets on respawn / relog; drop the cache so it re-applies,
  // and force a re-apply shortly after spawn once the client is likely ready.
  world.afterEvents.playerSpawn.subscribe((ev) => {
    lastBelly.delete(ev.player.id);
    bellySettle.delete(ev.player.id);
    const p = ev.player;
    // The client sometimes drops the first /playanimation after a spawn/relog:
    // the belly then sits at the default (full-size) bind pose until the next
    // bellyRefresh. Re-assert the settled pose a few times instead of waiting.
    for (const delay of [20, 40, 80, 140]) {
      system.runTimeout(() => {
        try {
          if (!p.isValid) return;
          const target = bellyTarget.get(p.id) ?? 0;
          if ((lastBelly.get(p.id) ?? 0) !== target) return; // mid-ease, don't snap
          applyBelly(p, target, true);
        } catch { /* ignore */ }
      }, delay);
    }
  });
  world.afterEvents.playerLeave.subscribe((ev) => { lastBelly.delete(ev.playerId); bellySettle.delete(ev.playerId); });
  // Custom commands: /vcraft:swallow, /vcraft:release, /vcraft:prey
  // Wrapped so a missing custom-command API can't abort the chat handler below.
  try {
    system.beforeEvents.startup.subscribe((init) => {
      try {
        const reg = (name, desc, fn) => init.customCommandRegistry.registerCommand(
          { name, description: desc, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
          (origin) => {
            const p = origin.sourceEntity;
            if (p?.typeId === "minecraft:player") { system.run(() => fn(p)); return { status: CustomCommandStatus.Success }; }
            return { status: CustomCommandStatus.Failure, message: "只能由玩家执行。" };
          }
        );
        reg("vcraft:swallow", "吞下正在瞄准的生物", instantSwallow);
        reg("vcraft:release", "放出胃袋里的所有猎物", releaseAll);
        reg("vcraft:prey", "打开胃袋面板", openPreyMenu);
        reg("vcraft:trinkets", "打开饰品面板", openTrinketMenu);
        reg("vcraft:config", "打开 VCraft 设置", openConfigMenu);
        reg("vcraft:menu", "打开 VCraft 主菜单", openMainMenu);
      } catch { /* custom commands unsupported */ }
    });
  } catch { /* startup event unavailable on this version */ }

  // Follow + hide + belly stage, every 2 ticks.
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      const gut = getGut(player);
      if (!gut) continue;
      try { gut.teleport(player.location, { dimension: player.dimension }); } catch { /* ignore */ }
      const all = riders(gut);
      const rs = all.filter((r) => !isDead(r));
      // all prey died inside -> end digestion early
      if (all.length > 0 && rs.length === 0) {
        for (const r of all) { try { r.removeTag(PREY_TAG); } catch { /* ignore */ } try { r.removeTag(PV_TAG); } catch { /* ignore */ } }
        try { player.setDynamicProperty(DIGEST_PROP, 0); } catch { /* ignore */ }
      }
      for (const r of rs) hide(r);
      // mark a digesting hunter so other hunters won't *prey on* it (attacks still land)
      try { if (rs.length > 0) player.addTag("vore_digesting"); else player.removeTag("vore_digesting"); } catch { /* ignore */ }
      const bellyHp = rs.reduce((sum, r) => sum + preyHealth(r), 0);
      setBelly(player, (cfgGet(player, CFG.belly, true) && bellyHp > 0) ? bellyLevel(bellyHp) : 0);
      updateRub(player, lastBelly.get(player.id) ?? 0);
      if (rs.length > 0) {
        let d = 0; try { const v = player.getDynamicProperty(DIGEST_PROP); d = typeof v === "number" ? v : 0; } catch { /* ignore */ }
        try { player.onScreenDisplay.setActionBar(`§d腹部 ${rs.length}/${capacity(player)} §7· 消化 §f${Math.round(d)}%`); } catch { /* ignore */ }
      }
    }
  }, 2);

  // Digestion: slowly digest one prey at a time.
  system.runInterval(digestTick, 20);
  // Smooth belly level easing (one step every 0.3s).
  system.runInterval(bellyEase, 6);
  // Ticker + safety net that re-asserts the settled belly state.
  system.runInterval(() => { bellyTick++; }, 1);
  system.runInterval(bellyRefresh, 40);
  // Ambient: struggle sounds + wither pendant aura + escape attempts.
  system.runInterval(ambientTick, 40);
  // Overwhelmed debuffs.
  system.runInterval(overwhelmTick, 40);
  // Player-as-prey struggle/digest.
  system.runInterval(playerPreyTick, 1);
  // Swallow progress (maw charge).
  system.runInterval(swallowTick, 1);

  // In-game trigger: hold vcraft:maw and right-click to swallow what you aim at.
  // itemUse covers right-click with the item; playerInteractWithEntity covers
  // right-clicking a creature directly.
  try {
    world.afterEvents.itemUse.subscribe((ev) => {
      try { if (ev.itemStack?.typeId === MAW_ITEM) instantSwallow(ev.source); } catch { /* ignore */ }
    });
  } catch { /* itemUse unavailable */ }
  try {
    world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
      try { if (ev.itemStack?.typeId === MAW_ITEM) instantSwallow(ev.player); } catch { /* ignore */ }
    });
  } catch { /* playerInteractWithEntity unavailable */ }

  // Cleanup when a player dies.
  world.afterEvents.entityDie.subscribe((ev) => {
    const e = ev.deadEntity;
    if (e?.typeId !== "minecraft:player") return;
    if (PV.has(e.id)) PV.delete(e.id);
    if (cfgGet(e, CFG.keep, false)) return;
    // hunter died mid-digestion -> release all its prey in place
    try { releaseAll(e); } catch { /* ignore */ }
    for (const [pid, s] of [...PV]) {
      if (s.predatorId === e.id) {
        const prey = entById(pid);
        if (prey) releasePlayerPrey(prey, "§a[VCraft] 你被放了出来。");
        else PV.delete(pid);
      }
    }
  });

  // Everything is exposed as a custom command (see the registration above);
  // no /scriptevent or chat-token entry points.
}

wireVcraft();
console.warn("[VCraft] scripts loaded.");
