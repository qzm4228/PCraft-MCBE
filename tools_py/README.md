# tools_py — PCraftRevorn 产出工具链（Python 版）

`tools/` 下的 Node / PowerShell 工具是**参考实现，原样保留**。
这里是等价的 **纯 Python 3.12（仅标准库）** 版本，用于在没有 Node 的环境下产出。

## 一条命令

```bat
python tools_py\pipeline.py
:: 或换版本（只写 config/version.json，其余全部读它）
python tools_py\pipeline.py 10.18.0
```

**版本号只写在 `config/version.json`**（`{ "version": "10.17.1" }`）：生成器读标签 +
整数三元组（`[10,17,1]`），`build_config.py` / `build.js` 把它写进每个 manifest 和
`PCraftRevorn_<版本>_<目标>.mcaddon` 文件名。`config/packs.json` 里没有版本字段，
生成器里也没有硬编码版本。

流程：`generate → generate_entities → nbt_to_data → build`

## 与 Node 版的对应关系

| Node (`tools/`) | Python (`tools_py/`) |
|---|---|
| `generate.js` | `generate.py` |
| `generate_entities.js` | `generate_entities.py` |
| `generate_community.js` | `generate_community.py` |
| `generate_variants.js` | `generate_variants.py` |
| `nbt_to_data.js` | `nbt_to_data.py` |
| `build.ps1` | `build.py` |
| `build.js` | `build_config.py` |
| `dist_resolver.js` | `dist_resolver.py` |
| （无） | `pipeline.py`（总控） |
| （无） | `_common.py`（共享小工具） |
| （无） | `check_dist.py` / `test_dist.py`（一致性校验/单测） |

## 多版本产出（dist.json）

工程里每个目录都可以放一个 `dist.json`，描述该目录下**哪些文件在打包时按目标版本替换**：

```json
{
  "menu.json": {
    "1.21.80.x": true,                   // 值省略 -> 读同目录的 menu.json.1.21.80.x
    "<=1.21.100": "menu.old.json",        // 区间键
    "1.26.x": "menu.new.json"             // 通配键
  },
  "sub/thing.json": { "1.26.x": true }
}
```

规则：

- 键是**输出文件名**（相对本目录）；值是**变体源文件**（相对本目录），写成 `true` 时默认取 `<输出名>.<版本键>`。
- 没出现在任何 `dist.json` 里的文件 → 原样产出（通用版）。
- 命中了版本键 → 用变体内容、**以原文件名**写出；**没命中 → 用原文件本身兜底**（该文件必须存在）。
- 作为变体源出现的文件**不会单独打包**；`dist.json` 自身不打包。
- 版本键两种写法都支持：
  - **序列/通配**：`1.21.100.x`、`1.26.x`（`x` 任意；末尾 `x` 可省；字面前缀越长越优先）。
  - **区间**：`<=1.21.100`、`>=1.21.60`、`<1.26.0`、`>1.21.80`。
  - 多个命中时：序列键（按字面段数）优先于区间键，再按数值从高到低。

目标清单在 `config/targets.json`（`min_engine_version` + `@minecraft/server(-ui)` 版本）。打包后每个目标一套产物，平铺带后缀：

```
dist/VCraft_RP_1.21.100.mcpack
dist/PCraftRevorn_<version>_1.21.100.mcaddon
```

```bat
python tools_py\build_config.py                    :: 全部目标
python tools_py\build_config.py --target 1.26.0    :: 单个目标（可重复）
python tools_py\build_config.py --list             :: 只看目标 + 每个文件命中的变体
node tools\build.js --target 1.26.0                :: Node 版等价命令
python tools_py\check_dist.py                      :: 校验两套工具产出逐条目一致
python tools_py\test_dist.py                        :: dist.json 解析单测
```


## 等价性

- 逐文件与 Node 版对比：**JSON / 文本基本逐字节一致**（含 `community.js`、`structures.js`、`skins.js`、清单、语言文件）。
- 唯一差异：**程序生成的 PNG**（生成蛋、药水瓶）只有 **deflate 压缩字节**不同（像素数据完全一致）——Node 与 Python 的 zlib 实现差异，标准库无法消除；以及极少数浮点写法（如 `-0.00003` vs `-3e-05`）。
- `build.py` 产出的 `.mcpack/.mcaddon` 结构与旧版一致，总体积差 < 0.01%（同为压缩字节差异）。

## 注意

- 运行 `generate.py` 会按 `main()` 里的清理列表**重建** `behavior_pack/`、`resource_pack/` 的产出目录，请按 pipeline 顺序一次性跑完整条链。
- 依赖 `.work/mod`（原作解包）、`.work/community`、`.work/matopt_orig` 等输入，与 Node 版完全相同。
