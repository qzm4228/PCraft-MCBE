# PCraftRevorn → Bedrock 文件映射

命名空间统一为 `pcraftrevorn`。下表给出 Java 源文件/资源到 Bedrock 目标的对应关系与处理状态。
状态：`✅ 已生成` / `🔄 手工改造` / `❌ 不可行（替代方案）` / `⏳ 待做`。

---

## 1. 转换规则（路径前缀）

| Java | Bedrock |
|---|---|
| `net/mcreator/pcraftrevorn/init/PcraftrevornModItems` | `behavior_pack/items/*.json` |
| `net/mcreator/pcraftrevorn/init/PcraftrevornModBlocks` | `behavior_pack/blocks/*.json` |
| `net/mcreator/pcraftrevorn/init/PcraftrevornModEntities` | `behavior_pack/entities/*.json` + `resource_pack/entity/*.entity.json` |
| `net/mcreator/pcraftrevorn/init/PcraftrevornModMobEffects` | `behavior_pack/scripts/effects/*.js`（伪效果） |
| `net/mcreator/pcraftrevorn/init/PcraftrevornModAttributes` | `behavior_pack/entities/*`（entity property）+ 脚本变量 |
| `net/mcreator/pcraftrevorn/item/*` | `behavior_pack/items/<name>.json` |
| `net/mcreator/pcraftrevorn/block/*` | `behavior_pack/blocks/<name>.json` |
| `net/mcreator/pcraftrevorn/entity/*` | `behavior_pack/entities/*` + `resource_pack/entity/*` |
| `net/mcreator/pcraftrevorn/procedures/*` | `behavior_pack/scripts/**/*.js` |
| `net/mcreator/pcraftrevorn/network/*Message` | 删除（脚本事件替代） |
| `net/mcreator/pcraftrevorn/network/PcraftrevornModVariables` | 玩家 dynamic properties |
| `net/mcreator/pcraftrevorn/potion/*MobEffect` | `behavior_pack/scripts/effects/*.js` |
| `net/mcreator/pcraftrevorn/world/inventory/*Menu` | `@minecraft/server-ui` 表单 |
| `net/mcreator/pcraftrevorn/client/**` | 删除（Java 渲染层），贴图转 RP |
| `net/mcreator/pcraftrevorn/configuration/*` | 脚本常量 / world dynamic property |
| `assets/pcraftrevorn/textures/**` | `resource_pack/textures/**` |
| `assets/pcraftrevorn/models/**` | `resource_pack/models/**`（block geo 已转） |
| `assets/pcraftrevorn/geo/**` + `animations/**` | `resource_pack/models/entity` + `resource_pack/animations`（P2） |
| `assets/pcraftrevorn/sounds/**` + `sounds.json` | `resource_pack/sounds/pcraftrevorn` + `sound_definitions.json` |
| `assets/pcraftrevorn/lang/en_us.json` | `behavior_pack/texts/*.lang` + `resource_pack/texts/*.lang` |
| `assets/pcraftrevorn/particles/**` | `resource_pack/particles/*.json`（P2） |
| `data/pcraftrevorn/recipes/**` | `behavior_pack/recipes/**` |
| `data/pcraftrevorn/loot_tables/**` | `behavior_pack/loot_tables/**` |
| `data/pcraftrevorn/tags/**` | 脚本集合 + `minecraft:tags` 组件 |
| `data/pcraftrevorn/damage_type/**` | 脚本 + `/damage` |
| `data/pcraftrevorn/worldgen/**` + `structures/**` | Bedrock jigsaw + `.mcstructure`（P6） |
| `data/pcraftrevorn/forge/biome_modifier/**` | `behavior_pack/spawn_rules/*.json`（P6） |
| `assets/curios/**` | 删除（无 Curios） |

---

## 2. 显式映射

### 2.1 初始化注册表

| Java | Bedrock |
|---|---|
| `init/PcraftrevornModItems`（40） | `behavior_pack/items/*.json` ✅ |
| `init/PcraftrevornModBlocks`（4） | `behavior_pack/blocks/*.json` ✅ |
| `init/PcraftrevornModEntities`（16） | P2 |
| `init/PcraftrevornModMobEffects`（18） | 脚本伪效果 P3/P5 |
| `init/PcraftrevornModAttributes`（9） | entity property + 脚本 |
| `init/PcraftrevornModPotions`（~20） | 自定义瓶子物品 + 脚本 |
| `init/PcraftrevornModKeyMappings`（4） | 删除；P4 改输入 |
| `init/PcraftrevornModMenus` / `ModScreens`（14） | 表单 |
| `init/PcraftrevornModParticles/ParticleTypes`（2） | `resource_pack/particles` P2 |
| `init/PcraftrevornModSounds` | `sound_definitions.json` ✅ |
| `init/PcraftrevornModCuriosSlots/CustomCuriosSlots` | 删除；脚本物品栏检测 |
| `init/PcraftrevornModTabs` | 删除；item `menu_category` |
| `init/PcraftrevornModConfigs` | 脚本常量 |

