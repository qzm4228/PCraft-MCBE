# VCM（Internalised V1.35）并入 PCraftRevorn — 移植方案

> 目标：把 **Internalised**（Forge 1.20.1，`modId="vcm"`，显示名 VCM）的内容**并入本仓库的
> PCraftRevorn 包对**，不新开独立包；组件名统一为 **PCraft+Internalised**（已在 `config/packs.json` 生效）。
>
> 来源：`jar/InternalisedV1.35(1.20.1-forge).jar`（gitignored）+ 反编译树 `.work/vcm_src/`（133 文件）。
> 资产解包目标：`.work/vcm/`（gitignored，不入库、不分发，与 `.work/community/` 同级处理）。
> 参考数据来自 `docs/java-mod-reference.md` §2。

---

## 1. 内容清单（逐项核对自 jar）

### 1.1 生物（8 个实体）

| VCM id | 类别 | 碰撞箱 w×h | HP | 攻击 | 跟随 | 变体 | 备注 |
|---|---|---|---|---|---|---|---|
| `slime_girl` | CREATURE | 1.00×2.00 | 20 | 6 | 24 | 5 色染料 | 唯一的**数值肚量**（见 §3.3） |
| `bat_girl` | CREATURE | 0.35×1.15 | 20 | 4 | 32 | normal / white / black，各有 tamed 版 | 满腹时 pehkui 防御 ×2 / 否则移速 ×0.75 |
| `bunny_girl` | MONSTER | 0.40×0.95 | 20 | 3 | 16 | — | `BunnyEatPlayerProcedure` 写错了实体（见 §2.8） |
| `cat_girl` | CREATURE | 0.40×0.95 | 20 | 5 | 16 | — | 贴图 `nekotexture` / `nekobellytexture` |
| `druid` | CREATURE | 0.40×0.95 | 20 | 4 | 16 | 四季（base/autumn/spring/winter） | 远程：法杖弹射物；目标僵尸/骷髅 |
| `lamia` | MONSTER | 0.40×0.95 | 40 | 8 | 16 | — | 击退抗性 0.3；目标 村民/铁傀儡/玩家/动物 |
| `projectile_druidprojectile` | MISC | 0.50×0.50 | — | 1.0 伤害 | — | 四季各一 | 穿透等级 2，发射冷却 60 tick |
| （同上 ×3 季） | MISC | 0.50×0.50 | — | — | — | autumn / spring / winter | 命中触发对应爆炸程序 |

渲染器缩放/阴影：蝙蝠娘 1.3/0.35、兔娘·猫娘·德鲁伊 2.0/0.5、拉米亚 2.5/0.5、史莱姆娘 2.0/1.0。

### 1.2 天然生成（`data/vcm/forge/biome_modifier/`）

| 生物 | 群系 | 权重 | 数量 |
|---|---|---|---|
| `bat_girl` | dripstone_caves / lush_caves / dark_forest | 10 | 1 |
| `bunny_girl` | 任意 | 5 | 1 |
| `cat_girl` | 任意 | 10 | 1 |
| `lamia` | 任意 | 20 | 1 |
| `slime_girl` | swamp | 20 | 1–4 |

### 1.3 物品（10：5 生成蛋 + 5 本体）

| 物品 | 关键数值 |
|---|---|
| `druid_staff` + `autumn/spring/winter_druid_staff` | 耐久 300；攻击 +2.0、移速 −2.4；使用动画 BOW；冷却 60 tick；音效 `block.amethyst_block.chime` |
| `vampiric_dagger` | 耐久 300；攻击 +3.0、移速 −2.4、**触及 +1.5**；物品冷却 16 tick；命中吸血 = 伤害/4（有虹吸粒子） |
| `blood_shard` | 堆叠 64，UNCOMMON；蝙蝠娘死亡 1/8 掉落 |
| `slime_pearl` | 堆叠 64；史莱姆娘 `"PEARL"` 槽吸收时产出 |
| 生成蛋 ×5 | Forge 的 base/overlay 颜色已记录，可直接生成蛋贴图 |

### 1.4 数据文件

- `data/vcm/loot_tables/entities/slime_girl.json`：1/6 `slime_pearl`（0–1）+ 1–2 `slime_ball`。
- `data/vcm/recipes/dagger_recipe.json`：黑曜石(上) + 铁锭×2(中左右) + `blood_shard`(中) + 木棍(下) → 吸血匕首。
- `data/vcm/damage_type/digestion.json`：自定义伤害类型（`message_id=digestion`，`effects=drowning`），
  对应三条死亡信息（`%1$s was digested`、`by %2$s using %3$s`、`whilst struggling to escape %2$s`）。

### 1.5 表现资源

