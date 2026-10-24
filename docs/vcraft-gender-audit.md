# VCraft / 性别包 实现方案全面审查校准

> 审查对象：`gender_pack/`、`vcraft_pack/` 的全部脚本与资源，以及它们与主包 `pcraftrevorn` 的交叉。
> 方法：逐功能对照 **官方文档 / Mojira / 原版 Bedrock 性别 addon / 社区 addon（Fast Commands、xtdljyg 按钮、Bedrock+、CPM）/ 原 Java 源码（WFC、VCraft Reborn）**。
> 配套：本文件偏“方案与校准”，逐 bug 的现场排查见 `docs/vcraft-gender-diagnosis.md`。
>
> 严重度：**P0 = 功能完全不生效**；**P1 = 正确性/健壮性缺陷**；**P2 = 长期运行/多人问题**；**P3 = 整洁度/体验**。
> 标注：`[已证实]` = 有文档/源码依据；`[待实机]` = 需在游戏内验证。

---

## 0. 审查范围与方法

| 材料 | 用途 |
|------|------|
| Microsoft Learn（Molang / Scoreboard / InputInfo / CustomCommand / DynamicProperty） | API 签名与语义 |
| Mojira MCPE-102389 | `query.scoreboard` 显示槽限制 |
| MS Learn 实验特性 / Bedrock Wiki | Beta API 门槛 |
| `.work/pgender/GendersAdd/GendersAddonV1.1.2`（原 Bedrock 性别 addon） | 胸部/体型的“标准做法”对照 |
| `.work/fastcmd`、`.work/buttons/按钮`、Bedrock+ | 按钮→命令机制对照 |
| `.work/cpm`（Custom Player Models） | 玩家自定义模型/腹部动画的另一条路线 |
| `.work/fgender_src`（WFC）、`.work/vcraft_src`（VCraft Reborn Java） | 原意图与功能清单 |
| 本仓库 `behavior_pack/scripts/pcraftrevorn`（主包掠食者 vore） | 交叉系统对照 |

---

## 1. 总览与数据模型

### 1.1 状态存储分层

| 层 | 机制 | 当前用途 | 评价 |
|----|------|----------|------|
| 全局同步 | 分数板 `pc_state` / `pc_belly` | 驱动玩家客户端渲染 | ⚠ 依赖显示槽，见 P0 |
| 服务端持久 | 动态属性（`vcraft:*`、`pc:*`） | 玩家设置、饰品、消化进度、吸收值、`pc:pred` | ✅ 合适 |
| 服务端持久 | 实体状态（`vcraft:gut` 的乘客） | 猎物实体本身 | ✅ 合适，但需清理 |
| 短暂运行 | 标签（`vore_digesting`、`vcraft_prey`…） | 跨脚本互斥 | ✅ 合适 |
| 内存 | `PV` Map（玩家猎物会话） | PvP 吞人 | ❌ 不持久，见 P1 |
| 实体属性 | `q.property('pcraftrevorn:set'/'skin')` | 主包掠食者皮肤（客户端可见） | ✅ 这是玩家用不了的更稳机制 |

**关键对照**：主包掠食者用**实体属性**（客户端可见）驱动皮肤；玩家不能用自定义实体属性，所以作者改用**分数板 + `query.scoreboard`**。这正是风险所在。

### 1.2 跨包依赖与资源耦合 `[已证实]`

- 清单依赖：gender BP→gender RP；vcraft BP→vcraft RP+gender RP；vcraft RP→gender RP。
- **但**：gender RP 的 `entity/player.entity.json` 直接引用了 vcraft RP 的 `geometry.vcraft_belly` 与 `controller.render.vcraft_belly1/2`。
- ⇒ gender RP 事实上依赖 vcraft RP，却未（也不能，否则循环）在清单声明。**任一 RP 未启用都会产生内容日志错误**，玩家实体定义可能整体失败。
- **校准**：把腹部几何 + 腹部渲染控制器放进 **gender RP**（它本来就是“玩家外观”的归属），或放进一个共享 RP；vcraft 只保留逻辑与贴图。

### 1.3 项目校验器覆盖缺口 `[已证实]`