### 2.2 物品（40）

Java `item/<X>Item` → `behavior_pack/items/<x>.json`

| Java 类 | Bedrock id | 状态 |
|---|---|---|
| `AttunedBindingRingItem` | `pcraftrevorn:attuned_binding_ring` | ✅ |
| `BasaltmitePlatedSolesItem` | `pcraftrevorn:basaltmite_plated_soles` | ✅（Curios 逻辑 P5） |
| `BasaltmiteScaleItem` | `pcraftrevorn:basaltmite_scale` | ✅ |
| `BejeweledUpgradeKitItem` | `pcraftrevorn:bejeweled_upgrade_kit` | ✅ |
| `CarbonatedWaterBottleItem` | `pcraftrevorn:carbonated_water_bottle` | ✅ |
| `CupidsArrowItem` | `pcraftrevorn:cupids_arrow` | ✅ |
| `DebuggingItemItem` | `pcraftrevorn:debugging_item` | ✅（原用河豚桶贴图） |
| `FermentedGlowberryJuiceBottleItem` | `pcraftrevorn:fermented_glowberry_juice_bottle` | ✅ 食物 |
| `GildedBasaltmiteScaleItem` | `pcraftrevorn:gilded_basaltmite_scale` | ✅ |
| `GildedShieldItem` | `pcraftrevorn:gilded_shield` | ✅（Curios 逻辑 P5） |
| `GlowberryJuiceBottleItem` | `pcraftrevorn:glowberry_juice_bottle` | ✅ 食物 |
| `GoldenBoneMealItem` | `pcraftrevorn:golden_bone_meal` | ✅（骨粉逻辑 P5） |
| `GoldenPiglinArmorKitItem` | `pcraftrevorn:golden_piglin_armor_kit` | ✅ |
| `HyperdensePorkchopItem` | `pcraftrevorn:hyperdense_porkchop` | ✅ |
| `NetheritePiglinArmorKitItem` | `pcraftrevorn:netherite_piglin_armor_kit` | ✅ |
| `NeutralizingWaterItem` | `pcraftrevorn:neutralizing_water` | ✅ |
| `PeculiarMirrorItem` | `pcraftrevorn:peculiar_mirror` | ✅ |
| `PiglinMightTalismanItem` | `pcraftrevorn:piglin_might_talisman` | ✅（Curios 逻辑 P5） |
| `PiglinRoyalTalismanItem` | `pcraftrevorn:piglin_royal_talisman` | ✅（Curios 逻辑 P5） |
| `PredGuidebookItemItem` | `pcraftrevorn:pred_guidebook_item` | ✅（GUI P7） |
| `RabbitStaffItem` | `pcraftrevorn:rabbit_staff` | ✅（右键逻辑 P5） |
| `RabbitStaffBloodlustItem` | `pcraftrevorn:rabbit_staff_bloodlust` | ✅ |
| `RabbitStaffGoldItem` | `pcraftrevorn:rabbit_staff_gold` | ✅ |
| `SilverfishPlateItem` | `pcraftrevorn:silverfish_plate` | ✅ |
| `SilverfishPlatingItem.Helmet` | `pcraftrevorn:silverfish_plating_helmet` | ✅ |
| `SilverfishPlatingItem.Chestplate` | `pcraftrevorn:silverfish_plating_chestplate` | ✅ |
| `SilverfishPlatingItem.Leggings` | `pcraftrevorn:silverfish_plating_leggings` | ✅ |
| `SilverfishPlatingItem.Boots` | `pcraftrevorn:silverfish_plating_boots` | ✅ |
| `SugarGlassBottleItem` | `pcraftrevorn:sugar_glass_bottle` | ✅ |
| `SugarNeutralizingWaterItem` | `pcraftrevorn:sugar_neutralizing_water` | ✅ |
| `VibrantElixirItem` | `pcraftrevorn:vibrant_elixir` | ✅ |
| `ForgeSpawnEggItem` ×9 | `*_spawn_egg` + `entity_placer` | ✅（实体 P2） |

### 2.3 方块（4）

| Java 类 | Bedrock | 资源 |
|---|---|---|
| `SoulJackOLanternBlock` | `behavior_pack/blocks/soul_jack_o_lantern.json` ✅ | `textures/blocks/pcraftrevorn/soul_jack_o_lantern.png` |
| `GlowberryFermentationBarrelBlock` + `BlockEntity` | `behavior_pack/blocks/glowberry_fermentation_barrel.json` ✅ | 6 面贴图；tick 逻辑 P7 |
| `PiglinThrone1Block` | `behavior_pack/blocks/piglin_throne_1.json` ✅ | `models/blocks/piglin_throne_1.geo.json` ⚠️ |
| `PiglinThrone2Block` | `behavior_pack/blocks/piglin_throne_2.json` ✅ | `models/blocks/piglin_throne_2.geo.json` ⚠️ |

### 2.4 生物（16）— ⏳ P2

