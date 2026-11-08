package com.guichaguri.trackplayer.eq;

/** RBJ peaking EQ 二阶滤波（双线性变换，direct form I） */
final class BiquadFilter {
  private float b0 = 1f, b1 = 0f, b2 = 0f, a1 = 0f, a2 = 0f;
  private float x1 = 0f, x2 = 0f, y1 = 0f, y2 = 0f;

  void reset() {
    x1 = x2 = y1 = y2 = 0f;
  }

  /** 频点超出奈奎斯特时自动旁路 */
  void setPeaking(float sampleRate, float freq, float q, float gainDb) {
    if (sampleRate <= 0 || freq <= 0 || freq >= sampleRate * 0.48f) {
      b0 = 1f; b1 = 0f; b2 = 0f; a1 = 0f; a2 = 0f;
      return;
    }
    float A = (float) Math.pow(10.0, gainDb / 40.0);
    float w0 = (float) (2.0 * Math.PI * freq / sampleRate);
    float cosw = (float) Math.cos(w0);
    float alpha = (float) (Math.sin(w0) / (2.0 * q));
    float a0 = 1f + alpha / A;

    b0 = (1f + alpha * A) / a0;
    b1 = (-2f * cosw) / a0;
    b2 = (1f - alpha * A) / a0;
    a1 = (-2f * cosw) / a0;
    a2 = (1f - alpha / A) / a0;
  }

  float process(float x) {
    float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    return y;
  }
}
