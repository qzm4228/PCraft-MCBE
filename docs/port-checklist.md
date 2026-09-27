# PCraftRevorn → Bedrock 1.21.100.6 移植清单

> 原模组：**PCraftRevorn 3.1.1**（Forge 1.20.1，作者 MysticSummoner，AFL-3.0）
> 目标：**Bedrock 1.21.100.6**（行为包 + 资源包 + ScriptAPI 2.x）
> 命名空间：`pcraftrevorn`

本文件是移植的**总清单与进度表**。逐文件映射见 [`file-mapping.md`](./file-mapping.md)。

---

## 0. 现状（本仓库已完成部分）

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | BP/RP 骨架、manifest（`min_engine_version 1.21.100`）、打包脚本 | ✅ 已完成 |
| P1 | 4 方块、40 物品、16 配方、方块掉落、贴图/音效/语言/图集 | ✅ 已完成 |
| P1 | 猪灵王座几何体自动转换（需游戏内目视校验） | ⚠️ 待验证 |
| P2 | 16 生物定义 + GeckoLib geo/animation + 变体贴图 | ✅ 完成（生成蛋新格式 `spawn_egg.texture`、发光层、弹射物模型；胃部骨骼显隐待办） |
| P2.5 | UI 基座（server_form 覆盖 + 状态总线） | 🟡 完成（待游戏内验证） |
| P3 | vore 核心（吞入/消化/反刍，不含挣扎） | 🟡 首版完成（待游戏内验证/调平衡） |
| P4 | 挣扎（原生输入：跳/潜/横移） | 🟡 已改为原生输入（待实机验证） |
| P5 | WG / 驯养 / AI / 物品交互 / 护符 | 🟡 首版（WG、驯养组件、物品右键、护符被动） |
| P6 | 世界生成（结构） | ✅ 脚本实现（jigsaw 无法移植，改为脚本近似：数据表放置 + 脚本刷出） |
| P7 | 指南书 / 发酵桶 UI（form）+ 配置 | 🟡 首版（指南书表单、发酵桶交互、设置表单） |

生成的包：`dist/PCraftRevorn.mcaddon`（需 `build.ps1`）。
scripts 模块已写入 manifest，依赖 `@minecraft/server 2.0.0` + `@minecraft/server-ui 2.0.0`
（**1.21.100.6 的确切版本待游戏内确认**；若加载失败，按 §6 调整版本号）。

---

## 1.5 UI 基座（P2.5）

方案：模仿 Ponder，用 **表单标题当状态总线**（Bedrock JSON-UI 不能直接跑脚本）。

- `behavior_pack/scripts/pcraftrevorn/constants.js`：标记定义 + `buildTitle()`
  - 标题结构：`§0§r§1§r`（门控）+ `§2§r`（进度标记）+ `§<hex>§r`（0–15 级）+ 人类可读标题
  - 标记都是格式化码，**不可见**，所以原生表单标题仍干净
- `scripts/pcraftrevorn/ui/forms.js`：`showPcForm()`（`ActionFormData`）/ `showPcModal()`
- `scripts/main.js`：被吞状态演示——手持木棍右键或 `/scriptevent pcraftrevorn:form` 打开
  「方向按钮」表单（**弹出鼠标**，符合选定方案）
- `resource_pack/ui/pcraftrevorn_forms.json`（由 `tools/generate_ui.js` 生成）：
  **局部覆盖** `server_form.third_party_server_screen`，通过 `$additional_screen_content`
  叠加一个 16 级进度条，仅当标题含 `§0§r§1§r` 时显示
- `resource_pack/ui/_ui_defs.json`：注册上面的文件（用**唯一文件名**避免与其他附加包冲突）

待验证/风险：
- [ ] 局部覆盖 `third_party_server_screen` 是否生效（若无效则改为整文件替换 `ui/server_form.json`，参考 Ponder）
- [ ] `@minecraft/server` 2.0.0 / `server-ui` 2.0.0 在 1.21.100.6 是否可用
- [ ] 进度条位置/尺寸在游戏内微调；后续可扩展为整屏自定义被吞界面（隐藏原生内容 + 自定义按钮绑定 `form_buttons` 集合）

