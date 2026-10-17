// Predator guidebook UI (port of PredGuidebookScreen / guidebook UI).
import { showPcForm } from "../ui/forms.js";
import { SKINS } from "../data/skins.js";
import { COMMUNITY } from "../data/community.js";
import { VCM } from "../data/vcm.js";
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

export async function openGuide(player) {
  while (true) {
    const res = await showPcForm(player, {
      title: "掠食者指南",
      body: "§7点一个名字，瞧瞧它是谁、爱吃什么、怎么哄。",
      level: 0,
      buttons: PRED_ORDER.map((id) => ({ id, label: `§f${NAMES[id]}` })).concat([{ id: "__options", label: "§b选项" }, { id: "__close", label: "§a关闭" }])
    });
    if (res.canceled || res.id === "__close") break;
    if (res.id === "__options") { await openOptions(player); continue; }
    if (res.id && PRED_ORDER.includes(res.id)) await openDetail(player, res.id);
  }
}

async function openDetail(player, id) {
  const variants = Object.keys(SKINS[id] || {}).length;
  const body = [`§7名字：§f${NAMES[id]}`, `§7外观款式：§f${variants}`, "", `§8${LORE[id] ?? ""}`].join("\n");
  await showPcForm(player, {
    title: NAMES[id],
    body,
    level: 0,
    buttons: [{ id: "__back", label: "§a返回" }]
  });
}