- geo/animation（各 8 套）：`bat_girl`、`bunny`、`neko`、`lamia`、`druid`、`vcmslime`、`druidstaff`、`vampiricdagger`。
- 生物贴图 35 张：`*nobelly`（空腹）/ 本体（满腹）成对；蝙蝠娘另有 white/black + tamed；德鲁伊四季；史莱姆 5 色。
- 物品贴图 7 张；粒子 5 个（`autumn_leaves`、`leaves`、`siphon`、`spring_blossom`、`winter_snowflake`）+ 6 张粒子贴图。
- 挣扎 HUD 4 张（`textures/screens/new_piskel-*`）——**不需要**：已有的 JSON-UI HUD 直接复用。
- **无自定义音效**（全部用原版音效）。

---

## 2. Java → Bedrock 映射

| # | 机制 | Java（VCM） | Bedrock 方案 | 损耗 |
|---|---|---|---|---|
| 2.1 | 满腹状态 | `DATA_BellyFull` / `DATA_BellySlot` / `DATA_Digestion`（同步实体数据 + NBT） | 实体属性 + dynamic property（沿用 PCraft 的 vore 状态机） | 无 |
| 2.2 | 肚皮表现 | **换贴图**：`<name>nobelly`（空）↔ `<name>`（满） | 同一套命名：`<base>`（空）/ `<base>_belly`（满），走 `skin` 数组 + `assignSkin(pred, true)` | 无 |
| 2.3 | 消化计时 | `DATA_Digestion = 1200` tick（60 s），完成后重置 + 掉落 + 治疗 5 HP | 沿用 PCraft 酸液/消化状态机，按生物调 `PRED_STATS` 使满腹 ≈60 s | 曲线形状不同 |
| 2.4 | 玩家被吞 | 玩家 HP ≤ 10 → **SPECTATOR** + 玩家变量 + 挣扎小游戏 | 复用已有 `swallow` + 锁定道具输入 + JSON-UI HUD（Bedrock 无旁观者态） | 无旁观视角 |
| 2.5 | 挣扎小游戏 | `+15` 逃脱 / `−15` 或 600 tick 失败 / 每 30 tick 换提示 | 同一套道具+HUD；每生物配 `struggles`/`timer`，按 VCM 手感调 | 数值可调 |
| 2.6 | 非玩家猎物 | 取消 `LivingDeathEvent` → 记录 `BellySlot` → 完成时 `loot spawn` | `beforeEvents.entityDie` 拦死亡 + 记槽位 + 完成时生成掉落 | 无 |
| 2.7 | 消化致死信息 | 自定义伤害类型 `vcm:digestion` | Bedrock 不能注册伤害类型/死亡信息 → 用 actionbar/聊天提示替代 | **有损** |
| 2.8 | 兔娘吃人 bug | `BunnyEatPlayerProcedure` 误写 `DruidEntity.DATA_BellySlot` | **不照抄**，写兔娘自己的槽位 | 修正 |
| 2.9 | 体型/攻防缩放 | pehkui（仅蝙蝠娘 DEFENSE 2.0 / MOTION 0.75；史莱姆娘数项） | 无运行时缩放 → 用 component group + `triggerEvent` 换 `minecraft:movement`/伤害减免 | 近似 |
| 2.10 | 法杖弹射物 | Forge 实体 + 命中程序 | Bedrock `minecraft:projectile` 实体（参考 `rabbit_player_projectile`） | 无 |
| 2.11 | 粒子 | 5 个 Java 粒子 | `RP/particles/*.particle.json` + 贴图 | 无 |
| 2.12 | 驯服 | 交互驯服；史莱姆娘用史莱姆球 20% | 沿用 PCraft `minecraft:tameable`（`cupids_arrow`），史莱姆娘另加史莱姆球 20% | 无 |
| 2.13 | 天然生成 | forge biome modifier | BP 实体 `minecraft:spawn_rules` + `minecraft:biome_filter`（地表/亮度）+ 权重 | 群系粒度略粗 |

### 2.14 编号与命名（统一到 PCraft 命名空间）

- 实体/物品 id 一律 `pcraftrevorn:<vcm 原名>`（如 `pcraftrevorn:bat_girl`、`pcraftrevorn:slime_pearl`），
  与 "并入 PCraftRevorn" 的定位一致。
- 贴图：`resource_pack/textures/entity/pcraftrevorn/<base>[_belly].png`（沿用既有目录与 `_belly` 约定）。
- 生成蛋贴图复用 `generate_community.py` 的 `egg_rgba(base, overlay)`，颜色取 §1.3 记录的 Forge 值。

---

## 3. 需要"多写一层"的三个生物

