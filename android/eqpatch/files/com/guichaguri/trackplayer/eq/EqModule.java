package com.guichaguri.trackplayer.eq;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

/**
 * 11 段 EQ 的 JS 接口（模块名 MxEq）。
 * 真正的音频处理在 EqAudioProcessor 里，这里只读写全局状态（SharedPreferences 持久化）。
 */
public class EqModule extends ReactContextBaseJavaModule {
  public static final String NAME = "MxEq";

  public EqModule(ReactApplicationContext reactContext) {
    super(reactContext);
    EqSettings.init(reactContext);
  }

  @Override
  public String getName() {
    return NAME;
  }

  @ReactMethod
  public void getState(Promise promise) {
    try {
      WritableMap map = Arguments.createMap();
      map.putBoolean("enabled", EqSettings.isEnabled());
      map.putDouble("preamp", EqSettings.getPreamp());
      map.putDouble("processedFrames", EqSettings.getProcessedFrames());
      WritableArray gains = Arguments.createArray();
      for (float g : EqSettings.getGains()) gains.pushDouble(g);
      map.putArray("gains", gains);
      WritableArray freqs = Arguments.createArray();
      for (float f : EqSettings.FREQS) freqs.pushDouble(f);
      map.putArray("freqs", freqs);
      promise.resolve(map);
    } catch (Exception e) {
      promise.reject("eq_state_failed", e);
    }
  }

  @ReactMethod
  public void setEnabled(boolean enabled, Promise promise) {
    EqSettings.setEnabled(enabled);
    promise.resolve(true);
  }

  @ReactMethod
  public void setGain(int band, double db, Promise promise) {
    EqSettings.setGain(band, (float) db);
    promise.resolve(true);
  }

  @ReactMethod
  public void setPreamp(double db, Promise promise) {
    EqSettings.setPreamp((float) db);
    promise.resolve(true);
  }

  /** 一次性下发全部参数（恢复预设/重置时用） */
  @ReactMethod
  public void setAll(ReadableArray gains, boolean enabled, double preamp, Promise promise) {
    float[] values = new float[EqSettings.BANDS];
    if (gains != null) {
      for (int i = 0; i < gains.size() && i < values.length; i++) {
        values[i] = (float) gains.getDouble(i);
      }
    }
    EqSettings.setAll(values, enabled, (float) preamp);
    promise.resolve(true);
  }

  @ReactMethod
  public void reset(Promise promise) {
    EqSettings.reset();
    promise.resolve(true);
  }
}
