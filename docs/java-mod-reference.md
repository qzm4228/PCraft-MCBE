# Java mod reference (`jar/`)

Internal technical notes on the Java mods kept in `jar/`. These are the *sources of truth* we
port mechanics from. Nothing in here is user-facing copy (guide/addon text must not mention any
of this).

| Jar | Mod | MC / loader | Role for us |
| --- | --- | --- | --- |
| `pcraftrevorn-3.1.1-forge-1.20.1(昕禾薇汉化).jar` | **PCraftRevorn** 3.1.1 | 1.20.1 / Forge 47 | **The mod we are porting.** |
| `InternalisedV1.35(1.20.1-forge).jar` | **VCM** 1.0.0 | 1.20.1 / Forge 47 | Reference for the arrow-key **struggle QTE**. |
| `hungryhana[简中]-1.12.3.jar` | **Hungry Hana** 1.12.3 | 1.21.1 / NeoForge 21.1 | Reference for **player-as-predator belly**, interior screen, gulp, endo, struggle meter. |

Decompiled trees are in `.work/` (gitignored, not packed):

- `.work/src/` — PCraftRevorn (550 files) — the tree already used by `docs/file-mapping.md`.
- `.work/vcm_src/` — VCM (133 files).
- `.work/hana_src/` — Hungry Hana (189 files).

## 1. PCraftRevorn 3.1.1 — the port source

`mods.toml`: `modId="pcraftrevorn"`, author **MysticSummoner**, `"A vore mod for Minecraft"`,
AFL-3.0. Required dep `geckolib`, optional `curios_api`. 951 class files.

> **Localization gotcha:** this build ships *only* `assets/pcraftrevorn/lang/en_us.json`, and the
> `昕禾薇汉化` patch filled it with **Chinese** values. Never use it as an English-name source —
> this is the same trap as the stale `zh_CN.lang` pack names we fixed in `build_config.py`.

### Package map (classes / decompiled files)

| Package | What it is |
| --- | --- |
| `procedures` | 470 / 347 — all game logic (see below) |
| `world` | 186 / 16 — 14 container menus (`PG*Menu`, `PredGuidebookMenu`, `StomachMenu`, `FermentationMenu`) + the structure feature |
| `entity` | 100 / 30 — creatures, models, layers, projectiles |
| `client` | 43 / 32 — renderers, screens, **2 HUD overlays** |
| `item` | 42 / 34 — items incl. staff item models/renderers |
| `init` | 28 / 23 — registries, key mappings, curios slots, tabs |
| `network` | 25 / 17 — capability + 4 struggle messages + guidebook button messages |
| `potion` | 21 / 18 — 18 mob effects |
| `recipes` | 15 — brewing recipes for the 5 custom potions |
| `configuration` | 10 — 1 global + 9 per-predator configs |
| `block` | 8 / 5 — fermentation barrel (+BE), 2 piglin thrones, soul jack-o-lantern |
| `utils` / `command` | `AnimUtils`, `PcrafttestingCommand` |

### Creatures (`PREDATORS` in our port)

`Basaltmite`, `GildedBasaltmite`, `Silverfish`, `Vinemaiden` (+ `VinemaidenSeedling`),
`Zombie` (zombie girl), `Scarecrow`, `RabbitWizard`, `PiglinRoyal`, `PiglinRoyalKnight`
(+ `PiglinRoyalSpawner`, `PiglinThroneroomSpawner` as spawner entities), `BindingRing`,
`ShieldingRing`, `RabbitPlayerProjectile`, `RabbitProjectileBloodlust`.

#### Who each creature hunts (`NearestAttackableTargetGoal` in `entity/*Entity.java`)

| entity | targets (goal priority order) |
|---|---|
| `Basaltmite` / `GildedBasaltmite` | `MagmaCube` (3) |
| `Vinemaiden` | `Cow` 4, `Sheep` 5, `Pig` 6, `Goat` 7, `Player` 8, `Wolf` 9, `ZombieEntity`(mod) 10, `Pillager` 11, `Vindicator` 12 |
| `Zombie` (mod) | `Villager` 2, `Player` 3 |
| `Silverfish` | `Player` 1, `Villager` 2, `Pillager` 3, `Vindicator` 4, `Witch` 5 |
| `Scarecrow` | `Monster` 3 (gated by `IsActiveProcedure`) |
| `RabbitWizard` | `Monster` 2, `Player` 3 |
| `PiglinRoyalKnight` | `Monster` 4, `Player` 5 |
| `PiglinRoyal` (royalty) | — (not hostile; no attack goal) |