## 1.6 vore 核心（P3）

原 `MobEatPlayerProcedure` 流程（瞬移锁位 + NBT 状态 + 脚本判定的消化/挣扎）移植为：

- `scripts/pcraftrevorn/vore/vore.js`
  - 吞入触发：掠食者（`predator` 家族）近战命中玩家，按 `swallowChance`(0.35) 概率吞入
  - 会话状态（内存 `Map`）：`digest / rate / maxTimer / struggles / needed`
  - 每秒 tick：把玩家瞬移锁定到掠食者身上；`digest += rate`（rate 递增到上限）；超过 `maxTimer` 用 magic 伤害致死
  - 满腹贴图：`digest/maxTimer >= bellyFraction` 时切 `_belly` 贴图（`assignSkin(pred, true)`）
  - 挣脱：挣扎够次数且 `digest <= 0` → `release(player, true)` 施放反刍效果
- `scripts/pcraftrevorn/skin/assign.js`：`TextureAssignerGendered` 的 JS 版，按
  `gender/variant/counter/wg/belly` 拼出贴图名并查 `skins.js` 索引 → `setProperty("pcraftrevorn:skin")`
- `scripts/pcraftrevorn/data/skins.js`：由 `generate_entities.js` 自动生成的「贴图名 → skin 索引」表
- 调试：`/scriptevent pcraftrevorn:swallow`（吞最近掠食者）、`/scriptevent pcraftrevorn:form`（纯表单演示）

待办（P4 替换挣扎逻辑 + 平衡）：
- [ ] 挣扎改为「正确方向组合」（读 `Struggle*Procedure` + `MobEatPlayerProcedure` 的 required 标志）
- [ ] 酸液系数/上限、致死时间按 `PCraftGeneralConfiguration` 还原
- [ ] 胃内视角（`3d_structure_renderer` 渲染掠食者）
- [ ] 被吞时隐藏 HUD、限制移动/视角

## 1.7 挣扎（P4）

`scripts/pcraftrevorn/vore/struggle.js`（移植 `MobEatPlayerProcedure` 的 required 逻辑 + `Struggle*Procedure`）：

- 每次提示随机要求 **1 个方向** 或 **2 个方向组合**（`struggleDifficulty=0.4` 概率为组合）
- 玩家用表单按钮按出所需方向；按对（组合需全部按到）→ 挣扎成功，播放对应
  `struggleup/down/left/right/upleft/upright/downleft/downright/updown/leftright` 动画
- 按错 / 超时（`struggleTimer=60` 刻）→ 播放 `strugglefail`，消化进度回涨
- 成功 `strugglesNeeded` 次且进度归零 → 反刍脱身

> 实机反馈后**弃用表单挣扎**。Bedrock 无法注册按键，物品栏/HUD 的 JSON-UI 按钮也**无法回调脚本**
> （TLM/Ponder 的按钮是**表单屏幕**的 `form_buttons` 集合，只在表单里有效）。
> 现改为**原生输入**当按键（零 UI、不锁视角、触屏可用）：**跳跃=上、潜行=下、左右横移=左右**
> （`Player.inputInfo` + `InputButton.Jump/Sneak`）。被吞流程：第三人称 + 松散锁位（漂移>4格才拉回）
> + 每 60 刻自动 `digest` 动画 + actionbar 提示所需方向；`/scriptevent pcraftrevorn:release` 脱身。
>
> 实机修复（第二轮）：① 动画文件缺 `"loop": true`（GeckoLib 靠代码循环）→ 生成器对 idle/walk/sprint/hidden 设 true；
> ② 掠食者攻击行为移入组件组 `pcraftrevorn:aggressive`，被吞时 `on_swallow` 移除、放出时 `on_release` 恢复，
> 解决"被吞后还在打我"；③ `isPredator` 改按 `typeId` 判定（原 `matches({family})` 字段名错误）。

## 1.8 工程自检

`node tools/audit.js` 会交叉校验：物品图标/方块贴图图集、实体↔客户端实体↔几何/控制器/动画、
实体生成蛋目标、配方引用、方块/实体掉落表、manifest 依赖、UI 定义、脚本 import 路径。
当前结果：**0 error / 0 warn**。

