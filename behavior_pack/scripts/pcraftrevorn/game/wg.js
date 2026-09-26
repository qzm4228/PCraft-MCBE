// Weight-gain progression (port of WGSetProcedure / WG1Returns / WG2Returns).
import { assignSkin, getNum, setNum } from "../skin/assign.js";

export const WG1_THRESHOLD = 3;
export const WG2_THRESHOLD = 7;

export function wgStage(entity) { return getNum(entity, "pc:wg"); }

/** Adds digestion progress; returns true if the stage changed. */
export function addWgProgress(entity, amount = 1) {
  const progress = getNum(entity, "pc:wg_progress") + amount;
  setNum(entity, "pc:wg_progress", progress);
  const stage = progress >= WG2_THRESHOLD ? 2 : progress >= WG1_THRESHOLD ? 1 : 0;
  if (stage !== getNum(entity, "pc:wg")) {
    setNum(entity, "pc:wg", stage);
    assignSkin(entity, getNum(entity, "pc:full") === 1);
    return true;
  }
  return false;
}
