"""MX Music 发布脚本：versionCode+1 → 同步 MX_BUILD → 构建 → 投放 → 删旧包

用法（在仓库根或 tools/ 下都可以）：
    python tools/pack_mx.py            # 正常发布（版本号 +1）
    python tools/pack_mx.py --dry      # 只预览会改什么
    python tools/pack_mx.py --no-bump  # 只重打包，不动版本号

约定：
  - 仓库根 = 本脚本所在目录的上一级
  - 投放目录：环境变量 MX_DIST（可用 ; 或 : 分隔多个），默认 <仓库根>/dist
"""
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, 'package.json')
CONST = os.path.join(ROOT, 'src', 'config', 'constant.ts')
APK = os.path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release',
                   'mx-music-v1.0-arm64-v8a.apk')

BUILD_CMD = [os.path.join(ROOT, 'tools', 'build.bat')] if os.name == 'nt' \
    else ['bash', os.path.join(ROOT, 'tools', 'build.sh')]

DISTS = [d for d in (os.environ.get('MX_DIST') or '').replace(';', ':').split(':') if d.strip()] \
    or [os.path.join(ROOT, 'dist')]

dry = '--dry' in sys.argv
nobump = '--no-bump' in sys.argv


def read(p):
    with open(p, encoding='utf-8', newline='') as f:
        return f.read()


def write(p, s):
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


# 1) versionCode（--no-bump 时保持不动）
pkg = read(PKG)
const = read(CONST)
m = re.search(r'"versionCode":\s*(\d+)', pkg)
if not m:
    sys.exit('package.json 里找不到 versionCode')

if nobump:
    ver = int(m.group(1))
    tag = re.search(r"export const MX_BUILD = '(b\d+)'", const).group(1)
    print(f'versionCode : {ver}（不递增）')
    print(f'MX_BUILD    : {tag}（不变）')
    ready_pkg, c2 = pkg, const
else:
    old_code = int(m.group(1))
    ver = old_code + 1
    tag = f'b{ver}'
    print(f'versionCode : {old_code} -> {ver}')

    c2, hit = re.subn(r"export const MX_BUILD = 'b\d+'", f"export const MX_BUILD = '{tag}'", const)
    if not hit:
        sys.exit("constant.ts 里找不到 MX_BUILD = 'bNNN'")
    old_build = re.search(r"export const MX_BUILD = '(b\d+)'", const).group(1)
    print(f'MX_BUILD    : {old_build} -> {tag}')
    ready_pkg = pkg[:m.start(1)] + str(ver) + pkg[m.end(1):]

if dry:
    print('[dry] 不做任何写入 / 构建')
    sys.exit(0)

write(PKG, ready_pkg)
write(CONST, c2)

# 3) 构建
print('\n=== 开始构建（首次约 5 分钟，增量约 1 分钟）===')
r = subprocess.run(BUILD_CMD, capture_output=True, text=True, errors='replace')
out = (r.stdout or '') + (r.stderr or '')
print('\n'.join(out.strip().splitlines()[-8:]))
if r.returncode != 0 or 'BUILD SUCCESSFUL' not in out:
    sys.exit('构建失败，未投放。请检查上面的输出。')

if not os.path.exists(APK):
    sys.exit(f'找不到产物：{APK}')

# 4) 投放 + 删旧
name = f'MX_Music_v1.0_{tag}.apk'
for d in DISTS:
    d = d.strip()
    os.makedirs(d, exist_ok=True)
    dst = os.path.join(d, name)
    shutil.copy2(APK, dst)
    print(f'投放: {dst}  ({os.path.getsize(dst):,} 字节)')
    # 只删「紧邻上一版」；不 glob 全删——早期版本曾把手动保存的旧包一起删掉
    if not nobump:
        prev = os.path.join(d, f'MX_Music_v1.0_b{ver - 1}.apk')
        if os.path.exists(prev) and os.path.basename(prev) != name:
            os.remove(prev)
            print(f'删旧: {prev}')

print(f'\n完成：{tag}  versionCode={new_code}003 (arm64-v8a)')
