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
import { ActionFormData, uiManager } from "@minecraft/server-ui";

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
// Build-time switch (not a runtime platform check):
//   PC package     -> false: modal menus, no HUD bar
//   Mobile package -> true : non-modal screen + HUD bar
// tools_py/build_config.py rewrites this exact line for the Mobile build.
const HUD_ENABLED = false;
// The art is drawn directly by JSON-UI from $tex / $tex_pressed (see
// ui/gender_menu.json); no icon is sent through the form button.
const HUD_BUTTONS = ["", ""];
const HUD_SWALLOW_TAG = "vcraft:want_swallow";
// unset = auto (touch only), 1 = forced on, 0 = forced off
const HUD_FORCE_PROP = "pcraftrevorn:hud_force";
const hudActive = new Set();
const menuSession = new Set();

// ---- true first person (tiny orbit camera + head-hide animation) ----------
// A follow_orbit camera with radius 0.1 sits at the player's head, and a
// server-played animation hides the head and shifts the waist/legs toward the
// camera. The third-person render controller then draws the body, which reads
// as a real first-person body. The animation lives in
// resource_pack/animations/first_person.animation.json.
const FP_PROP = "pcraftrevorn:first_person";
const FP_CAMERA = "pcraftrevorn_gender:first_person";
const FP_ANIM = "animation.pcraftrevorn_gender.fp_hide";
const FP_STOP = "animation.pcraftrevorn_gender.fp_stop";
const FP_BLEND = 999999;
// Camera-pivot offsets (blocks, entity-local) for the states our player
// animations lean the body into. The values are the head displacement of the
// matching animation frames (1 model unit = 0.0586 blocks):
//   sprint: waist 15 deg  -> head ~+0.20 z, ~-0.03 y
//   sneak : waist 35 deg  -> head ~+0.45 z, ~+0.03 y
// They keep the pivot on the animated head instead of the vanilla eye.
const FP_OFFSETS = {
  default: { x: 0, y: 0, z: 0 },
  sprinting: { x: 0, y: -0.03, z: 0.2 },
  sneaking: { x: 0, y: 0.03, z: 0.45 },
};
const FP_EASE = 0.55; // per 2-tick step -> settles in ~0.35 s
const fpMode = new Map(); // playerId -> "off" | "normal" | "model"
const fpOffset = new Map(); // playerId -> {x,y,z}

