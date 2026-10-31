// Per-player settings (port of PCraftGeneralConfiguration-ish knobs).
import { showPcModal, showPcForm } from "../ui/forms.js";
import { openVariants } from "./variants.js";

const DEFAULTS = { swallow: 25, difficulty: 40, timer: 80 };

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
  const res = await showPcModal(player, {
    title: "PCraft 设置",
    controls: [
      { kind: "slider", label: "被吞概率 (%)", min: 0, max: 100, step: 5, default: cfg.swallow },
      { kind: "slider", label: "挣扎难度 (%) — 越高判定窗口越短", min: 0, max: 100, step: 5, default: cfg.difficulty },
      { kind: "slider", label: "挣扎时限 (刻) — 判定窗口基准", min: 20, max: 200, step: 10, default: cfg.timer }
    ]
  });
  if (res.canceled) return;
  const [swallow, difficulty, timer] = res.values;
  safeSet(player, "pc:cfg", JSON.stringify({ swallow, difficulty, timer }));
  player.sendMessage(`§a[PCraft] 设置已保存：概率 ${swallow}% / 难度 ${difficulty}% / 时限 ${timer} 刻`);
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
