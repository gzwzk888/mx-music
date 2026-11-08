package cn.toside.music.mobile.media;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

/**
 * 手机本地音乐扫描（MediaStore）
 * 只做只读查询：返回音频文件的路径与基础元数据
 */
public class MediaScanModule extends ReactContextBaseJavaModule implements ActivityEventListener {

  private static final int REQ_PICK_IMAGE = 0xB607;
  private Promise pickImagePromise = null;

  MediaScanModule(ReactApplicationContext reactContext) {
    super(reactContext);
    reactContext.addActivityEventListener(this);
  }

  /** 选一张本地图片作为背景图：复制到应用私有目录，返回 file:// 路径（重启后仍可用） */
  @ReactMethod
  public void pickImage(Promise promise) {
    Activity activity = getCurrentActivity();
    if (activity == null) {
      promise.reject("no_activity", "没有可用的 Activity");
      return;
    }
    if (pickImagePromise != null) {
      promise.reject("busy", "上一个选择还没结束");
      return;
    }
    try {
      Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
      intent.addCategory(Intent.CATEGORY_OPENABLE);
      intent.setType("image/*");
      pickImagePromise = promise;
      activity.startActivityForResult(intent, REQ_PICK_IMAGE);
    } catch (Exception e) {
      pickImagePromise = null;
      promise.reject("failed", e);
    }
  }

