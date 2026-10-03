// VCraft Reborn - Bedrock port (player-as-predator vore).
//
// Gut design (Bedrock-friendly): an invisible, player-following carrier entity
// (vcraft:gut) with 5 seats. Swallowed mobs are made invisible and ride it.
// The belly mesh (owned by the gender pack's minecraft:player) is driven by the
// pc_belly scoreboard (0 = flat, 1 = small, 2 = big), derived from prey count.
import { world, system, DisplaySlotId, CommandPermissionLevel, CustomCommandStatus, ItemStack, EntityDamageCause } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const GUT_ENTITY = "vcraft:gut";
const GUT_PROP = "vcraft:gut";   // player dynamic property -> gut entity id
const BELLY_OBJ = "pc_belly";    // 0..2
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
function cfgGet(player, key, def) { try { const v = player.getDynamicProperty(key); return typeof v === "boolean" ? v : def; } catch { return def; } }
function cfgSet(player, key, val) { try { player.setDynamicProperty(key, !!val); } catch { /* ignore */ } }

function objective() {
  try {
    return world.scoreboard.getObjective(BELLY_OBJ) ?? world.scoreboard.addObjective(BELLY_OBJ, "腹部");
  } catch { return undefined; }
}
// Plan B: belly visibility is driven per-player by a server-side /playanimation,
// so every client sees it without depending on query.scoreboard.
const BELLY_ANIM = ["animation.vcraft.belly.off", "animation.vcraft.belly.small", "animation.vcraft.belly.big"];
const lastBelly = new Map();
function playAnim(entity, anim) {
  // Server-side only: client Molang can't read scoreboards here. Prefer the API.
  try { entity.playAnimation(anim, { players: world.getAllPlayers(), blendOutTime: 999999 }); return; } catch { /* fallthrough */ }
  try { entity.runCommand(`playanimation @s ${anim} none 999999`); } catch { /* ignore */ }
}
function applyBelly(player, n) {
  const idx = Math.max(0, Math.min(2, n | 0));
  if (lastBelly.get(player.id) === idx) return;
  lastBelly.set(player.id, idx);
  playAnim(player, BELLY_ANIM[idx]);
}
function setBelly(player, n) {
  const v = Math.max(0, Math.min(2, n | 0));
  try { objective()?.setScore(player, v); } catch { /* ignore */ }
  applyBelly(player, v);
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
  const form = new ActionFormData().title("饰品 / Trinkets");
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

function digestTick() {
  for (const player of world.getAllPlayers()) {
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
      try { prey.onScreenDisplay.setActionBar(`§c消化中 §f${left}% §7· 挣扎 §f${s.struggles}/${s.needed} §8[跳/潜]`); } catch { /* ignore */ }
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
  const form = new ActionFormData().title("VCraft");
  form.button("§f设置");
  form.button("§f胃袋");
  form.button("§f饰品");
  form.button("§7关闭");
  form.show(player).then((r) => {
    if (r.canceled) return;
    if (r.selection === 0) system.run(() => openConfigMenu(player));
    else if (r.selection === 1) system.run(() => openPreyMenu(player));
    else if (r.selection === 2) system.run(() => openTrinketMenu(player));
  }).catch(() => { /* ignore */ });
}

function openConfigMenu(player) {
  const form = new ModalFormData().title("VCraft 设置");
  form.toggle("显示腹部", { defaultValue: cfgGet(player, CFG.belly, true) });
  form.toggle("音效（吞咽/挣扎/打嗝）", { defaultValue: cfgGet(player, CFG.sounds, true) });
  form.toggle("自动消化", { defaultValue: cfgGet(player, CFG.digest, true) });
  form.toggle("死亡时保留猎物", { defaultValue: cfgGet(player, CFG.keep, false) });
  form.toggle("消化后增大胸部（体型）", { defaultValue: cfgGet(player, CFG.grow, false) });
  form.show(player).then((r) => {
    if (r.canceled) return;
    cfgSet(player, CFG.belly, r.formValues?.[0]);
    cfgSet(player, CFG.sounds, r.formValues?.[1]);
    cfgSet(player, CFG.digest, r.formValues?.[2]);
    cfgSet(player, CFG.keep, r.formValues?.[3]);
    cfgSet(player, CFG.grow, r.formValues?.[4]);
    player.sendMessage("§a[VCraft] 设置已保存。");
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

function openPreyMenu(player) {
  const gut = getGut(player);
  const rs = gut ? riders(gut) : [];
  const form = new ActionFormData().title("胃袋");
  if (rs.length === 0) {
    form.body("§7胃袋是空的。");
    form.button("§7关闭");
    form.show(player).catch(() => { /* ignore */ });
    return;
  }
  form.body(`§f猎物 ${rs.length}/${capacity(player)} · 吸收 ${getAbsorb(player)}`);
  for (const r of rs) form.button(`§f放出：§7${r.typeId.replace("minecraft:", "")}`);
  form.button("§7关闭");
  form.show(player).then((res) => {
    if (res.canceled || res.selection >= rs.length) return;
    const prey = rs[res.selection];
    try { prey.runCommand("ride @s stop_riding"); } catch { /* ignore */ }
    try { prey.removeTag(PREY_TAG); } catch { /* ignore */ }
    try { prey.removeEffect("invisibility"); } catch { /* ignore */ }
    player.sendMessage(`§a[VCraft] 放出了 §f${prey.typeId.replace("minecraft:", "")}§a。`);
  }).catch(() => { /* ignore */ });
}

export function wireVcraft() {
  // Belly rendering is command-driven (Plan B) and no longer uses query.scoreboard,
  // so we must NOT claim a display slot here — that would clobber the gender pack's
  // pc_state objective (still used for skin selection). The pc_belly objective is
  // still created lazily by setBelly().
  // /playanimation state resets on respawn / relog; drop the cache so it re-applies.
  world.afterEvents.playerSpawn.subscribe((ev) => { lastBelly.delete(ev.player.id); });
  world.afterEvents.playerLeave.subscribe((ev) => { lastBelly.delete(ev.playerId); });

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
        reg("vcraft:swallow", "吞下附近的一只生物", swallow);
        reg("vcraft:release", "放出胃袋里的所有猎物", releaseAll);
        reg("vcraft:prey", "打开胃袋面板", openPreyMenu);
        reg("vcraft:trinkets", "打开饰品面板", openTrinketMenu);
        reg("vcraft:config", "打开 VCraft 设置", openConfigMenu);
        reg("vcraft:menu", "打开 VCraft 主菜单", openMainMenu);
      } catch { /* custom commands unsupported */ }
    });
  } catch { /* startup event unavailable on this version */ }

  // Chat shortcuts (world.beforeEvents.chatSend is a Beta API; guard it).
  try {
  world.beforeEvents.chatSend?.subscribe((ev) => {
    const raw = (ev.message || "").trim();
    const m = raw.toLowerCase();
    if (!["?swallow", "?release", "?prey", "?肚子", "?胃", "?trinkets", "?饰品", "?vcraft", "?设置", "?config", "?vcraftmenu", "?菜单"].includes(m)) return;
    ev.cancel = true;
    const player = ev.sender;
    system.runTimeout(() => {
      try {
        if (m === "?swallow") swallow(player);
        else if (m === "?release") releaseAll(player);
        else if (m === "?trinkets" || m === "?饰品") openTrinketMenu(player);
        else if (m === "?vcraft" || m === "?设置" || m === "?config") openConfigMenu(player);
        else if (m === "?vcraftmenu" || m === "?菜单") openMainMenu(player);
        else openPreyMenu(player);
      } catch { /* ignore */ }
    }, 5);
  });
  } catch { /* chatSend unavailable (Beta APIs off) */ }

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
      setBelly(player, (cfgGet(player, CFG.belly, true) && rs.length > 0) ? (rs.length <= 2 ? 1 : 2) : 0);
      if (rs.length > 0) {
        let d = 0; try { const v = player.getDynamicProperty(DIGEST_PROP); d = typeof v === "number" ? v : 0; } catch { /* ignore */ }
        try { player.onScreenDisplay.setActionBar(`§d腹部 ${rs.length}/${capacity(player)} §7· 消化 §f${Math.round(d)}%`); } catch { /* ignore */ }
      }
    }
  }, 2);

  // Digestion: slowly digest one prey at a time.
  system.runInterval(digestTick, 20);
  // Ambient: struggle sounds + wither pendant aura + escape attempts.
  system.runInterval(ambientTick, 40);
  // Overwhelmed debuffs.
  system.runInterval(overwhelmTick, 40);
  // Player-as-prey struggle/digest.
  system.runInterval(playerPreyTick, 1);

  // In-game trigger: sneak + right-click a creature to swallow it.
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    const player = ev.player;
    const target = ev.target;
    if (!player || !target || !player.isSneaking) return;
    if (target.typeId === "minecraft:player") { swallowPlayer(player, target); return; }
    if (isPreyCandidate(target, player)) swallow(player, target);
  });

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

  // Entries (test / commands).
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    const p = ev.sourceEntity;
    if (p?.typeId !== "minecraft:player") return;
    switch (ev.id) {
      case "vcraft:swallow": swallow(p); break;
      case "vcraft:release": releaseAll(p); break;
      case "vcraft:trinkets": openTrinketMenu(p); break;
      case "vcraft:config": openConfigMenu(p); break;
      case "vcraft:menu": openMainMenu(p); break;
      case "vcraft:belly": {
        const n = Number(ev.message) || 0;
        setBelly(p, n);
        p.sendMessage(`§d[VCraft] 腹部阶段 = ${Math.max(0, Math.min(2, n))} (0=平,1=小,2=大)`);
        break;
      }
      default: break;
    }
  }, { namespaces: ["vcraft"] });
}

wireVcraft();
console.warn("[VCraft] scripts loaded.");
