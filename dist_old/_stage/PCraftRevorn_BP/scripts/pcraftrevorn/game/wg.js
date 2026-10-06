// Weight-gain progression (ported from WGSetProcedure / WG1Returns / WG2Returns /
// IncreaseStatsProcedure). Thresholds: progress === wg1 -> stage 1; >= wg2 -> stage 2.
import { assignSkin, getNum, setNum } from "../skin/assign.js";

export const wgStage = (entity) => getNum(entity, "pc:wg");

// IncreaseStatsProcedure: stronger/ harder to escape on each weight-gain stage
function increaseStats(entity) {
  setNum(entity, "pc:swallow", getNum(entity, "pc:swallow", 0.25) * 1.25);
  setNum(entity, "pc:struggles", getNum(entity, "pc:struggles", 7) + 1);
  setNum(entity, "pc:difficulty", Math.min(1, getNum(entity, "pc:difficulty", 0.3) * 1.1));
}

/** Adds digestion progress; returns true if the weight-gain stage changed. */
export function addWgProgress(entity, amount = 1) {
  const progress = getNum(entity, "pc:wg_progress", 0) + amount;
  setNum(entity, "pc:wg_progress", progress);
  const wg1 = getNum(entity, "pc:wg1", 1);
  const wg2 = getNum(entity, "pc:wg2", 4);
  let stage = 0;
  if (progress >= wg2) stage = 2;
  else if (progress >= wg1) stage = 1;
  if (stage !== getNum(entity, "pc:wg")) {
    setNum(entity, "pc:wg", stage);
    increaseStats(entity);
    assignSkin(entity, getNum(entity, "pc:full") === 1);
    return true;
  }
  return false;
}
