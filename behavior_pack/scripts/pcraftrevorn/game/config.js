// Per-player settings (port of PCraftGeneralConfiguration-ish knobs).
import { showPcModal } from "../ui/forms.js";

const DEFAULTS = { swallow: 25, difficulty: 40, timer: 60 };

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
      { kind: "slider", label: "挣扎难度（组合率 %）", min: 0, max: 100, step: 5, default: cfg.difficulty },
      { kind: "slider", label: "挣扎时限（刻）", min: 20, max: 200, step: 10, default: cfg.timer }
    ]
  });
  if (res.canceled) return;
  const [swallow, difficulty, timer] = res.values;
  safeSet(player, "pc:cfg", JSON.stringify({ swallow, difficulty, timer }));
  player.sendMessage(`§a[PCraft] 设置已保存：概率 ${swallow}% / 难度 ${difficulty}% / 时限 ${timer} 刻`);
}