- `tools/audit.js`、`tools/check.js` 只扫描 `behavior_pack/`、`resource_pack/`（`audit.js:10-11`、`check.js:15-16`）。
- ⇒ `gender_pack/`、`vcraft_pack/` 的 JSON 合法性、纹理/几何引用、动画骨骼名、UI 引用、清单依赖 **完全没被 CI 检查**。
- **校准**：让两个校验器遍历四个包（或新增 `tools/audit_extra.js`），至少校验 JSON 可解析、资源引用存在、渲染控制器/几何/纹理可解析、UI `_ui_defs` 可达。

---

## 2. 性别包 逐功能审查

### 2.1 `pc_state` 编码与写入

- 方案：`skin*10 + sex`；sex 0=男，1..5=女（体型 sex-1）；`clamp`、`encode`、`sexOf/skinOf` 清晰。
- 评价：编码紧凑、可读；single-objective 便于客户端查询。**问题不在编码，在“让它对客户端可见”**（2.2）。

### 2.2 显示槽与客户端查询 —— **P0**

- 现状：`world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.List, obj)`（`gender.js:149`）。
- 文档：该方法第二参必须是 `ScoreboardObjectiveDisplayOptions`（`{ objective, sortOrder? }`），见 MS Learn 与 1.21.80 TypeDoc。传裸目标会抛异常，被 `try/catch` 吞掉。
- 且：`query.scoreboard` 在资源包中**仅当目标被显示在 list/sidebar/belowname** 才有效（[MCPE-102389]）。
- ⇒ 目标从未显示 ⇒ 渲染控制器读到 0 ⇒ 胸部不渲染。
- **校准**：
  1. 改成 `setObjectiveAtDisplaySlot(DisplaySlotId.List, { objective: obj })`（或带 `ObjectiveSortOrder`）。
  2. 失败时打日志，不要静默。
  3. 确保 `query.scoreboard` 的控制器所在 RP（gender RP）处于启用。

### 2.3 默认状态 —— **P1**

- 现状：`DEFAULT_STATE = 14` = 预设皮肤 1 + 女性体型 3；`runInterval(…,10)` 对每个新玩家写默认。
- 问题：**把所有人默认成“女性 + 预设皮肤”**，会覆盖“原版皮肤”的预期；且默认写分数依赖 interval 先跑起来。
- **校准**：默认改为“原版皮肤 0 + 女性 sex=1（或男 0）”，并把默认写入放到 `world.afterEvents.playerSpawn`（含 `initialSpawn`）而非轮询。

### 2.4 胸部几何/渲染

- 现状：`geometry.b`（骨骼 `root/waist/body/b/bone/toplayer`）+ `controller.render.b`（`girl.json`），条件 `math.mod(pc_state,10)>0`；预设贴图用 `Array.pc_skins[floor(pc_state/10)]`。
- 评价：方案与**原版 addon 一致**（原版也是 `Geometry.b` + 常显 `controller.render.b`），额外加了分数板开关与预设贴图。合理。
- 细节：`girl.json` 的 `part_visibility` 列了 `bone2`，但 `geometry.b` 里没有 `bone2`（只有 `bone`）——**空引用**（通常被忽略，但应清理）。
- **校准**：把 `bone2` 改为 `bone`（或删除该条）；确认 `bone`/`toplayer` 是否都该显示。

### 2.5 体型动画

- 现状：`animation.player.size0..4` 只缩放骨骼 `b`（`girl.json`），由 `controller.animation.player.pc_size` 按 `pc_state%10` 切换。
- 评价：可控、可混合（`blend_transition 0.2`）。
- **对照原版**：原版用 `/playanimation @s animation.player.sizeN b 9999`（服务器命令），**不依赖 scoreboard**，也不依赖动画控制器。若 2.2 的客户端查询路线始终不稳，这是最稳的退路。
- **校准**：保留现方案的前提下，考虑“服务器命令 `/playanimation` + 常显 `controller.render.b`”作为降级/备选。

### 2.6 预设皮肤渲染 —— **P1**

