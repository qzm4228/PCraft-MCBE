// Predator guidebook UI (port of PredGuidebookScreen / guidebook UI).
import { showPcForm } from "../ui/forms.js";
import { SKINS } from "../data/skins.js";
import { COMMUNITY } from "../data/community.js";
import { openOptions } from "./config.js";

const NAMES = {
  basaltmite: "玄武岩虫",
  gilded_basaltmite: "鎏金玄武岩虫",
  silverfish: "吞食蠹虫",
  vinemaiden: "藤娘",
  zombie: "吞食僵尸",
  bibaso_zombie: "Bibaso 僵尸",
  scarecrow: "稻草人",
  rabbit_wizard: "兔法师",
  piglin_royal: "猪灵王",
  piglin_royal_knight: "猪灵王骑士"
};
const LORE = {
  basaltmite: "生活在下界玄武岩三角洲，能开采远古残骸，可喂食下界矿石驯养。",
  gilded_basaltmite: "玄武岩虫的鎏金变种，可从矿石提炼黄金，可用金苹果取信。",
  silverfish: "蠹虫的变异体，可从岩石中为你提取矿石。",
  vinemaiden: "埋伏型掠食者，白天埋在地下，夜晚狩猎，可被驯服。",
  zombie: "放弃追逐大脑，转而整只吞噬猎物的贪婪僵尸。",
  bibaso_zombie: "Bibaso 风格的吞食僵尸，独立行动，同样会把猎物吞进肚子消化。",
  scarecrow: "白天守护田地、加速周围作物生长，夜间外出狩猎。",
  rabbit_wizard: "村庄的忠诚守护者，可用金胡萝卜赢得信任。",
  piglin_royal: "贪婪的猪灵王者，尊重力量的象征，可与它交易。",
  piglin_royal_knight: "猪灵王的卫兵，可用猪灵王护符赠予成为你的护卫。"
};

Object.assign(NAMES, COMMUNITY.names ?? {});
Object.assign(LORE, COMMUNITY.lore ?? {});
const PRED_ORDER = Object.keys(NAMES);

export async function openGuide(player) {
  while (true) {
    const res = await showPcForm(player, {
      title: "掠食者指南",
      body: "§7选择一种掠食者查看信息。",
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
  const body = [`§7名称：§f${NAMES[id]}`, `§7贴图变体：§f${variants}`, "", `§8${LORE[id] ?? ""}`].join("\n");
  await showPcForm(player, {
    title: NAMES[id],
    body,
    level: 0,
    buttons: [{ id: "__back", label: "§a返回" }]
  });
}
