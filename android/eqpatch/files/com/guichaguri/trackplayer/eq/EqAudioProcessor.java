package com.guichaguri.trackplayer.eq;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;

/**
 * 11 段图示均衡器（PCM16 处理）
 * 挂在 ExoPlayer 的 DefaultAudioSink 处理器链上，所有音源（本机/NAS）都经过这里。
 */
public class EqAudioProcessor extends BaseAudioProcessor {
  private static final float Q = 1.1f;

  private BiquadFilter[][] filters = new BiquadFilter[0][];
  private float[] preampLinear = new float[0];
  private int sampleRate = 0;
  private int channelCount = 0;
  private int appliedVersion = -1;

  @Override
  protected AudioFormat onConfigure(AudioFormat inputAudioFormat)
      throws UnhandledAudioFormatException {
    if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT) {
      throw new UnhandledAudioFormatException(inputAudioFormat);
    }
    sampleRate = inputAudioFormat.sampleRate;
    channelCount = inputAudioFormat.channelCount;
    rebuild(true);
    return inputAudioFormat;
  }

  /** 始终参与处理链，关闭时直接透传，避免运行中启用/关闭需要重建播放器 */
  @Override
  public boolean isActive() {
    return true;
  }

  @Override
  protected void onFlush() {
    rebuild(true);
  }

  @Override
  protected void onReset() {
    filters = new BiquadFilter[0][];
    appliedVersion = -1;
  }

  private void rebuild(boolean resetState) {
    if (sampleRate <= 0 || channelCount <= 0) return;
    float[] gains = EqSettings.getGains();
    float pre = EqSettings.getPreamp();
    filters = new BiquadFilter[channelCount][EqSettings.BANDS];
    preampLinear = new float[EqSettings.BANDS];
    for (int c = 0; c < channelCount; c++) {
      for (int b = 0; b < EqSettings.BANDS; b++) {
        BiquadFilter f = new BiquadFilter();
        f.setPeaking(sampleRate, EqSettings.FREQS[b], Q, gains[b]);
        if (resetState) f.reset();
        filters[c][b] = f;
      }
    }
    preampLinear[0] = (float) Math.pow(10.0, pre / 20.0);
    appliedVersion = EqSettings.getVersion();
  }

  @Override
  public void queueInput(ByteBuffer inputBuffer) {
    int size = inputBuffer.remaining();
    int frameSize = 2 * Math.max(channelCount, 1);
    if (size <= 0) return;

    if (!EqSettings.isEnabled() || sampleRate <= 0 || filters.length == 0) {
      // 透传
      ByteBuffer out = replaceOutputBuffer(size);
      out.put(inputBuffer);
      out.flip();
      return;
    }
    if (appliedVersion != EqSettings.getVersion()) rebuild(false);

    size -= size % frameSize; // 只处理完整帧
    if (size <= 0) {
      inputBuffer.position(inputBuffer.limit());
      return;
    }

    ByteBuffer out = replaceOutputBuffer(size);
    out.order(ByteOrder.nativeOrder());
    ShortBuffer inS = inputBuffer.order(ByteOrder.nativeOrder()).asShortBuffer();
    ShortBuffer outS = out.asShortBuffer();
    float pre = preampLinear[0];
    int frames = size / frameSize;

    for (int i = 0; i < frames; i++) {
      for (int c = 0; c < channelCount; c++) {
        float s = inS.get() / 32768f;
        BiquadFilter[] chain = filters[c];
        for (int b = 0; b < chain.length; b++) s = chain[b].process(s);
        s *= pre;
        if (s > 1f) s = 1f;
        else if (s < -1f) s = -1f;
        outS.put((short) (s * 32767f));
      }
    }
    EqSettings.addProcessedFrames(frames);
    out.position(outS.position() * 2);
    out.flip();
    inputBuffer.position(inputBuffer.limit());
  }
}