- 现状：`pcskin1..12` 每个渲染 `Geometry.default` + `Texture.presetN`，`part_visibility: [{ "*": true }]`；同时 `third_person` 在 `pc_state>=10` 时把 `*` 全部隐藏。
- 问题：`pcskinN` 的 `{"*": true}` **会覆盖** `third_person` 里 `helmet/leftLegging/.../belt` 的条件可见性；启用预设皮肤时，盔甲/披风层的显示逻辑被重置，可能出现“裸皮上带盔甲层”或盔甲层常显。
- 另外：`third_person` 与 `pcskinN` 同时渲染 `Geometry.default`（仅贴图/可见性不同），属于“同几何多控制器”，依赖覆盖顺序，脆弱。
- **校准**：
  - 预设皮肤控制器只显示**身体部位**，并复制 `third_person` 的盔甲/披风条件；或
  - 改用**一个** `third_person` 控制器 + `Array.pc_skins[...]` 选择贴图（把皮肤选择并入 `textures` 数组），避免重复渲染。

### 2.7 `player.entity.json` 覆写策略 —— **P1**

- 现状：整份覆写 `minecraft:player` 客户端实体（含大量长枪/第一人称/kinetic weapon 逻辑，带 `//` 注释）。
- 对照：与原版 addon 的 `animate`/`render_controllers` 逐项比对，**我们的 animate 列表 = 原版 + `pcsizec`**，render_controllers = 原版 + `pcskin1..12` + `vcraft_belly1/2`。所以“结构对齐原版”，可接受。
- 风险：
  - **版本漂移**：官方每次给玩家实体加动画/控制器，这份覆写就落后（例如新的 `attack_time`/kinetic 字段）。
  - `//` 注释：Bedrock 一般容忍，但换成严格校验工具/未来版本可能失败 `[待实机]`。
  - 头部/手持/第一人称依赖 `root` 控制器，**不在 `animate` 里显式列出**——依赖 `controller.animation.player.root` 内部实现，属隐式契约。
- **校准**：用脚本对比官方 `bedrock-samples/.../player.entity.json` 与本地版本，列出差异并定期同步；注释改为独立 `README` 说明。

### 2.8 男/女判定与层可见性

- 现状：`third_person` 用 `query.scoreboard('pc_state') < 10` 判定“是否用了预设皮肤/是否女性”来隐藏全身层；胸部用 `mod(pc_state,10)>0` 判定性别。
- 问题：`pc_state < 10` 只表示“皮肤=0”，并不等于“男性”。男性 + 原版皮肤时 `pc_state=0..0`（sex=0, skin=0）→ 层正常；但**女性 + 原版皮肤**是 `pc_state=1..5 < 10` → 层也正常，同时胸部渲染（`mod>0`）。逻辑上勉强自洽，但把“皮肤选择”和“性别”耦合在一个阈值里，可读性差、易错。
- **校准**：分别用 `math.mod(pc_state,10)` 判性别、`math.floor(pc_state/10)` 判皮肤，不要把 `<10` 当性别判断。

### 2.9 受伤音效 —— **P2**

- 现状：`entityHurt` → 女性 + 未静音 → `dimension.playSound("pcraftrevorn_gender.female_hurt", e.location, {volume:0.7})`。
- 问题：`entityHurt` 对**每一 tick 的持续伤害**（着火、中毒、仙人掌）都会触发 → 音效刷屏。
- **校准**：加冷却（如 10 tick 内的伤害只播一次），或用 `EntityHurtAfterEvent.damageSource.cause` 过滤掉 `fire`/`magic`/`starve` 等。

### 2.10 菜单（表单）与 UI 皮肤化

- 现状：`ActionFormData` 主菜单 + 体型子菜单 + `ModalFormData` 皮肤滑条；`gender_menu.json` 劫持 `server_form` 命名空间，用标题里的纯文本标记 `PCraft Gender Mod`（+ `Female`/`Male`）判断是否本菜单。
- 评价：手法与社区一致（Fast Commands 也用命名空间覆盖/`server_form`）。早期用的是 `§3§r` 颜色码标记；1.26.50 的表单标题走新的文本管线，颜色码会被规范化掉，面板就再也匹配不到标题（已改为纯文本前缀标记，见 `docs/vcraft-gender-diagnosis.md`）。
- **校准**：
  - 标记可用更隐蔽的私有前缀（如 `\u00A7` 组合）或改用 `body`/`title` 的稳定字段；
  - 为 4 个按钮加图标（`button(text, icon)`）与本地化键。
