# 社区 addon 实测分析（面向本项目）

> 目的：下载并拆解真实社区 addon，提取它们在“**玩家身体模型 / 性别 / 第一人称 / 玩家实体覆写**”上的**实际做法**，
> 用来校准我们 `gender_pack` 与 `vcraft_pack` 的玩家外观方案。
>
> 下载物仅作分析，放在 `.work/refs/`（已 gitignore，不随仓库分发）。
> 配套：`docs/vcraft-gender-audit.md`（方案审查）、`docs/vcraft-gender-diagnosis.md`（现场排查）。

---

## 0. 本轮下载到的 addon

| Addon | 作者 | 版本 | 来源 | 大小 | 与本项目的相关性 |
|-------|------|------|------|------|------------------|
| **Player Genders** (`PlayerGenderAddon`) | ImJunXD / Jun Channel | V1.1.2 (26.3) | CurseForge `genders-addon` | 397 KB | ★★★★★ 与我们的性别/胸部系统同源 |
| **Player Gender Reloaded (PGR)** | ZazaKrizpy / KejuGorenk | v26.0.4b | 9minecraft | 448 KB(7z) | ★★★★★ 现代“pack settings”方案 |
| **Dynamic First Person Model** | AlienEdds | v1.5.2 | CurseForge `dynamic-first-person-model` | 687 KB | ★★★★ 玩家实体覆写 + 相机 + 互操作标签 |
| **Unique Player Client Model** | GYARAGA / ERROR2401 | 1.3 | CurseForge `player-name-specific-models-textures` | 96 KB | ★★★★ 客户端本地换模型 + 子包 |

> 说明：`Player Genders` 与我们 `.work/pgender` 里已有的 V1.1.2 是同一 addon（作者即原版 Bedrock 性别 addon 的作者）。
> 面向本研究去 CurseForge/GitHub 检索 **Bedrock vore/腹部** 类 addon：GitHub 基本没有（该题材不发布在 GitHub），
> 主流站点也未见公开成品。因此 vore 只能对照**原 Java 源码**（`.work/vcraft_src`），社区成品暂缺。

### 0.1 下载方法（可复现）

- CurseForge：`https://api.cfwidget.com/minecraft-bedrock/{addons|texture-packs}/{slug}` 取文件 `id`+`name`，
  再拼 `https://edge.forgecdn.net/files/{id/1000}/{id%1000 补3位}/{文件名}` 直接下载（`edge.forgecdn.net` 可达）。
- 9minecraft：文章页 → `files*.9minecraft.net` → 中转页 → `files*.9mcbox.com/...act=download...`（返回 7z，用 `C:\Program Files\7-Zip\7z.exe` 解）。
- GitHub：`api.github.com` 与 `codeload.github.com` 可达，`raw.githubusercontent.com`/`github.com` 被墙；
  可用 contents API 取单文件，或 codeload 下 tarball。

---

## 1. Player Genders（原版 Bedrock 性别 addon）— 复刻对象的“旧方案”

结构（`.work/refs/PlayerGenderAddonV1.1.2/GendersAdd/GendersAddonV1.1.2`）：
- 纯**资源包** + 一个**行为包脚本**（`GendersAdd BehaviorPack/scripts/settingmenu.js`）。
- **subpacks**：`type1` / `type2` / `type1+animation` / `type2+animation` —— 在“全局资源包设置”里选模型与是否用自定义动画。
- `render_controllers/girl.json`：`controller.render.b` **无条件常显**（`b/bone2/toplayer`）。
- 行为包脚本（全文很短）：
  ```js
  // ?settingmenu -> 打 tag -> 轮询 -> 打开 ModalForm -> /playanimation
  player.runCommand(`playanimation @s animation.player.size${input1} b 9999`);
  ```

**要点**
- 完全**不用分数板、不用 `query.scoreboard`**。
- 体型用**服务器命令 `/playanimation`** 驱动骨骼 `b`。
- “男/女/体型”靠**子包选择**（安装期）而非运行时；胸部对**所有人可见**（多人可用）。
- 缺点：切换要改子包/重进；不能逐玩家实时切换。

**对本项目的意义**
- 我们的胸部“旧骨架”（`geometry.b` + `controller.render.b` + 体型动画）来自它；但我们把“显示与否/体型”改成了**分数板驱动**，
  这一步恰恰是当前失效的根源。若走服务器命令路线，就是回到这个经过验证的稳定方案。

---

## 2. Player Gender Reloaded（PGR）— 现代“pack settings”方案 ★重点

结构（`.work/refs/PlayerGenderReloaded_v26/...`）：纯**资源包**，`manifest.format_version = 3`。