  @Override
  public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
    if (requestCode != REQ_PICK_IMAGE) return;
    Promise promise = pickImagePromise;
    pickImagePromise = null;
    if (promise == null) return;
    if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
      promise.reject("canceled", "已取消");
      return;
    }
    Uri uri = data.getData();
    try (InputStream in = getReactApplicationContext().getContentResolver().openInputStream(uri)) {
      if (in == null) {
        promise.reject("failed", "无法读取所选图片");
        return;
      }
      File dir = getReactApplicationContext().getFilesDir();
      File out = new File(dir, "app_bg_" + System.currentTimeMillis() + ".img");
      try (FileOutputStream fos = new FileOutputStream(out)) {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
        fos.flush();
      }
      // 清掉上一张，避免越攒越多
      File[] olds = dir.listFiles((d, name) -> name.startsWith("app_bg_") && !name.equals(out.getName()));
      if (olds != null) for (File f : olds) { if (f.delete()) { /* ignore */ } }
      promise.resolve("file://" + out.getAbsolutePath());
    } catch (Exception e) {
      promise.reject("failed", e);
    }
  }

  @Override
  public void onNewIntent(Intent intent) { }

  @Override
  public String getName() {
    return "MediaScan";
  }

  /**
   * SSDP 发现局域网内的 DLNA 媒体服务器（UPnP M-SEARCH）
   * 返回 [{ location, server, usn }]
   */
  @ReactMethod
  public void discoverDlna(int timeoutMs, Promise promise) {
    new Thread(() -> {
      MulticastSocket socket = null;
      try {
        socket = new MulticastSocket();
        socket.setSoTimeout(500);
        InetAddress group = InetAddress.getByName("239.255.255.250");
        String msg = "M-SEARCH * HTTP/1.1\r\n" +
          "HOST: 239.255.255.250:1900\r\n" +
          "MAN: \"ssdp:discover\"\r\n" +
          "MX: 2\r\n" +
          "ST: urn:schemas-upnp-org:device:MediaServer:1\r\n\r\n";
        byte[] data = msg.getBytes(StandardCharsets.UTF_8);
        socket.send(new DatagramPacket(data, data.length, group, 1900));

        long deadline = System.currentTimeMillis() + Math.max(1000, timeoutMs);
        Map<String, WritableMap> found = new LinkedHashMap<>();
        byte[] buf = new byte[4096];
        while (System.currentTimeMillis() < deadline) {
          DatagramPacket packet = new DatagramPacket(buf, buf.length);
          try {
            socket.receive(packet);
          } catch (SocketTimeoutException e) {
            continue;
          }
          String text = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
          String location = headerOf(text, "LOCATION");
          if (location == null || location.isEmpty() || found.containsKey(location)) continue;
          WritableMap item = Arguments.createMap();
          item.putString("location", location);
          item.putString("server", headerOf(text, "SERVER"));
          item.putString("usn", headerOf(text, "USN"));
          item.putString("ip", packet.getAddress() != null ? packet.getAddress().getHostAddress() : null);
          found.put(location, item);
        }
        WritableArray arr = Arguments.createArray();
        for (WritableMap item : found.values()) arr.pushMap(item);
        promise.resolve(arr);
      } catch (Exception e) {
        promise.reject("E_SSDP", e);
      } finally {
        if (socket != null) socket.close();
      }
    }, "rea-ssdp-discover").start();
  }

  /** 从 SSDP 响应里取某个头 */
  private static String headerOf(String text, String name) {
    for (String line : text.split("\r\n")) {
      int idx = line.indexOf(':');
      if (idx <= 0) continue;
      if (!line.substring(0, idx).trim().equalsIgnoreCase(name)) continue;
      return line.substring(idx + 1).trim();
    }
    return null;
  }

  @ReactMethod
  public void queryAudio(Promise promise) {
    Cursor cursor = null;
    try {
      Uri uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
      String[] projection = new String[] {
        MediaStore.Audio.Media.DATA,
        MediaStore.Audio.Media.TITLE,
        MediaStore.Audio.Media.ARTIST,
        MediaStore.Audio.Media.ALBUM,
        MediaStore.Audio.Media.DURATION,
        MediaStore.Audio.Media.SIZE,
        MediaStore.Audio.Media.MIME_TYPE,
        MediaStore.Audio.Media.DISPLAY_NAME,
        MediaStore.Audio.Media.ALBUM_ID,
      };
      // IS_MUSIC != 0 过滤掉铃声/通知音
      String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0";

      cursor = getReactApplicationContext().getContentResolver()
        .query(uri, projection, selection, null, MediaStore.Audio.Media.TITLE + " ASC");

      WritableArray result = Arguments.createArray();
      if (cursor != null) {
        int iPath = cursor.getColumnIndex(MediaStore.Audio.Media.DATA);
        int iTitle = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE);
        int iArtist = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST);
        int iAlbum = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM);
        int iDuration = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION);
        int iSize = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE);
        int iMime = cursor.getColumnIndex(MediaStore.Audio.Media.MIME_TYPE);
        int iName = cursor.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME);
        int iAlbumId = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM_ID);

        while (cursor.moveToNext()) {
          String path = iPath >= 0 ? cursor.getString(iPath) : null;
          if (path == null || path.isEmpty()) continue;

          WritableMap item = Arguments.createMap();
          item.putString("path", path);
          item.putString("title", iTitle >= 0 ? cursor.getString(iTitle) : null);
          item.putString("artist", iArtist >= 0 ? cursor.getString(iArtist) : null);
          item.putString("album", iAlbum >= 0 ? cursor.getString(iAlbum) : null);
          item.putDouble("duration", iDuration >= 0 ? cursor.getLong(iDuration) : 0);
          item.putDouble("size", iSize >= 0 ? cursor.getLong(iSize) : 0);
          item.putString("mimeType", iMime >= 0 ? cursor.getString(iMime) : null);
          item.putString("fileName", iName >= 0 ? cursor.getString(iName) : null);
          // 封面：不要再发 content://media/external/audio/albumart/<id>
          // （Android 10+ 这个地址已被系统废弃，Image 加载必然失败 → 只能显示占位图）
          // 统一留空，由界面按需从音频文件里抽内嵌封面（readCover）
          item.putString("picUrl", null);
          result.pushMap(item);
        }
      }
      promise.resolve(result);
    } catch (Exception e) {
      promise.reject("E_MEDIA_SCAN", e);
    } finally {
      if (cursor != null) cursor.close();
    }
  }

  /* ==================== 指定目录扫描（本机音乐） ==================== */

  /* 只列 ExoPlayer 能真正解码的格式：
     ape(Monkey's Audio) / dsf / dff(DSD) / wma / aiff 没有解码器，扫进来也放不了，
     一律不收录，避免曲库里出现点开没反应的条目。 */
  private static final String[] AUDIO_EXT = {
    "flac", "wav", "mp3", "m4a", "aac", "ogg", "opus", "alac", "mka", "mp2"
  };

  private static boolean isAudioFile(String name) {
    int i = name.lastIndexOf('.');
    if (i < 0 || i == name.length() - 1) return false;
    String ext = name.substring(i + 1).toLowerCase(Locale.ROOT);
    for (String e : AUDIO_EXT) if (e.equals(ext)) return true;
    return false;
  }

  /** 是否已获得「所有文件访问权限」（Android 11+ 才需要） */
  @ReactMethod
  public void hasAllFilesAccess(Promise promise) {
    // Android 11 以下没有 isExternalStorageManager()，直接调用会抛 NoSuchMethodError（Error 不是 Exception，会崩）
    if (android.os.Build.VERSION.SDK_INT < 30) {
      // Android 10 及以下：能否读目录取决于运行时读取权限 + 是否走 legacy 存储
      // （targetSdk >= 30 时 requestLegacyExternalStorage 被系统忽略，照样读不了外置目录）
      try {
        boolean legacy = getReactApplicationContext().getApplicationInfo().targetSdkVersion < 30;
        boolean read = getReactApplicationContext().checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE)
          == android.content.pm.PackageManager.PERMISSION_GRANTED;
        promise.resolve(legacy && read);
      } catch (Throwable e) {
        promise.resolve(false);
      }
      return;
    }
    try {
      promise.resolve(Environment.isExternalStorageManager());
    } catch (Throwable e) {
      promise.resolve(false);
    }
  }

  /** 跳到系统「所有文件访问」授权页 */
  @ReactMethod
  public void openAllFilesSettings(Promise promise) {
    if (android.os.Build.VERSION.SDK_INT < 30) {
      // 低版本不需要这个权限
      promise.resolve(false);
      return;
    }
    try {
      Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
      intent.setData(Uri.parse("package:" + getReactApplicationContext().getPackageName()));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getReactApplicationContext().startActivity(intent);
      promise.resolve(true);
    } catch (Exception e) {
      try {
        Intent fallback = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getReactApplicationContext().startActivity(fallback);
        promise.resolve(true);
      } catch (Exception e2) {
        promise.reject("E_SETTINGS", e2);
      }
    }
  }

  private void walk(File dir, WritableArray out, java.util.Set<String> seen, int depth) {
    if (dir == null || depth > 12) return;
    File[] files = dir.listFiles();
    if (files == null) return;
    for (File f : files) {
      String name = f.getName();
      if (name.startsWith(".")) continue;
      if (f.isDirectory()) {
        walk(f, out, seen, depth + 1);
        continue;
      }
      if (!isAudioFile(name)) continue;
      String abs = f.getAbsolutePath();
      if (!seen.add(abs)) continue;
      WritableMap item = Arguments.createMap();
      item.putString("path", abs);
      item.putString("name", name);
      item.putDouble("size", f.length());
      item.putDouble("mtime", f.lastModified());
      out.pushMap(item);
    }
  }

  /** 递归扫描多个目录，只返回音频文件清单（不读标签，速度第一） */
  @ReactMethod
  public void scanAudioDirs(ReadableArray dirs, Promise promise) {
    new Thread(() -> {
      try {
        WritableArray result = Arguments.createArray();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int i = 0; i < dirs.size(); i++) {
          String p = dirs.getString(i);
          if (p == null) continue;
          File dir = new File(p);
          if (!dir.exists() || !dir.isDirectory()) continue;
          walk(dir, result, seen, 0);
        }
        promise.resolve(result);
      } catch (Exception e) {
        promise.reject("E_SCAN_DIRS", e);
      }
    }).start();
  }

  private static MediaMetadataRetriever newRetriever(String path) {
    MediaMetadataRetriever r = new MediaMetadataRetriever();
    r.setDataSource(path);
    return r;
  }

  /** 读单个文件的标签（标题/艺人/专辑/时长/风格/是否有内嵌封面），失败返回 null 字段 */
  @ReactMethod
  public void readTags(String path, Promise promise) {
    MediaMetadataRetriever r = null;
    try {
      r = newRetriever(path);
      WritableMap item = Arguments.createMap();
      item.putString("title", r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE));
      item.putString("artist", r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
      item.putString("album", r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM));
      item.putString("genre", r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE));
      String dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
      item.putDouble("duration", dur == null ? 0 : Double.parseDouble(dur));
      // 是否有封面：有内嵌图，或同目录有 cover/folder/front 之类的图片
      boolean hasCover = false;
      try {
        byte[] pic = r.getEmbeddedPicture();
        hasCover = pic != null && pic.length > 0;
      } catch (Exception ignored) {}
      if (!hasCover) hasCover = hasFolderCover(path);
      item.putBoolean("hasCover", hasCover);
      promise.resolve(item);
    } catch (Exception e) {
      promise.resolve(null);
    } finally {
      if (r != null) try { r.release(); } catch (Exception ignored) {}
    }
  }

  /** 同目录是否有封面图（cover/folder/front/album 等），按目录缓存结果，避免每首都 stat */
  private static final java.util.Map<String, Boolean> DIR_COVER_CACHE = new java.util.HashMap<>();

  private static boolean hasFolderCover(String audioPath) {
    try {
      File dir = new File(audioPath).getParentFile();
      if (dir == null) return false;
      String key = dir.getAbsolutePath();
      Boolean cached = DIR_COVER_CACHE.get(key);
      if (cached != null) return cached;
      boolean has = false;
      File[] files = dir.listFiles();
      if (files != null) {
        for (File f : files) {
          if (!f.isFile()) continue;
          String n = f.getName().toLowerCase();
          boolean isImg = n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png") || n.endsWith(".webp");
          if (!isImg) continue;
          if (n.startsWith("cover") || n.startsWith("folder") || n.startsWith("front") || n.startsWith("album")
            || n.equals("封面.jpg") || n.equals("封面.png")) {
            has = true;
            break;
          }
        }
        // 目录里只有一张图时，通常就是封面
        if (!has) {
          int imgCount = 0;
          for (File f : files) {
            String n = f.getName().toLowerCase();
            if (f.isFile() && (n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png"))) imgCount++;
          }
          has = imgCount == 1;
        }
      }
      DIR_COVER_CACHE.put(key, has);
      return has;
    } catch (Exception e) {
      return false;
    }
  }

  /** 抽内嵌封面到缓存目录，返回文件路径（没有则 null） */
  /**
   * 读取音频规格：采样率 / 位深 / 码率（kHz、bit、kbps）
   * 优先解析文件头（FLAC / WAV 精确），其余退回 MediaMetadataRetriever
   */
  @ReactMethod
  public void readAudioSpec(String path, Promise promise) {
    try {
      WritableMap map = Arguments.createMap();
      File f = new File(path);
      if (!f.isFile()) {
        promise.resolve(null);
        return;
      }
      int sampleRate = 0, bits = 0;
      long bitrate = 0;
      String head = readHead(path, 64);
      if (head.startsWith("fLaC")) {
        byte[] b = head.getBytes("ISO-8859-1");
        // STREAMINFO: 4 字节 "fLaC" + 4 字节块头，之后 4 字节(min/max block) + 3 字节(frame size) + 8 字节(采样率20/声道3/位深5/总样本36)
        // 8(头) + 2+2(block size) + 3+3(frame size) = 18，之后才是采样率/声道/位深
        int off = 18;
        long sr = ((b[off] & 0xFFL) << 12) | ((b[off + 1] & 0xFFL) << 4) | ((b[off + 2] & 0xFFL) >> 4);
        int ch = ((b[off + 2] & 0x0E) >> 1) + 1;
        int bps = (((b[off + 2] & 0x01) << 4) | ((b[off + 3] & 0xF0) >> 4)) + 1;
        sampleRate = (int) sr;
        bits = bps;
        if (sampleRate > 0) bitrate = (long) sampleRate * bits * ch;
      } else if (head.length() > 44 && head.startsWith("RIFF") && head.substring(8, 12).equals("WAVE")) {
        // 在文件头里找 "fmt "
        int idx = head.indexOf("fmt ");
        if (idx > 0 && idx + 20 <= head.length()) {
          byte[] b = head.getBytes("ISO-8859-1");
          int ch = ((b[idx + 10] & 0xFF) | ((b[idx + 11] & 0xFF) << 8));
          int sr = ((b[idx + 12] & 0xFF) | ((b[idx + 13] & 0xFF) << 8) | ((b[idx + 14] & 0xFF) << 16) | ((b[idx + 15] & 0xFF) << 24));
          int bps = ((b[idx + 22] & 0xFF) | ((b[idx + 23] & 0xFF) << 8));
          sampleRate = sr;
          bits = bps;
          if (sr > 0 && bps > 0 && ch > 0) bitrate = (long) sr * bps * ch;
        }
      }
      if (sampleRate == 0 || bits == 0 || bitrate == 0) {
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
          mmr.setDataSource(path);
          if (bitrate == 0) {
            String br = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE);
            if (br != null) bitrate = Long.parseLong(br);
          }
          if (sampleRate == 0 && android.os.Build.VERSION.SDK_INT >= 31) {
            String sr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_SAMPLERATE);
            if (sr != null) sampleRate = Integer.parseInt(sr);
          }
          if (bits == 0) {
            String br = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITS_PER_SAMPLE);
            if (br != null) bits = Integer.parseInt(br);
          }
        } catch (Exception ignored) {
        } finally {
          try { mmr.release(); } catch (Exception ignored) {}
        }
      }
      if (sampleRate <= 0 && bitrate <= 0) {
        promise.resolve(null);
        return;
      }
      map.putInt("sampleRate", sampleRate);
      map.putInt("bits", bits);
      map.putDouble("bitrate", bitrate);
      promise.resolve(map);
    } catch (Exception e) {
      promise.reject("failed", e);
    }
  }

  private String readHead(String path, int len) {
    try (java.io.FileInputStream in = new java.io.FileInputStream(path)) {
      byte[] buf = new byte[len];
      int n = in.read(buf);
      if (n <= 0) return "";
      return new String(buf, 0, n, "ISO-8859-1");
    } catch (Exception e) {
      return "";
    }
  }

  @ReactMethod
  public void readCover(String path, Promise promise) {
    MediaMetadataRetriever r = null;
    try {
      File src = new File(path);
      File dir = new File(getReactApplicationContext().getCacheDir(), "mxcover");
      if (!dir.exists()) dir.mkdirs();
      String key = Integer.toHexString((path + "|" + (src.exists() ? src.lastModified() : 0)).hashCode());
      File out = new File(dir, key + ".jpg");
      if (out.exists() && out.length() > 0) {
        promise.resolve(out.getAbsolutePath());
        return;
      }
      r = newRetriever(path);
      byte[] pic = r.getEmbeddedPicture();
      if (pic == null || pic.length == 0) {
        promise.resolve(null);
        return;
      }
      try (FileOutputStream fos = new FileOutputStream(out)) {
        fos.write(pic);
      }
      promise.resolve(out.getAbsolutePath());
    } catch (Exception e) {
      promise.resolve(null);
    } finally {
      if (r != null) try { r.release(); } catch (Exception ignored) {}
    }
  }
}
