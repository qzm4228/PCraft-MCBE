// Per-player settings (port of PCraftGeneralConfiguration-ish knobs).
import { showPcForm } from "../ui/forms.js";
import { openVariants } from "./variants.js";

const DEFAULTS = { swallow: 25, difficulty: 40, timer: 80 };

const KNOBS = [
  { key: "swallow", label: "被吞概率", min: 0, max: 100, step: 5, unit: "%" },
  { key: "difficulty", label: "挣扎难度", min: 0, max: 100, step: 5, unit: "%" },
  { key: "timer", label: "挣扎时限", min: 20, max: 200, step: 10, unit: " 刻" },
];

const safeGet = (p, k) => { try { return p.getDynamicProperty(k); } catch { return undefined; } };
const safeSet = (p, k, v) => { try { p.setDynamicProperty(k, v); } catch { /* ignore */ } };

export function getCfg(player) {
  const raw = safeGet(player, "pc:cfg");
  if (typeof raw === "string" && raw.length) {
    try { return { ...DEFAULTS, ...JSON.parse(raw) }; } catch { /* ignore */ }
  }
  return { ...DEFAULTS };
}

export async function openSettings(player) {
  const cfg = getCfg(player);
  for (;;) {
    const buttons = [];
    for (const k of KNOBS) {
      buttons.push({ id: `${k.key}:-`, label: `§f${k.label} §e${cfg[k.key]}${k.unit} §7◀ 减少` });
      buttons.push({ id: `${k.key}:+`, label: `§f${k.label} §e${cfg[k.key]}${k.unit} §7增加 ▶` });
    }
    buttons.push({ id: "__back", label: "§a完成" });
    const res = await showPcForm(player, {
      title: "PCraft 设置",
      body: "§7每次点击立即保存，数值限制在合法范围内。",
      level: 0,
      buttons,
    });
    if (res.canceled || res.id === "__back") break;
    const [key, dir] = String(res.id).split(":");
    const k = KNOBS.find((x) => x.key === key);
    if (!k) continue;
    const delta = dir === "+" ? k.step : -k.step;
    cfg[k.key] = Math.max(k.min, Math.min(k.max, cfg[k.key] + delta));
    safeSet(player, "pc:cfg", JSON.stringify(cfg));
  }
  player.sendMessage(`§a[PCraft] 设置：概率 ${cfg.swallow}% / 难度 ${cfg.difficulty}% / 时限 ${cfg.timer} 刻`);
}

/** Options hub: game settings + appearance (community rework look-sets). */
export async function openOptions(player) {
  while (true) {
    const res = await showPcForm(player, {
      title: "PCraft 选项",
      menu: "options",
      body: "§7游戏设置与外观设置。",
      level: 0,
      buttons: [
        { id: "game", label: "§f游戏设置" },
        { id: "look", label: "§f外观设置 §7(社区变体)" },
        { id: "__back", label: "§a返回" }
      ]
    });
    if (res.canceled || res.id === "__back") break;
    if (res.id === "game") await openSettings(player);
    else if (res.id === "look") await openVariants(player);
  }
}
