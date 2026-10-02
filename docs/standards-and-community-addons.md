# Bedrock 1.21.100.6 附加包标准 与 社区实例研究

> 目的：为 PCraftRevorn / VCraft 的 Bedrock 移植建立**可长期参考**的规范与实例库。
> 目标版本：**Bedrock 1.21.100.6**（Windows UWP）。
> 研究日期：2026-10（本仓库当前迭代）。
> 关联文档：[`port-checklist.md`](./port-checklist.md)、[`file-mapping.md`](./file-mapping.md)。

---

## 0. 结论速览（TL;DR）

1. **manifest**：资源/行为包用 `format_version: 2`（数组版本号）最稳；`format_version: 3`（SemVer 字符串）+ `settings` 是较新做法（部分已稳定、部分仍实验）。`subpacks` 在 v2/v3 都可用。
2. **脚本**：本版脚本 API 为 **v2**，对应 `@minecraft/server 2.0.0` / `@minecraft/server-ui 2.0.0`。更新的 addon 已用 `@minecraft/server 2.1.0`（但需要更高引擎版本）。
3. **JSON-UI 不能让 HUD/物品栏按钮直接回调脚本**；唯一可行的「常驻 HUD 按钮」走「隐藏常驻表单 + `form_buttons` 集合」，但会与其它表单互斥。
4. **子包（subpack）** 的配置项在**资源包设置**里；重导入**同版本号不会覆盖**旧包，必须**升版本号**。
5. **打包**：`.mcpack`/`.mcaddon` 内部 zip 条目必须用**正斜杠**路径；`.mcaddon` 顶层放各包文件夹。
6. 本仓库踩过的两个跨包坑：①多个包同时覆盖同一个 `ui` 控件（如 `main_screen_content`）会打架；②跨包依赖要用 `uuid + version` 且版本号需一致。

---

## 1. 版本与脚本 API 事实

| 项目 | 值 / 说明 | 来源 |
|---|---|---|
| 目标引擎 | Bedrock **1.21.100.6** | 本仓库 README / manifest `min_engine_version: [1,21,100]` |
| manifest 最稳写法 | `format_version: 2`，`version: [x,y,z]` | Microsoft Learn manifest 参考 |
| 脚本 API 版本 | **v2**（非向后兼容旧版） | Minecraft Wiki「Add-on」 |
| `@minecraft/server` 稳定版 | **2.0.0**（1.21.90 预览起） | Wiki：`Preview 1.21.90.21` 发布 2.0.0 |
| `@minecraft/server-ui` 稳定版 | **2.0.0**（1.21.90 预览起） | 同上 |
| 更新版本 | `@minecraft/server 2.9.0` / `2.11.0-beta`、`server-ui 2.1.0 / 2.3.0-beta` | Wiki（面向更高引擎） |
| Custom Commands / Custom Components V2 | 随 `@minecraft/server 2.0.0+` 默认可用 | Wiki |
| DDUI（Data-Driven UI） | 26.10 预览新增，`@minecraft/server-ui`，仍是 Beta | Wiki |
| HTML 自定义 UI | **已于 1.18.10 移除**，不要用 | Wiki |

**对本仓库的含义**
- `@minecraft/server 2.0.0` + `@minecraft/server-ui 2.0.0` 是 1.21.100.6 的安全选择（现 manifest 已写死）。
- 若整包不加载：优先怀疑脚本模块版本；不要贸然上 `2.1.0`（社区用它的 addon 往往 `min_engine_version` 更高，如 Just Zoom 标 `1.21.130`）。

---

## 2. manifest.json 规范

### 2.1 两套写法

| | v2（数组版本） | v3（SemVer 字符串） |
|---|---|---|
| 版本号 | `[1,0,0]` | `"1.0.0"` |
| `settings`（包设置页） | 未支持 | 支持（实验→逐步稳定） |
| `memory_performance_tier` | 未支持 | 支持 |
| 稳定度 | 最稳 | 部分实验（v3 需 `metadata.authors`） |

