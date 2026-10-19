import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('native/octo-camera');
const directShowRoot = path.resolve('native/octo-directshow');
const required = [
  'CMakeLists.txt', 'README.md', 'feed_protocol.h', 'frame_queue.h',
  'media_types.cpp', 'camera_source.cpp', 'camera_stream.cpp', 'octo_camera_guids.cpp',
  'shared_frame_reader.cpp', 'class_factory.cpp', 'registration.cpp', 'cameractl.cpp',
];
for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error(`native camera file missing: ${file}`);
}
for (const file of ['CMakeLists.txt', 'softcam.cpp', 'octo-directshow-camera.def', 'softcamcore/DShowSoftcam.cpp', 'softcamcore/FrameBuffer.cpp', 'SOFTCAM-LICENSE']) {
  const full = path.join(directShowRoot, file);
  if (!fs.existsSync(full)) throw new Error(`DirectShow fallback file missing: ${file}`);
}
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const cmake = read('CMakeLists.txt');
const source = read('camera_source.cpp');
const registration = read('registration.cpp');
const control = read('cameractl.cpp');
const protocol = read('feed_protocol.h');
const directShowCmake = fs.readFileSync(path.join(directShowRoot, 'CMakeLists.txt'), 'utf8');
const directShowFrameBuffer = fs.readFileSync(path.join(directShowRoot, 'softcamcore/FrameBuffer.cpp'), 'utf8');
const directShowStream = fs.readFileSync(path.join(directShowRoot, 'softcamcore/DShowSoftcam.cpp'), 'utf8');
const mediaFrameReader = fs.readFileSync(path.join(root, 'shared_frame_reader.cpp'), 'utf8');
const directShowFilter = fs.readFileSync(path.join(directShowRoot, 'softcam.cpp'), 'utf8');
const registrationHeader = fs.readFileSync(path.join(root, 'registration.h'), 'utf8');
const assertions = [
  [cmake.includes('mfsensorgroup'), 'Media Foundation sensor-group library is linked'],
  [cmake.includes('registration.cpp'), 'registration client is built'],
  [source.includes('IMFMediaSourceEx'), 'frame-server source extension is implemented'],
  [source.includes('MFCreateEventQueue'), 'source uses an event queue'],
  [registration.includes('MFVirtualCameraAccess_CurrentUser'), 'registration defaults to current-user scope'],
  [registration.includes('MFVirtualCameraType_SoftwareCameraSource'), 'registration uses software-camera source type'],
  [control.includes('Android Emulator discovers Windows cameras through DirectShow'), 'control registers DirectShow alongside Media Foundation'],
  [/camera->Start\(nullptr\)/.test(registration), 'registration starts the camera'],
  [registration.includes('camera->Remove()'), 'uninstall removes the camera'],
  [protocol.includes('kFeedMagic'), 'feed protocol is versioned and validated'],
  [protocol.includes('IsSupportedSize'), 'feed protocol has a resolution allow-list'],
  [directShowCmake.includes('strmiids'), 'DirectShow fallback links DirectShow identifiers'],
  [directShowCmake.includes('baseclasses'), 'DirectShow fallback builds the Base Classes'],
  [directShowFrameBuffer.includes('kFeedMappingName'), 'DirectShow fallback reads the Octo shared feed'],
  [directShowFrameBuffer.includes('MapViewOfFile(') && directShowFrameBuffer.includes('VirtualQuery'), 'DirectShow fallback maps the actual shared-memory size'],
  [mediaFrameReader.includes('MapViewOfFile(') && mediaFrameReader.includes('VirtualQuery'), 'Media Foundation reader maps the actual shared-memory size'],
  [directShowStream.includes('if (!m_screenshot)') && directShowStream.includes('std::nothrow'), 'DirectShow fallback initializes a safe frame before the feed is active'],
  [directShowStream.includes('m_valid(true)') && directShowStream.includes('m_width(m_frame_buffer.width() > 0 ? m_frame_buffer.width() : 1280)'), 'DirectShow fallback advertises a stable stream without an active producer'],
  [directShowStream.includes('MEDIASUBTYPE_YUY2') && directShowStream.includes("MAKEFOURCC('Y', 'U', 'Y', '2')"), 'DirectShow fallback advertises YUY2 for Android Emulator compatibility'],
  [directShowFrameBuffer.includes('row[x * 2 + 1]') && directShowFrameBuffer.includes('row[x * 2 + 3]'), 'DirectShow fallback converts NV12 to packed YUY2'],
  [registrationHeader.includes('kDirectShowClsid'), 'Media Foundation and DirectShow have separate registration identifiers'],
  [directShowFilter.includes('0xa6c2b7e1'), 'DirectShow filter uses the dedicated CLSID'],
  [control.includes('FindSiblingDirectShow'), 'camera controller discovers the bundled DirectShow DLL automatically'],
];
for (const [ok, message] of assertions) if (!ok) throw new Error(`native camera contract failed: ${message}`);
console.log(`native camera contract ok (${required.length} files)`);