- `openSkinMenu` 用 `ModalFormData` 滑条（无标记 → 原生表单可见可拖），合理。

### 2.11 入口（按钮/命令/短语）与 OPEN_TAG

- 现状：
  - 自定义命令 `/pcraftrevorn:gender`（`startup` 注册）。
  - 聊天短语 `?gender / ?性别 / ?settingmenu`。
  - 聊天栏「性别」按钮（`chat_screen.json`，隐藏 `edit_box` + 透明 `sendbutton`）。
  - `OPEN_TAG = "pcgender:open"`：短语走 `open()` 打标签，`runInterval(10)` 轮询后开菜单。
- 问题/校准：
  - `BUTTON_TOKEN = "pcgender_open"` 在 `chatSend` 里被匹配，但按钮实际发的是 `/pcraftrevorn:gender`，**该 token 无来源（死代码）**。
  - `OPEN_TAG` 轮询可用 `system.runTimeout(player => openMenu(player), 1)` 直接替代（before 事件里不能开表单，但 `system.runTimeout` 可以），更简单可靠。
  - 自定义命令依赖 Script API 2.0（1.21.80+）。**校准**：入口优先用“聊天短语 + `chatSend`”（不依赖命令），或 `scriptevent`（主包已在用）。

### 2.12 死代码/冗余（P3）

- `girl.json`：`animation.player.sneakingj/jumpj/walkj/sprintj/stopj` **未被任何控制器引用**；`animation.player.attacking/fall/turnr` 被引用但只动 `b`（`bone2` 不存在）。
- 动画控制器：`girl.animation_controllers.json` 的 `controller.animation.player.walk`、`Player.json` 的 `controller.animation.player.jumping` **未被 `animate` 引用**。
- `openSizeMenu`/`openGenderMenu` 互相递归用 `system.run`——可接受，但深递归需注意切换表单的“busy”竞态（`show` 失败被 catch 吞掉）。

---

## 3. VCraft 逐功能审查

### 3.1 `pc_belly` 与肚子渲染 —— **P0**

- 与 2.2 同源：`main.js:438` 同样的 `setObjectiveAtDisplaySlot` 误用；`pc_belly` 也未显示 ⇒ 肚子渲染控制器读 0。
- 叠加 2.2 的槽位冲突：`pc_state` 与 `pc_belly` **都用 List**，一个槽只能挂一个。
- **校准**：见 5.1/5.2（修参数 + 分槽或合并编码）。

### 3.2 胃袋载体实体 `vcraft:gut`

- 现状：隐形、无重力/无碰撞、`damage_sensor deals_damage:false`、life 100、`persistent`、`rideable seat_count 5→20`。
- 评价：载体方案合理（Bedrock 无法直接给玩家套实体，用跟随实体承载猎物是常见做法）。
- 校准：
  - 20 座位已改；注意 `minecraft:rideable` 的具体上限 `[待实机]`。
  - 座位坐标仅占位（猎物隐形、gut 无碰撞），可接受。
  - `persistent` + 无退出清理 → 见 3.13。

### 3.3 跟随/传送与跨维度 —— **P2**

- 现状：`runInterval(2)` 每 2 tick `gut.teleport(player.location, {dimension: player.dimension})`。
- 问题：
  - `world.getEntity(id)` 在实体未加载/已移除时返回 `undefined` 或抛错（已 try/catch）。玩家跨维度时 gut 可能卸载 → 下个 tick `getGut` 重新生成，旧 gut 可能残留。
  - 每 2 tick 对**每个玩家** teleport + 读 riders，量大时是稳定开销。
- **校准**：跨维度用 `dimension` 变化检测重建；用 `Entity.isValid` 判定后再复用；把 2-tick 循环拆成“仅对有猎物的玩家”做重活。

### 3.4 吞怪流程

