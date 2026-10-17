from __future__ import annotations

import json
import zipfile
from pathlib import Path

archive = Path(__file__).resolve().parents[1] / "studio.zip"
tmp = archive.with_suffix(".zip.tmp")
root = "lvStudio arbitrage/vStudio/"
phone_name = root + "phone_formats.py"
app_name = root + "app.py"
settings_name = root + "realme12pro-ustawienia.json"

with zipfile.ZipFile(archive, "r") as source, zipfile.ZipFile(tmp, "w") as target:
    for info in source.infolist():
        data = source.read(info.filename)
        if info.filename == phone_name:
            text = data.decode("utf-8")
            marker = "PHONE_FORMATS = OrderedDict([\n"
            safe = '''    ("webcam_safe", {\n        "label": "USB webcam safe  •  1280 × 720  (16:9)",\n        "width": 1280, "height": 720, "desc": "Safe DirectShow/Unity Capture output for Android Emulator and video-call apps.",\n    }),\n'''
            if '"webcam_safe"' not in text:
                text = text.replace(marker, marker + safe, 1)
            data = text.encode("utf-8")
        elif info.filename == app_name:
            text = data.decode("utf-8")
            text = text.replace('"format_id": "realme12pro", "fit_mode"', '"format_id": "webcam_safe", "fit_mode"', 1)
            text = text.replace('"fps": 30, "backend": "unitycapture"', '"fps": 30, "backend": "unitycapture"', 1)
            data = text.encode("utf-8")
        elif info.filename == settings_name:
            settings = json.loads(data.decode("utf-8"))
            video = settings.setdefault("video", {})
            video["format_id"] = "webcam_safe"
            video["fps"] = 30
            video["backend"] = "unitycapture"
            video["orientation"] = "landscape"
            settings.setdefault("device_names", {})["camera"] = "Unity Capture virtual camera"
            data = (json.dumps(settings, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        target.writestr(info, data)

tmp.replace(archive)
print(f"Updated {archive}")
