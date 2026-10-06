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
