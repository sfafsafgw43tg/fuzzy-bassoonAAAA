from __future__ import annotations
import zipfile
from pathlib import Path

archive = Path(__file__).resolve().parents[1] / 'studio.zip'
tmp = archive.with_suffix('.zip.tmp')
engine_name = 'lvStudio arbitrage/vStudio/video_engine.py'
app_name = 'lvStudio arbitrage/vStudio/app.py'
config_name = 'lvStudio arbitrage/vStudio/config.example.json'

publisher = r'''
class NativeNv12Publisher:
    """Publishes the current RGB frame to Octo's Windows MF camera mapping."""
    MAGIC = 0x4F43564D
    VERSION = 1
    FORMAT_NV12 = 1
    TAG = r"Local\OctoSuite.VirtualCamera.NV12.v1"

    def __init__(self):
        self._map = None
        self._size = 0
        self._sequence = 0
        self.active = False

    def open(self, width, height):
        if os.name != "nt" or not HAS_NUMPY or not HAS_CV2:
            return False
        if (width, height) not in ((1280, 720), (1920, 1080)):
            return False
        try:
            import mmap
            self.close()
            stride = width
            frame_bytes = width * height * 3 // 2
            self._size = 40 + frame_bytes
            self._map = mmap.mmap(-1, self._size, tagname=self.TAG, access=mmap.ACCESS_WRITE)
            self.width, self.height, self.stride, self.frame_bytes = width, height, stride, frame_bytes
            self.active = True
            return True
        except Exception:
            self._map = None
            self.active = False
            return False

    def publish(self, rgb):
        if not self.active or self._map is None:
            return
        try:
            frame = cv2.resize(rgb, (self.width, self.height), interpolation=cv2.INTER_LINEAR)
            yuv = cv2.cvtColor(frame, cv2.COLOR_RGB2YUV_I420)
            y_size = self.width * self.height
            y = yuv[:self.height, :self.width].reshape(-1)
            uv_planar = yuv[self.height:, :self.width].reshape(-1)
            uv = np.empty(self.width * self.height // 2, dtype=np.uint8)
            uv[0::2] = uv_planar[:y_size // 4]
            uv[1::2] = uv_planar[y_size // 4:y_size // 2]
            payload = y.tobytes() + uv.tobytes()
            self._sequence = (self._sequence + 1) & 0xFFFFFFFF or 1
            import struct
            import time as _time
            now = int(_time.monotonic_ns() // 100)
            header = struct.pack("<IIIIIIIIq", self.MAGIC, self.VERSION,
                self.width, self.height, self.stride, self.frame_bytes,
                self.FORMAT_NV12, 0, now)
            self._map.seek(0); self._map.write(header); self._map.write(payload)
            final = struct.pack("<IIIIIIIIq", self.MAGIC, self.VERSION,
                self.width, self.height, self.stride, self.frame_bytes,
                self.FORMAT_NV12, self._sequence, now)
            self._map.seek(0); self._map.write(final); self._map.flush()
        except Exception:
            self.active = False

    def close(self):
        try:
            if self._map is not None: self._map.close()
        except Exception:
            pass
        self._map = None
        self.active = False
'''

with zipfile.ZipFile(archive, 'r') as source, zipfile.ZipFile(tmp, 'w') as target:
    for info in source.infolist():
        data = source.read(info.filename)
        if info.filename == engine_name:
            text = data.decode('utf-8')
            if 'class NativeNv12Publisher:' not in text:
                text = text.replace('\n\nclass VideoEngine:', '\n' + publisher + '\n\nclass VideoEngine:', 1)
            text = text.replace('        self._cam = None            # pyvirtualcam.Camera\n', '        self._cam = None            # pyvirtualcam.Camera\n        self._native_feed = NativeNv12Publisher()\n', 1)
            text = text.replace('        self.stop_virtual()\n        self._close_cap()\n', '        self.stop_virtual()\n        self._native_feed.close()\n        self._close_cap()\n', 1)
            text = text.replace('            self._cam_size = (w, h)\n', '            self._cam_size = (w, h)\n            self._native_feed.open(w, h)\n', 1)
            text = text.replace('        self._cam = None\n        self.vcam_active = False\n', '        self._cam = None\n        self._native_feed.close()\n        self.vcam_active = False\n', 1)
            text = text.replace('                if self._cam is not None and self.vcam_active:\n', '                self._native_feed.publish(frame)\n                if self._cam is not None and self.vcam_active:\n', 1)
            data = text.encode('utf-8')
        elif info.filename == app_name:
            text = data.decode('utf-8')
            if '"native_camera_feed": True' not in text:
                text = text.replace('        "loop_blend": 0.35,\n', '        "loop_blend": 0.35,\n        "native_camera_feed": True,\n', 1)
                text = text.replace('        "loop_video": True, "loop_blend": 0.35,\n', '        "loop_video": True, "loop_blend": 0.35, "native_camera_feed": True,\n', 1)
            data = text.encode('utf-8')
        elif info.filename == config_name:
            text = data.decode('utf-8')
            if '"native_camera_feed"' not in text:
                text = text.replace('    "loop_blend": 0.35\n', '    "loop_blend": 0.35,\n    "native_camera_feed": true\n', 1)
            data = text.encode('utf-8')
        target.writestr(info, data)
tmp.replace(archive)
print(f'Updated {archive}')
