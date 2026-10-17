// P4: struggle prompt logic ported from MobEatPlayerProcedure + the Struggle*
// procedures (Struggle*OnKeyPressed / UpIdle / UpOff / UpCorrect / UpIncorrect).
//
// Bedrock addons cannot register keybinds, so the prey performs the prompt with
// four locked hotbar items (one per direction); the server watches item use and
// feeds the direction in here.
//
// Only single-direction prompts are used. The original also asks for direction
// *pairs*, but a pair cannot be expressed reliably with one item per direction
// (the player would have to use two items inside the window and the second use
// is indistinguishable from a correction), so single directions are the only
// prompt shape.
export const DIRS = ["up", "down", "left", "right"];
export const STATES = ["off", "idle", "correct", "incorrect"];

export const allOff = () => ({ up: "off", down: "off", left: "off", right: "off" });

// sorted join matches the original animation names:
// struggleup / struggledown / struggleleft / struggleright
export const animFor = (dirs) => "struggle" + dirs.slice().sort().join("");
export const labelFor = (dirs) =>
  dirs.map((d) => ({ up: "↑", down: "↓", left: "←", right: "→" }[d])).join("");

/** Opens a prompt for a single random direction. @returns the struggle animation name. */
export function newPrompt(session, tick, timer = 60) {
  const dir = DIRS[Math.floor(Math.random() * DIRS.length)];
  session.required = [dir];
  session.promptDir = dir;
  session.pressed = new Set();
  session.wrongDirs = new Set();
  session.correctDir = undefined;
  session.awaiting = true;
  session.promptTick = tick;
  session.promptTimer = timer;
  session.anim = animFor([dir]);
  session.hud = allOff();
  session.hud[dir] = "idle";
  session.hudUntil = tick + timer;
  return session.anim;
}

/**
 * Feeds a pressed direction into the open prompt.
 * @returns {{result:"idle"|"fail"|"wrong"|"partial"|"success", anim?:string}}
 */
export function pressDir(session, dir, tick) {
  if (!session.awaiting) return { result: "idle" };
  if (tick - session.promptTick > session.promptTimer) {
    failPrompt(session, tick);
    return { result: "fail" };
  }
  if (!session.required.includes(dir)) {
    // Wrong direction: shown as `incorrect` right away, but the prompt itself only
    // fails when the window closes -- exactly like the original, which resolves
    // `all(require == press)` at timer expiry.
    session.wrongDirs.add(dir);
    session.hud[dir] = "incorrect";
    session.hudUntil = tick + 20;
    return { result: "wrong", anim: animFor([dir]) };
  }
  session.pressed.add(dir);
  session.correctDir = dir;
  session.hud[dir] = "correct";
  session.hudUntil = tick + 20;
  if (session.required.every((d) => session.pressed.has(d))) {
    session.awaiting = false;
    return { result: "success", anim: session.anim };
  }
  return { result: "partial", anim: animFor([dir]) };
}

/** Closes a prompt that ran out of time (or was abandoned). */
export function failPrompt(session, tick) {
  session.awaiting = false;
  session.pressed = new Set();
  session.wrongDirs = new Set();
  session.correctDir = undefined;
  session.hud = allOff();
  session.hudUntil = tick + 10;
  return "strugglefail";
}
