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

export const PAGE_SIZE = 10;

/**
 * Paginated PCraft form. Shows `items` in pages (prev/next rows) plus an
 * always-visible `footer` (关闭 / 返回 / 选项 ...).
 *
 * @param {import("@minecraft/server").Player} player
 * @param {{title?:string, body?:string, level?:number, items:Array<{id:string,label:string,icon?:string}>, perPage?:number, footer?:Array<{id:string,label:string,icon?:string}>}} opts
 * @returns {Promise<{canceled:boolean, id?:string, item?:object}>}
 */
export async function showPcPaged(player, {
  title = "",
  body = "",
  level = 0,
  items = [],
  perPage = PAGE_SIZE,
  footer = [],
}) {
  let page = 0;
  const size = Math.max(1, perPage | 0);
  for (;;) {
    const pages = Math.max(1, Math.ceil(items.length / size));
    if (page >= pages) page = pages - 1;
    const start = page * size;
    const slice = items.slice(start, start + size);
    const buttons = slice.map((it) => ({ id: it.id, label: it.label, icon: it.icon }));
    if (pages > 1) {
      buttons.push({ id: "__prev", label: "§7◀ 上一页" });
      buttons.push({ id: "__next", label: "§7下一页 ▶" });
    }
    for (const f of footer) buttons.push({ id: f.id, label: f.label, icon: f.icon });

    const pageInfo = pages > 1 ? `§8第 ${page + 1} / ${pages} 页` : "";
    const bodyText = [body, pageInfo].filter(Boolean).join("\n");
    const res = await showPcForm(player, { title, body: bodyText, level, buttons });
    if (res.canceled) return { canceled: true };
    if (res.id === "__prev") { page = (page + pages - 1) % pages; continue; }
    if (res.id === "__next") { page = (page + 1) % pages; continue; }
    if (footer.some((f) => f.id === res.id)) return { canceled: false, id: res.id };
    return { canceled: false, id: res.id, item: slice.find((it) => it.id === res.id) };
  }
}