## 1.9 玩法补全（P5/P7 首版）

- **物品右键交互** `scripts/pcraftrevorn/game/interact.js`
  - 掠食者指南 → 指南书表单；奇物 → 切换变种；超密猪排 → 体重阶段 +；鳞片/板 → 治疗
  - 空手右键 → 显示变种/体重/驯服状态
- **驯养**：5 个可驯服掠食者（`gilded_basaltmite / piglin_royal_knight / rabbit_wizard / scarecrow / vinemaiden`）
  用数据驱动 `minecraft:tameable` + 驯服组件组（`follow_owner`），驯服物品 = 丘比特之箭
- **体重增长** `game/wg.js`：每次完整消化累计进度，阈值 3/7 → WG 阶段 0/1/2，自动换贴图
- **护符/饰品** `game/baubles.js`：扫描背包（Curios 替代）施加被动效果
- **发酵桶** `game/ferment.js`：手持荧光浆果汁交互 → 发酵为发酵版
- **指南书** `game/guide.js`：多页表单列出 9 种掠食者
- **配置** `game/config.js`：`/scriptevent pcraftrevorn:settings` 打开设置（被吞概率/挣扎难度/时限，按玩家存储）

调试命令：`/scriptevent pcraftrevorn:form|guide|settings|swallow`

打包：`build.ps1`（已修正为 **正斜杠 zip 条目**，否则 Bedrock 无法导入）。

## 1.10 P6 世界生成（脚本实现）

Bedrock 附加包**不支持 jigsaw 结构**，原 `royal_castle_remnant`（jigsaw + template pool + 两个 `.nbt`）改为等价脚本实现：

- `tools/nbt_to_data.js`：把 Java `.nbt` 结构（大端 NBT）解析、**状态名映射**（stairs→`weirdo_direction`/`upside_down_bit`、
  wall→`wall_connection_type_*`/`wall_post_bit`、basalt/chain→`pillar_axis`、chest/throne→`minecraft:cardinal_direction`、
  lava→`liquid_depth`），生成 `scripts/pcraftrevorn/data/structures.js`
  - `remnant_throne_room`：3382 方块 + 7 实体（30×16×21）
- `game/structure.js`：`piglin_throneroom_spawner` 生成后延迟 2 秒，分批（300/刻）用
  `BlockPermutation.resolve` 放置整个城堡并刷出实体，然后移除自身
- `game/worldgen.js`：近似原 structure_set（spacing 16/separation 11）——每 20 秒有概率在主世界玩家的下界附近
  刷出 `piglin_throneroom_spawner`（避免 96 格内重复）
- 刷怪规则（4 条）在 P2 已生成

## 1.11 消化 / 体重机制对齐原版

数值取自 `PCraftGeneralConfiguration` 与各 `PCraftSpecific*Configuration`（`PRED_STATS` 表在 `skin/assign.js`）：

- **消化目标** = 12000（`DIGESTIONGOAL`）；酸液速率 = 各生物 `INITIALACIDSRATE`→`MAXACIDSRATE`，每刻 +`ACIDRATEINCRIMENT`
- **消化动画按体重阶段**（`DigestAnimProcedure`）：rabbit → `digest`/`digestWG1`/`digestWG2`；
  scarecrow → `digestWG1`/`digestWG2`（无基础 `digest`，已兜底）
- **消化完成**：肚子贴图复位 + 恢复 30% 最大生命（`HEALTHRECOVERY`）+ 打嗝音 + 体重进度 +1 + 击杀猎物
- **体重阈值**（`WG1`/`WG2`）：进度 ≥1 → 阶段1；≥4 → 阶段2；`gilded_basaltmite`/`piglin_royal` 不增长（原版返回 999）
- **阶段提升**（`IncreaseStatsProcedure`）：吞食概率 ×1.25、需挣扎次数 +1、挣扎难度 ×1.1
- **吞食概率**改用各生物自身的 `pc:swallow`（0.12–0.34），不再统一用玩家设置