- 现状：`swallow(player, target)`：容量检查 → 打 `vcraft_prey` 标签 → `gut.runCommand("ride @e[tag=...,c=1] start_riding @s")` → `hide()` → 音效 → 提示。
- 触发：蹲下 + 右击（`playerInteractWithEntity` + `player.isSneaking`）、命令、`scriptevent`、聊天短语。
- 评价：多入口覆盖好。
- 问题：
  - `hide()` 用 `invisibility 200t` + 清 nameTag；**invisibility 不隐藏手持/盔甲**；且只在 2-tick 循环里对“活着的 riders”刷新，玩家离线后过期。
  - `isPreyCandidate` 未排除被驯服/已命名/幼年/村民等（设计取舍）。
- **校准**：隐藏猎物优先“让猎物隐形 + 清装备显示”，或直接把猎物 `teleport` 到 gut 并给强隐身；对离线/过期做补偿刷新。

### 3.5 消化流程

- 现状：`digestTick`（每 20t）每玩家消化一只：进度 `rate`（maxima 16 / creativa 8 / 4）到 100 → `kill` → 回血 +4 → 掉 `bone_bits` → `absorb+1` → 可选 `growChest`。
- **对照 Java**（`.work/vcraft_src/procedures/AbsorbProcedure.java` 等）：
  - Java 有 `AbsorptionAmount / bellySize / AbsorptionBreakdown`（4 段配额），消化会**恢复饥饿值/饱和度**、按配额施加不同药水效果（生命恢复/缓慢/…），并**递减 bellySize**。
  - Bedrock 端口**大幅简化**：只有回血 +4 + 骨片 + absorb，没有饥饿/饱和度/配额效果。
- **校准**：若要还原，补 food/saturation 恢复与 `AbsorptionBreakdown` 的 4 段加成（可作为可选“吸收类型”）。

### 3.6 容量与饰品

- 现状：`capacity = 5 + min(5, floor(absorb/5))`，`expansion_ring`/`maxima` → 20；`digestionDisabled` = `acid_ring`；`digestRate` maxima/creativa 提高；`wither_pendant` 允许吞凋灵。
- 评价：饰品语义与 Java 名称一致（acid/expansion/maxima/creativa/wither）。
- 校准：`acid_ring` 语义是“免疫消化”还是“加速”？当前=禁用消化（猎物永久留存），确认与原意图一致。

### 3.7 饰品获取途径 —— **P1**

- 现状：只有 `bone_bits→bone_meal` 一个配方；6 个饰品**无配方、无掉落**，仅创造栏可取。
- 且：**没有“使用物品装备”的入口**，只能通过 `/vcraft:trinkets` 菜单装备（`equipFromInventory`）。
- **校准**：补合成/掉落/交易；或让饰品可用（`itemUse`/`playerInteractWithBlock`）直接装备，更符合直觉。

### 3.8 玩家互吞（PvP）—— **P1/P2**

- 现状：`PV` Map（内存）记录 `{predatorId,digest,rate,struggles,…}`；`swallowPlayer` 给猎物 `invisibility 1000000t` + `resistance 4`，`ride` 到 gut。
- 问题（严重）：
  - **会话不持久**：世界重载/崩溃后 `PV` 丢失，但玩家仍骑着 gut、带着 **1000000 tick 隐身/抗性**，脚本不再驱动 → **永久卡隐身/无法吐出**。
  - `resistance 4`（抗性提升 V）+ 隐身，若有其他战斗系统可能异常。
  - `PV` 是模块级 Map，非跨包共享；主包无法感知。
- **校准**：
  - 把“正在被吞”状态写成**玩家动态属性**（如 `vcraft:pprey`），在 `playerSpawn`/加载时对账并补发/释放；
  - 效果改成**有限时长**（如 40t）并由 tick 刷新，避免 1000000t 残留；
  - 泄露时提供 `/vcraft:release` 或自动 60s 超时释放。

### 3.9 挣扎输入 —— **P1**

- 现状：`playerPreyTick`（每 1t）用 `prey.inputInfo.getButtonState("Jump"/"Sneak")` 做边沿检测。
- 文档：Input API 1.21.70 起脱离 Beta；但明确警告“**按得太快可能读不到**”，且**触屏 Sneak 只按下 ≤1 tick**；推荐 `world.afterEvents.playerButtonInput`。
- **校准**：改用 `playerButtonInput` 捕获边沿（Jump/Sneak/Left/Right），或两者结合；对手柄/触屏分别调参。

### 3.10 压倒 debuff

