# VCraft / 性别包 游戏内不生效：排查与结论

> 现象：玩家胸部（性别/体型）不出现；吞食后肚子不显示；三个入口按钮存在但点击无反应；
> `/vcraft:swallow` 吞了也不显示肚子。
>
> 本文先给结论，再给证据与逐项分析、修复建议、验证清单。最后附本次“胃袋座位数→20”的改动。

---

## 0. 结论速览（按可能性排序）

| # | 可能原因 | 影响的现象 | 确定度 |
|---|----------|-----------|--------|
| 1 | `setObjectiveAtDisplaySlot(DisplaySlotId.List, obj)` 参数写错：API 需要 `{ objective, sortOrder }`，传裸 `ScoreboardObjective` 会抛错，被 `try/catch` 吞掉 → 目标**从未被设置显示** | 胸 + 肚子**全部**不渲染 | 高 |
| 2 | `query.scoreboard` 在资源包（渲染/动画控制器）里**只有目标被显示在 list / sidebar / belowname 时才有效**（Mojira MCPE-102389） | 同上，即使 #1 修好，仍取决于是否真的显示 | 高（已证实） |
| 3 | `pc_state` 与 `pc_belly` **抢同一个 List 显示槽**：一个槽同一时刻只能挂一个目标 | 胸 / 肚子**只会有一个**能工作 | 高 |
| 4 | HUD 屏没有开启输入（缺 `hud_screen@common.base_screen.always_accepts_input`） | HUD「Vore」按钮点了没反应 | 高 |
| 5 | 自定义命令（`/pcraftrevorn:gender`、`/vcraft:*`）依赖 Script API 2.0 自定义命令；世界/引擎不匹配或未开相关实验 → 命令不存在 | 三个入口按钮全部无反应 | 中 |
| 6 | 脚本在 `system.beforeEvents.startup`（自定义命令注册处）抛错时，后面的 `system.runInterval`（写默认分数、轮询 OPEN_TAG）可能没注册 | 目标分数不写入、菜单打不开 | 中 |
| 7 | `vcraft:gut` 座位只有 5，而 `capacity()` 可达 10/20 | 容量数字与实际能装的数量不符 | 已修（见 §6） |

> **一句话**：胸部和肚子都靠“客户端 Molang `query.scoreboard(...)`”来驱动渲染；
> 而现在的代码很可能**从未把目标真正设进显示槽**，所以查询恒为 0，两个功能一起失效；
> 按钮则另受 HUD 输入 + 自定义命令可用性影响。

---

## 1. 现状接线图（便于对照）

### 1.1 性别包 `gender_pack`
- BP `scripts/gender.js`
  - 目标 `pc_state`：`skin * 10 + sex`（sex 0=男，1..5=女，体型=sex-1）
  - `setObjectiveAtDisplaySlot(DisplaySlotId.List, obj)`（**有问题的调用**）
  - 菜单：`/pcraftrevorn:gender`、聊天 `?gender / ?性别 / ?settingmenu` 或聊天栏「性别」按钮
  - 受伤音效 `pcraftrevorn_gender.female_hurt`
- RP
  - `entity/player.entity.json`：覆盖 `minecraft:player`，定义 `geometry.b`、`geometry.vcraft_belly`、preset 1–12 贴图
  - `animation_controllers/pc_gender.animation_controllers.json`：`controller.animation.player.pc_size` 按 `pc_state % 10` 切 `animation.player.size0..4`
  - `render_controllers/player.render_controllers.json` + `girl.json`：按 `pc_state` 决定胸部 `b` 与预设皮肤
  - 关键条件：`math.mod(query.scoreboard('pc_state'), 10) > 0` 才渲染胸部

### 1.2 VCraft `vcraft_pack`
- BP `scripts/main.js`
  - 目标 `pc_belly`（0 平 / 1 小 / 2 大）
  - 同样 `setObjectiveAtDisplaySlot(DisplaySlotId.List, obj)`（**同样的问题**）
  - 隐形载体实体 `vcraft:gut`（跟随玩家，猎物隐身上座）
  - 自定义命令 `/vcraft:swallow·release·prey·trinkets·config·menu`；聊天 `?swallow/?菜单/...`
