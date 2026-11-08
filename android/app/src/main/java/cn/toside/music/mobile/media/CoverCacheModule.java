package cn.toside.music.mobile.media;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.util.Log;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 封面缩略图缓存：
 *  - 逐张读取音频内嵌封面 → SHA-1 作为键 → 缩到 512px JPEG(q85) 落盘
 *  - 同一个哈希只存一份（跨专辑、跨目录都去重）
 *  - 目录可配：App 私有 / 外部 Android/data / 用户自选目录（SAF，可指向 TF 卡）
 */
public class CoverCacheModule extends ReactContextBaseJavaModule implements ActivityEventListener {

  private static final String TAG = "CoverCache";
  private static final String PREF = "mx_cover_cache";
  private static final String KEY_DIR = "dir_kind";
  private static final String KEY_URI = "dir_uri";
  private static final int REQ_PICK_DIR = 47021;

  private Promise pickPromise;

  public CoverCacheModule(ReactApplicationContext ctx) {
    super(ctx);
    ctx.addActivityEventListener(this);
  }

  @Override
  public String getName() {
    return "CoverCache";
  }

  /* ------------------------------ 目录配置 ------------------------------ */

  private SharedPreferences prefs() {
    return getReactApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
  }

  private String dirKind() {
    return prefs().getString(KEY_DIR, "private");
  }

  private Uri safUri() {
    String s = prefs().getString(KEY_URI, null);
    return s == null ? null : Uri.parse(s);
  }

  private ContentResolver cr() {
    return getReactApplicationContext().getContentResolver();
  }

  private File privateDir() {
    File d = new File(getReactApplicationContext().getFilesDir(), "covers");
    if (!d.exists()) d.mkdirs();
    return d;
  }

  private File externalDir() {
    File base = getReactApplicationContext().getExternalFilesDir(null);
    if (base == null) return privateDir();
    File d = new File(base, "covers");
    if (!d.exists()) d.mkdirs();
    return d;
  }

  private String currentDirLabel() {
    switch (dirKind()) {
      case "external":
        return externalDir().getAbsolutePath();
      case "saf":
        Uri u = safUri();
        return u == null ? privateDir().getAbsolutePath() : u.toString();
      default:
        return privateDir().getAbsolutePath();
    }
  }

  @ReactMethod
  public void getDir(Promise promise) {
    WritableMap m = Arguments.createMap();
    m.putString("kind", dirKind());
    m.putString("dir", currentDirLabel());
    promise.resolve(m);
  }

  @ReactMethod
  public void setDir(String kind, String uri, Promise promise) {
    try {
      if ("saf".equals(kind) && uri != null && !uri.isEmpty()) {
        prefs().edit().putString(KEY_DIR, "saf").putString(KEY_URI, uri).apply();
      } else if ("external".equals(kind)) {
        prefs().edit().putString(KEY_DIR, "external").remove(KEY_URI).apply();
      } else {
        prefs().edit().putString(KEY_DIR, "private").remove(KEY_URI).apply();
      }
      if ("saf".equals(dirKind())) ensureSafWritable();
      promise.resolve(currentDirLabel());
    } catch (Throwable e) {
      promise.reject("set_dir_fail", e);
    }
  }

  /** 弹系统「选择文件夹」，用于把缓存放到 TF 卡等任意目录 */
  @ReactMethod
  public void pickDir(Promise promise) {
    Activity act = getCurrentActivity();
    if (act == null) {
      promise.reject("no_activity", "no activity");
      return;
    }
    if (pickPromise != null) {
      promise.reject("busy", "picking");
      return;
    }
    pickPromise = promise;
    try {
      Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
      i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
      act.startActivityForResult(i, REQ_PICK_DIR);
    } catch (Throwable e) {
      pickPromise = null;
      promise.reject("pick_fail", e);
    }
  }

  /* ------------------------------ SAF 工具 ------------------------------ */

  private Uri treeDocUri() {
    Uri u = safUri();
    if (u == null) return null;
    try {
      return DocumentsContract.buildDocumentUriUsingTree(u, DocumentsContract.getTreeDocumentId(u));
    } catch (Throwable e) {
      return null;
    }
  }