The port bakes these into the generated `pcraftrevorn:aggressive` component group
(`TARGETS` in `tools_py/generate_entities.py`; community reskins reuse the same
table through `TARGETS_BY_BASE` in `generate_community.py`), and `vore.js`
(`PREY_FAMILIES`) filters the passive mob hunt with the same lists.

### Effects (18)

AcidResistance, Bloodlust, Bound, Carbonated, DelectableScent, GlowberryHigh, NeutralizedAcids,
PiglinsDecree, PlaySound, RabbitMarked, RegurgitationArmor, RegurgitationSickness,
RegurgitationStench, RottenStench, Shielded, Softened, VisualFX, Warded.

### The vore state machine — `PlayerVariables`

Capability `PcraftrevornModVariables.PLAYER_VARIABLES_CAPABILITY`; saved-data companions
`MapVariables` + `WorldVariables` (synced by `SavedDataSyncMessage`).

```
Eaten            // currently inside a pred
eatenTicks       // ticks inside
predRNGSeed      // per-meal RNG seed
predToken        // which pred/instance owns the meal
allowStruggles   // struggle enabled for this meal
requireLeft/Right/Up/Down   // the 4 arrow prompts
pressLeft/Right/Up/Down     // player's presses
struggleTimer    // window for the current prompt
digestionProgress// 0..maxTimer (drives the 100-step acid bar)
softenLevel      // Softened effect level
giveRing, basaltShield, counter, updateTick
guidebookPage, book  // book = 60-char bitmask "FFFF…" = entries known
givenGuidebook, lastStaff, testworld
```

### Struggle (QTE)

- Prompts: `requireUp/Down/Left/Right` + `pressUp/Down/Left/Right`, gated by `allowStruggles`
  and `struggleTimer > 0`.
- Client → server: `StruggleUpMessage` / `Down` / `Left` / `Right`; keybinds live in
  `PcraftrevornModKeyMappings`.
- HUD `client/screens/StrugglesOverlay` draws one 48×48 sprite at screen centre:
  `struggle_{up,down,left,right}_{off,idle,correct,incorrect}.png`, chosen by
  `UpCorrectProcedure` … `DownOffProcedure` (16 tiny predicate procedures).
- Per-predator config: `strugglesNeeded` (Basaltmite default **11**) ± `strugglesNeededVariance` (**4**);
  `struggleDifficulty` (**0.3**) ± variance (**0.15**) = chance the prompt needs **two** directions.
- **Port note:** Bedrock has no key mappings, and JSON-UI buttons in the inventory /
  HUD cannot call scripts either. The port therefore ships four locked hotbar items
  (`pcraftrevorn:struggle_up/down/left/right`, `ItemLockMode.slot`) that the prey
  *uses*; `world.afterEvents.itemUse` feeds the direction into the same state machine.
  Prompts are single-direction only (a pair cannot be expressed with one item per
  direction), so `struggleDifficulty` instead tightens the reaction window.
  The pacing numbers above are what we mirror.

### Digestion

- Progress accumulator `digestionProgress` compared against `ReturnMaxTimerProcedure` →
  `digestiobGoal` (**12000**), `±15%` by difficulty (`difficultyAffectsDigestionGoal`).
- Rate: `initialAcidsRate` **2.8**/tick, ceiling `maxAcidsRate` **26**, ramp
  `acidRateIncriment` **0.008**/tick.  (`DigestAnim`, `ReturnDigestionSlow`, `DProgress`.)
- HUD acid bar: `acid_bar_1` … `acid_bar_100` + `acid_indicator` drawn by
  `client/screens/IndicatorOverlay`, each step gated by `A{n}Procedure`
  reading `digestionProgress >= ReturnMaxTimer/100 * n`.
  (This is where the 100 `A*Procedure` classes come from.)
