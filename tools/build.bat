@echo off
rem 纯构建：不改版本号，只 assembleRelease
rem 需要环境变量：JAVA_HOME(JDK17/21)、ANDROID_HOME(或 ANDROID_SDK_ROOT)
setlocal

if "%JAVA_HOME%"=="" (
  echo 错误：请先设置 JAVA_HOME 指向 JDK 17 或 21
  exit /b 1
)

if "%ANDROID_HOME%"=="" (
  if "%ANDROID_SDK_ROOT%"=="" (
    echo 错误：请设置 ANDROID_HOME 指向 Android SDK
    exit /b 1
  ) else (
    set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
  )
)

set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"
set "ROOT=%~dp0.."

echo JAVA_HOME    = %JAVA_HOME%
echo ANDROID_HOME = %ANDROID_HOME%

pushd "%ROOT%\android"
call gradlew.bat assembleRelease --no-daemon
set RC=%ERRORLEVEL%
popd

echo.
echo 产物目录：%ROOT%\android\app\build\outputs\apk\release\
if exist "%ROOT%\android\app\build\outputs\apk\release\*.apk" dir /b "%ROOT%\android\app\build\outputs\apk\release\*.apk"

echo BUILD_EXIT=%RC%
exit /b %RC%