### 3.1 蝙蝠娘（变体最多）
`pcraftrevorn:skin` 需覆盖：normal / white / black × tamed / 非 tamed = 6 个基底，每个再 ×2（空/满腹）。
命名落成 `batgirl{,_white,_black}{,_tamed}` + `_belly` 后缀。

### 3.2 德鲁伊（四季 + 远程）
`skin` 0–3 选四季；每季带 `_belly`；配 4 个弹射物实体（四季各一），命中做范围伤害 + 粒子。

### 3.3 史莱姆娘（数值肚量，唯一需要新属性）
- `DATA_BellySize`（0/2/4/6，硬上限 6）、`DATA_Max_Belly_Size`（初始 2）、`DATA_Size`（染料变体）、
  3 个槽位（`BellySlot1..3`，值 `"SLIME"` / `"PEARL"` / `"BABY"` / 猎物名）。
- 加实体属性：`pcraftrevorn:belly_size`(int)、`pcraftrevorn:belly_max`(int)；槽位存 dynamic property。
- 喂史莱姆球 `+2` 并记 `"SLIME"`；`"PEARL"` 吸收 → 肚量归零 + `belly_max +2`；`"BABY"` → 召唤幼体（owner 继承）。
- 未驯服且 `belly_size < belly_max` 才捕食玩家/村民/动物；驯服后转为 `OwnerHurtTarget`。

---

## 4. 分阶段计划

| 阶段 | 内容 | 产出 / 验收 |
|---|---|---|
| **A 资产** | `tools/extract_vcm_assets.ps1`：从 jar 解出 geo/anim/贴图/粒子/物品图/语言到 `.work/vcm/` | `.work/vcm/` 目录树完整；脚本可重复执行 |
| **B 生成器** | `tools_py/generate_vcm.py`（+ `tools/generate_vcm.js` 参照）：实体（predator/vore 组、skin 属性、spawn_rules）、client entity、render controller、geo/anim 转换、贴图改名、生成蛋、10 个物品、5 个粒子、掉落表、配方、注册表 `scripts/pcraftrevorn/data/vcm.js`、`en_US`/`zh_CN` 语言 | 8 目标全构建；`check.js` PROBLEMS 0；`audit.js` ERROR 0 |
| **C 行为** | `PRED_STATS` 6 条、`PREY_FAMILIES`/目标清单、驯服物品、天然生成、消化/掉落接线、玩家被吞复用挣扎 | 游戏内：被吞 → HUD 出箭头；逃脱/死亡流程与 PCraft 掠食者一致 |
| **D 特色** | 史莱姆娘数值肚量、德鲁伊弹射物+爆炸、5 个粒子、蝙蝠娘 component group 缩放、吸血匕首吸血、法杖冷却 | 逐项在游戏内验证 |
| **E 收尾** | 文档（本文件 + `standards-and-community-addons.md` 来源表 + `port-checklist.md` 索引）、Downloads 刷新、提交 | 版本号推进、`usable-*` 标签待验证后打 |

---

## 5. 待定 / 需确认

1. **vore 数值来源**：VCM 生物的 `struggles`/`acid`/`wg` 走 VCM 手感（60 s 消化、+15 逃脱）还是沿用
   PCraftRevorn 同体型生物的数值？（方案默认：**按 VCM 手感另配一组**）
2. **蝙蝠娘 white/black 变体**是否保留（原版是随机 variant，没有选择入口）？
3. **死亡信息**：接受"有损"（Bedrock 无法注册 `vcm:digestion`），用 actionbar 替代？
4. **组合实现顺序**：建议 B→C 先打通**蝙蝠娘**一条线（最复杂变体，最能验证管线），再批量补齐其余 5 个。

---

## 6. 实现进度

| 阶段 | 状态 | 产物 |
|---|---|---|
| A 资产 | ✅ | `tools/extract_vcm_assets.ps1` → `.work/vcm/`（104 文件） |
| B1 生物 | ✅ | `tools_py/generate_vcm.py`：6 生物 + 客户端实体 + 渲染控制器 + geo/anim 转换 + 生成蛋 + `data/vcm.js`；`assign.js`/`vore.js`/`guide.js` 合并 VCM 注册表 |
| B2 物品 | ✅ | 7 物品（四季德鲁伊法杖、吸血匕首、血碎片、史莱姆珍珠）+ 5 手持 3D attachables + 手持 geo/anim 转换 + 匕首配方 + 史莱姆娘掉落表 |
| B3 弹射物/粒子 | ⏳ | 4 个德鲁伊弹射物 + 5 个粒子 |
| B4 特色 | ⏳ | 史莱姆娘数值肚量、天然生成规则、蝙蝠娘 component group 缩放、驯服物品 |
| C 收尾 | ⏳ | 文档索引、Downloads 刷新 |

