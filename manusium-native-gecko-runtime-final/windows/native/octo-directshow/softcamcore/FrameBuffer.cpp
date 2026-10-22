#include "FrameBuffer.h"

#include "../../octo-camera/feed_protocol.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <vector>

namespace softcam {
namespace {

inline std::uint8_t ClampByte(int value) {
  return static_cast<std::uint8_t>((std::min)(255, (std::max)(0, value)));
}

void ClearDib(void* output, int width, int height) {
  if (!output) return;
  const int stride = (width * 2 + 3) & ~3;
  std::memset(output, 0, static_cast<std::size_t>(stride) * height);
}

} // namespace

FrameBuffer::FrameBuffer(FrameBuffer&& other) noexcept
    : mapping_(other.mapping_), view_(other.view_), mapping_bytes_(other.mapping_bytes_),
      width_(other.width_), height_(other.height_), framerate_(other.framerate_),
      sequence_(other.sequence_) {
  other.mapping_ = nullptr;
  other.view_ = nullptr;
  other.mapping_bytes_ = 0;
}

FrameBuffer& FrameBuffer::operator=(FrameBuffer&& other) noexcept {
  if (this == &other) return *this;
  release();
  mapping_ = other.mapping_;
  view_ = other.view_;
  mapping_bytes_ = other.mapping_bytes_;
  width_ = other.width_;
  height_ = other.height_;
  framerate_ = other.framerate_;
  sequence_ = other.sequence_;
  other.mapping_ = nullptr;
  other.view_ = nullptr;
  other.mapping_bytes_ = 0;
  return *this;
}

FrameBuffer::~FrameBuffer() { release(); }

FrameBuffer FrameBuffer::create(int, int, float) {
  // The Camera Studio producer owns the Octo mapping. DirectShow is read-only.
  return {};
}

FrameBuffer FrameBuffer::open() {
  FrameBuffer result;
  result.width_ = 1280;
  result.height_ = 720;
  result.framerate_ = 30.0f;
  result.mapping_ = OpenFileMappingW(FILE_MAP_READ, FALSE, octo::camera::kFeedMappingName);
  if (!result.mapping_) return result;
  result.view_ = static_cast<const std::uint8_t*>(MapViewOfFile(
      result.mapping_, FILE_MAP_READ, 0, 0, 0));
  if (!result.view_) {
    result.release();
    return result;
  }
  MEMORY_BASIC_INFORMATION memory{};
  if (!VirtualQuery(result.view_, &memory, sizeof(memory)) ||
      memory.RegionSize < octo::camera::kHeaderBytes) {
    result.release();
    return result;
  }
  result.mapping_bytes_ = memory.RegionSize;
  octo::camera::FeedHeader header{};
  std::memcpy(&header, result.view_, sizeof(header));
  if (!octo::camera::IsValidHeader(header, result.mapping_bytes_)) {
    result.release();
    return result;
  }
  result.width_ = static_cast<int>(header.width);
  result.height_ = static_cast<int>(header.height);
  result.framerate_ = 30.0f;
  result.sequence_ = header.sequence;
  return result;
}

bool FrameBuffer::waitForNewFrame(std::uint64_t frame_counter, float time_out) {
  if (!*this) return false;
  if (!active()) {
    Sleep(static_cast<DWORD>((std::max)(1.0f, time_out * 1000.0f)));
    return true;
  }
  const auto deadline = std::chrono::steady_clock::now() +
      std::chrono::milliseconds(static_cast<long>((std::max)(0.0f, time_out) * 1000.0f));
  for (;;) {
    octo::camera::FeedHeader header{};
    std::memcpy(&header, view_, sizeof(header));
    if (octo::camera::IsValidHeader(header, mapping_bytes_) &&
        header.width == static_cast<std::uint32_t>(width_) &&
        header.height == static_cast<std::uint32_t>(height_) &&
        header.sequence != frame_counter) {
      sequence_ = header.sequence;
      return true;
    }
    if (std::chrono::steady_clock::now() >= deadline) return true;
    Sleep(2);
  }
}

void FrameBuffer::transferToDIB(void* image_bits, std::uint64_t* out_frame_counter) {
  if (out_frame_counter) *out_frame_counter = sequence_;
  if (!image_bits || !*this) return;

  octo::camera::FeedHeader header{};
  MemoryBarrier();
  std::memcpy(&header, view_, sizeof(header));
  if (!octo::camera::IsValidHeader(header, mapping_bytes_) ||
      header.width != static_cast<std::uint32_t>(width_) ||
      header.height != static_cast<std::uint32_t>(height_)) {
    ClearDib(image_bits, width_, height_);
    return;
  }

  std::vector<std::uint8_t> nv12(header.frameBytes);
  std::memcpy(nv12.data(), view_ + octo::camera::kHeaderBytes, nv12.size());
  MemoryBarrier();
  octo::camera::FeedHeader after{};
  std::memcpy(&after, view_, sizeof(after));
  if (after.sequence != header.sequence) {
    ClearDib(image_bits, width_, height_);
    return;
  }

  const int stride = (width_ * 2 + 3) & ~3;
  auto* output = static_cast<std::uint8_t*>(image_bits);
  const auto* yPlane = nv12.data();
  const auto* uvPlane = yPlane + static_cast<std::size_t>(header.stride) * height_;
  for (int y = 0; y < height_; ++y) {
    const int sourceY = height_ - 1 - y;
    auto* row = output + static_cast<std::size_t>(y) * stride;
    for (int x = 0; x + 1 < width_; x += 2) {
      const int yValue0 = yPlane[static_cast<std::size_t>(sourceY) * header.stride + x];
      const int yValue1 = yPlane[static_cast<std::size_t>(sourceY) * header.stride + x + 1];
      const int uvRow = sourceY / 2;
      const int uvOffset = (x / 2) * 2;
      const auto uvIndex = static_cast<std::size_t>(uvRow) * header.stride + uvOffset;
      row[x * 2 + 0] = static_cast<std::uint8_t>(yValue0);
      row[x * 2 + 1] = uvPlane[uvIndex];
      row[x * 2 + 2] = static_cast<std::uint8_t>(yValue1);
      row[x * 2 + 3] = uvPlane[uvIndex + 1];
    }
  }
  sequence_ = header.sequence;
  if (out_frame_counter) *out_frame_counter = sequence_;
}

void FrameBuffer::release() {
  if (view_) UnmapViewOfFile(view_);
  if (mapping_) CloseHandle(mapping_);
  view_ = nullptr;
  mapping_ = nullptr;
  mapping_bytes_ = 0;
  width_ = 1280;
  height_ = 720;
  framerate_ = 30.0f;
  sequence_ = 0;
}

} // namespace softcam
