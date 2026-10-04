# tools_py — PCraftRevorn 产出工具链（Python 版）

`tools/` 下的 Node / PowerShell 工具是**参考实现，原样保留**。
这里是等价的 **纯 Python 3.12（仅标准库）** 版本，用于在没有 Node 的环境下产出。

## 一条命令

```bat
python tools_py\pipeline.py
:: 或指定版本（会同步改写 tools/generate.js、tools_py/generate.py 与性别/VCraft 清单）
python tools_py\pipeline.py 261005-beta-1
python tools_py\pipeline.py 261005-beta-1 261005 0 1
```

流程：`set version → generate → generate_entities → nbt_to_data → build`

## 与 Node 版的对应关系

| Node (`tools/`) | Python (`tools_py/`) |
|---|---|
| `generate.js` | `generate.py` |
| `generate_entities.js` | `generate_entities.py` |
| `generate_community.js` | `generate_community.py` |
| `generate_variants.js` | `generate_variants.py` |
| `nbt_to_data.js` | `nbt_to_data.py` |
| `build.ps1` | `build.py` |
| （无） | `pipeline.py`（总控 + 版本号统一） |
| （无） | `_common.py`（共享小工具） |

## 等价性

- 逐文件与 Node 版对比：**JSON / 文本基本逐字节一致**（含 `community.js`、`structures.js`、`skins.js`、清单、语言文件）。
- 唯一差异：**程序生成的 PNG**（生成蛋、药水瓶）只有 **deflate 压缩字节**不同（像素数据完全一致）——Node 与 Python 的 zlib 实现差异，标准库无法消除；以及极少数浮点写法（如 `-0.00003` vs `-3e-05`）。
- `build.py` 产出的 `.mcpack/.mcaddon` 结构与旧版一致，总体积差 < 0.01%（同为压缩字节差异）。

## 注意

- 运行 `generate.py` 会按 `main()` 里的清理列表**重建** `behavior_pack/`、`resource_pack/` 的产出目录，请按 pipeline 顺序一次性跑完整条链。
- 依赖 `.work/mod`（原作解包）、`.work/community`、`.work/matopt_orig` 等输入，与 Node 版完全相同。