- **Port note:** the 100 segments are pre-composited into one 300×8 strip
  (`textures/ui/pcraftrevorn/hud/acid_bar_fill.png`) clipped by `#progress_percentage`,
  and the bar itself is redrawn by `resource_pack/ui/pcraftrevorn_hud.json` — a
  `modifications` patch on vanilla `hud.boss_health_panel` applied to the
  `pcraftrevorn:digestion_bar` boss entity (health = acid, nameTag = the struggle
  state bus). Original position (`w/2-158`, y 0, 320×32) is the top-centre boss-bar
  slot, so the port keeps the layout.
- On completion: `belchingAfterDigestion` → **Carbonated 15 s**; `bonesFromDigestion` → bones into
  the pred's stomach inventory; `healthRecovery` → pred heals **30 %**; meal count feeds WG.
- `ignoresWallothThreshold`, `autoShowBook`, `guidebookOnSpawn`, `newPredStruggleAnims`
  (3.0.0 preds use the new struggle anims).

### Weight gain

`WG1` = 1 digested meal → stage 1, `WG2` = 4 → stage 2 (per pred; `WG1Returns`/`WG2Returns`).
Spawn already-fat chances `wg1SpawnChance` **9 %** / `wg2SpawnChance` **1.5 %**; `fullnessGain`
**10** capacity per stage; `maxBlockFullness` **20** for Basaltmite (ores/buried mechanic).

### Other systems to know

- **Curios:** `BindingRing` + `AttunedBindingRing` (talisman slot), `GildedShield`,
  `PiglinMightTalisman` (`PiglinMightTalismanWhileBaubleIsEquippedTick`).
- **Guidebook:** `PredGuidebookItemItem` + 12 `PG*` pages (`OpenZombie`, `OpenVinemaiden2`, …),
  each a container menu + a `*ButtonMessage`; `book` is a per-page bitmask.
- **Stomach GUI:** `StomachMenu` / `client/gui/StomachScreen` (176×220, `textures/screens/stomach.png`)
  — the pred's "stomach inventory".
- **Food chain:** `RabbitWizard` gets sight bonus / follows / attacks; `Silverfish`,
  `Basaltmite` mine blocks for fullness; `PiglinRoyal` decree + stomp; `Scarecrow` similar.
- **Regurgitation:** `RegurgitationSickness`/`Armor`/`Stench`, `ReturnSatisfied`.

## 2. VCM (`InternalisedV1.35`) — struggle QTE + creature girls

`modId="vcm"`, display "VCM", v1.0.0, **MCreator**-made (mcknu), deps: `minecraft 1.20.1`
required, `pehkui` + `geckolib` optional. 175 classes / 133 files.

- Creatures: `BatGirl`, `BunnyGirl`, `CatGirl`, `SlimeGirl`, `Lamia`, `Druid`
  (+ `AutumnDruidProjectile`, `SpringDruidProjectile`, `WinterDruidProjectile`), model `Modelmcv`.
- Items: druid staffs (spring/autumn/winter), vampiric dagger, slime pearl, blood shard.
- Particles: autumn leaves, leaves, siphon, spring blossom, winter snowflake.

### The minigame, exactly

State (`VcmModVariables.PlayerVariables`): `MinigameActive`, `MinigameScore` (0), `MinigameTimer`
(**600** ticks = 30 s), `CurrentKey` (0 = none, 1–4), `IsUpdating`, `MobUUID` (the eater).

`MinigameTickLoopProcedure` (per-player tick):

1. Not active → return.
2. **Lose** if `score <= -15` **or** `timer <= 0`: clear state, force `SURVIVAL`, clear the
   predator's `DATA_Digestion` and `setAnimation("empty")`, then kill the player with
   **`vcm:digestion`** damage.
3. `timer -= 1`.
4. Every **30 ticks**: if a key was still pending → `score -= 1`; then roll
   `CurrentKey = 1..4`.
5. **Win** if `score >= 15`: clear state, force `SURVIVAL`, teleport the player to the predator,
   clear `DATA_Digestion` + `setAnimation("empty")` → you are let out unharmed.
