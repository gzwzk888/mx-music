package cn.toside.music.mobile.media;

import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;

import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

/**
 * 手机本地音乐扫描（MediaStore）
 * 只做只读查询：返回音频文件的路径与基础元数据
 */
public class MediaScanModule extends ReactContextBaseJavaModule {

  MediaScanModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

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
          // 歌曲封面：MediaStore 的 album art URI（同一专辑的多首会指向同一张，但这是曲目自己的 embedded 图）
          long albumId = iAlbumId >= 0 ? cursor.getLong(iAlbumId) : -1;
          if (albumId > 0) item.putString("picUrl", "content://media/external/audio/albumart/" + albumId);
          else item.putString("picUrl", null);
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
}
