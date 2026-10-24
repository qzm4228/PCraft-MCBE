# Agent 开发说明

本文件记录必须遵守的实现约定，改代码前先读。

## HUD 是 JSON-UI，不做表单降级

**结论：HUD 按钮是纯 JSON-UI 控件，不允许、也不需要回退成原版表单 UI。**

### 为什么看起来「像表单」

`ActionFormData`（`@minecraft/server-ui`）在 HUD 里**只承担数据/事件通道**，不负责渲染：

- 脚本 `new ActionFormData().title("PCraft HUD").button("", "").show(player)` 把按钮列表喂给引擎；
- 引擎把它们填进 `form_buttons` 集合，JSON-UI 从集合里读出来画按钮；
- 玩家点击时引擎发出 `button.form_button_click`，再通过 `show()` 的 Promise 把索引还给脚本。

引擎里 **JSON-UI 按钮无法直接调用脚本**，`ActionFormData` 是唯一的 UI→脚本回调通道（官方文档、Bedrock Wiki、MSIFvAPI 的 BP 半边都是这样）。这是通道，不是「表单界面」。

### 渲染完全由 JSON-UI 完成

- **屏幕**：`server_form`（`resource_pack/ui/pcraftrevorn_forms.json` 的 `third_party_server_screen`）只改屏幕标志，非模态（触屏）+ `render_game_behind`；
- **容器**：`gender_pack/resource_pack/ui/gender_menu.json`
  - `long_form` 里有一个**被隐藏**的原版 form + `hud_buttons`；
  - `hud_buttons` 只在标题包含 `PCraft HUD` 时显示：`(not ((#title_text - 'PCraft HUD') = #title_text))`；
  - 原版 form 在标题含 `§3§r` 或 `PCraft HUD` 时隐藏；
- **按钮**：`hud_gender_button` / `hud_vore_button` 都是 `common.button` + 一张常亮 `image`，贴图路径**写死**（不经过 `$变量`）：
  ```jsonc
  "hud_gender_button@common.button": {
    "$pressed_button_name": "button.form_button_click",
    "bindings": [{ "binding_type": "collection_details", "binding_collection_name": "form_buttons" }],
    "controls": [{ "art": { "type": "image", "texture": "textures/pcraftrevorn_gender/gui/hud_gender" } }]
  }
  ```
- **槽位**：`hud_gender_slot` / `hud_vore_slot`（`collection_panel`，`collection_index` 0 / 1），右侧 `top_right`，距边 30px；
- **HUD 屏幕**：`gender_pack/resource_pack/ui/hud_screen.json` 保证 HUD 屏幕持续接收输入。

### 明确禁止

- ❌ 不要为了「藏住表单」而把 HUD 改回 `ActionFormData` 默认按钮、或依赖原版表单渲染。
- ❌ 不要用 `$tex` / `$tex_pressed` 之类的变量把贴图传进按钮（`collection_panel` 里不可靠，会渲染成空白）。
- ❌ 不要在 HUD 里放「关闭 HUD」之类的原版文字按钮。
- ✅ 贴图路径直接写死；按钮用 `common.button` + 常亮 `image`。
- ✅ 显隐判断用「包含」而不是「等于」，避免标题后缀导致匹配失败。

## 触控输入（HUD 不能挡摇杆 / 转视角）

HUD 的持久表单在触屏上是**非模态**的，而且只有按钮本身吃触摸：

- `third_party_server_screen`（`resource_pack/ui/pcraftrevorn_forms.json`）：
  `is_showing_menu` / `absorbs_input` / `render_only_when_topmost` 都是
  `(not ($touch and (not $is_pregame)))` —— 触屏游戏内全为 `false`；`render_game_behind: true`。
- `hud_screen`（`gender_pack/resource_pack/ui/hud_screen.json`）：
  `always_accepts_input: true`、`absorbs_input: false`、`is_showing_menu: false`、
  `render_only_when_topmost: false`。这样表单盖在 HUD 上时，HUD 屏幕仍然接收摇杆/视角输入。
- `ui_common.json` 只给 `button` / `toggle` / `slider` / `text_edit_box` / `close_button`
  设 `prevent_touch_input: true`。`hud_buttons` 是普通 `panel`，**不吃触摸**。
- 全屏 `input_panel` 只有 `gender_root/shield`（性别菜单的遮罩）；标题不含 `§3§r` 时它是隐藏的，
  所以 HUD 打开时不会挡住摇杆/视角。

结论：HUD 打开时摇杆、转视角、其他触摸操作都不受影响；只有点在 22×22 按钮上时那一小块会被按钮消费。

## 入口

全部是自定义指令，没有聊天文字口令（`?xxx`）、没有 `/scriptevent` 入口。

- `/pcraftrevorn:gender` 性别 / 体型面板
- `/pcraftrevorn:panel` 快捷面板（HUD 开关 / 性别 / 吞食）
- `/pcraftrevorn:hud` 开关 HUD
- `/pcraftrevorn:guide`、`:variants`、`:settings`、`:form`
- `/pcraftrevorn:swallow`（作为猎物被吞）、`:release`（脱身）
- `/vcraft:swallow`（瞬时吞食，需瞄准）、`:release`、`:prey`、`:trinkets`、`:config`、`:menu`

HUD 可见性：默认**仅触屏**（`clientSystemInfo.platformType === "Mobile"`）；`/pcraftrevorn:hud` 或快捷面板可手动强制开关（`pcraftrevorn:hud_force` 动态属性：1 开 / 0 关 / 未设自动）。

## 聊天界面菜单

- `gender_pack/resource_pack/ui/chat_screen.json`
- 聊天界面**右上角**一个面板（`pcraftrevorn_panel`，`anchor_from/to: top_right`，注入 `chat_screen_content` 的 `controls`）；
- 三个按钮：`HUD` / `性别` / `Vore`；
- 采用 18 号提交的「假输入框」做法：按钮把自定义指令拼进聊天输入框并自动发送（`edit_box` + 透明 `sendbutton` 映射 `button.send`）。

## 吞食

- `vcraft_pack/behavior_pack/scripts/main.js` 的 `instantSwallow(player)`：
  - **必须瞄准**（`getEntitiesFromViewDirection`，6 格）；
  - **瞬时**，没有进度条、不需要保持视角；
  - HUD 的 Vore 按钮通过 `vcraft:want_swallow` 标签触发；
  - 手持 `vcraft:maw` 右键和 `/vcraft:swallow` 走同一函数。

## 版本与构建

- 版本唯一来源：`config/version.json`，不要改别处的版本号；
- 只用 `python tools_py/pipeline.py`（不要单独跑 `generate.py`）；
- 回归检查：`node tools/check.js`、`node tools/audit.js`、`python .work/audit_hud_buttons.py`、`python .work/artifact_check.py 1.26.50`。