### 2.1 用 manifest `settings` 做“逐玩家”配置
```json
// manifest.json（format_version 3）
"settings": [
  { "type":"dropdown","name":"player_gender_reloaded:character_gender",
    "options":[{"name":"male"},{"name":"female"}], "default":"male" },
  { "type":"slider","name":"player_gender_reloaded:bust_size","min":35,"max":100,"default":75,"step":1 },
  { "type":"toggle","name":"player_gender_reloaded:physics_enabled","default":true },
  ...
]
```
在客户端实体 `pre_animation` 里读进 **client variable**：
```molang
v.player_gender_reloaded_breasts_enabled = q.is_pack_setting_selected('player_gender_reloaded:character_gender','female');
v.player_gender_reloaded_breasts_size    = 0.25 + q.get_pack_setting('player_gender_reloaded:bust_size') * 0.01;
v.player_gender_reloaded_breasts_physics_enabled = q.is_pack_setting_enabled('player_gender_reloaded:physics_enabled');
```
- 官方文档《Create a Pack With Custom Settings》明确：**资源包 settings 可按玩家（per-player）配置**；
  **行为包 settings 是每世界（owner）配置**。
- Molang 三个查询：`query.get_pack_setting` / `query.is_pack_setting_enabled` / `query.is_pack_setting_selected`。
- 需要 `manifest format_version 3`（SemVer 版本字符串）。

### 2.2 只对“本地玩家”渲染
```json
{ "controller.render.player_gender_reloaded.breasts":
   "!variable.is_paperdoll && query.is_local_player && !variable.is_first_person && !query.is_spectator && !variable.use_blinking_animation" }
```
- 代码注释直言：“remove `query.is_local_player` when multiplayer support has been implemented”。
- `changelogs.txt` 也写明：“the character's breasts model is currently **only visible to you**”。
- ⇒ PGR 是**单机/本地视角**方案，多人同步尚未实现（作者也承认）。

### 2.3 装甲兼容（我们最缺的一环）
- 为每件原版胸甲提供**attachable 覆写**（`attachables/vanilla_armor/*.chestplate.player.json`），
  在 `parent_setup` 里写变量：
  ```js
  "parent_setup": "{ v.chest_layer_visible = 0.0; } + { v.player_gender_reloaded_breasts_armor_physics_strength = 0.0; } + { v.player_gender_reloaded_breasts_in_armor = 1.0; };"
  ```
- 另有 `models/.../attachables/breasts_armor.geo.json` + `controller.render.player_gender_reloaded.breasts.custom_armor`
  让“胸部形状”在**穿甲后依然成立**。
- `tutorials/armor_compatibility.txt` 给出各材质装甲的物理强度（铜/铁/钻/下界合金 0%，金 15%，锁链 50%，皮革 70%，鞘翅 100%）与“穿甲是否隐藏”。
- 自定义渲染材料 `materials/entity.material`：`USE_UV_ANIM`（抖动/UV 动画）+ `ALPHA_TEST`。

### 2.4 其他
- 覆写的是**当前原版** `player.entity.json`（完整 vanilla 动画表、现役 query 名，如 `animation.player.swimming`、`q.modified_swing_duration`），不是旧 addon 的裁剪表。
- 有 `animated_face`（眨眼）、`sneak_dance` 等附加动画。
- 配置项文案全部走 **lang key**（`pack.syrvilandia_production.pgr.*`），manifest 里只放 `%key`。

**对本项目的意义**
- 这是“**逐玩家 + 运行时可视化配置 + 不靠分数板**”的现实可行路线：**RP settings + client variables + `query.is_local_player`**。
- 代价：默认只有自己看得到（要多人可见需额外的服务器→客户端同步）。
- 装甲兼容用 attachable，正是解决我们 2.6 节 `part_visibility {"*": true}` 遮挡问题的正确做法。

---

## 3. Dynamic First Person Model — 玩家实体覆写 + 相机 + 互操作

- `manifest format_version 3`，`min_engine_version "1.21.100"`，依赖 `@minecraft/server 2.1.0` + `server-ui 2.0.0`。
- BP 脚本被**混淆**（`a0_0x...`），难读；但资产清晰：
  - 相机预设：`cameras/presets/first_person.json`
    ```json
    { "minecraft:camera_preset": { "identifier":"ae_fpm:first_person", "radius":0.1, "inherit_from":"minecraft:follow_orbit" } }
    ```
  - RP 动画把玩家**头部缩放为 0**（进入 UI 时恢复）：
    ```json
    "animation.ae_fpm.remove_head": { "bones": { "head": { "scale": "q.is_in_ui ? 1.0 : 0.0" }, ... } }
    ```
  - RP `hud_screen.json` 用 `root_panel.modifications.insert_front` 插准星。
- 对外暴露**创作者标签**做互操作：`ae_fpm.is_first_person`、`ae_fpm.disable_animation`、`ae_fpm:toggle_model` 等。

**对本项目的意义**
- 证明了“玩家实体覆写 + 相机 + 标签互操作”的整套做法；`query.is_in_ui`、相机预设、标签命名空间（`ae_fpm.*`）都值得借鉴。
- 它的 BP 也用了自定义命令/表单（与我们的 `gender.js`/`vcraft main.js` 同类），说明自定义命令在这类 addon 里是常规手段（但要确认实验开关/引擎版本）。

---

## 4. Unique Player Client Model — 最省的“本地换模型”