⚠️ 风险：方块**状态名映射**为最佳猜测（尤其楼梯朝向 `weirdo_direction` 0=E/1=W/2=S/3=N），
若游戏内楼梯/墙朝向错乱，改 `tools/nbt_to_data.js` 的 `STAIR_DIR`/`WALL_CONN` 即可。


---

## 1. Java → Bedrock 技术栈映射

| Java (1.20.1 Forge) | Bedrock (1.21.100.6) |
|---|---|
| `mods.toml` + Forge 注册 | `manifest.json`（BP `data` + RP `resources`） |
| GeckoLib 模型/动画 | RP `models/entity/*.geo.json` + `animations` + `render_controllers` |
| Curios API 槽位 | 无对应 → 脚本 + 物品栏/副手/盔甲槽近似 |
| `procedures/*`（347） | BP `scripts/*.js`（`@minecraft/server`） |
| `getPersistentData()`（1408 处） | 实体 `dynamic properties` + `entity properties` |
| `PlayerVariables` 能力（网络同步） | 玩家 dynamic properties + `world.setDynamicProperty` |
| 网络包 `*Message`（16） | 脚本事件（无需网络层） |
| Custom `MobEffect`（18） | 不可注册 → 脚本伪效果（actionbar + 原版效果 + 实体标记） |
| Custom `Attribute`（9） | BP 实体组件 + entity properties + 脚本变量 |
| Custom `Menu`/`Screen`（14） | `@minecraft/server-ui` 表单 |
| `KeyMapping`（4 个方向键） | 不可注册 → 移动/跳跃/潜行组合检测 |
| jigsaw structure + `.nbt` | Bedrock jigsaw + `.mcstructure` |

---

## 2. 注册表逐项

### 2.1 方块（4）— ✅ 已生成

| ID | 实现 | 备注 |
|---|---|---|
| `glowberry_fermentation_barrel` | 全方块，六面贴图，`cardinal_direction` 朝向 | 发酵逻辑 P7 |
| `soul_jack_o_lantern` | 全方块，南瓜贴图 + 灵魂正面，发光 10 | 朝向 |
| `piglin_throne_1` / `_2` | 自定义 geometry（自动转换）+ 多材质 | ⚠️ 需目视校验坐标/旋转 |

### 2.2 物品（40）— ✅ 已生成

- 普通物品 27 + 蠹虫装甲 4 + 生成蛋 9
- 食物 2（荧光浆果汁 / 发酵版）：nutrition 12
- 蠹虫装甲：护甲值 2/6/5/2，耐久 165/240/225/195，用 `silverfish_plate` 修复
- 生成蛋：`minecraft:entity_placer` 指向对应实体（实体 P2 定义后生效）
- 生成蛋图标：脚本生成的两色蛋形 PNG
- **Curios 饰品**（`basaltmite_plated_soles`、`gilded_shield`、`piglin_might_talisman`、`piglin_royal_talisman`、`sugar_neutralizing_water`）暂作为普通物品，交互逻辑 P5

### 2.3 生物（16）— ⏳ P2

| ID | 类别 | 变体维度 |
|---|---|---|
| `basaltmite` / `gilded_basaltmite` | 挖矿、可驯服 | 性别 × 体型 × WG(3) |
| `silverfish` | 挖矿、驯养 | 性别 × WG(3) |
| `vinemaiden` / `vinemaiden_seedling` | 埋伏、驯养、成长 | 序号（0-13,99）× WG |
| `zombie` | 掠食 | 序号（0-3,66）× WG |
| `scarecrow` | 守护、催熟、饥饿值 | 性别 × 健康(3) × WG |
| `rabbit_wizard` | 村庄守护、召唤 | 序号（0-2）× WG |
| `piglin_royal` / `piglin_royal_knight` | 王座、交易、护卫 | 性别 × 护甲(3) × WG |
| `piglin_royal_spawner` / `piglin_throneroom_spawner` | 生成器 | — |
| `binding_ring` / `shielding_ring` | 光环实体 | — |
| `rabbit_player_projectile` / `rabbit_projectile_bloodlust` | 弹射物 | — |