6. While active: the player is pinned to the predator every tick and gets a short mob effect.

Input: keybinds bound directly to the **arrow keys** (265 up / 264 down / 263 left / 262 right),
category `gameplay`; each sends `Up/Down/Left/RightArrowMessage`; the handler
(`UpArrowOnKeyPressedProcedure`, …) checks `CurrentKey` — match → `score + 1` and consume,
mismatch → `score - 1`.

HUD: `client/screens/VoreMinigameOverlay` draws a 48×48 arrow sprite at the screen centre plus
`Score: n/15` (`GetScoreForMinigameProcedure`) and a timer (`GetTimerForMinigameProcedure`).

Take-away for us: score **15** to escape, **30-tick** prompt cadence, **-1** for a miss, both
outcomes clear the pred's digestion data and return it to the "empty" animation.

## 3. Hungry Hana 1.12.3 — player-as-predator reference

`modId="hungryhana"`, author **Eatermeter**, *"Hana is a girl with a bottomless appetite >:)"*,
All Rights Reserved. NeoForge 21.1 / MC 1.21.1. 320 classes / 189 files. Uses **mixins**
(`EntityPushMixin`, `BatRestMixin`, `BeehiveExitMixin`, `ShulkerBoxMixin`, `ItemRendererMixin`,
`hungryhana.mixins.json`) and `META-INF/enumextensions.json`.

- Mobs: `hungryhana:hana` (pink name tag) and `hungryhana:harold` (blue tag), both `HanaEntity`,
  0.6×1.8, with a **hunt goal**; `WorldConfig.spawnWho` = 0 both / 1 women / 2 men / 3 neither.
- `MoreSpawns` adds extra animal spawns; `WildSpawner` spawns Hana in the world.

### Player-as-predator — `PlayerVore` + `PlayerVoreData`

Keybind `vore_menu`. Per-player data (NBT-serialisable, `INBTSerializable`):

```
on, digest, multi, speed, style, size (Small .8 / Normal 1.0 / Big 1.25 / Huge 1.5)
burps, voices, slow, feeds, asHana, look / lookM (appearance presets), bare, color, name (≤24)
lapse, endo, welcomed, inSetup / setupTicks
stomach[]        // one CompoundTag per swallowed prey  (multi-prey)
gulpTarget/gulpPlayer, gulpTime/gulpTicks/gulpVol/gulpStart  // swallow choreography
eatenPlayer, escape (struggle meter), digestP (digest progress), wiggle
insideTicks, held, squirmIn, voiceIn, burpIn, rush/rushTotal/rushRate/rushVol/rushLeft0
fullTalkIn, syncIn, girlTalkIn, drops, dirty, glowVol/glowTicks, nightRate, toot*
```

Derived: `capacity()`, `fullness()`, `volume()`, `bellyFront()`; `mealName()` for the last meal.

- **Gulp** (`Gulp$Plan`/`Gulp$Shape`) = the swallow animation plan; `EatAnims`, `GulpArms`.
- **Digestion**: `Digestion`, `Digested`, `DigestedOverlay`, damage type **`hungryhana:digested`**
  (used to bypass the inside-invulnerability).
- **Endo mode** (`endo`) = safe belly, no digestion (`TalkEndo`).

### Belly rendering (the valuable part for our belly work)

`client/BellyView`, `BellyWrap` (`Occupant`, `Surface`, `Imprint`, `XrayOut`, `XrayVc`),
`BellyShape`, `BellyScreen`, `PlayerBellyLayer`, `PlayerBellyScreen`, `HanaRenderer$BellyLayer`.

Config knobs that map onto what we are doing in `vcraft_pack` / the gender pack:

- **`bellyFitStyle`** — `Classic` / `Out Front` / `Hang Low`  → i.e. the *sag / out-front* concept.
- **`wobble` 0–2** → jiggle amount (`Jiggle`, `Idle`, `IdleAnims`).
- **`imprints`** — hands / feet / faces pushing out through the belly wall from inside.
- **`firstPersonBody`**, **`eyes3d`**, `blockyChest` / `rounderChest` / `blockyRear`, `gore`.
- `PreyPaths` + `FunnelBuffer` + `Drape`/`FigureMesh` = the procedurally deformed belly surface.

