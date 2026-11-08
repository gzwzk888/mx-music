package cn.toside.music.mobile.smb;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

import jcifs.CIFSContext;
import jcifs.config.PropertyConfiguration;
import jcifs.context.BaseContext;
import jcifs.smb.NtlmPasswordAuthenticator;
import jcifs.smb.SmbFile;

public class SmbModule extends ReactContextBaseJavaModule {

  public SmbModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "SmbModule";
  }

  private CIFSContext buildContext(String domain, String user, String pass, boolean smb2, boolean onlySmb2) throws Exception {
    Properties props = new Properties();
    props.setProperty("jcifs.smb.client.enableSMB2", smb2 ? "true" : "false");
    props.setProperty("jcifs.smb.client.disableSMB1", onlySmb2 ? "true" : "false");
    props.setProperty("jcifs.smb.client.responseTimeout", "15000");
    props.setProperty("jcifs.smb.client.soTimeout", "15000");
    props.setProperty("jcifs.smb.client.connTimeout", "15000");
    // 关闭签名要求带来的握手问题（服务端要求签名时仍会协商）
    props.setProperty("jcifs.smb.client.signingPreferred", "true");
    CIFSContext base = new BaseContext(new PropertyConfiguration(props));
    return base.withCredentials(new NtlmPasswordAuthenticator(domain == null ? "" : domain, user, pass));
  }

  /**
   * 把 probe 返回的 mode 名字还原成连接参数（域 / 是否 SMB2 / 是否禁用 SMB1）。
   * probe 用的七种组合，这里必须一一对应，否则会出现「验证通过但列不出目录」。
   */
  // 连接上下文缓存：同一个账号/模式只建一次会话，列目录时复用（SMB 建连很贵）
  private static final java.util.Map<String, CIFSContext> CTX_CACHE = new java.util.HashMap<>();

  private synchronized CIFSContext cachedCtx(String host, String user, String pass, String mode) throws Exception {
    String key = host + "|" + user + "|" + mode + "|" + Integer.toHexString(String.valueOf(pass).hashCode());
    CIFSContext hit = CTX_CACHE.get(key);
    if (hit != null) return hit;
    CIFSContext ctx = ctxFor(host, user, pass, mode);
    CTX_CACHE.put(key, ctx);
    return ctx;
  }

  /** 验证失败/换账号时清掉缓存 */
  @ReactMethod
  public void resetCache(Promise promise) {
    synchronized (SmbModule.class) {
      CTX_CACHE.clear();
    }
    promise.resolve(true);
  }

  private String[] modeToConfig(String mode, String host) {
    String m = mode == null ? "SMB2" : mode;
    if (m.startsWith("SMB1")) {
      // SMB1 / SMB1+WORKGROUP：允许 SMB1 协商
      String dom = m.contains("+") ? m.substring(m.indexOf('+') + 1) : "";
      return new String[]{ dom, "false", "false" };
    }
    if (m.equals("SMB2")) return new String[]{ "", "true", "false" };
    if (m.equals("SMB2-only")) return new String[]{ "", "true", "true" };
    if (m.startsWith("SMB2+")) {
      String d = m.substring(5);
      if ("hostAsDomain".equals(d)) d = host;
      return new String[]{ d, "true", "true" };
    }
    return new String[]{ "", "true", "false" };
  }

  private CIFSContext ctxFor(String host, String user, String pass, String mode) throws Exception {
    String[] c = modeToConfig(mode, host);
    return buildContext(c[0], user, pass, Boolean.parseBoolean(c[1]), Boolean.parseBoolean(c[2]));
  }

  private String buildUrl(String host, String share, String path) {
    String p = path == null ? "" : path.trim();
    if (p.startsWith("/")) p = p.substring(1);
    StringBuilder sb = new StringBuilder("smb://").append(host).append("/").append(share).append("/");
    if (!p.isEmpty()) sb.append(p);
    return sb.toString();
  }

  /** 列出目录名 */
  @ReactMethod
  public void list(String host, String share, String path, String user, String pass, String mode, Promise promise) {
    try {
      CIFSContext ctx = cachedCtx(host, user, pass, mode);
      String url = buildUrl(host, share, path);
      if (!url.endsWith("/")) url = url + "/";
      SmbFile dir = new SmbFile(url, ctx);
      WritableArray out = Arguments.createArray();
      for (SmbFile f : dir.listFiles()) {
        String name = f.getName();
        if (name.endsWith("/")) name = name.substring(0, name.length() - 1);
        if (name.isEmpty()) continue;
        WritableMap item = Arguments.createMap();
        item.putString("name", name);
        item.putBoolean("dir", f.isDirectory());
        item.putDouble("size", f.isDirectory() ? 0 : f.length());
        out.pushMap(item);
      }
      promise.resolve(out);
    } catch (Exception e) {
      promise.reject("smb_list_failed", e.getClass().getSimpleName() + ": " + e.getMessage(), e);
    }
  }

  /**
   * 连接自检：按 SMB2 → SMB2-only → SMB1，以及 workgroup 域，逐个尝试，返回第一组成功的配置。
   * 全失败时返回每一项的错误，便于定位（协议不支持 / 账号错 / 共享名错）。
   */
  @ReactMethod
  public void probe(String host, String share, String user, String pass, Promise promise) {
    String[][] modes = {
        {"SMB2", "true", "false", ""},
        {"SMB2-only", "true", "true", ""},
        {"SMB2+WORKGROUP", "true", "true", "WORKGROUP"},
        {"SMB2+hostAsDomain", "true", "true", host},
        {"SMB2+NASWUGE", "true", "true", "NASWUGE"},
        {"SMB1", "false", "true", ""},
        {"SMB1+WORKGROUP", "false", "true", "WORKGROUP"},
    };
    WritableArray errors = Arguments.createArray();

    for (String[] m : modes) {
      try {
        CIFSContext ctx = buildContext(m[3], user, pass, Boolean.parseBoolean(m[1]), Boolean.parseBoolean(m[2]));
        String url = buildUrl(host, share, "");
        SmbFile dir = new SmbFile(url, ctx);
        SmbFile[] files = dir.listFiles();
        WritableMap ok = Arguments.createMap();
        ok.putBoolean("ok", true);
        ok.putString("mode", m[0]);
        ok.putInt("count", files.length);
        promise.resolve(ok);
        return;
      } catch (Exception e) {
        WritableMap err = Arguments.createMap();
        err.putString("mode", m[0]);
        err.putString("error", e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage()));
        errors.pushMap(err);
      }
    }

    WritableMap fail = Arguments.createMap();
    fail.putBoolean("ok", false);
    fail.putArray("errors", errors);
    promise.resolve(fail);
  }

  /** 读文本文件（cue 多为 GBK/GB18030） */
  @ReactMethod
  public void readText(String host, String share, String path, String user, String pass, String mode, Promise promise) {
    try {
      CIFSContext ctx = cachedCtx(host, user, pass, mode);
      SmbFile file = new SmbFile(buildUrl(host, share, path), ctx);
      if (!file.exists()) {
        promise.reject("smb_not_found", "文件不存在");
        return;
      }
      InputStream in = file.getInputStream();
      ByteArrayOutputStream bos = new ByteArrayOutputStream();
      byte[] buf = new byte[8192];
      int n;
      while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
      in.close();
      byte[] data = bos.toByteArray();

      String text;
      try {
        java.nio.charset.CharsetDecoder dec = java.nio.charset.StandardCharsets.UTF_8.newDecoder();
        dec.onMalformedInput(java.nio.charset.CodingErrorAction.REPORT);
        dec.onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT);
        text = dec.decode(java.nio.ByteBuffer.wrap(data)).toString();
      } catch (Exception ignore) {
        text = new String(data, java.nio.charset.Charset.forName("GB18030"));
      }
      promise.resolve(text);
    } catch (Exception e) {
      promise.reject("smb_read_failed", e.getClass().getSimpleName() + ": " + e.getMessage(), e);
    }
  }
}