- RP
  - `models/entity/belly.geo.json` → `geometry.vcraft_belly`（骨骼 `vore1` / `vore2`）
  - `render_controllers/belly.render_controllers.json` → `controller.render.vcraft_belly1/2`
  - `ui/hud_screen.json`（HUD「Vore」按钮）、`ui/inventory_screen.json`（背包「菜单」按钮）
  - 关键条件：`query.scoreboard('pc_belly') == 1/2` 才渲染肚子

### 1.3 跨包依赖
- vcraft BP → vcraft RP + gender RP
- vcraft RP → gender RP
- 肚子的 **geometry / render controller 定义在 vcraft RP**，但 **被 gender RP 的 `minecraft:player` 引用**。两个 RP 必须同时启用。

---

## 2. 证据（外部资料）

1. **`query.scoreboard` 的官方说明**（Microsoft Learn）
   - “Returns the specified scoreboard value for this entity. **Available only with behavior packs.**”
   - “Available without experimental toggle in 1.20.70. **Limited to server-side queries only.**”
   - “This item requires a format version of at least 1.20.70.”
   - 链接：<https://learn.microsoft.com/en-us/minecraft/creator/reference/content/molangreference/examples/molangconcepts/queryfunctions/query_scoreboard?view=minecraft-bedrock-stable>
   - 实操结论来自 Mojira：**“When using query.scoreboard, the query only works in resource packs if the scoreboard is displayed (below name, list or sidebar).”**
   - 链接：<https://bugs.mojang.com/browse/MCPE-102389>

2. **`setObjectiveAtDisplaySlot` 的签名**（Microsoft Learn，`Scoreboard`）
   - `setObjectiveAtDisplaySlot(displaySlotId: DisplaySlotId, objectiveDisplaySetting: ScoreboardObjectiveDisplayOptions): ScoreboardObjective | undefined`
   - `ScoreboardObjectiveDisplayOptions` 形如 `{ objective, sortOrder? }`
   - 官方示例：
     ```js
     world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, {
       objective: objective,
       sortOrder: ObjectiveSortOrder.Descending,
     });
     ```
   - 链接：<https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/scoreboard?view=minecraft-bedrock-stable>
   - 本项目目标版本 **1.21.100** 对应的 `@minecraft/server` 2.0.0（1.21.84 稳定分支）签名同样如此；1.21.80 的 TypeDoc 示例即：
     ```js
     scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.List, {
       objective: scoreboard.getObjective("Objective2"),
     });
     ```
     链接：<https://jaylydev.github.io/scriptapi-docs/1.21.80/classes/_minecraft_server.Scoreboard.html>
   - 而当前代码是 `setObjectiveAtDisplaySlot(DisplaySlotId.List, obj)` —— **传的是裸目标对象，不是 options 对象**，`try/catch` 会把这个异常吞掉。

3. **自定义命令（Custom Commands）属于 Scripting API 2.0 Beta（1.21.80 起）**
   - 链接：<https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/custom-commands?view=minecraft-bedrock-stable>
   - Beta API 模块需要世界开启 **“Beta APIs” 实验**（`@minecraft/server` 使用 `2.x` 稳定版时通常不需要，但自定义命令在部分版本仍受实验/引擎版本影响）。
   - 链接：<https://wiki.bedrock.dev/scripting/scripting-intro>

4. **HUD 元素接收输入需要覆写 `hud_screen@common.base_screen` 的 `always_accepts_input`**
   - 参考：<https://wiki.bedrock.dev/json-ui/add-hud-elements>
   - 例（Bedrock+ / 本仓库 `.work/buttons/按钮/hud_screen.json`）：
     ```json
     {
       "namespace": "hud",
       "hud_screen@common.base_screen": {
         "is_showing_menu": false,
         "should_steal_mouse": true,
         "absorbs_input": false,
         "render_only_when_topmost": false,
         "always_accepts_input": true
       }
     }
     ```
   - 当前 `vcraft_pack/resource_pack/ui/hud_screen.json` **没有这段覆写**，只往 `hud_content` 里插了按钮。