- v3 示例来源：`examples/(E)_Just_Zoom_v1.2.1.mcaddon` ——
  `format_version:3`、`version:"1.2.1"`、`settings:[label...]`、
  `dependencies:[{@minecraft/server:2.1.0},{@minecraft/server-ui:2.0.0}, {uuid,version:"1.2.1"}]`、
  `pack_optimization_version`、`metadata.product_type:"addon"`。

### 2.2 常用字段

| 字段 | 作用 | 备注 |
|---|---|---|
| `header.pack_scope` | `"world"` / `"global"` / `"any"` | 资源包可选 |
| `header.min_engine_version` | 最低引擎版本 | 资源/行为包**必填** |
| `modules[].type` | `resources` / `data` / `script` / `world_template` | 脚本模块加 `language:"javascript"` + `entry` |
| `dependencies[]` | 依赖其它包或内置模块 | 包依赖用 `uuid+version`，内置模块用 `module_name+version` |
| `capabilities` | `pbr` / `raytraced` / `editorExtension` 等 | |
| `metadata.authors/license/url` | 元数据 | v3 里 authors 目前必填 |
| `subpacks[]` | 子包 | 见 §3 |
| `settings[]`（v3） | 包设置页控件：`label/toggle/slider/dropdown` | 资源包的设置可用 Molang 读取 |

### 2.3 依赖版本一致性（本仓库强约束）

- BP 依赖 RP：`{ "uuid": RP_HEADER_UUID, "version": [..] }` 的版本号**必须等于** RP 的 `header.version`。
- 跨包依赖（VCraft → 性别包 RP）同理。
- 已加入自检：`node tools/audit.js` 会比对依赖版本；本仓库现存 6 个 manifest 均为 `[0,4,0]` 且互相一致。

---

## 3. 子包（subpacks）规范

