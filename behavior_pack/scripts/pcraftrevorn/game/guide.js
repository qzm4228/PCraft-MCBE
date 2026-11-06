// Predator guidebook UI (port of PredGuidebookScreen / guidebook UI).
import { showPcForm, showPcPaged } from "../ui/forms.js";
import { SKINS } from "../data/skins.js";
import { COMMUNITY } from "../data/community.js";
import { VCM } from "../data/vcm.js";
import { TAME } from "../data/tame.js";
import { openOptions } from "./config.js";

const NAMES = {
  basaltmite: "玄武岩虫",
  gilded_basaltmite: "鎏金玄武岩虫",
  silverfish: "吞食蠹虫",
  vinemaiden: "藤娘",
  zombie: "吞食僵尸",
  scarecrow: "稻草人",
  rabbit_wizard: "兔法师",
  piglin_royal: "猪灵王",
  piglin_royal_knight: "猪灵王骑士"
};
const LORE = {
  basaltmite: "住下界玄武岩三角洲的小矿工，闻到远古残骸就走不动路。喂几块矿石，它就把你当自己人。",
  gilded_basaltmite: "玄武岩虫的金光闪闪版，能把矿石变成黄金。递个金苹果，它立马对你摇尾巴。",
  silverfish: "从石头缝里钻出来的小家伙，会帮你把矿石叼出来。个头小，肚子可不小。",
  vinemaiden: "白天把自己埋进土里装植物，天黑了才出来觅食。想跟她做朋友？多带点心，别站太近。",
  zombie: "脑子？早就吃腻了。现在的它，连人带骨头囫囵吞下去。",
  scarecrow: "白天下地干活，让周围作物蹭蹭长；太阳一落山，就换它出去觅食。",
  rabbit_wizard: "村庄的老守卫，脾气有点傲。金胡萝卜是它的软肋。",
  piglin_royal: "贪得无厌的猪灵之王。谁拳头硬它敬谁，也能坐下来跟你做买卖。",
  piglin_royal_knight: "猪灵王的贴身护卫。递上猪灵王护符，它就跟着你走。"
};

Object.assign(NAMES, COMMUNITY.names ?? {});
Object.assign(LORE, COMMUNITY.lore ?? {});
Object.assign(NAMES, VCM.names ?? {});
Object.assign(LORE, VCM.lore ?? {});
const PRED_ORDER = Object.keys(NAMES);

// Who is neutral and who can be tamed with what (data/tame.js, generated from
// each entity's minecraft:tameable so the guide can never drift from the engine).
const NEUTRAL = new Set(VCM.neutral ?? []);
const VCM_IDS = new Set(VCM.predatorIds ?? []);
const ITEM_NAMES = {
  "pcraftrevorn:cupids_arrow": "丘比特之箭",
  "minecraft:slime_ball": "史莱姆球",
  "minecraft:golden_apple": "金苹果",
  "minecraft:golden_carrot": "金胡萝卜",
  "pcraftrevorn:piglin_royal_talisman": "猪灵王护符"
};
const itemLabel = (id) => ITEM_NAMES[id] ?? id.split(":").pop();

export async function openGuide(player) {
  while (true) {
    const res = await showPcPaged(player, {
      title: "掠食者指南",
      body: "§7点一个名字，瞧瞧它是谁、爱吃什么、怎么哄。",
      level: 0,
      items: PRED_ORDER.map((id) => ({ id, label: `§f${NAMES[id]}` })),
      footer: [{ id: "__options", label: "§b选项" }, { id: "__close", label: "§a关闭" }]
    });
    if (res.canceled || res.id === "__close") break;
    if (res.id === "__options") { await openOptions(player); continue; }
    if (res.id && PRED_ORDER.includes(res.id)) await openDetail(player, res.id);
  }
}

async function openDetail(player, id) {
  const variants = Object.keys(SKINS[id] || {}).length;
  const lines = [`§7名字：§f${NAMES[id]}`, `§7外观款式：§f${variants}`];
  if (NEUTRAL.has(id)) {
    lines.push("§7脾气：§f中立 §8（不主动袭击玩家，被打了会还手）");
  }
  const tame = TAME[id];
  if (tame) {
    if (tame.items && tame.items.length) {
      const items = tame.items.map(itemLabel).join("§7 / §f");
      const chance = Math.round((tame.chance ?? 1) * 100);
      const rate = chance >= 100 ? "§a必定成功" : `§f${chance}%`;
      lines.push(`§7驯服：§f手持${items}§f右键它 §8· ${rate} §8，或§e丘比特之箭§8射中它`);
    } else {
      lines.push("§7驯服：§f用§e丘比特之箭§f射中它，箭到即驯服");
    }
  } else if (VCM_IDS.has(id)) {
    lines.push("§7驯服：§8不可驯服");
  }
  lines.push("", `§8${LORE[id] ?? ""}`);
  await showPcForm(player, {
    title: NAMES[id],
    body: lines.join("\n"),
    level: 0,
    buttons: [{ id: "__back", label: "§a返回" }]
  });
}