- 纯**资源包** + **subpacks**（每个模型一个子包）。
- `player.entity.json`：`animate: ["root"]`（几乎不接管动画）；额外声明多套 `geometry`/`texture`。
- 关键：本地玩家隐藏原版第三人称，改用自定义几何：
  ```json
  { "controller.render.player.third_person": ... "part_visibility": [ { "*": "!query.is_local_player" }, ... ] },
  { "controller.render.player.lugia": "!variable.is_first_person && query.is_local_player" }
  ```
- `enable_attachables: false`。

**对本项目的意义**
- 证明“**只改自己看到的模型**”最简单：`!query.is_local_player` 隐藏原版 + 自己的控制器渲染自定义。
- 与 PGR 同思路（本地可见），但更轻量（靠子包切换，不靠 settings）。

---

## 5. 技术要点对照总表

| 能力 | 我们 gender_pack | Player Genders | PGR | Unique Client Model | Dynamic FPM |
|------|------------------|----------------|-----|---------------------|-------------|
| 配置来源 | **分数板 `pc_state`** + 表单 | subpacks（安装期） | **manifest v3 settings（逐玩家）** | subpacks | 脚本/命令 + 标签 |
| 客户端读取 | `query.scoreboard('pc_state')`（**需显示，当前失效**） | 常显（无条件） | **`query.get_pack_setting` → client variable** | `query.is_local_player` | `query.is_local_player`/`is_in_ui` |
| 逐玩家 | 是（但客户端查询脆弱） | 否（全局子包） | **是（RP settings）** | 否（子包） | 是（脚本状态） |
| 多人可见 | 设计上尝试（失败） | **是**（常显） | **否（仅本地）** | 否（仅本地） | 是（相机是本地） |
| 装甲兼容 | 缺失（`*: true` 遮挡） | 无 | **attachable + 装甲几何** | 覆盖第三方模型 | 不涉及 |
| 体型/物理 | 分数板切换动画 | `/playanimation` | settings 滑块 + 物理动画 | — | — |
| 本地化 | 中文硬编码 | 无 | **lang keys** | 无 | lang keys |
| 清单版本 | 2 | 2 | **3（SemVer）** | 2 | **3（SemVer）** |
| 本地玩家门控 | 无 | 无（全体） | `query.is_local_player` | `!query.is_local_player` 隐藏原版 | `query.is_local_player` |

---

## 6. 校准结论（给我们项目的具体建议）

1. **玩家外观配置优先改用“资源包 settings（manifest v3）”。**
   - 官方明确 RP settings 是**逐玩家**的，正好替代我们“分数板 + 表单 + `query.scoreboard`”这条已失效且客户端查询受限的路线。
   - 落地：`manifest` 升 `format_version 3`（SemVer），加 `settings`（gender dropdown、per-size slider、物理 toggle 等），
     在 `player.entity.json` 的 `pre_animation` 用 `q.get_pack_setting`/`q.is_pack_setting_enabled`/`q.is_pack_setting_selected` 读入 `v.*`。
   - 参考实现：PGR（`settings` + 变量 + 控制器）。
2. **如果必须多人互相可见**，RP settings 不够（它只影响本机），需要在“方案 A 分数板（修好显示槽/参数）”与
   “服务端状态→客户端同步”之间做取舍；PGR 的作者也把多人支持列为 TODO。
3. **装甲兼容**：采用 PGR 的 **attachable + 胸部装甲几何 + `parent_setup` 变量**方案，替代当前 `part_visibility {"*": true}`。
4. **本地可见的选择**：若只需“自己看到”，用 `query.is_local_player` 门控（PGR/Unique 的通用做法），实现最简单。
5. **版本对齐**：PGR/Dynamic FPM 覆写的是**现役 vanilla `player.entity.json`**；我们应把 `gender_pack` 的玩家实体从“旧 addon 裁剪表”
   升级/对齐到当前 vanilla（完整动画表、现役 query 名），降低版本漂移。
6. **清单升级**：`format_version 3` + SemVer 是使用 settings 的前提；顺带让 `min_engine_version` 与目标一致。
7. **互操作标签**：借鉴 `ae_fpm.*` 命名（我们已有 `vore_digesting`），跨 addon 协调（例如“是否处于第一人称模型/是否在消化”）。
8. **本地化**：settings/选项文案全部走 lang key（PGR 的做法），与主包 i18 工作合并。
9. **相机/第一人称**：若要“第一人称看到自己身体/肚子”，可参考 Dynamic FPM 的相机预设 + 头部缩放动画。

---

## 7. 附：文件位置

```
.work/refs/
├── PlayerGenderAddonV1.1.2/            # 原版 Bedrock 性别 addon（复刻对象）
├── PlayerGenderReloaded_v26/           # PGR：manifest v3 settings + 装甲 attachable ★
├── DynamicFirstPersonModel_v1.5.2/     # 第一人称模型 + 相机预设 + 标签
└── UniquePlayerClientModel_1.3/        # 本地换模型 + 子包
```

*分析记录：砂墨SandMo · 所有第三方 addon 版权归原作者，仅用于本地技术分析，不随仓库分发。*