来源：Microsoft Learn [`buildingsubpacks`](https://learn.microsoft.com/en-us/minecraft/creator/documents/buildingsubpacks)。

### 3.1 结构
```
resource_pack/
  manifest.json
  subpacks/
    <folder_name_1>/   <- 子包内的文件会“覆盖主包”的同名文件
    <folder_name_2>/
```

### 3.2 manifest
```json
"subpacks": [
  { "folder_name": "bibaso",   "name": "Bibaso's Zombie Girl", "memory_tier": 0 },
  { "folder_name": "original", "name": "原版 Zombie Girl",     "memory_tier": 0 }
]
```
- `folder_name`：子包目录名；`name`：玩家看到的名称（**不可本地化**）；`memory_tier`：每级约 250MB。
- 新字段 `memory_performance_tier`（1–5，实验，需 v3）。
- 默认按设备档位自动选最高不超过设备档的子包；玩家可在包设置里手动下调。
- **同档位多个子包时取列表中最后一个** → 多个子包 `memory_tier` 相同时要留意这个“取最后”规则。（本仓库曾用它做 ZombieGirl `bibaso`/`original`，现已取消子包、把 Bibaso 改为独立生物 `pcraftrevorn:bibaso_zombie`。）

### 3.3 配置入口（本仓库踩的坑）
- 子包选择器出现在**资源包/世界资源包的“设置”**里；外部 Packs 列表上也应有设置按钮。
- **同 `uuid+version` 重导入不会覆盖旧包**（Bedrock 会生成 `PCraftRevo(1)` 之类副本）。
  → 症状：游戏里仍是旧包、看不到子包配置。
  → 修复：**升 manifest 版本号**（本仓库已把所有包升到 `[0,4,0]`）并删除旧副本后再导入。
- `settings`（v3）与 `subpacks` 可共存（`ActualGuns` 同时有两者）。

---

## 4. JSON-UI / 自定义界面规范

### 4.1 基本机制
- 资源包 `ui/*.json` + `ui/_ui_defs.json` 注册；同名控件**逐控件合并覆盖**（可局部改）。
- 命名空间由文件内 `"namespace"` 决定（例如 `inventory_screen.json` 的命名空间是 **`crafting`**）。
- `modifications`（`insert_before` / `insert_after` / `remove` / `move`）可往原版控件里插东西，避免整文件替换。

### 4.2 硬限制（本仓库验证）
- **物品栏 / HUD 的 JSON-UI 按钮不能直接调用脚本**。
- 能驱动脚本的按钮只存在于**表单屏幕**，且绑定到引擎的 `form_buttons` 集合。
- 「发送命令」技巧：隐藏 `edit_box`（`text_box_name:"#message_text_box"`）+ `button.send` 可把文本/命令塞进聊天框并发送（Fast Commands 套路）。**聊天屏可用；HUD/背包屏是否可用未定（依赖该屏能否写 `#message_text_box`）**。
- **常驻 HUD 按钮**正规做法 = 脚本开一个 `is_showing_menu:false` 的隐藏表单 + HUD/表单层用 `form_buttons` 渲染按钮；点击 resolve 表单 → 脚本动作。**缺点：同一玩家同一时刻只能开一个表单，会顶掉背包/箱子/菜单**，不适合本项目。

### 4.3 表单标题当“状态总线”（Ponder / 本仓库 PCraft 采用）
- 用**不可见格式化码**在标题里编码状态，UI 用字符串运算读回：
  - 本仓库：`§0§r§1§r`（门控）+ `§2§r` + `§<hex>§r`（16 级进度）。
  - 资源包 `server_form.json` 里局部覆盖 `third_party_server_screen`，通过 `$additional_screen_content` 叠加进度条层。
- Ponder 用同样套路（`preview_*` / `structure_renderer` + 多种 `§` 前缀门控）。

### 4.4 跨包 UI 冲突（重要）
- 想让 VR/MR 屏幕注入内容常用 `third_party_server_screen.$additional_screen_content`；但这是**单值**，多个包各设一次会互相覆盖。
  - 本仓库现状：PCraft 占用 `additional_screen_content`，性别包占用 `main_screen_content`，VCraft 若再占 `main_screen_content` 会与性别冲突。
  - 建议：**所有自定义 UI 覆盖集中到同一个包**（或经由同一 `$additional_screen_content` 值串联），不要分散到多个包各占一次。

---

## 5. 打包与导入规范

| 规范 | 说明 |
|---|---|
| zip 条目分隔符 | **必须正斜杠** `/`（`Compress-Archive` 在旧版会用反斜杠，Bedrock 拒绝导入）→ 本仓库 `build.ps1` 手写 zip 条目 |
| 扩展名 | `.mcpack` 单包；`.mcaddon` 多包（顶层放各包文件夹） |
| 导入行为 | 同 uuid+version 不覆盖；升级版本号才替换 |
| 开发测试 | `development_behavior_packs` / `development_resource_packs`（每次启动刷新）→ 本仓库 `link_dev.ps1` 用 junction 链接 |
| 控制台 | 自制包无法直接导入主机；只能经 Realms |

---

## 6. 社区 / 相关实例研究（15 个）

> 「与仓库相关」= 本仓库直接引用、移植来源、或同类型（vore/gender/生物/JSON-UI）的可借鉴 addon。
> 位置以仓库相对路径给出。

### ① PCraftRevorn 3.1.1（移植来源 · Java Forge 1.20.1）
- 位置：`.work/mod`（解包 jar）
- 要点：MCreator 生成；184 procedure、408 处 `getPersistentData`、大量自定义 effect/attribute/keybind/menu；GeckoLib 模型动画。
- 教训：**Java 的“每 tick 过程式逻辑”全部要落到 BP 脚本**；`dynamic properties` + `entity properties` 替代 NBT；自定义按键/容器/GUI 不可移植。

### ② VCraft Reborn 1.18.2（移植来源 · Java Forge）
- 位置：`.work/vcraft_src`、`examples/VCraft/VCraft-Reborn-1.18.2-ver1.0.1.jar`
- 要点：玩家当捕食者；饰品（Acid/Expansion/Maxima/Creativa/Wither Pendant）改变消化/上限/免疫；猎物在胃里的挣扎与逃脱。
- 教训：饰品在 Bedrock 无 Curios 槽 → 改**背包扫描 + 动态属性**（本仓库 `vcraft:ring/necklace`）；玩家不能 `rideable` → 用**瞬移跟随的 gut 载体**。

### ③ Wildfire's Female Gender Mod（性别包参考 · Java）
- 依据：性别包 description 标注“参考 Wildfire's Female Gender Mod”。
- 要点：性别 + 胸部尺寸模型、按玩家档案持久化。
- 教训：Bedrock 无自定义玩家模型注册 → 由**性别包的 RP 拥有 `minecraft:player`**，用 `pc_state` 整数驱动 render controller 选贴图。

### ④ Female Gender Mod for Forge 1.20.1 3.1（第二个性别参考）
- 位置：`.work/fgender_src`、`examples/Female-Gender-Mod-forge-1.20.1-3.1.jar`
- 要点：客户端渲染层 + 网络同步。
- 教训：网络层删除；状态用**记分板 `query.scoreboard`（需 display）+ 动态属性**做联机同步。

### ⑤ PlayerGenderAddonV1.1.2.mcaddon（Bedrock 性别 addon）
- 位置：`examples/PlayerGenderAddonV1.1.2.mcaddon`（解包在 `.work/pgender`）
- 要点：Bedrock 端已有人做性别/皮肤；用登录 UI、皮肤条目。
- 教训：`§` 颜色码在皮肤/条目名里不生效；skin 包格式与 RP 不同。

### ⑥ Genders Addon V1.1.2（Jun Channel · Bedrock 性别 addon）
- 位置：用户已装（`.work/pgender/GendersAdd\GendersAddonV1.1.2`）
- 要点：**用 `subpacks` 提供 4 种性别/动画变体**（`type1`/`type2`/`type1+animation`/`type2+animation`），全部 `memory_tier:0`。
- 教训：这曾是本项目做 ZombieGirl `bibaso`/`original` 子包的**直接样板**（结构一致）；该子包现已取消，Bibaso 改为独立掠食者 `pcraftrevorn:bibaso_zombie`。

### ⑦ Ponder（Bedrock addon · JSON-UI 状态总线样板）
- 位置：`.work/Ponder`
- 要点：`server_form.json` 里用 `#title_text` 的前缀码门控多个 3D 结构渲染器；`$additional_screen_content` 叠加自定义层；进度条动画用 `anims`。
- 教训：本仓库 PCraft 的表单进度条/“标题当状态总线”直接来自此实例。

### ⑧ Fast Commands V3（Bedrock addon · 聊天 UI 样板）
- 位置：`.work/fastcmd`（RP：`chat_screen.json`/`debug_screen.json`/`ui_common.json`/`_global_variables.json`）
- 要点：隐藏 `edit_box` 写 `#message_text_box` + `button.send` 把文本/命令注入聊天；`#item_name_with_command` 插入。
- 教训：本仓库「按钮发 `/vcraft:menu`」采用同一机制（聊天屏可用）。

### ⑨ (E) Just Zoom v1.2.1（Bedrock addon · manifest v3 + 设置页样板）
- 位置：`examples/(E)_Just_Zoom_v1.2.1.mcaddon`（解包 `.work/justzoom`）
- 要点：`format_version:3`、SemVer、`settings` 标签页、`pack_optimization_version`、`product_type:"addon"`；脚本用 `@minecraft/server 2.1.0`；`item-use.js` 做交互、`zoom.js` 做功能、`ui-neck.js` 做视角。
- 教训：如需**包设置页/子包档位**，参考其 v3 manifest 写法；注意其 `min_engine_version` 更高（1.21.130）。

### ⑩ 按键!（HUD/表单按钮样板）
- 位置：`.work/btn_example`、`.work/buttons`
- 要点：`server_form.json` + `_ui_defs.json`，用 `form_buttons` 集合把表单按钮渲染成“常驻 HUD 键”。
- 教训：证明「HUD 常驻按钮」必须依附打开的隐藏表单；据此本项目判断其与多表单场景不兼容。

### ⑪ Actual Guns（已装 · 设置 + 子包共存样板）
- 位置：用户 `com.mojang/resource_packs/ActualGuns`
- 要点：同一 manifest 同时有 `settings`（label 文本块）与 `subpacks`（`no_watermark`/`watermark`）。
- 教训：设置页可与子包选择并存，是资源包“可配置”的主流做法。

### ⑫ 原版功勋增强包V2（已装 · 子包样板）
- 位置：用户 `com.mojang/resource_packs/原版功勋增强包V2`（另见世界包）
- 要点：纯 RP、`subpacks` 变体、多语言 `.lang`。
- 教训：多语言与子包是 RP 常用组合；本项目语言文件结构可对齐。

### ⑬ 材质优化（PCraft 资产优化 RP）
- 位置：`.work/matopt`（原包 `.work/matopt_orig`）
- 要点：为 basaltmite/gilded、piglin_royalty、silverfish、zombiegirl 等提供**优化几何/动画/贴图**；并**替换原版僵尸音效**。
- 教训：RP 可直接覆盖原版 `mob.zombie.*` 音效；优化模型并进本项目主 RP（vinemaiden 除外）。

### ⑭ Custom Player Models（CPM）· Vore Stage 工程
- 位置：`.work/cpm`、`examples/VCraft/Alex_Slim.cpmproject`
- 要点：`.cpmproject` 的 `Vore Stage 1/2` 模型 + `skin.png` 提供了本项目**腹部几何/UV/贴图**来源。
- 教训：CPM 坐标→Bedrock geo 需平移（本项目给 cube 原点加了 `(0,7,-2)`），UV 仍是**猜测值**，需实机微调。

### ⑮ PlayerGenderSkinConverter（网页工具）
- 位置：`examples/url.txt` → `playergendersaddonskinconverter.tiiny.site`
- 要点：把皮肤包转成性别包可用格式的社区工具。
- 教训：性别/皮肤生态里有现成转换工具，可减轻资产转换负担。

---

## 7. 把研究落回本仓库（行动项）

| 主题 | 现状 | 建议 |
|---|---|---|
| manifest 版本 | 全部 `[0,4,0]`（v2） | 保持；若要用包设置页再评估 v3 |
| 子包 | 已取消（原 ZombieGirl `bibaso`/`original`） | Bibaso 现为独立掠食者 `pcraftrevorn:bibaso_zombie`；`pcraftrevorn:zombie` 用经典原版模型 |
| Bibaso 僵尸 | 独立实体（贴图 `bibaso_zombie*`、`geometry.bibaso_zombie`、自带生成蛋） | 生成器 `genBibasoZombie`；脚本已加入 `PREDATORS`/`SKINS`/`PRED_STATS` |
| 依赖版本一致 | audit 已校验 | 每次改版本后跑 `node tools/audit.js` |
| UI 跨包冲突 | PCraft 占 `additional_screen_content`、性别占 `main_screen_content` | **统一到一个包**，或串联同一 `$additional_screen_content` |
| HUD “Vore 键” | 已试「HUD 屏 + 发 `/vcraft:menu`」 | 若 HUD 屏写不了 `#message_text_box`，回退到聊天栏按钮（已验证） |
| 脚本 API | 2.0.0 | 不轻易升 2.1.0（引擎版本门槛） |
| 打包 | 正斜杠 zip | 保持 `build.ps1` 的手写 zip |

---

## 8. 参考链接

- manifest 参考：https://learn.microsoft.com/en-us/minecraft/creator/reference/content/addonsreference/examples/addonmanifest
- 子包教程：https://learn.microsoft.com/en-us/minecraft/creator/documents/buildingsubpacks
- 自定义包设置：https://learn.microsoft.com/en-us/minecraft/creator/documents/addons/custompacksettings
- 入门/目录结构：https://learn.microsoft.com/en-us/minecraft/creator/documents/gettingstarted
- 资源包教程：https://learn.microsoft.com/en-us/minecraft/creator/documents/resourcepack
- 脚本 API：https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/
- Add-on 概览（含模块版本表）：https://minecraft.wiki/w/Add-on
