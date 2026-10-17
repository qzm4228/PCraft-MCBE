// PCraftRevorn - shared UI markers / state bus.
//
// Bedrock JSON-UI cannot be scripted directly, so the form *title* is used as a
// state bus: we prepend invisible formatting-code markers that the custom
// server_form UI reads back with string operations (same trick as Ponder).
//
// Title layout:  TITLE_MARKER + PROGRESS_MARKER + progressCode(level) + humanTitle
//   - TITLE_MARKER gates whether our custom layer shows at all
//   - progressCode(level) selects one of 16 progress-bar fill widths

export const TITLE_MARKER = "§0§r§1§r";
export const PROGRESS_MARKER = "§2§r";

const HEX = "0123456789abcdef";
export const MAX_LEVEL = HEX.length - 1;

export const progressCode = (level) => {
  const i = Math.max(0, Math.min(MAX_LEVEL, level | 0));
  return `§${HEX[i]}§r`;
};

export const buildTitle = (humanTitle, level) =>
  `${TITLE_MARKER}${PROGRESS_MARKER}${progressCode(level)}${humanTitle ?? ""}`;

// ---------------------------------------------------------------------------
// HUD bus (JSON-UI)
//
// The HUD screen cannot be scripted either, and its only globally readable
// bindings are the game's own. So the vore HUD rides the *boss bar* instead: the
// digestion-bar entity already draws a real bar (health = acid level) and its
// nameTag is exposed to JSON-UI as the collection binding `#bossName`.
//
// Name layout:  TITLE_MARKER + one marker per direction
//   marker = PROGRESS_MARKER + progressCode(dirIndex * 4 + stateIndex)
// so hud/pcraftrevorn_hud.json can test for each of the 16 direction/state
// sprites with the same `(not ((#name - 'marker') = #name))` trick the forms use.
export const HUD_DIRS = ["up", "down", "left", "right"];
export const HUD_STATES = ["off", "idle", "correct", "incorrect"];

export const hudMarker = (dir, state) =>
  `${PROGRESS_MARKER}${progressCode(HUD_DIRS.indexOf(dir) * 4 + HUD_STATES.indexOf(state))}`;

/** @param {{[dir: string]: "off"|"idle"|"correct"|"incorrect"}} stateByDir */
export const buildHudBus = (stateByDir) =>
  TITLE_MARKER + HUD_DIRS.map((d) => hudMarker(d, stateByDir?.[d] ?? "off")).join("");
