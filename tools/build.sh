#!/usr/bin/env bash
# 纯构建：不改版本号，只 assembleRelease
# 需要环境变量：JAVA_HOME(JDK17/21)、ANDROID_HOME(或 ANDROID_SDK_ROOT)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "${JAVA_HOME:-}" ]; then
  echo "错误：请先设置 JAVA_HOME 指向 JDK 17 或 21" >&2
  exit 1
fi

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ]; then
  echo "错误：请设置 ANDROID_HOME（Android SDK 路径）" >&2
  exit 1
fi

echo "JAVA_HOME   = $JAVA_HOME"
echo "ANDROID_HOME= $SDK"

cd "$ROOT/android"
./gradlew assembleRelease --no-daemon

echo
echo "产物目录：$ROOT/android/app/build/outputs/apk/release/"
ls -1 "$ROOT/android/app/build/outputs/apk/release/"*.apk 2>/dev/null || true
