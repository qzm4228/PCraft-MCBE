// Multiplayer-safe player gender / body-size / preset-skin system.
//
// One scoreboard objective stores everything and is SHOWN on the list slot so
// clients can read it with query.scoreboard (client-side scoreboard queries need
// the objective to be displayed, otherwise they read 0).
//
//   pc_state = skin * 10 + sex
//     sex  : 0 = male, 1..5 = female, chest size = sex - 1 (0..4)
//     skin : 0 = own skin, 1..12 = preset texture
//
// The RP applies the chest scale (animation controller), hides the bust for
// males (render controller condition) and selects the skin texture (player
// render controllers) from pc_state.
//
// The menu is a native form; the RP re-skins it into a Wildfire's Female Gender
// Mod look (ui/gender_menu.json). The form title carries an invisible marker so
// the UI knows it is a gender menu.
import { world, system, CommandPermissionLevel, CustomCommandStatus, DisplaySlotId } from "@minecraft/server";
import { ActionFormData, ModalFormData, uiManager } from "@minecraft/server-ui";

const OBJECTIVE = "pc_state";
const SEX_MAX = 5;
const PRESET_COUNT = 12;
// Default applied to players who have not chosen anything yet:
// preset 1 (skin 1) + female (sex 4 = size 3)  =>  1*10 + 4
const DEFAULT_STATE = 14;
const OPEN_TAG = "pcgender:open";
const SOUNDS_OFF_TAG = "pcgender:sounds_off";
const HURT_SOUND = "pcraftrevorn_gender.female_hurt";

// Title state bus read by resource_pack/ui/gender_menu.json.
const MARKER = "§3§r";
const title = (female) => `${MARKER}${female ? "1" : "0"}Female Gender Mod`;

// ---------------------------------------------------------------------------
// HUD button bar (MSIFvAPI style: a persistent, transparent ActionFormData
// whose buttons are drawn by JSON-UI -- see ui/gender_menu.json "PCraft HUD").
// Only one form can be open per player, so every menu we open pauses the bar;
// it comes back as soon as that menu closes.
// ---------------------------------------------------------------------------
const HUD_TITLE = "PCraft HUD";
// The icons are sent through the form button (ActionFormData.button) and drawn
// by JSON-UI from #form_button_texture -- the same path MSIFvAPI uses.
const HUD_BUTTONS = [
  { text: "", icon: "textures/pcraftrevorn_gender/gui/hud_gender" },
  { text: "", icon: "textures/pcraftrevorn_gender/gui/hud_vore" },
];
const HUD_SWALLOW_TAG = "vcraft:want_swallow";
// unset = auto (touch only), 1 = forced on, 0 = forced off
const HUD_FORCE_PROP = "pcraftrevorn:hud_force";
const hudActive = new Set();
const menuSession = new Set();

const sleep = (ticks) => new Promise((resolve) => system.runTimeout(resolve, Math.max(1, ticks | 0)));
const isBusy = (r) => String(r?.cancelationReason ?? "").includes("Busy");
function closeForms(player) {
  try { uiManager.closeAllForms(player); } catch { /* older ui module */ }
}
function beginSession(player) {
  try { menuSession.add(player.id); } catch { /* ignore */ }
}
function endSession(player) {
  try { menuSession.delete(player.id); } catch { /* ignore */ }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v | 0));
const sexOf = (state) => state % 10;
const skinOf = (state) => Math.floor(state / 10);
const encode = (skin, sex) => clamp(skin, 0, PRESET_COUNT) * 10 + clamp(sex, 0, SEX_MAX);

