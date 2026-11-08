#!/usr/bin/env python3
"""把 11 段 EQ 注入 node_modules 里的 react-native-track-player。

做法：替换音频渲染器（MediaCodecAudioRenderer 的 AudioProcessor 构造），
比改 AudioSink 稳——media3 1.8 的 ExoPlayer.Builder 已经没有 setAudioSink。

npm install 会冲掉 node_modules，所以每次打包前跑一遍（幂等）。
用法：python android/eqpatch/apply.py [项目根目录]
"""
import io
import os
import shutil
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'android', 'eqpatch', 'files')
JAVA = os.path.join(ROOT, 'node_modules', 'react-native-track-player', 'android', 'src', 'main', 'java')
MM = os.path.join(JAVA, 'com', 'guichaguri', 'trackplayer', 'service', 'MusicManager.java')
TP = os.path.join(JAVA, 'com', 'guichaguri', 'trackplayer', 'TrackPlayer.java')

MARK = 'MX_EQ_PATCHED'

ORIGINAL_FACTORY = '        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(service);'

EQ_FACTORY = '''        // MX_EQ_PATCHED: 自定义 RenderersFactory，音频渲染器带 11 段 EQ 处理器链
        androidx.media3.exoplayer.DefaultRenderersFactory baseRenderersFactory =
                new androidx.media3.exoplayer.DefaultRenderersFactory(service);
        androidx.media3.exoplayer.RenderersFactory renderersFactory =
                (handler, videoListener, audioListener, textOutput, metadataOutput) -> {
                    androidx.media3.exoplayer.Renderer[] renderers = baseRenderersFactory.createRenderers(
                            handler, videoListener, audioListener, textOutput, metadataOutput);
                    for (int i = 0; i < renderers.length; i++) {
                        if (renderers[i] instanceof androidx.media3.exoplayer.audio.MediaCodecAudioRenderer) {
                            renderers[i] = new androidx.media3.exoplayer.audio.MediaCodecAudioRenderer(
                                    service,
                                    androidx.media3.exoplayer.mediacodec.MediaCodecSelector.DEFAULT,
                                    handler,
                                    audioListener,
                                    androidx.media3.exoplayer.audio.AudioCapabilities.getCapabilities(service),
                                    new com.guichaguri.trackplayer.eq.EqAudioProcessor());
                        }
                    }
                    return renderers;
                };'''

# v1 的失败补丁（ExoPlayer.Builder 无 setAudioSink），需要替换掉
V1_BLOCK = '''        // MX_EQ_PATCHED: 音频处理链插入 11 段 EQ
        androidx.media3.exoplayer.audio.DefaultAudioSink audioSink =
                new androidx.media3.exoplayer.audio.DefaultAudioSink.Builder(service)
                        .setAudioProcessors(new androidx.media3.common.audio.AudioProcessor[]{
                                new com.guichaguri.trackplayer.eq.EqAudioProcessor()
                        })
                        .setEnableFloatOutput(false)
                        .build();

        ExoPlayer player = new ExoPlayer.Builder(service, renderersFactory)
                .setAudioSink(audioSink)
                .setLoadControl(control)'''

V1_FIX = '''        ExoPlayer player = new ExoPlayer.Builder(service, renderersFactory)
                .setLoadControl(control)'''


def copy_files():
    for dirpath, _, files in os.walk(SRC):
        for name in files:
            if not name.endswith('.java'):
                continue
            src = os.path.join(dirpath, name)
            rel = os.path.relpath(src, SRC)
            dst = os.path.join(JAVA, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.exists(dst):
                with io.open(src, encoding='utf-8') as a, io.open(dst, encoding='utf-8') as b:
                    if a.read() == b.read():
                        continue
            shutil.copyfile(src, dst)
            print('copied', rel)


def patch_music_manager():
    with io.open(MM, encoding='utf-8') as f:
        s = f.read()

    # 先修掉早期失败的 sink 写法（幂等）
    if V1_BLOCK in s:
        s = s.replace(V1_BLOCK, V1_FIX)
        print('removed v1 sink patch')

    if MARK in s and 'baseRenderersFactory' in s:
        with io.open(MM, 'w', encoding='utf-8', newline='') as f:
            f.write(s)
        print('MusicManager already patched')
        return

    # 关闭 audio offload：offload 会绕过 AudioProcessor
    s = s.replace(
        'boolean shouldEnableAudioOffload = options.getBoolean("audioOffload", true);',
        'boolean shouldEnableAudioOffload = false; // MX_EQ_PATCHED: offload 会绕过 EQ 处理器')

    # 初始化 EQ 状态（读 SharedPreferences）
    s = s.replace(
        '    public LocalPlayback createLocalPlayback(Bundle options) {',
        '    public LocalPlayback createLocalPlayback(Bundle options) {\n'
        '        com.guichaguri.trackplayer.eq.EqSettings.init(service); // MX_EQ_PATCHED')

    if ORIGINAL_FACTORY not in s:
        raise SystemExit('MusicManager 结构与预期不符，未找到 RenderersFactory')
    s = s.replace(ORIGINAL_FACTORY, EQ_FACTORY)

    with io.open(MM, 'w', encoding='utf-8', newline='') as f:
        f.write(s)
    print('patched MusicManager.java')


def patch_trackplayer_package():
    with io.open(TP, encoding='utf-8') as f:
        s = f.read()
    if 'EqModule' in s:
        print('TrackPlayer.java already patched')
        return
    old = 'return Collections.singletonList(new MusicModule(reactContext));'
    new = '\n'.join([
        'return java.util.Arrays.<NativeModule>asList(',
        '                new MusicModule(reactContext),',
        '                new com.guichaguri.trackplayer.eq.EqModule(reactContext) // MX_EQ_PATCHED',
        '        );',
    ])
    if old not in s:
        raise SystemExit('TrackPlayer.java 结构不符，未找到 createNativeModules')
    s = s.replace(old, new)
    with io.open(TP, 'w', encoding='utf-8', newline='') as f:
        f.write(s)
    print('patched TrackPlayer.java')


def main():
    if not os.path.isdir(JAVA):
        raise SystemExit('找不到 react-native-track-player，先 npm install')
    copy_files()
    patch_music_manager()
    patch_trackplayer_package()


if __name__ == '__main__':
    main()