Java `entity/<X>Entity` → `behavior_pack/entities/<x>.json`；`<X>Model` → `resource_pack/entity/<x>.entity.json` + geo/render controller。

`BasaltmiteEntity`、`GildedBasaltmiteEntity`、`SilverfishEntity`、`VinemaidenEntity`、`VinemaidenSeedlingEntity`、`ZombieEntity`、`ScarecrowEntity`、`RabbitWizardEntity`、`PiglinRoyalEntity`、`PiglinRoyalKnightEntity`、`PiglinRoyalSpawnerEntity`、`PiglinThroneroomSpawnerEntity`、`BindingRingEntity`、`ShieldingRingEntity`、`RabbitPlayerProjectileEntity`、`RabbitProjectileBloodlustEntity`

`BindingRingLayer` / `ShieldingRingLayer` → render controller 层。

### 2.5 药水效果（18）— ❌

`potion/<X>MobEffect` → `scripts/effects/<x>.js`（伪效果）。清单见 `port-checklist.md` §2.4。

### 2.6 菜单 / 屏幕（14）— ❌

`world/inventory/StomachMenu`、`FermentationMenu`、`PredGuidebookMenu`、`PGBasaltmiteMenu`…`PGVinemaiden2Menu` → 表单。

### 2.7 网络（16）— 删除

`PG*ButtonMessage`、`Struggle*Message`、`PcraftrevornModVariables`（→ 玩家 dynamic properties）。

### 2.8 资源

| Java | Bedrock | 状态 |
|---|---|---|
| `textures/item/*.png` | `resource_pack/textures/items/pcraftrevorn/*.png` | ✅ |
| `textures/block/*.png` | `resource_pack/textures/blocks/pcraftrevorn/*.png` | ✅ |
| `textures/models/armor/*` | `resource_pack/textures/models/armor/silverfish_plating_layer_{1,2}.png` | ✅ |
| `textures/entities/*`（含 `_belly`/`_wg`/`_wg2`） | `resource_pack/textures/entity/pcraftrevorn/*` | P2 |
| `textures/screens/*`（GUI/酸液条/挣扎图标） | 仅少量可用于表单/图标 | ⏳ |
| `sounds/*.ogg` + `sounds.json` | `resource_pack/sounds/pcraftrevorn/*` + `sound_definitions.json` | ✅ |
| `models/item/*` | item icon 复用贴图 | ✅ |
| `models/block/*` | 方块 material_instances | ✅ |
| `models/custom/piglin_throne{1,2}` | `resource_pack/models/blocks/*.geo.json` | ✅ ⚠️ |
| `geo/*.geo.json` + `animations/*` | `resource_pack/models/entity` + `animations` | P2 |
| `particles/*` | `resource_pack/particles/*.json` | P2 |
| `lang/en_us.json` | `texts/en_US.lang` + `texts/zh_CN.lang` | ✅ |

### 2.9 数据

| Java | Bedrock | 状态 |
|---|---|---|
| `recipes/*`（16） | `behavior_pack/recipes/*` | ✅（6 个锻造→无序合成，P5 脚本） |
| `loot_tables/blocks/*`（4） | `behavior_pack/loot_tables/blocks/*` | ✅ |
| `loot_tables/entities/{zombie,piglin_royal}` | `behavior_pack/loot_tables/entities/*` | ✅ |
| `loot_tables/entities/piglin_royal/bartering_1` | 脚本交易表（P5） | ⏳ |
| `tags/items/*` | `minecraft:tags` + 脚本 | ✅ / P5 |
| `tags/entity_types/*` | 脚本集合 | P3 |
| `damage_type/digestion` | 脚本 | P3 |
| `worldgen/**`, `structures/*.nbt` | jigsaw + `.mcstructure` | P6 |
| `forge/biome_modifier/*` | `spawn_rules/*.json` | P6 |

---

## 3. procedure 索引（347）

以下为全部 `net/mcreator/pcraftrevorn/procedures/*` 源文件 → 目标脚本模块（按名称归类）。