- 现状：`overwhelmTick`（40t）`n>=5` 给反胃、`n>=3` 给缓慢。
- 校准：`getGut(player)` 会**为每个玩家生成 gut**（有副作用），这里应改用 `getGutExisting`。阈值可对照 Java `OverwhelmedProcedure`。

### 3.11 环境音/逃脱

- 现状：`ambientTick`（40t）30% 概率播 struggle；2% 概率随机放走一只猎物。
- 校准：随机放走对“捕食者”体验可能突兀；Java 是“猎物挣扎/被消化”而非随机跑。建议改成“低概率提示”或去掉。

### 3.12 菜单

- 现状：主菜单/设置/胃袋/饰品，全部脚本表单。
- 校准：与性别包统一 UI 风格与本地化；饰品菜单已可用。

### 3.13 死亡/退出清理 —— **P2**

- 现状：`entityDie`（玩家）→ 释放其猎物；`cfgKeep` 可保留。
- 缺口：
  - **无 `playerLeave`/`playerSpawn` 对账** → 持久 gut 在玩家离线后残留在原地，长期累积。
  - 玩家被吞状态（3.8）无恢复。
- **校准**：`world.afterEvents.playerLeave` 释放/记录；`playerSpawn` 时校验并重建 gut；提供 `/vcraft:cleanup` 清理孤儿 gut。

### 3.14 与主包 PCraft 掠食者系统的交叉 —— **P1**

- 主包 `vore/vore.js` 用 `pc:pred` + `sessions`（内存）处理“掠食者吞玩家”，并用 `vore_digesting` 标签、`vcraft_prey`/`vcraft_pprey` 做互斥。
- VCraft 用 `PV`（内存）处理“玩家吞玩家”，也查 `vore_digesting`/`pc:pred`。
- 问题：**两套玩家猎物系统并存**，互斥只覆盖部分路径；边界情况可能双重状态；两套都不可持久。
- **校准**：统一由一处管理“玩家被吞”状态（或让 vcraft 复用主包的 `pc:pred`/`sessions`），并在文档里明确分工。

### 3.15 性能

- `runInterval(2)`：全玩家 teleport + riders。
- `runInterval(1)`：仅 PV 非空时遍历。
- `runInterval(20)` 消化、`runInterval(40)` 环境/压倒。
- 评价：对中小服可接受；大服建议按需 tick（有猎物才跑重活），并避免 `setActionBar` 每 tick 刷（现在 2-tick 刷，尚可）。

### 3.16 本地化

- 性别/VCraft 的菜单与消息**全部硬编码中文**，未走 `texts/*.lang`。
- **校准**：与主包 i18 统一，改为 lang key（`entity.*`、`item.*`、自定义 UI/消息键）。

---

## 4. API / 版本正确性清单

| 项 | 现状 | 结论 |
|----|------|------|
| `setObjectiveAtDisplaySlot` | 传裸目标 | ❌ 必须 `{ objective }`（P0） |
| `query.scoreboard`（RP） | 用于渲染/动画控制 | ⚠ 仅当目标显示时有效（P0 条件） |
| 自定义命令注册 | `startup.customCommandRegistry` | ⚠ Script API 2.0（1.21.80+）；确认实验/引擎 |
| `Player.inputInfo.getButtonState` | 每 tick 轮询 | ⚠ 有丢失风险；建议 `playerButtonInput` |
| 动态属性 | boolean/number/string/Vector3 | ✅ 用法合规；注意 string ≤ 32767B、number Int64 |
| `world.getEntity(id)` | 复用 gut/预捕 | ⚠ 无效 id 会抛；已 try/catch；注意跨维度/未加载 |
| `scoreboard` 目标名 | `pc_state`/`pc_belly` | ✅ 全小写（Wiki 警告大写不可查） |
| `Entity.runCommand` | 在 interval 内 | ✅ interval 非 before 事件，允许 |
| `@minecraft/server` 版本 | `2.0.0`（稳定=1.21.84） | ⚠ 1.21.100 对应 2.1.0（1.21.95），2.0.0 可用但非最贴 |
| JSON `//` 注释 | 玩家实体文件有 | ⚠ Bedrock 一般容忍，建议确认并最好移除 |
| `player.entity.json` 覆写 | 全量覆写 | ⚠ 版本漂移风险，需同步官方 |
| 跨包资源引用 | gender RP 引 vcraft 几何/RC | ⚠ 脆弱，建议归位到 gender RP |