### Stomach interior — `Stomach`

- 21 acid colours (`ACID_NAMES`/`ACID`), including `Rainbow` which cycles hue over time
  (`acidRgbOf(acid, age)`).
- 8 acid levels: `None, A Puddle, Low, Half, High, Nearly Full, Brimming` with `acidHeight()`.
- 16 wall colours + 20 "inside" colours; `StomachPics` / `StomachTex`; screen `InsideScreen`
  (+ `InsidePayload`).

### Struggle & carry

- `client/Struggle` + `net/StrugglePayload` + `struggleGame` config = the escape meter
  (same role as our Bedrock struggle).
- `CarrySystem` + `CarryPayload` (carry a mob/player), `PushGuard` + `EntityPushMixin`.

### "Guy" — vanilla mobs re-skinned as humans

`GuyModel`, `GuyRenderer`, `GuyPainter`, `GuyTextures`, `GuyLayers` (carried block / charged /
hands / pumpkin), `GuyMoves`, `GuyHitbox`, `NpcGender`. `mobGender` = mixed / all men / all women.
This is the same *idea* as our gender pack's model swap, but far more invasive.

### Cosmetic / extra systems

- **Styles:** `StyleBook` (hair, ahoge, brow, eye, mouth, blush, makeup, mark, outfit, top/bottom,
  shoe, legwear, persona, voice, walk), `LookTextures`, `SkinPainter`, `FacePainter`, `Faces`.
- **Poses:** `PoseBook`, `PoseSet1…8`, `PoseScreen`, `PoseKeys`, `PoseLib`, `CustomPose`.
- **Studio:** `Studio*` (`StudioScreen`, `StudioTimeline`, `StudioObject`, `StudioPicker`,
  `StudioRows`, `StudioTheme`, `StudioInspector`) = a photo/scene mode; `StudioMode`, `StudioPayload`.
- **Wardrobe/presets:** `WardrobeScreen`, `PresetScreen`, `ClientPresets`, `Shots`, `PlayerLookScreen`.
- **Dialogue:** `Talk*` (~40 classes: `TalkFriends`, `TalkTame`, `TalkEndo`, `TalkIdol1-3`,
  `TalkMore2…14`, `TalkUnwilling`, `TalkToots`, …), `SpeechPayload`, `ChatBubbles`, `CallName`.
- **Night/sleep:** `NightLapse`, `NightPayload`, `NightSkipPayload`, `Dreams`, `LapseScreen`,
  `WakeScreen`, `RespawnLink`, `Recall`.
- **Races:** `RaceBook` / `RaceDefs` (ears, tails, snouts, pat) — animal-girl race variants.
- Sounds: 109 files; particles via `ModParticles` / `GasParticle`; `GasOptions` (toots/farts).

## 4. How to (re)decompile

```powershell
# Java 21 JDK on this machine
$java = 'F:\opencode\tools\jdk21\jdk-21.0.12.1+1\bin\java.exe'
& $java -jar .work\cfr.jar 'jar\<file>.jar' --outputdir .work\<name>_src
```

`java.exe` is **not** on `PATH`; other JREs present: `F:\opencode\tools\java\jdk-17.0.20.1+1-jre`,
`G:\Java\dragonwell-8.29.28`. CFR 0.152 handles both the Java 17 (1.20.1 Forge) and the Java 21
(1.21.1 NeoForge) bytecode. Decompiled output for the two reference mods is already in
`.work/vcm_src` and `.work/hana_src` and does **not** need to be regenerated.

## 5. Where each mod maps in our repo

| Mod | Already ported / used | Still open |
| --- | --- | --- |
| PCraftRevorn | creatures + predation + digestion + belly + guidebook text — see `docs/file-mapping.md`, `docs/port-checklist.md` | struggle pacing numbers from `PCraftSpecific*Configuration`; the acid-bar HUD (we approximate with the belly animation) |
| VCM | nothing (reference only) | prompt cadence + score/timer tuning for our native-input struggle |
| Hungry Hana | nothing (reference only) | belly fit styles (sag/out-front), wobble strength, imprints, acid tinting, interior screen, endo mode |