  private Uri safFind(String name) {
    Uri tree = safUri();
    if (tree == null) return null;
    try {
      String id = DocumentsContract.getTreeDocumentId(tree);
      Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id);
      Cursor c = cr().query(children, new String[]{
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      }, null, null, null);
      if (c == null) return null;
      try {
        while (c.moveToNext()) {
          String dn = c.getString(1);
          if (dn != null && dn.equalsIgnoreCase(name)) {
            return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
          }
        }
      } finally {
        c.close();
      }
    } catch (Throwable e) {
      Log.w(TAG, "safFind fail: " + e.getMessage());
    }
    return null;
  }

  private boolean ensureSafWritable() {
    Uri tree = safUri();
    if (tree == null) {
      prefs().edit().putString(KEY_DIR, "private").remove(KEY_URI).apply();
      return false;
    }
    try {
      Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(
        tree, DocumentsContract.getTreeDocumentId(tree));
      Cursor c = cr().query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID},
        null, null, null);
      if (c != null) c.close();
      return true;
    } catch (Throwable e) {
      Log.w(TAG, "saf not usable, fallback private: " + e.getMessage());
      prefs().edit().putString(KEY_DIR, "private").remove(KEY_URI).apply();
      return false;
    }
  }

  private long safSize(Uri docUri) {
    try {
      Cursor c = cr().query(docUri, new String[]{DocumentsContract.Document.COLUMN_SIZE},
        null, null, null);
      if (c != null) {
        try {
          if (c.moveToFirst()) return c.getLong(0);
        } finally {
          c.close();
        }
      }
    } catch (Throwable ignored) {
    }
    return 0L;
  }

  private List<Uri> safListJpg() {
    List<Uri> out = new ArrayList<>();
    Uri tree = safUri();
    if (tree == null) return out;
    try {
      Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(
        tree, DocumentsContract.getTreeDocumentId(tree));
      Cursor c = cr().query(children, new String[]{
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      }, null, null, null);
      if (c == null) return out;
      try {
        while (c.moveToNext()) {
          String dn = c.getString(1);
          if (dn != null && dn.toLowerCase(Locale.ROOT).endsWith(".jpg")) {
            out.add(DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0)));
          }
        }
      } finally {
        c.close();
      }
    } catch (Throwable e) {
      Log.w(TAG, "safListJpg fail: " + e.getMessage());
    }
    return out;
  }

  /* ------------------------------ 读写 ------------------------------ */

  private String thumbFileName(String hash) {
    return hash + ".jpg";
  }

  private String existingThumb(String hash) {
    String name = thumbFileName(hash);
    switch (dirKind()) {
      case "saf": {
        Uri f = safFind(name);
        return f == null ? null : f.toString();
      }
      case "external": {
        File f = new File(externalDir(), name);
        return f.exists() ? f.getAbsolutePath() : null;
      }
      default: {
        File f = new File(privateDir(), name);
        return f.exists() ? f.getAbsolutePath() : null;
      }
    }
  }

  @ReactMethod
  public void thumbOf(String hash, Promise promise) {
    try {
      promise.resolve(hash == null || hash.isEmpty() ? null : existingThumb(hash));
    } catch (Throwable e) {
      promise.resolve(null);
    }
  }

  private String writeBytes(String hash, byte[] jpg) throws Exception {
    String name = thumbFileName(hash);
    switch (dirKind()) {
      case "saf": {
        Uri dir = treeDocUri();
        if (dir == null) throw new IllegalStateException("no saf dir");
        Uri old = safFind(name);
        if (old != null) {
          try {
            DocumentsContract.deleteDocument(cr(), old);
          } catch (Throwable ignored) {
          }
        }
        Uri f = DocumentsContract.createDocument(cr(), dir, "image/jpeg", name);
        if (f == null) throw new IllegalStateException("create fail");
        OutputStream os = cr().openOutputStream(f);
        if (os == null) throw new IllegalStateException("open fail");
        os.write(jpg);
        os.close();
        return f.toString();
      }
      case "external": {
        File f = new File(externalDir(), name);
        FileOutputStream os = new FileOutputStream(f);
        os.write(jpg);
        os.close();
        return f.getAbsolutePath();
      }
      default: {
        File f = new File(privateDir(), name);
        FileOutputStream os = new FileOutputStream(f);
        os.write(jpg);
        os.close();
        return f.getAbsolutePath();
      }
    }
  }

  private static String sha1(byte[] data) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-1");
      byte[] d = md.digest(data);
      StringBuilder sb = new StringBuilder();
      for (byte b : d) sb.append(String.format(Locale.ROOT, "%02x", b));
      return sb.toString();
    } catch (Exception e) {
      return null;
    }
  }

  /** 解码 + 居中裁方 + 缩放 + JPEG 压缩 */
  private byte[] makeJpeg(byte[] raw, int maxSize, int quality) {
    BitmapFactory.Options opts = new BitmapFactory.Options();
    opts.inJustDecodeBounds = true;
    BitmapFactory.decodeByteArray(raw, 0, raw.length, opts);
    if (opts.outWidth <= 0 || opts.outHeight <= 0) return null;
    int sample = 1;
    while (Math.max(opts.outWidth, opts.outHeight) / (sample * 2) >= maxSize) sample *= 2;
    BitmapFactory.Options o2 = new BitmapFactory.Options();
    o2.inSampleSize = sample;
    Bitmap bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length, o2);
    if (bmp == null) return null;
    int w = bmp.getWidth(), h = bmp.getHeight();
    int side = Math.min(w, h);
    Bitmap square = Bitmap.createBitmap(bmp, (w - side) / 2, (h - side) / 2, side, side);
    Bitmap scaled = Bitmap.createScaledBitmap(square, maxSize, maxSize, true);
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    scaled.compress(Bitmap.CompressFormat.JPEG, quality, bos);
    if (square != bmp) square.recycle();
    if (scaled != square) scaled.recycle();
    bmp.recycle();
    return bos.toByteArray();
  }

  private WritableMap thumbResult(String hash, byte[] art, int maxSize, int quality, boolean dryRun) throws Exception {
    WritableMap m = Arguments.createMap();
    m.putString("hash", hash);
    m.putInt("artBytes", art.length);
    String existing = existingThumb(hash);
    if (existing != null) {
      m.putString("thumb", existing);
      m.putBoolean("cached", true);
      return m;
    }
    if (dryRun) {
      m.putNull("thumb");
      m.putBoolean("cached", false);
      return m;
    }
    byte[] jpg = makeJpeg(art, Math.max(64, maxSize), Math.min(100, Math.max(40, quality)));
    if (jpg == null) return null;
    m.putString("thumb", writeBytes(hash, jpg));
    m.putInt("thumbBytes", jpg.length);
    m.putBoolean("cached", false);
    return m;
  }

  /**
   * 本机：从音频文件抽内嵌封面 → 缩略图。
   * 返回 { hash, thumb, artBytes, thumbBytes, cached }；无内嵌图返回 null
   */
  @ReactMethod
  public void makeThumbFromFile(String path, int maxSize, int quality, boolean dryRun, Promise promise) {
    MediaMetadataRetriever mmr = new MediaMetadataRetriever();
    try {
      mmr.setDataSource(path);
      byte[] art = mmr.getEmbeddedPicture();
      if (art == null || art.length < 1024) {
        promise.resolve(null);
        return;
      }
      String hash = sha1(art);
      if (hash == null) {
        promise.resolve(null);
        return;
      }
      promise.resolve(thumbResult(hash, art, maxSize, quality, dryRun));
    } catch (Throwable e) {
      promise.resolve(null);
    } finally {
      try {
        mmr.release();
      } catch (Throwable ignored) {
      }
    }
  }

  /** NAS：JS 已用 Range 取到图片字节（base64 或 data URL） */
  @ReactMethod
  public void makeThumbFromBase64(String b64, int maxSize, int quality, boolean dryRun, Promise promise) {
    try {
      String s = b64 == null ? "" : b64;
      int comma = s.indexOf(',');
      if (s.startsWith("data:") && comma > 0) s = s.substring(comma + 1);
      byte[] raw = Base64.decode(s, Base64.DEFAULT);
      if (raw.length < 1024) {
        promise.resolve(null);
        return;
      }
      String hash = sha1(raw);
      if (hash == null) {
        promise.resolve(null);
        return;
      }
      promise.resolve(thumbResult(hash, raw, maxSize, quality, dryRun));
    } catch (Throwable e) {
      promise.resolve(null);
    }
  }

  /** 从同目录封面图片（cover.jpg 等）生成缩略图 */
  @ReactMethod
  public void makeThumbFromImage(String path, int maxSize, int quality, boolean dryRun, Promise promise) {
    try {
      String p = path == null ? "" : path;
      if (p.startsWith("file://")) p = p.substring(7);
      java.io.File f = new java.io.File(p);
      if (!f.exists() || f.length() <= 0 || f.length() > 32L * 1024 * 1024) {
        promise.resolve(null);
        return;
      }
      byte[] raw = new byte[(int) f.length()];
      java.io.FileInputStream in = new java.io.FileInputStream(f);
      int read = 0;
      while (read < raw.length) {
        int n = in.read(raw, read, raw.length - read);
        if (n <= 0) break;
        read += n;
      }
      in.close();
      if (read < 1024) {
        promise.resolve(null);
        return;
      }
      String hash = sha1(raw);
      if (hash == null) {
        promise.resolve(null);
        return;
      }
      promise.resolve(thumbResult(hash, raw, maxSize, quality, dryRun));
    } catch (Throwable e) {
      promise.resolve(null);
    }
  }

  @ReactMethod
  public void clearAll(Promise promise) {
    try {
      int n = 0;
      switch (dirKind()) {
        case "saf": {
          for (Uri f : safListJpg()) {
            try {
              if (DocumentsContract.deleteDocument(cr(), f)) n++;
            } catch (Throwable ignored) {
            }
          }
          break;
        }
        case "external": {
          File[] fs = externalDir().listFiles();
          if (fs != null) for (File f : fs) if (f.getName().endsWith(".jpg") && f.delete()) n++;
          break;
        }
        default: {
          File[] fs = privateDir().listFiles();
          if (fs != null) for (File f : fs) if (f.getName().endsWith(".jpg") && f.delete()) n++;
        }
      }
      promise.resolve(n);
    } catch (Throwable e) {
      promise.reject("clear_fail", e);
    }
  }

  @ReactMethod
  public void stats(Promise promise) {
    try {
      int count = 0;
      long bytes = 0;
      switch (dirKind()) {
        case "saf": {
          for (Uri f : safListJpg()) {
            count++;
            bytes += safSize(f);
          }
          break;
        }
        case "external": {
          File[] fs = externalDir().listFiles();
          if (fs != null) for (File f : fs) {
            if (f.getName().endsWith(".jpg")) {
              count++;
              bytes += f.length();
            }
          }
          break;
        }
        default: {
          File[] fs = privateDir().listFiles();
          if (fs != null) for (File f : fs) {
            if (f.getName().endsWith(".jpg")) {
              count++;
              bytes += f.length();
            }
          }
        }
      }
      WritableMap m = Arguments.createMap();
      m.putInt("count", count);
      m.putDouble("bytes", bytes);
      m.putString("dir", currentDirLabel());
      m.putString("kind", dirKind());
      promise.resolve(m);
    } catch (Throwable e) {
      promise.reject("stats_fail", e);
    }
  }

  /* ------------------------------ SAF 结果 ------------------------------ */

  @Override
  public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
    if (requestCode != REQ_PICK_DIR) return;
    Promise p = pickPromise;
    pickPromise = null;
    if (p == null) return;
    if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
      p.resolve(null);
      return;
    }
    Uri uri = data.getData();
    try {
      cr().takePersistableUriPermission(uri,
        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    } catch (Throwable e) {
      Log.w(TAG, "persist permission failed: " + e.getMessage());
    }
    prefs().edit().putString(KEY_DIR, "saf").putString(KEY_URI, uri.toString()).apply();
    ensureSafWritable();
    p.resolve(currentDirLabel());
  }

  @Override
  public void onNewIntent(Intent intent) {
  }
}
