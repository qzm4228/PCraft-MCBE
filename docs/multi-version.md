# 组件多版本适配（1.21.80 / 1.21.100 / 1.26.x）

目标清单见 `config/targets.json`；分版本选文件见 `dist.json`（机制与用法见
`tools_py/README.md`）。下面是官方文档 + 开发者社区调研的结论，以及每个组件的
适配方式。

参考来源：
- Script Module Versioning（Microsoft Learn）
- Block Format History / Item Format History / Format Versions（Bedrock Wiki）
- JSON UI Best Practices / Intro to JSON UI（Bedrock Wiki）
- Ore UI（Minecraft Wiki）
- 1.21.100 / 1.26.10 / 26.50 更新日志（minecraft.net）

## 一、结论速览

| 组件 | 我们的 format_version | 跨 1.21.80–1.26.x | 需要 dist.json 变体？ |
|---|---|---|---|
| manifest | 2 | min_engine / 脚本模块按目标改 | 否（走 `config/targets.json`） |
| 脚本 | — | 依赖模块版本 + API 可用性 | 否（模块版本已分目标；API 全 try/catch） |
| 几何 models | 1.12.0 | ✅ 稳定 | 否 |
| 动画 animations | 1.8.0 | ✅ 稳定 | 否 |
| 动画/渲染控制器 | 1.10.0 / 1.8.0 | ✅ 稳定 | 否 |
| attachable | 1.10.0 / 1.8.0 | ✅ 稳定 | 否 |
| 音效 sound_definitions | 1.14.0 | ✅ 稳定 | 否 |
| spawn_rules | 1.8.0 | ✅ 稳定 | 否 |
| 配方 recipes | 1.20.10 | ✅ 稳定 | 否 |
| 实体 entities(行为) | 1.21.0 | ✅ 保守值，26.x 只新增组件 | 否 |
| 实体 entity(客户端) | 1.10.0 | ✅ 稳定 | 否 |
| 方块 blocks | 1.21.0 | ✅ 见下 | 否 |
| 物品 items | 1.21.0 | ✅ 见下 | 否 |
| **JSON-UI（ui/）** | 无版本号 | ⚠️ **无版本、随原版漂移** | **是** |

## 二、方块 / 物品 的关键规则（已核对，当前写法均安全）

**方块**
- **1.21.80 起：用了 `minecraft:geometry` 就必须同时有 `minecraft:material_instances`**（反之亦然）。我们的 4 个方块两者都有 ✅。
- 版本门槛（用到才受影响）：`minecraft:transformation` ≥1.21.0；`minecraft:item_visual` ≥1.21.60；`leashable` ≥1.26.0；`material_instances` 的 `isotropic`/`tint_method` ≥1.21.80。
- 1.21.90：`minecraft:custom_components` 移除；`geometry`/`material_instances` 允许放进 `permutations`。
- 26.10：修了 `format_version ≥ 1.26.0` 的 `geometry.full_block` 在展示框里的旋转（MCPE-234715）——我们仍是 1.21.0 格式，不受影响。

**物品**
- `minecraft:icon`：我们用对象形式（1.20.40 起单字符串也允许，对象一直可用）✅。
- `minecraft:food`：我们**没用 `effects`**（1.20.50 起 effects 有已知问题 MCPE-180398）✅。
- 26.10：`minecraft:block_placer` 新增可选字段 `aligned_placement`（不破坏兼容）。

> 这两类在当前目标区间**无需分版本**。

## 三、唯一需要分版本的部分：JSON-UI

官方/社区明确两点：
1. **JSON-UI 是"无版本号"系统**（Bedrock Wiki, Best Practices）——它对原版 UI 的改动
   **不提供兼容保证**，原版控件改名就会让注入失效。
2. **JSON-UI 正在被 Ore UI 取代**（Bedrock Wiki：*JSON UI is being deprecated in favor of
   Ore UI … unlike JSON UI, Ore UI is hardcoded and cannot be modified by resource packs*）。
   迁移进度（Minecraft Wiki / 官方）：设置 26.0.28、Realms 26.20.22、主菜单 26.60.29 …
   **完全迁移后，资源包将无法再改这些界面。**

我们的 UI 文件全部是"最小侵入 + `modifications`"写法（符合最佳实践），但依赖原版控件名：

| 文件 | 命名空间 | 依赖的原版控件 |
|---|---|---|
| `vcraft_pack/.../ui/hud_screen.json` | `hud` | `hud_content` / `root_panel` |
| `vcraft_pack/.../ui/inventory_screen.json` | `crafting` | `recipe_inventory_screen_content` / `content_stack_panel` |
| `gender_pack/.../ui/chat_screen.json`、`vcraft_pack/.../ui/chat_screen.json` | `chat` | `chat_screen` 相关控件 |
| `gender_pack/.../ui/gender_menu.json`、`resource_pack/.../ui/pcraftrevorn_forms.json` | `server_form` | `custom_form` / `form_buttons` |

**这些控件名一旦在原版变更，就需要该版本专属变体**——这正是 `dist.json` 的用途：

```jsonc
// vcraft_pack/resource_pack/ui/dist.json
{
  "_comment": "控件名随原版变化时，给对应版本加一个变体文件即可",
  "hud_screen.json":       { "1.26.x": "hud_screen.json.1.26" },
  "inventory_screen.json": { "1.26.x": "inventory_screen.json.1.26" }
}
```

- 没写的版本 → 用原文件本身（通用版）。
- 命中 `1.26.x` → 用 `hud_screen.json.1.26` 的内容，仍以 `hud_screen.json` 之名打包。
- 变体源文件不会被单独打包。

## 四、验证清单（每加一个 target 跑一次）

1. `python tools_py/build_config.py --target <id>` → 装对应版本游戏。
2. 逐项确认：
   - **脚本**加载无日志报错（自定义命令 1.21.80 起才是 beta；`?吞` 等聊天/物品入口应可用）。
   - **方块/物品**外观、`minecraft:light_emission`、食物可食用。
   - **UI**：HUD "Vore" 按钮、背包 "菜单" 按钮、`server_form` 皮肤/菜单、聊天按钮是否显示且可点。
     - 若某按钮消失 → 原版控件名变了 → 在该目录 `dist.json` 加一个变体。
3. 记录：新增变体后跑 `python tools_py/check_dist.py` 确认两套工具仍一致。

## 五、长期风险与建议

- **Ore UI 迁移**：不要继续加深对原版界面的改动。能换成**原生表单**（`ActionFormData` /
  `ModalFormData`，即 `server_form`，由脚本打开）的交互尽量换成原生表单；自定义 JSON-UI 只做
  "就地插入"。一旦某界面迁到 Ore UI，对应注入会整体失效。
- **保持最小侵入**：只 `modifications` 插入，不要整份复制原版 UI 文件（社区一致建议）。
- **方块/物品/实体**：只要不主动启用新特性，维持现有 `format_version` 即可长期兼容；升级
  `format_version` 前先查 Bedrock Wiki 的 Format History。
