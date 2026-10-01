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
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const OBJECTIVE = "pc_state";
const SEX_MAX = 5;
const PRESET_COUNT = 12;
// Default applied to players who have not chosen anything yet:
// preset 1 (skin 1) + female (sex 4 = size 3)  =>  1*10 + 4
const DEFAULT_STATE = 14;
const OPEN_TAG = "pcgender:open";
// Payload sent by the chat-screen button (resource_pack/ui/chat_screen.json).
const BUTTON_TOKEN = "pcgender_open";
const SOUNDS_OFF_TAG = "pcgender:sounds_off";
const HURT_SOUND = "pcraftrevorn_gender.female_hurt";

// Title state bus read by resource_pack/ui/gender_menu.json.
const MARKER = "§3§r";
const title = (female) => `${MARKER}${female ? "1" : "0"}Female Gender Mod`;

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
function setState(player, value) {
  try { objective()?.setScore(player, clamp(value, 0, PRESET_COUNT * 10 + SEX_MAX)); } catch { /* ignore */ }
}

function openSizeMenu(player) {
  const st = getState(player);
  const sex = sexOf(st);
  const size = sex > 0 ? sex - 1 : 0;
  const form = new ActionFormData().title(title(true));
  for (let i = 0; i <= 4; i++) form.button(`体型 ${i}${i === size ? " §a✔" : ""}`);
  form.button("§7返回");
  form.show(player).then((r) => {
    if (r.canceled) return;
    if (r.selection >= 0 && r.selection <= 4) {
      setState(player, encode(skinOf(st), r.selection + 1));
      system.run(() => openSizeMenu(player));
    } else {
      system.run(() => openGenderMenu(player));
    }
  }).catch(() => { /* ignore */ });
}

function openSkinMenu(player) {
  const st = getState(player);
  const cur = skinOf(st);
  // No marker in the title: the custom overlay stays hidden so the native
  // slider form is visible and draggable.
  const form = new ModalFormData().title("性别 / 皮肤预设");
  form.slider("皮肤预设", 0, PRESET_COUNT, { valueStep: 1, defaultValue: cur, tooltip: "0 = 原版皮肤，1-12 = 预设" });
  form.show(player).then((r) => {
    if (r.canceled) return;
    const sel = Math.max(0, Math.min(PRESET_COUNT, Number(r.formValues?.[0] ?? cur)));
    setState(player, encode(sel, sexOf(st)));
    system.run(() => openGenderMenu(player));
  }).catch(() => { /* ignore */ });
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
    form.button(`皮肤预设 - ${skin === 0 ? "§7原版" : `§b预设 ${skin}`}`); actions.push("skin");
    form.button(`女性受伤音效 - ${soundsOn ? "§a开" : "§c关"}`); actions.push("sounds");
  }
  form.button("§7关闭"); actions.push("close");

  form.show(player).then((r) => {
    if (r.canceled) return;
    switch (actions[r.selection]) {
      case "gender":
        setState(player, encode(skin, female ? 0 : (size > 0 ? size + 1 : 1)));
        system.run(() => openGenderMenu(player));
        break;
      case "size":
        system.run(() => openSizeMenu(player));
        break;
      case "skin":
        system.run(() => openSkinMenu(player));
        break;
      case "sounds":
        try { soundsOn ? player.addTag(SOUNDS_OFF_TAG) : player.removeTag(SOUNDS_OFF_TAG); } catch { /* ignore */ }
        system.run(() => openGenderMenu(player));
        break;
      default:
        break; // close
    }
  }).catch(() => { /* player left / busy */ });
}

export function wireGender() {
  const obj = objective();
  // Show the objective so clients receive it for query.scoreboard.
  if (obj) { try { world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.List, obj); } catch { /* ignore */ } }

  const open = (player) => {
    system.runTimeout(() => { try { player.addTag(OPEN_TAG); } catch { /* ignore */ } }, 5);
  };

  // Stable entry: custom command /gender.
  system.beforeEvents.startup.subscribe((init) => {
    try {
      init.customCommandRegistry.registerCommand(
        { name: "pcraftrevorn:gender", description: "打开性别 / 体型设置", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
        (origin) => {
          const p = origin.sourceEntity;
          if (p?.typeId === "minecraft:player") { system.run(() => openGenderMenu(p)); return { status: CustomCommandStatus.Success }; }
          return { status: CustomCommandStatus.Failure, message: "只能由玩家执行。" };
        }
      );
    } catch { /* custom commands unsupported on this version */ }
  });

  // Chat entries: the screen button token + typed shortcuts.
  world.beforeEvents.chatSend.subscribe((ev) => {
    const raw = (ev.message || "").trim();
    const low = raw.toLowerCase();
    if (!raw.includes(BUTTON_TOKEN) && low !== "?gender" && low !== "?性别" && low !== "?settingmenu") return;
    ev.cancel();
    open(ev.sender);
  });

  system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      // apply the default the first time a player is seen
      if (!hasState(player)) setState(player, DEFAULT_STATE);
      if (player.hasTag(OPEN_TAG)) {
        try { player.removeTag(OPEN_TAG); } catch { /* ignore */ }
        system.run(() => openGenderMenu(player));
      }
    }
  }, 10);

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