变体方案：**`pcraftrevorn:skin` 整数实体属性**（`client_sync`）作为贴图索引，render controller 用
`Array.skins[q.property('pcraftrevorn:skin')]` 选贴图；脚本（P3）按原 `TextureAssignerGenderedProcedure`
的命名规则算出贴图名，再查索引表 `setProperty`。生成器：
- `tools/generate_entities.js`
- geo 为 GeckoLib 格式，**与 Bedrock 原生格式一致可直接复用**（仅修正 `vinemaiden_seedling` 的 identifier）
- **动画必须转换关键帧**：GeckoLib 用 `{"vector":[...]}` / `{"post":{"vector":[...]},"lerp_mode":...}` / 常量 `{"vector":[...]}`，Bedrock 只认
  普通数组 / molang / `{"pre":…,"post":…,"lerp_mode":…}`。生成器递归解包 `vector`，并给动画补 `"loop"`
  （GeckoLib 靠代码循环，JSON 无 loop → Bedrock 播一次即停）。这是"模型在但完全不动"的真正原因。
- 动画控制器：`idle`/`walk` 由 `q.modified_move_speed` 切换；`swallow/strugle*/digest` 等过程动画由脚本 `playAnimation` 触发

P2 精修：
- [x] glow 层（`binding_ring_glow`/`shielding_ring_glow`/`scarecrow_glow`）→ 第二 render controller（`entity_emissive_alpha`）
- [x] `_belly` 满腹贴图并入 skin 数组，脚本 `assignSkin(pred, true)` 联动
- [x] 弹射物专用 `geometry.pcraftrevorn.projectile` + `cupid_arrow` 贴图
- [x] 生成蛋改用**新版 `spawn_egg.texture`**（每实体独立纹理，非 base/overlay 颜色）
- [ ] 胃部骨骼显隐（`UpperStomach2..6`/`LowerStomach2..6`/`WGStomach*` 等）→ `part_visibility` + 属性（需逐状态核对，暂缓）

### 2.4 自定义状态效果（18）— ❌ 不可注册

`regurgitation_armor/stench/sickness`、`rotten_stench`、`delectable_scent`、`play_sound`、`softened`、`acid_resistance`、`glowberry_high`、`carbonated`、`neutralized_acids`、`shielded`、`bound`、`piglins_decree`、`visual_fx`、`warded`、`rabbit_marked`、`bloodlust`

→ 全部脚本伪效果。

### 2.5 自定义属性（9）— 🔄

`size`、`tamed_behavior`、`counter`、`counter_2`、`variant`、`wg_progress`、`wg_stage`、`gender`、`hunger`
→ entity properties / dynamic properties。

### 2.6 自定义药水 — ❌

香气 / 恶臭 / 坚韧 / 平和 / 抗性各变体 → 自定义瓶子物品 + 脚本施加伪效果。

### 2.7 GUI / 菜单（14）— ❌ 自定义容器 UI 不可做

`StomachMenu`、`FermentationMenu`、`PredGuidebookMenu` + 11 个 `PG*Menu`
→ `ActionFormData`/`ModalFormData`。

### 2.8 按键（4）— ❌

`struggle_up/down/left/right`（方向键）
→ P4 重新设计为移动/跳跃/潜行检测。

---

## 3. 玩法系统（procedure 群）

