// In-game per-species rework look-set selector.
//
// The community rework packs (Predatopia, Royal Rump, Silverfish 重绘,
// TasteTested) are imported as extra geometry/texture/animation sets on the
// existing creatures (tools/generate_variants.js). This menu lets players pick
// the active set per species; the choice is a world dynamic property applied to
// every loaded creature of that species via `pcraftrevorn:set`.
import { world, system } from "@minecraft/server";
import { ActionFormData, uiManager } from "@minecraft/server-ui";
import { VARIANTS } from "../data/variants.js";
import { MENU_MARKERS } from "../constants.js";
import { assignSkin, applyWorldSet, getNum } from "../skin/assign.js";

const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const LABEL = { zombie: "吞食僵尸", piglin_royal: "猪灵王", silverfish: "吞食蠹虫", scarecrow: "稻草人" };

const getSel = (id) => { try { const v = world.getDynamicProperty("pc:set:" + id); return typeof v === "number" ? v : 0; } catch { return 0; } };
const setSel = (id, v) => { try { world.setDynamicProperty("pc:set:" + id, v | 0); } catch { /* ignore */ } };

function entityType(id) { return `pcraftrevorn:${id}`; }

/** Pushes the current world set + recomputes the skin on every loaded creature of a species. */
export function refreshSpecies(species) {
  for (const dimId of DIMENSIONS) {
    let list;
    try { list = world.getDimension(dimId).getEntities({ type: entityType(species) }); } catch { continue; }
    for (const e of list) { applyWorldSet(e); assignSkin(e, getNum(e, "pc:full") === 1); }
  }
}

export function refreshAll() { for (const species of Object.keys(VARIANTS)) refreshSpecies(species); }

function openSpecies(player, species) {
  const vs = VARIANTS[species];
  const cur = getSel(species);
  const form = new ActionFormData().title(`${MENU_MARKERS.appearance}${LABEL[species] ?? species} · 外观`);
  const actions = [{ set: 0 }];
  form.button(`§f原版${cur === 0 ? " §a✔" : ""}`);
  vs.sets.forEach((s, i) => { form.button(`§f${s.name} §7(${s.count})${cur === i + 1 ? " §a✔" : ""}`); actions.push({ set: i + 1 }); });
  form.button("§7返回"); actions.push({ set: -1 });
  try { uiManager.closeAllForms(player); } catch { /* older ui module */ }
  form.show(player).then((r) => {
    if (r.canceled) return;
    const a = actions[r.selection];
    if (!a) return;
    if (a.set === -1) { system.run(() => openVariants(player)); return; }
    setSel(species, a.set);
    refreshSpecies(species);
    player.sendMessage(`§a[外观] ${LABEL[species] ?? species} 已切换为 ${a.set === 0 ? "原版" : vs.sets[a.set - 1].name}。`);
    system.run(() => openSpecies(player, species));
  }).catch(() => { /* ignore */ });
}

export function openVariants(player) {
  const species = Object.keys(VARIANTS);
  const form = new ActionFormData().title(`${MENU_MARKERS.appearance}社区外观 · 每生物变体`);
  form.body("§7为每种掠食者选择社区资源包提供的外观（服务端统一生效）。");
  for (const sp of species) {
    const cur = getSel(sp);
    const label = cur === 0 ? "原版" : VARIANTS[sp].sets[cur - 1]?.name ?? "?";
    form.button(`§f${LABEL[sp] ?? sp} §7- ${label}`);
  }
  form.button("§7关闭");
  try { uiManager.closeAllForms(player); } catch { /* older ui module */ }
  form.show(player).then((r) => {
    if (r.canceled || r.selection >= species.length) return;
    system.run(() => openSpecies(player, species[r.selection]));
  }).catch(() => { /* ignore */ });
}

export function wireVariants() {
  // keep newly loaded creatures in sync with the world selection
  system.runInterval(refreshAll, 60);
}