| procedure | 目标模块 | 阶段 |
|---|---|---|
| `ReturnSizeProcedure` | 体重增长/WG | P5 |
| `TextureAssignerGenderedProcedure` | 体重增长/WG | P5 |
| `WG1ReturnsProcedure` | 体重增长/WG | P5 |
| `WG1SpawnAdjustedProcedure` | 体重增长/WG | P5 |
| `WG2ReturnsProcedure` | 体重增长/WG | P5 |
| `WG2SpawnAdjustedProcedure` | 体重增长/WG | P5 |
| `WGSetProcedure` | 体重增长/WG | P5 |
| `PRRabbitFProcedure` | 兔法师/法杖 | P5 |
| `PRRabbitTProcedure` | 兔法师/法杖 | P5 |
| `RabbitAttackMonstersProcedure` | 兔法师/法杖 | P5 |
| `RabbitAttackPlayerProcedure` | 兔法师/法杖 | P5 |
| `RabbitAttackProcedure` | 兔法师/法杖 | P5 |
| `RabbitFollowProcedure` | 兔法师/法杖 | P5 |
| `RabbitMarkedEffectExpiresProcedure` | 兔法师/法杖 | P5 |
| `RabbitNoLookProcedure` | 兔法师/法杖 | P5 |
| `RabbitParticleParticleVisualScaleProcedure` | 兔法师/法杖 | P5 |
| `RabbitProjectileBloodlustWhileProjectileFlyingTickProcedure` | 兔法师/法杖 | P5 |
| `RabbitProjectileWhileProjectileFlyingTickProcedure` | 兔法师/法杖 | P5 |
| `RabbitSightBonusProcedure` | 兔法师/法杖 | P5 |
| `RabbitStaffRightclickedProcedure` | 兔法师/法杖 | P5 |
| `RabbitWanderProcedure` | 兔法师/法杖 | P5 |
| `RabbitWizardOnEntityTickUpdateProcedure` | 兔法师/法杖 | P5 |
| `RabbitWizardOnInitialEntitySpawnProcedure` | 兔法师/法杖 | P5 |
| `RabbitWizardRightClickedOnEntityProcedure` | 兔法师/法杖 | P5 |
| `RegurgitationSicknessOnEffectActiveTickProcedure` | 反刍 | P3 |
| `StartFullProcedure` | 反刍 | P3 |
| `StopFullProcedure` | 反刍 | P3 |
| `ZombieGirlOnEntityTickUpdateProcedure` | 吞食僵尸 | P5 |
| `ZombieGirlRightClickedOnEntityProcedure` | 吞食僵尸 | P5 |
| `ZombieMellowProcedure` | 吞食僵尸 | P5 |
| `ZombieNaturalEntitySpawningConditionProcedure` | 吞食僵尸 | P5 |
| `ZombieOnInitialEntitySpawnProcedure` | 吞食僵尸 | P5 |
| `EatPreyBoundProcedure` | 吞食核心 | P3 |
| `EatPreyFlyingProcedure` | 吞食核心 | P3 |
| `EatTamedProcedure` | 吞食核心 | P3 |
| `EntitySwallowHandlerProcedure` | 吞食核心 | P3 |
| `MaidenFullMobProcedure` | 吞食核心 | P3 |
| `MaidenFullPlayerProcedure` | 吞食核心 | P3 |
| `MobEatMobProcedure` | 吞食核心 | P3 |
| `MobEatPlayerMultiProcedure` | 吞食核心 | P3 |
| `MobEatPlayerProcedure` | 吞食核心 | P3 |
| `PiglinBoundCaptureProcedure` | 吞食核心 | P3 |
| `PiglinFullMobProcedure` | 吞食核心 | P3 |
| `PiglinFullPlayerProcedure` | 吞食核心 | P3 |
| `PiglinKnightFullMobProcedure` | 吞食核心 | P3 |
| `PiglinKnightFullPlayerProcedure` | 吞食核心 | P3 |
| `ReturnPiglinFullSlowProcedure` | 吞食核心 | P3 |
| `ReturnSwallowChanceProcedure` | 吞食核心 | P3 |
| `SwallowAnimPlayerProcedure` | 吞食核心 | P3 |
| `SwallowTargetCheckProcedure` | 吞食核心 | P3 |
| `ZombieFullMobProcedure` | 吞食核心 | P3 |
| `ZombieFullPlayerProcedure` | 吞食核心 | P3 |
| `ShieldedOnEffectActiveTickProcedure` | 护盾/守护 | P5 |
| `ShieldingRingOnEntityTickUpdateProcedure` | 护盾/守护 | P5 |
| `WardDefenseProcedure` | 护盾/守护 | P5 |
| `WardOffenseProcedure` | 护盾/守护 | P5 |
| `OpenBasaltmite2Procedure` | 指南书 UI | P7 |
| `OpenBasaltmiteProcedure` | 指南书 UI | P7 |
| `OpenGildedBasaltmiteProcedure` | 指南书 UI | P7 |
| `OpenPRKProcedure` | 指南书 UI | P7 |
| `OpenPRProcedure` | 指南书 UI | P7 |
| `OpenRabbitProcedure` | 指南书 UI | P7 |
| `OpenScarecrowProcedure` | 指南书 UI | P7 |
| `OpenSilverfishProcedure` | 指南书 UI | P7 |
| `OpenVinemaiden2Procedure` | 指南书 UI | P7 |
| `OpenVinemaidenProcedure` | 指南书 UI | P7 |
| `OpenZombieProcedure` | 指南书 UI | P7 |
| `BoundMoveYProcedure` | 挣扎/束缚 | P4 |
| `BoundMoveZProcedure` | 挣扎/束缚 | P4 |
| `BoundXMoveProcedure` | 挣扎/束缚 | P4 |
| `DownCorrectProcedure` | 挣扎/束缚 | P4 |
| `DownIdleProcedure` | 挣扎/束缚 | P4 |
| `DownIncorrectProcedure` | 挣扎/束缚 | P4 |
| `DownOffProcedure` | 挣扎/束缚 | P4 |
| `LeftCorrectProcedure` | 挣扎/束缚 | P4 |
| `LeftIdleProcedure` | 挣扎/束缚 | P4 |
| `LeftIncorrectProcedure` | 挣扎/束缚 | P4 |
| `LeftOffProcedure` | 挣扎/束缚 | P4 |
| `RightCorrectProcedure` | 挣扎/束缚 | P4 |
| `RightIdleProcedure` | 挣扎/束缚 | P4 |
| `RightIncorrectProcedure` | 挣扎/束缚 | P4 |
| `RightOffProcedure` | 挣扎/束缚 | P4 |
| `StruggleAnimationsProcedure` | 挣扎/束缚 | P4 |
| `StruggleCooldownProcedure` | 挣扎/束缚 | P4 |
| `StruggleDownOnKeyPressedProcedure` | 挣扎/束缚 | P4 |
| `StruggleLeftOnKeyPressedProcedure` | 挣扎/束缚 | P4 |
| `StruggleRightOnKeyPressedProcedure` | 挣扎/束缚 | P4 |
| `StruggleUpOnKeyPressedProcedure` | 挣扎/束缚 | P4 |
| `UpCorrectProcedure` | 挣扎/束缚 | P4 |
| `UpIdleProcedure` | 挣扎/束缚 | P4 |
| `UpIncorrectProcedure` | 挣扎/束缚 | P4 |
| `UpOffProcedure` | 挣扎/束缚 | P4 |
| `EscapeProcedure` | 束缚/逃脱 | P4 |
| `EscapeSoftenedProcedure` | 束缚/逃脱 | P4 |
| `DProgressProcedure` | 消化 | P3 |
| `DigestAnimProcedure` | 消化 | P3 |
| `DigestTestProcedure` | 消化 | P3 |
| `ReturnDigestSlowMobProcedure` | 消化 | P3 |
| `ReturnDigestionSlowProcedure` | 消化 | P3 |
| `ReturnHealthThresholdProcedure` | 消化 | P3 |
| `ReturnMaxTimerProcedure` | 消化 | P3 |
| `CarbonatedOnEffectActiveTickProcedure` | 状态效果 | P5 |
| `CarbonatedWaterBottleSpecialInformationProcedure` | 状态效果 | P5 |
| `GlowberryFermentationBarrellOnTickUpdateProcedure` | 状态效果 | P5 |
| `NeutralizingWaterSpecialInformationProcedure` | 状态效果 | P5 |
| `PlaySoundEffectStartedappliedProcedure` | 状态效果 | P5 |
| `PotionAppliedProcedure` | 状态效果 | P5 |
| `SoftenedEffectExpiresProcedure` | 状态效果 | P5 |
| `SoftenedOnEffectActiveTickProcedure` | 状态效果 | P5 |
| `SugarNeutralizingWaterItemInInventoryTickProcedure` | 状态效果 | P5 |
| `VisualFXEffectStartedappliedProcedure` | 状态效果 | P5 |
| `PiglinDecreeProcedure` | 猪灵王 | P5 |
| `PiglinMightTalismanWhileBaubleIsEquippedTickProcedure` | 猪灵王 | P5 |
| `PiglinRoyalKnightOnEntityTickUpdateProcedure` | 猪灵王 | P5 |
| `PiglinRoyalKnightOnInitialEntitySpawnProcedure` | 猪灵王 | P5 |
| `PiglinRoyalOnEntityTickUpdateProcedure` | 猪灵王 | P5 |
| `PiglinRoyalOnInitialEntitySpawnProcedure` | 猪灵王 | P5 |
| `PiglinRoyalRightClickedOnEntityProcedure` | 猪灵王 | P5 |
| `PiglinRoyalSpawnerOnEntityTickUpdateProcedure` | 猪灵王 | P5 |
| `PiglinSpawnIntervalsProcedure` | 猪灵王 | P5 |
| `PiglinStompProcedure` | 猪灵王 | P5 |
| `PiglinThrone1OnTickUpdateProcedure` | 猪灵王 | P5 |
| `PiglinThroneroomSpawnerOnEntityTickUpdateProcedure` | 猪灵王 | P5 |
| `ReturnPiglinLaunchXProcedure` | 猪灵王 | P5 |
| `ReturnPiglinLaunchZProcedure` | 猪灵王 | P5 |
| `RightClickPiglinProcedure` | 猪灵王 | P5 |
| `BasaltmiteEntityVisualScaleProcedure` | 玄武岩虫 | P5 |
| `BasaltmiteOnEntityTickUpdateProcedure` | 玄武岩虫 | P5 |
| `BasaltmiteOnInitialEntitySpawnProcedure` | 玄武岩虫 | P5 |
| `BasaltmiteOreFullnessProcedure` | 玄武岩虫 | P5 |
| `BasaltmiteReturnProcedure` | 玄武岩虫 | P5 |
| `BasaltmiteRightClickedOnEntityProcedure` | 玄武岩虫 | P5 |
| `GildedBasaltmiteOnInitialEntitySpawnProcedure` | 玄武岩虫 | P5 |
| `GildedBasaltmiteRightClickProcedure` | 玄武岩虫 | P5 |
| `PRBasaltmiteFProcedure` | 玄武岩虫 | P5 |
| `PRBasaltmiteTProcedure` | 玄武岩虫 | P5 |
| `PRGilBasaltmiteFProcedure` | 玄武岩虫 | P5 |
| `PRGilBasaltmiteTProcedure` | 玄武岩虫 | P5 |
| `PRScarecrowFProcedure` | 稻草人 | P5 |
| `PRScarecrowTProcedure` | 稻草人 | P5 |
| `ScarecrowOnEntityTickUpdateProcedure` | 稻草人 | P5 |
| `ScarecrowOnInitialEntitySpawnProcedure` | 稻草人 | P5 |
| `ScarecrowRightClickedOnEntityProcedure` | 稻草人 | P5 |
| `IncreaseStatsVinemaidenProcedure` | 藤娘 | P5 |
| `PRVinemaidenFProcedure` | 藤娘 | P5 |
| `PRVinemaidenTProcedure` | 藤娘 | P5 |
| `VineStopFollowPlayerProcedure` | 藤娘 | P5 |
| `VinemaidenBlockCheckProcedure` | 藤娘 | P5 |
| `VinemaidenEntityDiesProcedure` | 藤娘 | P5 |
| `VinemaidenNaturalEntitySpawningConditionProcedure` | 藤娘 | P5 |
| `VinemaidenOnEntityTickUpdateProcedure` | 藤娘 | P5 |
| `VinemaidenOnInitialEntitySpawnProcedure` | 藤娘 | P5 |
| `VinemaidenRightClickedOnEntityProcedure` | 藤娘 | P5 |
| `VinemaidenRollProcedure` | 藤娘 | P5 |
| `VinemaidenSeedlingOnEntityTickUpdateProcedure` | 藤娘 | P5 |
| `VinemaidenSeedlingRightClickedOnEntityProcedure` | 藤娘 | P5 |
| `VinemaidenSetProcedure` | 藤娘 | P5 |
| `VinemaidenTamedProcedure` | 藤娘 | P5 |
| `VinemaidenWanderProcedure` | 藤娘 | P5 |
| `PRSilverfishFProcedure` | 蠹虫 | P5 |
| `PRSilverfishTProcedure` | 蠹虫 | P5 |
| `SilverfishEntityDiesProcedure` | 蠹虫 | P5 |
| `SilverfishEntityVisualScaleProcedure` | 蠹虫 | P5 |
| `SilverfishOnEntityTickUpdateProcedure` | 蠹虫 | P5 |
| `SilverfishOnInitialEntitySpawnProcedure` | 蠹虫 | P5 |
| `SilverfishOreFullnessProcedure` | 蠹虫 | P5 |
| `SilverfishReturnProcedure` | 蠹虫 | P5 |
| `SilverfishRightClickedOnEntityProcedure` | 蠹虫 | P5 |
| `BonesCheckProcedure` | 辅助/生物参数 | P5 |
| `BookChecksProcedure` | 辅助/生物参数 | P5 |
| `DropRewardProcedure` | 辅助/生物参数 | P5 |
| `EntityCodeNamesProcedure` | 辅助/生物参数 | P5 |
| `GEPCheckProcedure` | 辅助/生物参数 | P5 |
| `PRKFixProcedure` | 辅助/生物参数 | P5 |
| `PRPRFProcedure` | 辅助/生物参数 | P5 |
| `PRPRKFProcedure` | 辅助/生物参数 | P5 |
| `PRPRKTProcedure` | 辅助/生物参数 | P5 |
| `PRPRTProcedure` | 辅助/生物参数 | P5 |
| `PRZombieFProcedure` | 辅助/生物参数 | P5 |
| `PRZombieTProcedure` | 辅助/生物参数 | P5 |
| `PorkchopProcedure` | 辅助/生物参数 | P5 |
| `ReturnRoyalDropXProcedure` | 辅助/生物参数 | P5 |
| `ReturnRoyalDropZProcedure` | 辅助/生物参数 | P5 |
| `AddNetheriteArmorProcedure` | 通用事件 | P5 |
| `AllDamageProcedure` | 通用事件 | P5 |
| `AlwaysTrueProcedure` | 通用事件 | P5 |
| `BeforeDamageProcedure` | 通用事件 | P5 |
| `BindProcedure` | 通用事件 | P5 |
| `BindingRingOnInitialEntitySpawnProcedure` | 通用事件 | P5 |
| `CheckMonthProcedure` | 通用事件 | P5 |
| `CriticalHitProcedure` | 通用事件 | P5 |
| `DistanceCalculatorProcedure` | 通用事件 | P5 |
| `EntityAboutToGriefProcedure` | 通用事件 | P5 |
| `EntityAttackedProcedure` | 通用事件 | P5 |
| `EntityDiesProcedure` | 通用事件 | P5 |
| `EntityMaxVarianceProcedure` | 通用事件 | P5 |
| `EntityPicksUpItemProcedure` | 通用事件 | P5 |
| `EntitySpawnsProcedure` | 通用事件 | P5 |
| `EntityTickProcedure` | 通用事件 | P5 |
| `EntityTramplesProcedure` | 通用事件 | P5 |
| `FollowOwnerProcedure` | 通用事件 | P5 |
| `GildedShieldWhileBaubleIsEquippedTickProcedure` | 通用事件 | P5 |
| `GuardingModeHealthProcedure` | 通用事件 | P5 |
| `GuardingModeProcedure` | 通用事件 | P5 |
| `IncreaseStatsProcedure` | 通用事件 | P5 |
| `IncreaseStatsZombieProcedure` | 通用事件 | P5 |
| `IsActiveProcedure` | 通用事件 | P5 |
| `IsBuriedExtraProcedure` | 通用事件 | P5 |
| `IsBuriedProcedure` | 通用事件 | P5 |
| `IsBuriedTamed2Procedure` | 通用事件 | P5 |
| `IsBuriedTamedAnimalsProcedure` | 通用事件 | P5 |
| `IsBuriedTamedProcedure` | 通用事件 | P5 |
| `IsFollowingProcedure` | 通用事件 | P5 |
| `LeftClickBlockProcedure` | 通用事件 | P5 |
| `NameCutTestProcedure` | 通用事件 | P5 |
| `NoLookKnightProcedure` | 通用事件 | P5 |
| `PCraftTestingNoticeProcedure` | 通用事件 | P5 |
| `PlayerBreaksBlockProcedure` | 通用事件 | P5 |
| `PlayerJoinsProcedure` | 通用事件 | P5 |
| `PlayerPlacesBlockProcedure` | 通用事件 | P5 |
| `PlayerTickProcedure` | 通用事件 | P5 |
| `PlayerUpdateTickProcedure` | 通用事件 | P5 |
| `PredChanceAdjustedProcedure` | 通用事件 | P5 |
| `PredExtraTagsProcedure` | 通用事件 | P5 |
| `ResetProcedure` | 通用事件 | P5 |
| `ReturnLaunchXProcedure` | 通用事件 | P5 |
| `ReturnLaunchZProcedure` | 通用事件 | P5 |
| `ReturnMainProcedure` | 通用事件 | P5 |
| `ReturnMonthProcedure` | 通用事件 | P5 |
| `ReturnPageProcedure` | 通用事件 | P5 |
| `ReturnSatisfiedProcedure` | 通用事件 | P5 |
| `ReturnWorldTimeProcedure` | 通用事件 | P5 |
| `RightClickBlockProcedure` | 通用事件 | P5 |
| `RightClickEntityProcedure` | 通用事件 | P5 |
| `RightClickOnEntityProcedure` | 通用事件 | P5 |
| `RightClickWithItemProcedure` | 通用事件 | P5 |
| `RoyalIntroProcedure` | 通用事件 | P5 |
| `SetTestWorldProcedure` | 通用事件 | P5 |
| `SetsAttackTargetProcedure` | 通用事件 | P5 |
| `SoulJackOLanternBlockIsPlacedByProcedure` | 通用事件 | P5 |
| `StopAttackProcedure` | 通用事件 | P5 |
| `StopKnightTreatyProcedure` | 通用事件 | P5 |
| `TimeProcedure` | 通用事件 | P5 |
| `TooltipsProcedure` | 通用事件 | P5 |
| `UUIDProcedure` | 通用事件 | P5 |
| `WanderCheckProcedure` | 通用事件 | P5 |
| `A100Procedure` | 通用数值/工具 | P3 |
| `A10Procedure` | 通用数值/工具 | P3 |
| `A11Procedure` | 通用数值/工具 | P3 |
| `A12Procedure` | 通用数值/工具 | P3 |
| `A13Procedure` | 通用数值/工具 | P3 |
| `A14Procedure` | 通用数值/工具 | P3 |
| `A15Procedure` | 通用数值/工具 | P3 |
| `A16Procedure` | 通用数值/工具 | P3 |
| `A17Procedure` | 通用数值/工具 | P3 |
| `A18Procedure` | 通用数值/工具 | P3 |
| `A19Procedure` | 通用数值/工具 | P3 |
| `A1Procedure` | 通用数值/工具 | P3 |
| `A20Procedure` | 通用数值/工具 | P3 |
| `A21Procedure` | 通用数值/工具 | P3 |
| `A22Procedure` | 通用数值/工具 | P3 |
| `A23Procedure` | 通用数值/工具 | P3 |
| `A24Procedure` | 通用数值/工具 | P3 |
| `A25Procedure` | 通用数值/工具 | P3 |
| `A26Procedure` | 通用数值/工具 | P3 |
| `A27Procedure` | 通用数值/工具 | P3 |
| `A28Procedure` | 通用数值/工具 | P3 |
| `A29Procedure` | 通用数值/工具 | P3 |
| `A2Procedure` | 通用数值/工具 | P3 |
| `A30Procedure` | 通用数值/工具 | P3 |
| `A31Procedure` | 通用数值/工具 | P3 |
| `A32Procedure` | 通用数值/工具 | P3 |
| `A33Procedure` | 通用数值/工具 | P3 |
| `A34Procedure` | 通用数值/工具 | P3 |
| `A35Procedure` | 通用数值/工具 | P3 |
| `A36Procedure` | 通用数值/工具 | P3 |
| `A37Procedure` | 通用数值/工具 | P3 |
| `A38Procedure` | 通用数值/工具 | P3 |
| `A39Procedure` | 通用数值/工具 | P3 |
| `A3Procedure` | 通用数值/工具 | P3 |
| `A40Procedure` | 通用数值/工具 | P3 |
| `A41Procedure` | 通用数值/工具 | P3 |
| `A42Procedure` | 通用数值/工具 | P3 |
| `A43Procedure` | 通用数值/工具 | P3 |
| `A44Procedure` | 通用数值/工具 | P3 |
| `A45Procedure` | 通用数值/工具 | P3 |
| `A46Procedure` | 通用数值/工具 | P3 |
| `A47Procedure` | 通用数值/工具 | P3 |
| `A48Procedure` | 通用数值/工具 | P3 |
| `A49Procedure` | 通用数值/工具 | P3 |
| `A4Procedure` | 通用数值/工具 | P3 |
| `A50Procedure` | 通用数值/工具 | P3 |
| `A51Procedure` | 通用数值/工具 | P3 |
| `A52Procedure` | 通用数值/工具 | P3 |
| `A53Procedure` | 通用数值/工具 | P3 |
| `A54Procedure` | 通用数值/工具 | P3 |
| `A55Procedure` | 通用数值/工具 | P3 |
| `A56Procedure` | 通用数值/工具 | P3 |
| `A57Procedure` | 通用数值/工具 | P3 |
| `A58Procedure` | 通用数值/工具 | P3 |
| `A59Procedure` | 通用数值/工具 | P3 |
| `A5Procedure` | 通用数值/工具 | P3 |
| `A60Procedure` | 通用数值/工具 | P3 |
| `A61Procedure` | 通用数值/工具 | P3 |
| `A62Procedure` | 通用数值/工具 | P3 |
| `A63Procedure` | 通用数值/工具 | P3 |
| `A64Procedure` | 通用数值/工具 | P3 |
| `A65Procedure` | 通用数值/工具 | P3 |
| `A66Procedure` | 通用数值/工具 | P3 |
| `A67Procedure` | 通用数值/工具 | P3 |
| `A68Procedure` | 通用数值/工具 | P3 |
| `A69Procedure` | 通用数值/工具 | P3 |
| `A6Procedure` | 通用数值/工具 | P3 |
| `A70Procedure` | 通用数值/工具 | P3 |
| `A71Procedure` | 通用数值/工具 | P3 |
| `A72Procedure` | 通用数值/工具 | P3 |
| `A73Procedure` | 通用数值/工具 | P3 |
| `A74Procedure` | 通用数值/工具 | P3 |
| `A75Procedure` | 通用数值/工具 | P3 |
| `A76Procedure` | 通用数值/工具 | P3 |
| `A77Procedure` | 通用数值/工具 | P3 |
| `A78Procedure` | 通用数值/工具 | P3 |
| `A79Procedure` | 通用数值/工具 | P3 |
| `A7Procedure` | 通用数值/工具 | P3 |
| `A80Procedure` | 通用数值/工具 | P3 |
| `A81Procedure` | 通用数值/工具 | P3 |
| `A82Procedure` | 通用数值/工具 | P3 |
| `A83Procedure` | 通用数值/工具 | P3 |
| `A84Procedure` | 通用数值/工具 | P3 |
| `A85Procedure` | 通用数值/工具 | P3 |
| `A86Procedure` | 通用数值/工具 | P3 |
| `A87Procedure` | 通用数值/工具 | P3 |
| `A88Procedure` | 通用数值/工具 | P3 |
| `A89Procedure` | 通用数值/工具 | P3 |
| `A8Procedure` | 通用数值/工具 | P3 |
| `A90Procedure` | 通用数值/工具 | P3 |
| `A91Procedure` | 通用数值/工具 | P3 |
| `A92Procedure` | 通用数值/工具 | P3 |
| `A93Procedure` | 通用数值/工具 | P3 |
| `A94Procedure` | 通用数值/工具 | P3 |
| `A95Procedure` | 通用数值/工具 | P3 |
| `A96Procedure` | 通用数值/工具 | P3 |
| `A97Procedure` | 通用数值/工具 | P3 |
| `A98Procedure` | 通用数值/工具 | P3 |
| `A99Procedure` | 通用数值/工具 | P3 |
| `A9Procedure` | 通用数值/工具 | P3 |
| `ABaseProcedure` | 通用数值/工具 | P3 |

> 共 347 个 procedure。目标模块名对应 `behavior_pack/scripts/` 下的子目录（P3 起建立）。