---

## 5. 校准建议（按优先级）

### 5.1 P0 —— 让渲染真正生效
1. `gender.js` 与 `vcraft/main.js` 的 `setObjectiveAtDisplaySlot` 补 `{ objective: obj }`。
2. 解决槽位冲突：`pc_state` 与 `pc_belly` 分开显示槽，或**合并为一个目标**（如 `skin*1000+sex*100+belly`）。
3. 客户端查询依赖显示槽（MCPE-102389）——修好后用 §7 清单验证。

### 5.2 P0 备选 —— 降低对 scoreboard 的依赖
4. 胸部改用原版 addon 的 `/playanimation @s animation.player.sizeN b 9999` + 常显 `controller.render.b`。
5. 肚子改成由服务器命令/动画驱动（`/playanimation` 或实体脚本），不再用 `query.scoreboard('pc_belly')`。

### 5.3 P1 —— 正确性/健壮性
6. 玩家被吞状态持久化 + 加载对账；效果改有限时长（见 3.8）。
7. 挣扎输入改 `playerButtonInput`（见 3.9）。
8. 饰品获取途径 + 直接使用装备（见 3.7）。
9. 预设皮肤渲染避免 `{"*": true}` 覆盖盔甲可见性（见 2.6）。
10. `overwhelmTick`/`ambientTick` 用 `getGutExisting`，避免副作用生成（见 3.10）。
11. `playerLeave`/`playerSpawn` 清理与对账孤儿 gut（见 3.13）。
12. 统一/协调主包与 vcraft 的玩家猎物系统（见 3.14）。
13. 受伤音效加冷却（见 2.9）。

### 5.4 P2/P3 —— 长期与整洁
14. 校验器覆盖 gender/vcraft（见 1.3）。
15. 跨包资源归位（见 1.2 / 2.7）。
16. 清理死动画/控制器/未用 token（见 2.12）。
17. 性别/VCraft 本地化（见 3.16）。
18. 同步官方 `player.entity.json` 差异（见 2.7）。
19. 还原 Java 的饥饿/饱和度/吸收配额（见 3.5）。

---

## 6. 参考与对照表

| 主题 | 我们的做法 | 参考做法 | 结论 |
|------|-----------|----------|------|
| 玩家胸部渲染 | scoreboard + `query.scoreboard` | 原版 addon：subpacks + 常显 + `/playanimation` | 我们的更灵活但更脆 |
| 状态→客户端 | 分数板 | 主包掠食者用实体属性 | 玩家无法用属性，scoreboard 是次优 |
| 按钮→命令 | HUD/背包隐藏 edit_box | Fast Commands：只在 chat_screen；HUD 需 `always_accepts_input` | 我们的 HUD 缺输入覆写 |
| 玩家自定义模型 | 覆写 `minecraft:player` | CPM：skin+anim 配置 | 两路线，CPM 更隔离 |
| 玩家猎物管理 | `PV` Map + 实体乘客 | Java：capability 持久 + 网络包 | 我们缺持久化 |

---

## 7. 验证清单（实机）

1. 开**内容日志**，观察脚本/资源报错。
2. `/scoreboard objectives list` 看 `pc_state`、`pc_belly` 是否存在；`/scoreboard objectives setdisplay` 看是否可显示（修 P0 后应成功）。
3. 三人称看胸部；`/scoreboard players set @s pc_belly 2`（并显示该目标）看肚子。
4. 分离变量：`?gender`、`?菜单` 能否开表单（不依赖自定义命令）。
5. 逐个测试入口按钮（聊天/性别、HUD/Vore、背包/菜单）。
6. 吞一只怪后看 `vore_digesting` 标签、gut 乘客、`pc_belly` 分数。
7. 玩家互吞后 **重启世界**，检查是否卡隐身/卡骑乘（验证 3.8）。
8. 换维度、退出重进，检查 gut 是否重建/残留（验证 3.3/3.13）。

---

*审查记录：砂墨SandMo · 基于仓库当前实现与公开资料整理。*