| 系统 | 代表 procedure | Bedrock 方案 | 状态 |
|---|---|---|---|
| 捕获吞食 | `MobEatPlayer(Multi)`、`EatPrey*`、`EatTamed` | 脚本 tick 锁位 + dynamic property | P3 |
| 消化 | `DigestAnim`、`DigestTest`、`DProgress`、`ReturnDigestionSlow`、`ReturnMaxTimer` | 脚本计时 + actionbar 进度 | P3 |
| 挣扎 | `Struggle*`（4×5）、`StruggleCooldown`、`StruggleAnimations` | 重设计输入 + bossbar/actionbar | P4 |
| 反刍 | `StartFull/StopFull`、`Regurgitation*` | 脚本 + 原版效果 + 音效 | P3 |
| 体重增长 WG | `WGSet`、`WG1/2SpawnAdjusted/Returns` | entity property + render controller | P5 |
| 驯养/跟随 | `EatTamed`、`FollowOwner`、`RabbitFollow`、`VinemaidenTamed` | BP 行为组件 + 脚本 | P5 |
| 挖矿 | `BasaltmiteOreFullness`、`SilverfishOreFullness` | 脚本破坏事件 | P5 |
| 稻草人催熟 | `ScarecrowOnEntityTickUpdate` | 脚本 tick 施肥 | P5 |
| 猪灵王 | `PiglinRoyal*`、`PiglinSpawnIntervals`、`PiglinKnight*` | 脚本交互 + 结构 | P5 |
| 兔法师/法杖 | `RabbitWizard*`、`RabbitProjectile*`、`CupidsArrow` | BP 弹射物 + 脚本命中 | P5 |
| 发酵桶 | `GlowberryFermentationBarrellOnTickUpdate` | 脚本 tick（GUI → form） | P7 |
| 指南书 | `PredGuidebook*` + `Open*` | `ActionFormData` 分页 | P7 |
| 护符/护盾 | `*WhileBaubleIsEquippedTick` | 脚本检测物品栏 | P5 |
| 配置 | `PCraftGeneralConfiguration`（11 项） | 脚本常量 / world dynamic property | P7 |
| 世界生成 | `RoyalIntro`、`castle_remnant` | Bedrock jigsaw + mcstructure | P6 |
| 刷怪 | `biome_modifier/*` | `spawn_rules.json` | P6 |

---

## 4. 关键阻塞点与替代方案

1. **自定义按键 + HUD 叠加层** → 挣扎玩法必须重设计（差异最大处）。
2. **自定义容器 GUI** → 表单 / bossbar / actionbar 替代。
3. **18 个自定义效果 + 药水** → 脚本伪效果，死亡提示无法完全还原（用脚本消息 + 伤害后处理）。
4. **jigsaw 结构** → `.nbt` → `.mcstructure` 转换工具链。
5. **自定义锻造台配方** → Bedrock 的 `recipe_smithing_transform` 仅接受 `netherite_ingot` 作为 addition、原版盔甲/工具作为 base、模板需带 `transform_templates` 标签。本模组的 6 个自定义锻造（猪灵护甲升级、护符升级、蠹虫装甲）无法表达，**临时改为工作台无序合成**，P5 用脚本还原锻造交互。

---

## 5. 数据转换

| 数据 | 数量 | 处理 |
|---|---|---|
| 配方 | 16 | ✅ 已转（shaped / shapeless / furnace）；6 个自定义锻造改为工作台无序合成（P5 脚本还原） |
| 方块掉落 | 4 | ✅ 已转（Bedrock loot） |
| 实体掉落 | 2 | ✅ 已转（`zombie`、`piglin_royal`；实体阶段挂载） |
| 物品标签 | 3 | `basaltmite_scale` 用 `minecraft:tags` 组件；食物标签留待脚本 |
| 实体标签 | 10 | 脚本集合替代（`preds`、`gendered_preds`、`unswallowable_normal` 等） |
| 伤害类型 | 1 | `pcraftrevorn:digestion` → 脚本 + `/damage` 或自定义处理 |
| 世界生成 | jigsaw ×1、feature ×1、template_pool ×1、`.nbt` ×2 | P6 转换 |
| 刷怪 biome_modifier | 4 | P6 → `spawn_rules.json` |

---

## 6. 已知风险

- **王座几何体**：Java 元素模型自动转 Bedrock cube，坐标偏移（-8,0,-8）与旋转符号约定可能需微调；throne1 按 16 单位 UV、throne2 按 64 单位 UV 处理（两模型 UV 空间不一致）。
- **`minecraft:wool` 配方标签**：Bedrock 对原版标签支持不确定，若无效需改为具体羊毛。
- **生成蛋图标**：程序生成的占位蛋形，可后续替换为正式美术。
- **ScriptAPI 小版本**：1.21.100.6 精确支持的 `@minecraft/server` / `server-ui` 版本待确认；当前 manifest 写死 `2.0.0`，若整包不加载优先改这里（同 major 内 2.x 会被满足）。
- **UI 局部覆盖**：`server_form.third_party_server_screen` 的跨文件局部覆盖若无效，需改为整文件替换 `ui/server_form.json`（参考 Ponder）。
