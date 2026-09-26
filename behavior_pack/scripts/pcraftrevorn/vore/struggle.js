// P4: struggle prompt logic ported from MobEatPlayerProcedure + Struggle*Procedure.
// A prompt requires either one direction or a pair of directions. Bedrock cannot
// register keybinds, so the player performs them with on-screen form buttons.
export const DIRS = ["up", "down", "left", "right"];
const PAIRS = [
  ["up", "down"], ["up", "left"], ["up", "right"],
  ["down", "left"], ["down", "right"], ["left", "right"]
];

// sorted join matches the original animation names:
// updown / upleft / upright / downleft / downright / leftright / up / down / left / right
export const animFor = (dirs) => "struggle" + dirs.slice().sort().join("");
export const labelFor = (dirs) => dirs.map((d) => ({ up: "↑", down: "↓", left: "←", right: "→" }[d])).join("");

export function newPrompt(session, tick, difficulty = 0.4, timer = 60) {
  const usePair = Math.random() <= difficulty;
  const required = usePair
    ? PAIRS[Math.floor(Math.random() * PAIRS.length)]
    : [DIRS[Math.floor(Math.random() * DIRS.length)]];
  session.required = required;
  session.pressed = new Set();
  session.awaiting = true;
  session.promptTick = tick;
  session.promptTimer = timer;
  session.anim = animFor(required);
  return session.anim;
}

/**
 * @returns {{result:"idle"|"fail"|"partial"|"success", anim?:string}}
 */
export function pressDir(session, dir, tick) {
  if (!session.awaiting) return { result: "idle" };
  if (tick - session.promptTick > session.promptTimer) { session.awaiting = false; return { result: "fail" }; }
  if (!session.required.includes(dir)) { session.awaiting = false; return { result: "fail" }; }
  session.pressed.add(dir);
  if (session.required.every((d) => session.pressed.has(d))) {
    session.awaiting = false;
    return { result: "success", anim: session.anim };
  }
  return { result: "partial", anim: animFor([dir]) };
}
