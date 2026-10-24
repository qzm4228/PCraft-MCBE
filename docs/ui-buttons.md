# HUD 按钮与表单共存（MSIFvAPI 模式）

> 适用版本：10.18.3+（1.21.100 / 1.26.x）
> 参考实现：MSIFvAPI ULTRA v11.3（CurseForge，作者 vertX），只借鉴机制，不依赖它的包。

## 为什么放弃聊天栏按钮

旧的「性别」「菜单」入口都是**聊天栏假输入框**写法（Fast Commands 那套）：

```
common.button ($pressed_button_name: button.nodata)
└─ 假 text_edit_box (text_box_name: #message_text_box)
   └─ 隐形 sendbutton (button.menu_select → button.send)
```

它依赖输入框焦点与 `button.send`，在 26.50 上不可靠；而且 HUD/背包里的 `button.form_button_click` 按钮（VCraft 的 Vore / 菜单）本来就**没有**表单上下文，永远不会触发。

## 现在的机制

一个**常驻的透明 ActionFormData**（标题 `PCraft HUD`）承载全部按钮，按钮由 JSON-UI 画在 HUD 上：

```
[性别]  → 打开衣柜面板（同一套 server_form UI）
[菜单]  → 给玩家加 vcraft:open_menu 标签，VCraft 轮询后打开主菜单
[关闭 HUD] → 停止这个玩家的 HUD（键鼠端主要用它退出模态）
```

- 按钮来自表单的 `form_buttons` 集合，由 `collection_panel` + `collection_index` 摆位。
- 点按钮 = `button.form_button_click`（引擎表单事件）→ `show()` 返回 `selection`。
- 脚本（`gender_pack/.../gender.js`）在 `hudLoop()` 里循环 `show()`，点完立即重开 → 常驻。
  - `UserBusy`（聊天/别的表单开着）每 20 tick 重试；玩家 Esc 关掉后 10 tick 内自动回来。
  - `uiManager.closeAllForms(player)` 用来在打开其它菜单前把 HUD 关掉。

## 怎么做到不和性别面板冲突

**同一个文件、同一个标题门控，不抢 `long_form`：**

`gender_pack/resource_pack/ui/gender_menu.json`

```
main_screen_content (100%)
├─ server_form_factory
└─ gender_root            (标题含 §3§r 时显示)

long_form (wrapper，factory 实例化它)
├─ form@common_dialogs.main_panel_no_buttons
│                          (标题既不是 §3§r 也不是 PCraft HUD 时显示 → 普通表单)
└─ hud_buttons             (标题 == PCraft HUD 时显示 → HUD 按钮)
```

三个标题互斥，所以：

- 普通表单（指南/设置/发酵桶/其它 addon）→ 原版外观；
- 性别菜单 → 衣柜面板；
- HUD → 只有按钮。

不存在两个包各自替换 `long_form` 的“后加载覆盖”问题。

## 表单串行化

一个玩家同时只能开一个表单，所以：

| 场景 | 行为 |
|---|---|
| HUD 点「性别」 | `beginSession` → 打开衣柜；主菜单关闭（Esc/关闭）时 `endSession`，HUD 自动回来 |
| 命令 `/pcraftrevorn:gender` | `openMenu()` 先 `closeAllForms` 再开衣柜（HUD 被关掉，结束后面板自动回来） |
| HUD 点「菜单」 | 加标签 → VCraft 轮询打开主菜单；60 tick 后释放 session，HUD 在 VCraft 菜单关闭后自动回来 |
| 主包/VCraft 打开任意表单 | 先 `uiManager.closeAllForms(player)`（`ui/forms.js`、VCraft 各菜单），HUD 自动让位并在关闭后回来 |
| 玩家离开 | `playerLeave` → 停掉该玩家的 HUD |

## 触摸 / 键鼠

`resource_pack/ui/pcraftrevorn_forms.json` 把表单屏幕改成：

```json
"is_showing_menu": "(not ($touch and (not $is_pregame)))",
"absorbs_input":   "(not ($touch and (not $is_pregame)))",
"render_only_when_topmost": "(not ($touch and (not $is_pregame)))",
"render_game_behind": true
```

- **触屏**：表单屏幕不抢占输入 → HUD 按钮悬浮在游戏画面上，可以边走边点。
- **键鼠**：仍是普通模态菜单（光标要能被 UI 捕获），玩家点「关闭 HUD」退出，用命令打开菜单。
- `gender_pack/resource_pack/ui/ui_common.json` 给 `button` / `toggle` / `slider` / `text_edit_box` / `close_button` 加 `prevent_touch_input`，保证非模态时点按钮不会顺手挖方块。
- 衣柜面板自己带 `input_panel` 遮罩，防止点面板外时误操作世界。

## 删掉的东西

- `gender_pack/.../ui/chat_screen.json`（性别聊天按钮）
- `vcraft_pack/.../ui/chat_screen.json`（Vore 聊天按钮）
- `vcraft_pack/.../ui/hud_screen.json`、`inventory_screen.json`（点了没反应的死按钮）

## 相关文件

| 作用 | 文件 |
|---|---|
| HUD 逻辑 / 表单串行化 | `gender_pack/behavior_pack/scripts/gender.js` |
| HUD + 衣柜 + 普通表单的 UI | `gender_pack/resource_pack/ui/gender_menu.json` |
| 触摸控件防穿透 | `gender_pack/resource_pack/ui/ui_common.json` |
| 屏幕非模态设置 | `resource_pack/ui/pcraftrevorn_forms.json` |
| VCraft 菜单入口（标签轮询） | `vcraft_pack/behavior_pack/scripts/main.js` |
| 主包表单让位 | `behavior_pack/scripts/pcraftrevorn/ui/forms.js`、`game/variants.js` |
| 静态自检 | `.work/audit_hud_buttons.py` |
