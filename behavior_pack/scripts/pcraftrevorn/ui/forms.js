import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { buildTitle } from "../constants.js";

/**
 * Shows a PCraftRevorn-styled action form.
 * The title carries the UI state bus so the custom server_form layer can render
 * the progress bar. Native form buttons provide the interaction (cursor pops up).
 *
 * @param {import("@minecraft/server").Player} player
 * @param {{title?:string, body?:string, level?:number, buttons:Array<{id:string,label:string,icon?:string}>}} opts
 * @returns {Promise<{canceled:boolean, id?:string, selection?:number}>}
 */
export async function showPcForm(player, { title = "", body = "", level = 0, buttons = [] }) {
  const form = new ActionFormData().title(buildTitle(title, level)).body(body);
  for (const b of buttons) {
    if (b.icon) form.button(b.label, b.icon);
    else form.button(b.label);
  }
  const res = await form.show(player);
  if (res.canceled) return { canceled: true };
  const button = buttons[res.selection];
  return { canceled: false, id: button?.id, selection: res.selection };
}

export async function showPcModal(player, { title = "", level = 0, controls = [] }) {
  const form = new ModalFormData().title(buildTitle(title, level));
  for (const c of controls) {
    if (c.kind === "dropdown") form.dropdown(c.label, c.options, { defaultValueIndex: c.default ?? 0 });
    else if (c.kind === "toggle") form.toggle(c.label, { defaultValue: !!c.default });
    else if (c.kind === "slider") form.slider(c.label, c.min, c.max, { valueStep: c.step ?? 1, defaultValue: c.default ?? c.min });
    else if (c.kind === "text") form.textField(c.label, c.placeholder ?? "", { default: c.default ?? "" });
  }
  const res = await form.show(player);
  if (res.canceled) return { canceled: true };
  return { canceled: false, values: res.formValues ?? [] };
}