### 6.1 已落地的映射细节（B1）

- **肚皮 = 换贴图 + 换动画**：VCM 每个模型都有 `Belly/BellyUpper/BellyLower` 骨骼，`*full` 动画缩放这些骨骼 →
  贴图走 `_belly` 皮肤，动画走客户端实体的 `pcraftrevorn:belly` 布尔属性：
  `{"idlefull": "q.property('pcraftrevorn:belly') * (1 - ...move...)"}`、`{"idle": "(1 - q.property(...)) * ..."}`。
  该属性由 `assignSkin(pred, belly)` 顺手写入（其它掠食者没声明该属性，所以 `try/catch` 静默）。
- **渲染缩放**：VCM 用 pehkui 放大模型（蝙蝠娘 1.3、少女 2.0、拉米亚 2.5）→ Bedrock 用 `minecraft:scale`，
  碰撞箱仍取 VCM 的实体尺寸。
- **史莱姆娘**：源里没有 `*nobelly` 贴图（肚皮是数值状态），皮肤只放 6 个染料色；消化时播 `idle2`。
- **id 冲突**：社区导入已占用 `pcraftrevorn:lamia`（僵尸娘改皮），VCM 的拉米亚落到 `lamia_vcm`。
- **不照抄的 bug**：`BunnyEatPlayerProcedure` 把肚皮状态写进了 `DruidEntity.DATA_BellySlot`。

### 6.3 已落地的映射细节（B2）

- **手持模型的 UV 空间**：VCM 的 geo 声明 16×16（法杖）/32×32（匕首）UV，但贴图按 64×64 画（GeckoLib 按声明尺寸归一化 UV）。
  Bedrock 的 box UV 按声明的像素空间取样，所以**不动几何**、把贴图重采样到声明尺寸（`<id>_model.png`），
  背包图标仍用原分辨率 64×64（`<id>.png`）。
- **法杖四种季节**共用一个 geo（`geometry.druidstaff`，骨 `Staff`/`Core`）+ `animation.pcraftrevorn.druidstaff.loop`；
  匕首 `geometry.vampiricdagger`（骨 `Knife`/`handle`）+ `animation.pcraftrevorn.vampiricdagger.loop`。
  手持姿态统一写在 `RP/animations/vcm_held.animation.json`（`animation.pcraftrevorn.held.<geo>`）。
- **踩到的坑**：第一轮构建把 attachable 的 `geometry.*` 写成了 `geometry.{'out': ...}`（字典当字符串用），
  说明 `check.js` 不校验 attachable 的几何/动画引用；已修，并用 `.work/artifact_check.py` 复核产物与源 1:1。

### 6.2 B2/B3 清单（已核对自 jar / 反编译）

| 项目 | Bedrock 落点 | 备注 |
|---|---|---|
| `druid_staff` + `autumn/spring/winter_druid_staff` | `ITEMS` 表 + 3D attachable | geo `geometry.druidstaff`（骨 `Staff`/`Core`）+ `animation.druidstaff.loop`；冷却 60 tick |
| `vampiric_dagger` | `ITEMS` 表 + 3D attachable | geo `geometry.vampiricdagger`（骨 `Knife`/`handle`）+ `animation.vampdagger.loop`；命中吸血 = 伤害/4 |
| `blood_shard` / `slime_pearl` | `ITEMS` 表（2D） | 堆叠 64；血碎片是蝙蝠娘死亡 1/8 掉落 |
| 匕首配方 | `BP/recipes/vampiric_dagger.json` | 黑曜石(上) + 铁锭×2(左右) + 血碎片(中) + 木棍(下) |
| 生成规则 | `BP/spawn_rules/<id>.json` | 沿用 `genSpawnRules()` 写法：蝙蝠娘=洞穴标签、史莱姆娘=swamp、兔/猫/拉米亚=overworld；权重 5–20 |
| 4 个弹射物 | BP 实体（`minecraft:projectile`）+ 贴图 | 伤害 1、穿透 2、命中触发季节粒子 |
| 5 个粒子 | `RP/particles/*.particle.json` + 贴图 | `autumn_leaves`/`leaves`/`siphon`/`spring_blossom`/`winter_snowflake` |
| `slime_girl` 掉落 | `BP/loot_tables/entities/slime_girl.json` | 1/6 史莱姆珍珠 + 1–2 史莱姆球（Java 表直译） |
| 驯服 | `minecraft:tameable` | 全用 `pcraftrevorn:cupids_arrow`（与整包一致）；史莱姆娘另加史莱姆球 20%（阶段 D） |
