import { ActionFormData, uiManager } from "@minecraft/server-ui";
import { buildTitle, MENU_MARKERS } from "../constants.js";

// The PCraft HUD button bar is a persistent form (see the gender pack). Only
// one form can be open per player, so every entry point closes it first and the
// bar reopens by itself when this form is closed.
function closeHud(player) {
  try { uiManager.closeAllForms(player); } catch { /* older ui module */ }
}

/**
 * Shows a PCraftRevorn-styled action form.
 * The title carries the UI state bus so the custom server_form layer can render
 * the progress bar. Native form buttons provide the interaction (cursor pops up).
 *
 * @param {import("@minecraft/server").Player} player
 * @param {{title?:string, body?:string, level?:number, buttons:Array<{id:string,label:string,icon?:string}>}} opts
 * @returns {Promise<{canceled:boolean, id?:string, selection?:number}>}
 */
export async function showPcForm(player, { title = "", body = "", level = 0, buttons = [], menu }) {
  const human = (menu && MENU_MARKERS[menu] ? MENU_MARKERS[menu] : "") + title;
  const form = new ActionFormData().title(buildTitle(human, level)).body(body);
  for (const b of buttons) {
    if (b.icon) form.button(b.label, b.icon);
    else form.button(b.label);
  }
  closeHud(player);
  const res = await form.show(player);
  if (res.canceled) return { canceled: true };
  const button = buttons[res.selection];
  return { canceled: false, id: button?.id, selection: res.selection };
}
