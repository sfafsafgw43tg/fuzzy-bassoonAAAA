#include "shared_frame_reader.h"
#include "feed_protocol.h"
#include <Windows.h>
#include <mfapi.h>
#include <algorithm>
#include <cstring>

namespace octo::camera {

static LONGLONG Clock100ns() {
  return static_cast<LONGLONG>(GetTickCount64()) * 10000;
}

SharedFrameReader::~SharedFrameReader() {
  if (view_) UnmapViewOfFile(view_);
  if (mapping_) CloseHandle(static_cast<HANDLE>(mapping_));
}

static void MakeBlack(Frame& frame, std::uint32_t width, std::uint32_t height) {
  frame.width = width;
  frame.height = height;
  frame.stride = width;
  frame.bytes.assign(static_cast<std::size_t>(width) * height * 3 / 2, 0);
  std::fill(frame.bytes.begin() + static_cast<std::size_t>(width) * height, frame.bytes.end(), 128);
  frame.timestamp100ns = Clock100ns();
}

bool SharedFrameReader::ReadLatest(Frame& frame, std::uint32_t width, std::uint32_t height) {
  if (!IsSupportedSize(width, height)) return false;
  const std::size_t maxBytes = kHeaderBytes + static_cast<std::size_t>(1920) * 1080 * 3 / 2;
  if (!mapping_) {
    mapping_ = OpenFileMappingW(FILE_MAP_READ, FALSE, kFeedMappingName);
    if (mapping_) {
      view_ = MapViewOfFile(static_cast<HANDLE>(mapping_), FILE_MAP_READ, 0, 0, maxBytes);
      if (!view_) { CloseHandle(static_cast<HANDLE>(mapping_)); mapping_ = nullptr; }
      else mappingBytes_ = maxBytes;
    }
  }
  if (!view_) { MakeBlack(frame, width, height); return false; }

  auto* source = static_cast<const FeedHeader*>(view_);
  FeedHeader before{};
  std::memcpy(&before, source, sizeof(before));
  if (!IsValidHeader(before, mappingBytes_) || before.width != width || before.height != height) {
    MakeBlack(frame, width, height);
    return false;
  }
  frame.width = before.width;
  frame.height = before.height;
  frame.stride = before.stride;
  frame.timestamp100ns = before.timestamp100ns > 0 ? before.timestamp100ns : Clock100ns();
  frame.bytes.resize(before.frameBytes);
  std::memcpy(frame.bytes.data(), static_cast<const std::uint8_t*>(view_) + kHeaderBytes, before.frameBytes);
  MemoryBarrier();
  FeedHeader after{};
  std::memcpy(&after, source, sizeof(after));
  if (after.sequence != before.sequence || !IsValidHeader(after, mappingBytes_)) {
    MakeBlack(frame, width, height);
    return false;
  }
  return true;
}

} // namespace octo::camera