5. **两个可对照的“其它 addon”**（都在 `.work/`）
   - `.work/pgender/GendersAdd/GendersAddonV1.1.2/`：原版 Bedrock 性别 addon
     - 用 **subpacks（type1/type2…）**选模型，渲染控制器 `controller.render.b` **无条件常显**
     - 体型用命令 **`/playanimation @s animation.player.sizeN b 9999`**，**完全不依赖 scoreboard**
     - 菜单触发：`?settingmenu` → 打 tag → 脚本开表单
   - `.work/fastcmd/`：纯资源包的“快捷命令”按钮
     - 只在 **chat_screen** 里做按钮；核心是隐藏 `edit_box`（`always_listening`）+ 透明 `sendbutton` 映射 `button.menu_select → button.send`
     - 说明：**这套“按钮→命令”机制只在聊天屏里是成熟可靠的**，搬到 HUD / 背包屏风险高

---

## 3. 逐项分析

### 3.1 为什么胸部完全不出现
链路：脚本写 `pc_state` → 客户端渲染控制器读 `query.scoreboard('pc_state')` → 决定是否渲染骨骼 `b`。

- 若 `setObjectiveAtDisplaySlot` 调用无效（#1），`pc_state` 不进显示槽 → 资源包里 `query.scoreboard` 恒为 0 → `math.mod(0,10)=0` → 不渲染胸部。
- 若脚本在 `system.beforeEvents.startup` 抛错（#6）导致后面 `runInterval` 未注册，则连默认分（`DEFAULT_STATE=14`）都不会写 → 同上。
- 即便修好显示，`DisplaySlotId.List` 是否被客户端实时用于资源包查询，仍建议按 MCPE-102389 验证（list/sidebar/belowname 三选一）。

### 3.2 为什么吞食后肚子不显示
链路与胸部**完全相同**，只是目标换成 `pc_belly`：
- 同一个错误调用（#1）→ `pc_belly` 也未显示 → `query.scoreboard('pc_belly')` 恒为 0 → `vcraft_belly1/2` 永不命中。
- 加上 #3 的槽位冲突：即使两处调用都修成正确写法，**List 槽也只能挂一个**，另一个照旧读 0。
- 注意肚子还依赖 vcraft RP 的 geometry/render controller 被 gender RP 引用，所以**两个 RP 必须同时启用**（README 已写明）。

### 3.3 为什么三个按钮点了没反应
分三类看：

- **聊天栏「性别」按钮**（`gender_pack/.../ui/chat_screen.json`）
  - 它是往 `chat_bottom_panel` 里插一个带隐藏 `edit_box` + 透明 `sendbutton` 的按钮，按下发送 `/pcraftrevorn:gender`。
  - 这条路径本身是成熟的（与 Fast Commands 同款）。若失败，多半是 **自定义命令没注册**（#5）。

- **HUD「Vore」按钮**（`vcraft_pack/.../ui/hud_screen.json`）
  - 只插了按钮，**没有让 HUD 屏接受输入**（#4）→ 点击事件根本到不了控件。
  - 参考 `.work/buttons/按钮/hud_screen.json` 必须覆写 `hud_screen@common.base_screen`。

- **背包「菜单」按钮**（`vcraft_pack/.../ui/inventory_screen.json`）
  - 依赖 `#message_text_box` 在背包屏可用；即便控件显示出来，隐藏 edit_box + send 未必能触发。属于高风险做法。

- **共同点**：三者最终都依赖 `/pcraftrevorn:gender` 或 `/vcraft:menu` 这两个**自定义命令**。如果命令没注册，三者全灭（#5）。
  - 反过来说，**聊天快捷短语**（`?gender`、`?菜单`、`?swallow`）走的是 `world.beforeEvents.chatSend`，**不依赖自定义命令**，是很好的“分离变量”测试手段。

