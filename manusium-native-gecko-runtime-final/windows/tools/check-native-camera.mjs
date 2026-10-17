import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('native/octo-camera');
const required = [
  'CMakeLists.txt', 'README.md', 'feed_protocol.h', 'frame_queue.h',
  'media_types.cpp', 'camera_source.cpp', 'camera_stream.cpp', 'octo_camera_guids.cpp',
  'shared_frame_reader.cpp', 'class_factory.cpp', 'registration.cpp', 'cameractl.cpp',
];
for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error(`native camera file missing: ${file}`);
}
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const cmake = read('CMakeLists.txt');
const source = read('camera_source.cpp');
const registration = read('registration.cpp');
const protocol = read('feed_protocol.h');
const assertions = [
  [cmake.includes('mfsensorgroup'), 'Media Foundation sensor-group library is linked'],
  [cmake.includes('registration.cpp'), 'registration client is built'],
  [source.includes('IMFMediaSourceEx'), 'frame-server source extension is implemented'],
  [source.includes('MFCreateEventQueue'), 'source uses an event queue'],
  [registration.includes('MFVirtualCameraAccess_CurrentUser'), 'registration defaults to current-user scope'],
  [registration.includes('MFVirtualCameraType_SoftwareCameraSource'), 'registration uses software-camera source type'],
  [/camera->Start\(nullptr\)/.test(registration), 'registration starts the camera'],
  [registration.includes('camera->Remove()'), 'uninstall removes the camera'],
  [protocol.includes('kFeedMagic'), 'feed protocol is versioned and validated'],
  [protocol.includes('IsSupportedSize'), 'feed protocol has a resolution allow-list'],
];
for (const [ok, message] of assertions) if (!ok) throw new Error(`native camera contract failed: ${message}`);
console.log(`native camera contract ok (${required.length} files)`);
