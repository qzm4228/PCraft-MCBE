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

**屏幕标志必须是字面量布尔值，不能写 Molang 字符串。**

原版 1.21.100.6 里唯一「弹在游戏上、带可点按钮、底下照常收输入」的屏幕是
`debug_screen`（`resource_pack/ui/debug_screen.json`，`access_button` 就是它上面的可点按钮）：

```jsonc
"debug_screen@common.base_screen": {
  "send_telemetry": false,
  "screen_not_flushable": true,
  "render_game_behind": true,
  "is_showing_menu": false,
  "low_frequency_rendering": true,
  "is_modal": true,
  "should_steal_mouse": false,
  "render_only_when_topmost": false,
  "screen_draws_last": true,
  "always_accepts_input": true,
  "$screen_animations": [],
  "$use_loading_bars": false
}
```

（`holographic_postrender_screen` 是另一个同类例子。）

这套字面量照抄进 `third_party_server_screen`（`resource_pack/ui/pcraftrevorn_forms.json`）：
`is_showing_menu: false`、`absorbs_input: false`、`render_only_when_topmost: false`、
`render_game_behind: true`、`always_accepts_input: true`、`screen_draws_last: true`、
`screen_not_flushable: true`。

- ❌ **绝对不要在这些标志上写表达式**（以前写过 `(not ($touch and (not $is_pregame)))`）。
  引擎不按表达式求值，非空字符串就是「真」，于是 `absorbs_input` 变成 `true`，
  **整屏吞掉所有触摸，摇杆和转视角全部失效**。这就是「HUD 顶掉触控」的真正原因。
- `hud_screen`（`gender_pack/resource_pack/ui/hud_screen.json`）同样只用字面量：
  `always_accepts_input: true`、`absorbs_input: false`、`is_showing_menu: false`、
  `render_only_when_topmost: false`。
- `ui_common.json` 只给 `button` / `toggle` / `slider` / `text_edit_box` / `close_button`
  设 `prevent_touch_input: true`。`hud_buttons` 是普通 `panel`，**不吃触摸**。
- 全屏 `input_panel` 只有 `gender_root/shield`（性别菜单的遮罩）；标题不含 `§3§r` 时它是隐藏的。

原版屏幕打开时会在**屏幕正中**画一条加载条（`common.base_screen` 的
`loading_bars_background`，由 `$use_loading_bars` 控制，默认 `true`）。我们的表单是常驻的，
这条会反复闪，所以和 `debug_screen` 一样关掉：

```jsonc
"$use_loading_bars": false
```

结果：表单浮在游戏上，只有点在按钮 / 开关 / 滑条上时那一小块被消费，其余触摸全部透传给摇杆和视角。

验证：`python .work/audit_hud_buttons.py` 会检查这些标志都是字面量布尔值，且没有任何一个写成字符串。

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
- 回归检查：`node tools/check.js`、`node tools/audit.js`、`python .work/audit_hud_buttons.py`、`python .work/artifact_check.py 1.26.50`、`python .work/validate_artifact.py <target>`（清单/资源引用/UI 注册，8 个目标都要过）。