### 3.4 座位 / 容量
- `vcraft:gut` 原来只有 5 个座位，但 `capacity()`：
  - 默认 `5 + min(5, floor(absorb/5))` → 最多 10
  - 戴 `expansion_ring` / `maxima` → 20
- 座位数 < 容量 → “容量 20”是假的。**已把座位改成 20**（见 §6）。

---

## 4. 建议修复方案

> 下面按“先修最可能的、成本最低的”排序。建议一次只改一项并实机验证，便于定位。

### 4.1 修 `setObjectiveAtDisplaySlot` 调用（必做）
两个脚本各一处：

`gender_pack/behavior_pack/scripts/gender.js:149`
```js
// before
world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.List, obj);
// after
world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.List, { objective: obj });
```

`vcraft_pack/behavior_pack/scripts/main.js:438` 同理。

> 注意：若要用排序或更稳妥，可 `import { ObjectiveSortOrder }` 后传 `{ objective: obj, sortOrder: ObjectiveSortOrder.Descending }`。

### 4.2 解决两个目标抢同一个显示槽（必做）
`list` / `sidebar` / `belowname` 三个槽只能各挂一个目标。两种方案：

- **方案 A（改动小）**：分槽显示，例如
  - `pc_state` → `DisplaySlotId.List`（只在暂停界面可见，最不打扰）
  - `pc_belly` → `DisplaySlotId.BelowName`（会在头顶显示数字）或 `Sidebar`
  - 缺点：BelowName/Sidebar 会露出生效数字。
- **方案 B（推荐）**：**合并成一个目标**，一个槽即可。
  - 例如把 `pc_state` 编码成 `skin*1000 + sex*100 + belly`（或 `skin*100 + sex*10 + belly`），
    渲染控制器里用 `math.floor(q.scoreboard('pc_state')/10) % 10` 取 belly、`/10` 取 skin、`%10` 取 sex。
  - 好处：只需显示一个目标，彻底避开槽冲突。
- **方案 C（最稳，参考原版 addon）**：**不用 scoreboard 驱动渲染**。
  - 胸部：常显 `b`，用服务器命令 `/playanimation @s animation.player.sizeN b 9999` 设体型（GendersAddonV1.1.2 就是这么做的）。
  - 肚子：把 `vore1/vore2` 也做成动画，用 `/playanimation` 控制缩放/显隐，或用 `variable.` 由实体脚本驱动。
  - 好处：绕开 `query.scoreboard` 的“必须显示”限制。

### 4.3 HUD 按钮（必做，若保留 HUD 按钮）
在 `vcraft_pack/resource_pack/ui/hud_screen.json` 增加：
```json
{
  "namespace": "hud",
  "hud_screen@common.base_screen": {
    "is_showing_menu": false,
    "should_steal_mouse": true,
    "absorbs_input": false,
    "render_only_when_topmost": false,
    "always_accepts_input": true,
    "$screen_animations": [],
    "$background_animations": []
  },
  ...原有 hud_content 修改...
}
```
（对照 `.work/buttons/按钮/hud_screen.json`）

### 4.4 自定义命令 / 实验开关（需实机确认）
- 确认世界 **1.21.80+**，且如使用了 `-beta` 模块则开启 **Beta APIs** 实验。
- 当前清单依赖写的是 `"@minecraft/server": "2.0.0"`（稳定分支，对应 1.21.84），理论上无需实验；但自定义命令在部分版本仍被实验门控，建议实测：
  - 在聊天输入 `/pcraftrevorn:gender` / `/vcraft:menu`，看是否“未知命令”。
- **降低风险的替代**：把入口统一改成**聊天短语 + `chatSend`**（`?gender`、`?菜单` 已实现），或 `scriptevent`（主包已在用 `scriptevent`）。
  - 主包 `pcraftrevorn` 没有注册自定义命令，而是用 `scriptevent` + 指南书交互，说明这条路线在本项目里更成熟。