function objective() {
  try {
    return world.scoreboard.getObjective(OBJECTIVE) ?? world.scoreboard.addObjective(OBJECTIVE, "性别");
  } catch {
    return undefined;
  }
}
function getState(player) {
  try {
    const obj = world.scoreboard.getObjective(OBJECTIVE);
    if (!obj) return DEFAULT_STATE;
    const s = obj.getScore(player.scoreboardIdentity);
    return typeof s === "number" && !Number.isNaN(s) ? s : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}
function hasState(player) {
  try {
    const obj = world.scoreboard.getObjective(OBJECTIVE);
    if (!obj) return false;
    return obj.getScore(player.scoreboardIdentity) !== undefined;
  } catch {
    return false;
  }
}
// Chest show/size is driven per-player by a server-side /playanimation on the
// gender pack's own-skin chest model (Geometry.b / controller.render.b).
// TEST BUILD: set FORCE_CHEST to 1..5 to force a size for everyone; null = normal.
const FORCE_CHEST = null;
const chestAnim = (sex, rot) => (sex > 0 ? `animation.pcraftrevorn.chest.size${Math.min(5, sex)}r${clamp(rot ?? 0, 0, 4)}` : "animation.pcraftrevorn.chest.off");
// Animations must be driven server-side: client Molang (render/animation
// controllers) cannot use query.scoreboard on this engine. Prefer the
// playAnimation API (visible to every player); fall back to the /playanimation
// command where that API is unavailable.
// A huge blend-out time keeps the played animation from fading back to the
// default pose (otherwise the chest flickers between the chosen size and size 3).
const PERSIST_BLEND = 999999;
function playAnim(entity, anim, controller) {
  try {
    entity.playAnimation(anim, { players: world.getAllPlayers(), blendOutTime: PERSIST_BLEND, controller });
    return;
  } catch { /* fall through */ }
  try { entity.runCommand(`playanimation @s ${anim} none ${PERSIST_BLEND} "0" ${controller}`); } catch { /* ignore */ }
}
// Chest rotation angle (0..4), stored per player; applied on top of the size.
const CHEST_ROT_PROP = "pcraftrevorn:chest_rot";
function getRot(player) {
  try { const v = player.getDynamicProperty(CHEST_ROT_PROP); return typeof v === "number" ? clamp(v, 0, 4) : 0; } catch { return 0; }
}
function setRot(player, n) {
  const v = clamp(n, 0, 4);
  try { player.setDynamicProperty(CHEST_ROT_PROP, v); } catch { /* ignore */ }
  applyChest(player, getState(player));
}
function applyChest(player, state) {
  const st = typeof state === "number" ? state : getState(player);
  const sex = FORCE_CHEST === null ? sexOf(st) : FORCE_CHEST;
  playAnim(player, chestAnim(sex, getRot(player)), "pcraftrevorn:chest");
}
// The belly mesh is owned by this pack, but VCraft shows/hides it via pc_belly.
// Once VCraft is running (it lazily creates the pc_belly objective) it drives the
// belly itself, including the grow/shrink transitions — so we only hide the belly
// ourselves while no pc_belly objective exists yet. Otherwise our always-on "off"
// would stomp VCraft's shrink and make the belly vanish as soon as the count hits 0.
function ensureBelly(player) {
  let owned = false;
  try { owned = !!world.scoreboard.getObjective("pc_belly"); } catch { owned = false; }
  if (!owned) playAnim(player, "animation.vcraft.belly.off", "pcraftrevorn:belly");
}

// ---- Belly (owned by this pack) -------------------------------------------
// The belly mesh lives here but is hidden by default through the always-on
// "belly_off" animation (player.entity.json); VCraft overrides it with
// playAnimation when the belly needs to show. Client-side query.scoreboard is
// not usable in render/animation controllers on this engine, so it is avoided.
function setState(player, value) {
  const v = clamp(value, 0, PRESET_COUNT * 10 + SEX_MAX);
  try { objective()?.setScore(player, v); } catch { /* ignore */ }
  applyChest(player, v);
}

function openSizeMenu(player) {
  const st = getState(player);
  const sex = sexOf(st);
  const size = sex > 0 ? sex - 1 : 0;
  const form = new ActionFormData().title(title(true));
  for (let i = 0; i <= 4; i++) form.button(`体型 ${i}${i === size ? " §a✔" : ""}`);
  form.button("§7返回");
  form.show(player).then((r) => {
    if (r.canceled) { endSession(player); return; }
    if (r.selection >= 0 && r.selection <= 4) {
      setState(player, encode(skinOf(st), r.selection + 1));
      system.run(() => openSizeMenu(player));
    } else {
      system.run(() => openGenderMenu(player));
    }
  }).catch(() => { endSession(player); });
}

function openRotationMenu(player) {
  const rot = getRot(player);
  const form = new ActionFormData().title(title(true));
  for (let i = 0; i <= 4; i++) form.button(`胸旋转 ${i}${i === rot ? " §a✔" : ""}`);
  form.button("§7返回");
  form.show(player).then((r) => {
    if (r.canceled) { endSession(player); return; }
    if (r.selection >= 0 && r.selection <= 4) {
      setRot(player, r.selection);
      system.run(() => openRotationMenu(player));
    } else {
      system.run(() => openGenderMenu(player));
    }
  }).catch(() => { endSession(player); });
}

function openSkinMenu(player) {
  const st = getState(player);
  const cur = skinOf(st);
  // No marker in the title: the custom overlay stays hidden so the native
  // slider form is visible and draggable.
  const form = new ModalFormData().title("性别 / 皮肤预设");
  form.slider("皮肤预设", 0, PRESET_COUNT, { valueStep: 1, defaultValue: cur, tooltip: "0 = 原版皮肤，1-12 = 预设" });
  form.show(player).then((r) => {
    if (r.canceled) { endSession(player); return; }
    const sel = Math.max(0, Math.min(PRESET_COUNT, Number(r.formValues?.[0] ?? cur)));
    setState(player, encode(sel, sexOf(st)));
    system.run(() => openGenderMenu(player));
  }).catch(() => { endSession(player); });
}

function openGenderMenu(player) {
  const st = getState(player);
  const sex = sexOf(st);
  const female = sex > 0;
  const size = female ? sex - 1 : 0;
  const skin = skinOf(st);
  const soundsOn = !player.hasTag(SOUNDS_OFF_TAG);

  const form = new ActionFormData().title(title(female));
  const actions = [];
  form.button(`性别 - ${female ? "§b女性" : "§7男性"}`); actions.push("gender");
  if (female) {
    form.button(`体型 - §b${size} / 4`); actions.push("size");
    form.button(`胸旋转 - §b${getRot(player)} / 4`); actions.push("rot");
    form.button(`女性受伤音效 - ${soundsOn ? "§a开" : "§c关"}`); actions.push("sounds");
  }
  form.button("§7关闭"); actions.push("close");

  form.show(player).then((r) => {
    if (r.canceled) { endSession(player); return; }
    switch (actions[r.selection]) {
      case "gender":
        setState(player, encode(skin, female ? 0 : (size > 0 ? size + 1 : 1)));
        system.run(() => openGenderMenu(player));
        break;
      case "size":
        system.run(() => openSizeMenu(player));
        break;
      case "rot":
        system.run(() => openRotationMenu(player));
        break;
      case "sounds":
        try { soundsOn ? player.addTag(SOUNDS_OFF_TAG) : player.removeTag(SOUNDS_OFF_TAG); } catch { /* ignore */ }
        system.run(() => openGenderMenu(player));
        break;
      default:
        endSession(player); // close
        break;
    }
  }).catch(() => { endSession(player); });
}

// ---- HUD button bar -------------------------------------------------------
async function hudLoop(player) {
  const id = player.id;
  while (hudActive.has(id)) {
    try { if (!player.isValid) return; } catch { return; }
    if (menuSession.has(id)) { await sleep(10); continue; }
    let r;
    try {
      const form = new ActionFormData().title(HUD_TITLE);
      for (const b of HUD_BUTTONS) form.button(b.text, b.icon);
      r = await form.show(player);
    } catch { r = undefined; }
    if (!hudActive.has(id)) return;
    if (!r || r.canceled) {
      // Busy = another form or the chat screen is open -> wait; closed by the
      // player -> just reopen (the bar is meant to be persistent).
      await sleep(isBusy(r) ? 20 : 10);
      continue;
    }
    if (r.selection === 0) {
      beginSession(player);
      try { openGenderMenu(player); } catch { endSession(player); }
    } else if (r.selection === 1) {
      // Instant swallow: signal the main pack, which calls startSwallow on the
      // nearest predator. No aim/hold minigame involved.
      try { player.addTag(HUD_SWALLOW_TAG); } catch { /* ignore */ }
      await sleep(10);
    }
  }
}

// HUD visibility: auto = touch devices only. The quick panel or
// /pcraftrevorn:hud can force it.
function hudWanted(player) {
  try {
    const v = player.getDynamicProperty(HUD_FORCE_PROP);
    if (v === 1) return true;
    if (v === 0) return false;
  } catch { /* ignore */ }
  try {
    const info = player.clientSystemInfo;
    if (!info) return true; // API missing on this version -> keep the old behaviour
    return info.platformType === "Mobile";
  } catch { return true; }
}

function startHud(player) {
  try {
    if (hudActive.has(player.id)) return;
    if (!hudWanted(player)) return;
    hudActive.add(player.id);
    const id = player.id;
    system.runTimeout(() => { if (hudActive.has(id)) hudLoop(player); }, 40);
  } catch { /* ignore */ }
}

function stopHud(playerOrId) {
  try {
    const id = typeof playerOrId === "string" ? playerOrId : playerOrId.id;
    hudActive.delete(id);
    menuSession.delete(id);
  } catch { /* ignore */ }
}

// Close the HUD (if it is open) and open the wardrobe menu. Used by
// /pcraftrevorn:gender and /pcraftrevorn:panel.
function openMenu(player) {
  closeForms(player);
  beginSession(player);
  openGenderMenu(player);
}

// Quick panel (/pcraftrevorn:panel): a normal form (the HUD JSON-UI buttons
// only work while the HUD form is open), and the HUD loop waits on UserBusy
// while it is up.
const QUICK_TITLE = "PCraft 面板";

function toggleHud(player) {
  const on = !hudActive.has(player.id);
  try { player.setDynamicProperty(HUD_FORCE_PROP, on ? 1 : 0); } catch { /* ignore */ }
  if (on) startHud(player);
  else stopHud(player);
  try { player.sendMessage(on ? "§7[PCraft] HUD 已开启。" : "§7[PCraft] HUD 已关闭。"); } catch { /* ignore */ }
}

async function openQuickPanel(player) {
  closeForms(player);
  let r;
  try {
    const form = new ActionFormData().title(QUICK_TITLE);
    form.button("切换 电脑 / 手机 HUD");
    form.button("打开性别面板");
    form.button("吞食（最近目标）");
    form.button("§7关闭");
    r = await form.show(player);
  } catch { r = undefined; }
  if (!r || r.canceled) return;
  if (r.selection === 0) toggleHud(player);
  else if (r.selection === 1) openMenu(player);
  else if (r.selection === 2) { try { player.addTag(HUD_SWALLOW_TAG); } catch { /* ignore */ } }
}

export function wireGender() {
  // Ensure the pc_state objective exists (server-side state only; nothing queries it client-side now).
  objective();

  // Custom commands only:
  //   /pcraftrevorn:gender  -> wardrobe panel
  //   /pcraftrevorn:panel   -> quick panel (PC/mobile HUD, gender, swallow)
  //   /pcraftrevorn:hud     -> toggle the HUD buttons
  // Wrapped so a missing custom-command API can't abort the rest of the wiring.
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
        reg("pcraftrevorn:gender", "打开性别 / 体型设置", openMenu);
        reg("pcraftrevorn:panel", "打开快捷面板", (p) => { void openQuickPanel(p); });
        reg("pcraftrevorn:hud", "开关 HUD 按钮", toggleHud);
      } catch { /* custom commands unsupported on this version */ }
    });
  } catch { /* startup event unavailable on this version */ }

  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      // apply the default the first time a player is seen
      if (!hasState(player)) setState(player, DEFAULT_STATE);
      if (player.hasTag(OPEN_TAG)) {
        try { player.removeTag(OPEN_TAG); } catch { /* ignore */ }
        system.run(() => openMenu(player));
      }
    }
  }, 10);

  // /playanimation state is not persisted across respawn / relog / dimension travel,
  // so re-apply on spawn and periodically as a safety net.
  world.afterEvents.playerSpawn.subscribe((ev) => {
    system.run(() => applyChest(ev.player, getState(ev.player)));
    startHud(ev.player);
  });
  try {
    world.afterEvents.playerLeave.subscribe((ev) => stopHud(ev.playerId));
  } catch { /* older event shape */ }
  system.runTimeout(() => { for (const p of world.getAllPlayers()) startHud(p); }, 60);
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      applyChest(player, getState(player));
      ensureBelly(player);
    }
  }, 3);

  // Wildfire female hurt sound (played at the player's position so nearby
  // players hear it as well).
  world.afterEvents.entityHurt.subscribe((ev) => {
    const e = ev.hurtEntity;
    if (e?.typeId !== "minecraft:player") return;
    if (sexOf(getState(e)) <= 0) return;
    if (e.hasTag(SOUNDS_OFF_TAG)) return;
    try {
      e.dimension.playSound(HURT_SOUND, e.location, { volume: 0.7, pitch: 1.0 });
    } catch { /* ignore */ }
  });
}
