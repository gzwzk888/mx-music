package com.guichaguri.trackplayer.eq;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * EQ 全局状态（供音频线程与 RN 模块共享）
 * 增益单位 dB，预增益单位 dB。任何修改都会 bump version，
 * 音频线程检测到 version 变化后重建滤波器系数。
 */
public final class EqSettings {
  public static final int BANDS = 11;
  public static final float[] FREQS = {
      31.5f, 63f, 125f, 250f, 500f, 1000f, 2000f, 4000f, 8000f, 16000f, 32000f
  };

  private static final float MIN_GAIN = -12f;
  private static final float MAX_GAIN = 12f;

  private static final float[] gains = new float[BANDS];
  private static boolean enabled = false;
  private static float preamp = 0f;
  private static volatile int version = 0;
  private static SharedPreferences prefs = null;
  private static volatile long processedFrames = 0L;

  private EqSettings() {}

  public static synchronized void init(Context context) {
    if (prefs != null) return;
    prefs = context.getApplicationContext().getSharedPreferences("mx_eq", Context.MODE_PRIVATE);
    enabled = prefs.getBoolean("enabled", false);
    preamp = prefs.getFloat("preamp", 0f);
    for (int i = 0; i < BANDS; i++) gains[i] = prefs.getFloat("g" + i, 0f);
    version++;
  }

  public static boolean isEnabled() { return enabled; }

  public static synchronized void setEnabled(boolean value) {
    enabled = value;
    version++;
    if (prefs != null) prefs.edit().putBoolean("enabled", value).apply();
  }

  public static float getPreamp() { return preamp; }

  public static synchronized void setPreamp(float db) {
    preamp = clamp(db, MIN_GAIN, MAX_GAIN);
    version++;
    if (prefs != null) prefs.edit().putFloat("preamp", preamp).apply();
  }

  public static synchronized float[] getGains() {
    float[] copy = new float[BANDS];
    System.arraycopy(gains, 0, copy, 0, BANDS);
    return copy;
  }

  public static synchronized void setGain(int band, float db) {
    if (band < 0 || band >= BANDS) return;
    gains[band] = clamp(db, MIN_GAIN, MAX_GAIN);
    version++;
    if (prefs != null) prefs.edit().putFloat("g" + band, gains[band]).apply();
  }

  public static synchronized void setAll(float[] values, boolean enabledValue, float preampValue) {
    if (values != null) {
      for (int i = 0; i < BANDS && i < values.length; i++) gains[i] = clamp(values[i], MIN_GAIN, MAX_GAIN);
    }
    enabled = enabledValue;
    preamp = clamp(preampValue, MIN_GAIN, MAX_GAIN);
    version++;
    if (prefs != null) {
      SharedPreferences.Editor e = prefs.edit();
      e.putBoolean("enabled", enabled);
      e.putFloat("preamp", preamp);
      for (int i = 0; i < BANDS; i++) e.putFloat("g" + i, gains[i]);
      e.apply();
    }
  }

  public static synchronized void reset() {
    for (int i = 0; i < BANDS; i++) gains[i] = 0f;
    preamp = 0f;
    version++;
    if (prefs != null) {
      SharedPreferences.Editor e = prefs.edit();
      e.putFloat("preamp", 0f);
      for (int i = 0; i < BANDS; i++) e.putFloat("g" + i, 0f);
      e.commit();
    }
  }

  public static int getVersion() { return version; }

  /** 已处理（真正过 EQ 的）PCM 帧数，用来验证处理链确实在跑 */
  public static void addProcessedFrames(long frames) { processedFrames += frames; }

  public static long getProcessedFrames() { return processedFrames; }

  private static float clamp(float v, float lo, float hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }
}
