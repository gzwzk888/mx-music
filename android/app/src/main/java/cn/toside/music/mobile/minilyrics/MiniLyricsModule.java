package cn.toside.music.mobile.minilyrics;

import android.util.Base64;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * MiniLyrics 歌词搜索的二进制 POST 通道
 *
 * RN 的 fetch/XHR 发二进制体在部分机型/版本上会直接报 network error，
 * 这里用 HttpURLConnection 老老实实发一次字节流：入参 base64，出参 base64。
 */
public class MiniLyricsModule extends ReactContextBaseJavaModule {

  public MiniLyricsModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "MiniLyrics";
  }

  @ReactMethod
  public void post(String url, String bodyBase64, Promise promise) {
    HttpURLConnection conn = null;
    try {
      byte[] body = Base64.decode(bodyBase64, Base64.DEFAULT);
      conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setRequestMethod("POST");
      conn.setConnectTimeout(15000);
      conn.setReadTimeout(20000);
      conn.setDoOutput(true);
      conn.setRequestProperty("Content-Type", "application/octet-stream");
      conn.setFixedLengthStreamingMode(body.length);
      try (OutputStream os = conn.getOutputStream()) {
        os.write(body);
        os.flush();
      }
      int code = conn.getResponseCode();
      InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
      byte[] resp = readAll(is);
      if (code >= 200 && code < 300) {
        promise.resolve(Base64.encodeToString(resp, Base64.NO_WRAP));
      } else {
        promise.reject("HTTP_" + code, "HTTP " + code);
      }
    } catch (Exception e) {
      promise.reject("E_ML", String.valueOf(e.getMessage()), e);
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  @ReactMethod
  public void get(String url, Promise promise) {
    HttpURLConnection conn = null;
    try {
      conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setRequestMethod("GET");
      conn.setConnectTimeout(15000);
      conn.setReadTimeout(20000);
      int code = conn.getResponseCode();
      InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
      byte[] resp = readAll(is);
      if (code >= 200 && code < 300) {
        promise.resolve(Base64.encodeToString(resp, Base64.NO_WRAP));
      } else {
        promise.reject("HTTP_" + code, "HTTP " + code);
      }
    } catch (Exception e) {
      promise.reject("E_ML", String.valueOf(e.getMessage()), e);
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  private static byte[] readAll(InputStream is) throws Exception {
    if (is == null) return new byte[0];
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    byte[] buf = new byte[8192];
    int n;
    while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
    is.close();
    return bos.toByteArray();
  }
}