function firstPersonOn(player) {
  try { return player.getDynamicProperty(FP_PROP) === true; } catch { return false; }
}
function firstPersonBlocked(player) {
  try { if (player.isGliding || player.isSwimming || player.isSleeping) return true; } catch { /* ignore */ }
  try { if (player.getComponent("minecraft:riding")?.entityRidingOn) return true; } catch { /* ignore */ }
  try {
    const item = player.getComponent("minecraft:equippable")?.getEquipment("Mainhand");
    if (item?.typeId === "minecraft:spyglass") return true;
  } catch { /* ignore */ }
  return false;
}
function fpOffsetTarget(player) {
  try { if (player.isSneaking) return FP_OFFSETS.sneaking; } catch { /* ignore */ }
  try { if (player.isSprinting) return FP_OFFSETS.sprinting; } catch { /* ignore */ }
  return FP_OFFSETS.default;
}
function fpPlayHide(player) {
  try {
    player.playAnimation(FP_ANIM, { blendOutTime: FP_BLEND, players: [player] });
  } catch { /* ignore */ }
}
function fpStopHide(player) {
  // Playing another animation on the same (default) controller replaces the
  // head-hide pose; this stop pose only restores head scale 1, so the body
  // positions fall back to the normal animation controllers.
  try {
    player.playAnimation(FP_STOP, { blendOutTime: 0.15, players: [player] });
  } catch { /* ignore */ }
}
function fpSetCamera(player, model) {
  try {
    if (model) {
      player.camera.setCamera(FP_CAMERA, { entityOffset: fpOffset.get(player.id) ?? FP_OFFSETS.default });
    } else {
      player.camera.setCamera("minecraft:first_person");
    }
    return true;
  } catch { return false; }
}
function fpSync(player, force = false) {
  if (!player?.isValid) return;
  const want = !firstPersonOn(player) ? "off" : firstPersonBlocked(player) ? "normal" : "model";
  const prev = fpMode.get(player.id);
  if (!force && prev === want) return;
  fpMode.set(player.id, want);
  if (want === "model") {
    if (prev !== "model") fpOffset.set(player.id, { x: 0, y: 0, z: 0 });
    // Never hide the head unless the custom camera actually took over: on an
    // engine without the preset that would leave a headless body in 3rd person.
    if (!fpSetCamera(player, true)) {
      if (prev === "model") fpStopHide(player);
      fpMode.set(player.id, "normal");
      fpOffset.delete(player.id);
      fpSetCamera(player, false);
      return;
    }
    if (prev !== "model") fpPlayHide(player);
  } else if (want === "normal") {
    fpOffset.delete(player.id);
    if (prev === "model") fpStopHide(player);
    fpSetCamera(player, false);
  } else if (prev === "model" || prev === "normal") {
    fpOffset.delete(player.id);
    fpStopHide(player);
    try { player.camera.clear(); } catch { /* ignore */ }
  }
}
// Ease the pivot toward the state offset every 2 ticks so sprint/sneak changes
// glide instead of snapping. It also re-checks riding/swimming so entering
// water or a mount leaves the model camera within two ticks.
function fpEaseTick() {
  for (const player of world.getAllPlayers()) {
    fpSync(player);
    if (fpMode.get(player.id) !== "model") continue;
    const target = fpOffsetTarget(player);
    const cur = fpOffset.get(player.id) ?? { x: 0, y: 0, z: 0 };
    const nx = cur.x + (target.x - cur.x) * FP_EASE;
    const ny = cur.y + (target.y - cur.y) * FP_EASE;
    const nz = cur.z + (target.z - cur.z) * FP_EASE;
    if (Math.abs(nx - cur.x) < 0.001 && Math.abs(ny - cur.y) < 0.001 && Math.abs(nz - cur.z) < 0.001) {
      if (cur.x !== target.x || cur.y !== target.y || cur.z !== target.z) {
        fpOffset.set(player.id, { ...target });
        fpSetCamera(player, true);
      }
      continue;
    }
    fpOffset.set(player.id, { x: nx, y: ny, z: nz });
    fpSetCamera(player, true);
  }
}

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
// The chest / belly pose is re-asserted by a periodic loop. Re-issuing the same
// animation every 3 ticks (the old behaviour) means ~13 playAnimation calls per
// second per player: on PCs that is invisible, on phones it floods the animation
// and command pipelines and is a known source of stutter / crashes. Remember the
// last pose per (entity, controller) and only re-send it when it actually
// changes, plus a low-frequency forced refresh that survives respawn / dimension
// changes.
const POSE_REFRESH = 200; // ticks (10 s)
const lastPose = new Map(); // `<entityId>|<controller>` -> animation id
function playAnim(entity, anim, controller, force = false) {
  const key = `${entity.id}|${controller}`;
  if (!force && lastPose.get(key) === anim) return;
  lastPose.set(key, anim);
  try {
    entity.playAnimation(anim, { players: world.getAllPlayers(), blendOutTime: PERSIST_BLEND, controller });
    return;
  } catch { /* fall through */ }
  try { entity.runCommand(`playanimation @s ${anim} none ${PERSIST_BLEND} "0" ${controller}`); } catch { lastPose.delete(key); }
}
function clearPose(id) {
  const prefix = id + "|";
  for (const key of lastPose.keys()) if (key.startsWith(prefix)) lastPose.delete(key);
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
function applyChest(player, state, force = false) {
  const st = typeof state === "number" ? state : getState(player);
  const sex = FORCE_CHEST === null ? sexOf(st) : FORCE_CHEST;
  playAnim(player, chestAnim(sex, getRot(player)), "pcraftrevorn:chest", force);
}
// The belly mesh is owned by this pack, but VCraft shows/hides it via pc_belly.
// Once VCraft is running (it lazily creates the pc_belly objective) it drives the
// belly itself, including the grow/shrink transitions — so we only hide the belly
// ourselves while no pc_belly objective exists yet. Otherwise our always-on "off"
// would stomp VCraft's shrink and make the belly vanish as soon as the count hits 0.
function ensureBelly(player, force = false) {
  let owned = false;
  try { owned = !!world.scoreboard.getObjective("pc_belly"); } catch { owned = false; }
  if (!owned) playAnim(player, "animation.vcraft.belly.off", "pcraftrevorn:belly", force);
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
  const form = new ActionFormData().title(title(true));
  form.button("§f◀ 上一个预设");
  form.button(`§f当前：§e${cur === 0 ? "原版皮肤" : `预设 ${cur}`}`);
  form.button("§f下一个预设 ▶");
  form.button("§7返回");
  form.show(player).then((r) => {
    if (r.canceled) { endSession(player); return; }
    const total = PRESET_COUNT + 1;
    if (r.selection === 0) {
      setState(player, encode((cur + total - 1) % total, sexOf(st)));
      system.run(() => openSkinMenu(player));
    } else if (r.selection === 2) {
      setState(player, encode((cur + 1) % total, sexOf(st)));
      system.run(() => openSkinMenu(player));
    } else if (r.selection === 3) {
      system.run(() => openGenderMenu(player));
    }
  }).catch(() => { endSession(player); });
}

function openGenderMenu(player) {
  const st = getState(player);
  const sex = sexOf(st);
  const female = sex > 0;
  const size = female ? sex - 1 : 0;
  const skin = skinOf(st);
  const soundsOn = !player.hasTag(SOUNDS_OFF_TAG);
  const fpOn = firstPersonOn(player);

  const form = new ActionFormData().title(title(female));
  const actions = [];
  form.button(`性别 - ${female ? "§b女性" : "§7男性"}`); actions.push("gender");
  if (female) {
    form.button(`体型 - §b${size} / 4`); actions.push("size");
    form.button(`胸旋转 - §b${getRot(player)} / 4`); actions.push("rot");
    form.button(`女性受伤音效 - ${soundsOn ? "§a开" : "§c关"}`); actions.push("sounds");
  }
  form.button(`第一人称模型 - ${fpOn ? "§a开" : "§c关"}`); actions.push("firstperson");
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
      case "firstperson":
        try { player.setDynamicProperty(FP_PROP, !fpOn); } catch { /* ignore */ }
        fpSync(player, true);
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
      for (const label of HUD_BUTTONS) form.button(label);
      r = await form.show(player);
    } catch { r = undefined; }
    if (!hudActive.has(id)) return;
    if (!r) { await sleep(10); continue; }
    if (r.canceled) {
      // Busy = the chat / another form is open -> retry. A real cancel is the
      // player dismissing the bar: stop here (MSIFvAPI does the same) so the
      // vanilla touch controls come back; /pcraftrevorn:hud re-opens it.
      if (isBusy(r)) { await sleep(20); continue; }
      hudActive.delete(id);
      try { player.sendMessage("§7[PCraft] HUD 已收起，输入 /pcraftrevorn:hud 可重新打开。"); } catch { /* ignore */ }
      return;
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

// HUD visibility is decided by the package, not by runtime platform sniffing:
// the Mobile build flips HUD_ENABLED on, the PC build leaves it off.
// /pcraftrevorn:hud can still force it off/on for the current player.
function hudWanted(player) {
  if (!HUD_ENABLED) return false;
  try {
    if (player.getDynamicProperty(HUD_FORCE_PROP) === 0) return false;
  } catch { /* ignore */ }
  return true;
}

function startHud(player) {
  try {
    if (hudActive.has(player.id)) return;
    if (!HUD_ENABLED) return;
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
// Invisible PCraft form marker (same as the BP's TITLE_MARKER): the JSON-UI
// shell in gender_menu.json draws every title that contains it.
const PCRAFT_MARKER = "§0§r§1§r";
const QUICK_TITLE = `${PCRAFT_MARKER}PCraft 面板`;

function toggleHud(player) {
  if (!HUD_ENABLED) {
    try { player.sendMessage("§7[PCraft] 此版本不提供 HUD 按钮。"); } catch { /* ignore */ }
    return;
  }
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
    form.button("打开性别面板");
    form.button("吞食（最近目标）");
    form.button("§7关闭");
    r = await form.show(player);
  } catch { r = undefined; }
  if (!r || r.canceled) return;
  if (r.selection === 0) openMenu(player);
  else if (r.selection === 1) { try { player.addTag(HUD_SWALLOW_TAG); } catch { /* ignore */ } }
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
    clearPose(ev.player.id);
    fpMode.delete(ev.player.id);
    system.run(() => applyChest(ev.player, getState(ev.player), true));
    system.runTimeout(() => { try { if (ev.player.isValid) fpSync(ev.player, true); } catch { /* ignore */ } }, 20);
    startHud(ev.player);
  });
  try {
    world.afterEvents.playerLeave.subscribe((ev) => { clearPose(ev.playerId); stopHud(ev.playerId); fpMode.delete(ev.playerId); });
  } catch { /* older event shape */ }
  try {
    world.afterEvents.playerDimensionChange.subscribe((ev) => {
      fpMode.delete(ev.player.id);
      system.runTimeout(() => { try { fpSync(ev.player, true); } catch { /* ignore */ } }, 20);
    });
  } catch { /* event unavailable on this engine */ }
  system.runTimeout(() => { for (const p of world.getAllPlayers()) startHud(p); }, 60);
  // Smooth first-person pivot (every 2 ticks; only hits the camera while moving).
  system.runInterval(fpEaseTick, 2);
  // Safety net only: the pose cache means a normal tick sends nothing. The
  // forced refresh every POSE_REFRESH ticks covers respawn / dimension travel.
  let poseClock = 0;
  system.runInterval(() => {
    poseClock += 1;
    const force = poseClock % Math.max(1, Math.round(POSE_REFRESH / 20)) === 0;
    for (const player of world.getAllPlayers()) {
      applyChest(player, getState(player), force);
      ensureBelly(player, force);
      // Re-assert the camera once per second (the reference re-applies every
      // tick); recovers from dimension changes / respawns even if the event
      // listener is unavailable on this engine.
      if (firstPersonOn(player)) fpSync(player, true);
    }
  }, 20);

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
