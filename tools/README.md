# tools

构建、发布与图标生成脚本。**所有路径都从仓库根推导**，换机器不用改常量。

| 脚本 | 作用 |
|---|---|
| `build.sh` / `build.bat` | 纯构建（`assembleRelease`），不改版本号。需 `JAVA_HOME` + `ANDROID_HOME` |
| `pack_mx.py` | **一键发布**：versionCode+1 → 同步 `MX_BUILD` → 构建 → 投放到 `dist/` → 只删紧邻上一版 |
| `gen_icon_final.py` | 生成应用图标（512 / 1024 母版 + 尺寸预览），输出到 `assets/` |
| `gen_mx_assets.py` | **把图标写进 App**（`android/app/src/main/res/`、`src/resources/images/`） |
| `gen_icon_mipmaps.py` | 按尺寸分级渲染图标的预览（不写 App） |
| `gen_seal_yin.py` | ~~生成关于页「印」章~~ **已停用**，当前印章为篆书「吴」，直接替换图片 |

## 发布

```bash
python tools/pack_mx.py            # 正常发布（版本号 +1）
python tools/pack_mx.py --dry      # 只看会改什么
python tools/pack_mx.py --no-bump  # 只重打包，不动版本号
```

投放目录默认 `<仓库根>/dist`，可用环境变量 `MX_DIST` 指定（多个用 `;` 分隔）。

## 图标调参

细纹参数在 `gen_icon_final.py`、`gen_mx_assets.py`、`gen_icon_mipmaps.py` 三个文件里
必须保持一致：

```python
GROOVE_MIN = 60      # 最外圈最小 alpha
GROOVE_MAX = 125     # 最外圈最大 alpha
GROOVE_W   = 0.0042  # 线宽 × 画布
```

出对比稿（临时后缀，不覆盖正式图）：

```bash
GROOVE_MIN=80 GROOVE_MAX=165 GROOVE_W=0.0052 OUT_SUFFIX=_v2 python tools/gen_icon_final.py
```

**改完必须跑 `gen_mx_assets.py`** —— `gen_icon_final.py` 只出图片文件，
`gen_mx_assets.py` 才是写进 `res/` 的那一步。

## 印章

关于页署名的印章是 `src/resources/images/seal_yin.png`：**篆书「吴」白文**，384×384，38dp，-4°。
基准图为 `assets/seal_yin_master.png`，改动后应与其像素一致。
文件名沿用 `seal_yin`（印）但内容是「吴」——看内容，别看名字。
换成自己的字：改脚本顶部的 `GLYPH` 后重跑，再把输出的 `seal_yin_384.png`
复制到 `src/resources/images/`。