### 4.5 保险：脚本健壮性
- 给 `system.beforeEvents.startup.subscribe(...)` 整体包 `try/catch`，避免因该事件在个别版本不可用而中断后续 `runInterval` 的注册。
- `setObjectiveAtDisplaySlot` 失败时打日志（不要静默吞异常），方便定位。

---

## 5. 实机验证清单（按顺序做，能快速锁定）

1. 打开 **内容日志（Content Log）**，看有没有脚本报错（HTTP/JSON/API 版本）。
2. 聊天执行 `/scoreboard objectives list`：
   - 有没有 `pc_state`、`pc_belly`？
3. 聊天执行 `/scoreboard objectives setdisplay list pc_state`，再看 `/scoreboard players list` / 自己的 `pc_state` 分数是否为默认 14。
4. **分离变量**：
   - 聊天输入 `?gender`（无自定义命令依赖）：
     - 菜单能开 → 脚本在跑；菜单开不了 → 脚本/事件有问题。
   - 聊天输入 `?菜单`：同理测 vcraft。
   - 若 `?gender` 能开但按钮不能 → 是 **UI 按钮/显示槽**问题。
   - 若 `?gender` 也开不了 → 是 **脚本没跑/目标没建**问题。
5. 手动验证渲染链路：进入第三人称，看胸部。若装了原版 `GendersAddonV1.1.2` 能显示、你的不能，则确认是 scoreboard 驱动这一层的问题。
6. 手动设置 `pc_belly`：
   ```
   /scoreboard objectives add pc_belly dummy
   /scoreboard objectives setdisplay sidebar pc_belly
   /scoreboard players set @s pc_belly 2
   ```
   看肚子是否出现；不出现 → 渲染控制器/几何/跨包引用的问题。
7. 确认 **gender RP 与 vcraft RP 同时启用**（肚子几何在 vcraft，玩家实体在 gender）。

---

## 6. 本次已改：胃袋座位 5 → 20

文件：`vcraft_pack/behavior_pack/entities/gut.json`
- `minecraft:rideable.seat_count`: `5` → `20`
- `seats`: 补齐 20 个座位坐标

这样才配得上 `capacity()` 的上限：
- 默认 + 吸收：最多 10
- `expansion_ring` / `maxima`：20

> 说明：座位位置本身只是占位（猎物会 `invisibility` 且 gut 无碰撞），分布在小范围偏移即可。

---

## 7. 附：相关文件索引

| 作用 | 文件 |
|------|------|
| 性别逻辑/分数/菜单 | `gender_pack/behavior_pack/scripts/gender.js` |
| 性别客户端实体 | `gender_pack/resource_pack/entity/player.entity.json` |
| 体型动画控制器 | `gender_pack/resource_pack/animation_controllers/pc_gender.animation_controllers.json` |
| 体型动画定义 | `gender_pack/resource_pack/animations/girl.json` |
| 胸部/皮肤渲染 | `gender_pack/resource_pack/render_controllers/player.render_controllers.json`、`girl.json` |
| VCraft 逻辑 | `vcraft_pack/behavior_pack/scripts/main.js` |
| 胃袋实体 | `vcraft_pack/behavior_pack/entities/gut.json` |
| 肚子几何 | `vcraft_pack/resource_pack/models/entity/belly.geo.json` |
| 肚子渲染 | `vcraft_pack/resource_pack/render_controllers/belly.render_controllers.json` |
| HUD/背包按钮 | `vcraft_pack/resource_pack/ui/hud_screen.json`、`inventory_screen.json` |
| 参考：原版性别 addon | `.work/pgender/GendersAdd/GendersAddonV1.1.2/` |
| 参考：按钮示例 | `.work/buttons/按钮/`、`.work/fastcmd/` |

---

*生成：砂墨SandMo 的排查记录。资料链接见 §2。*
