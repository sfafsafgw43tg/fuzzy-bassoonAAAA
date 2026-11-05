#pragma once

#include <Windows.h>
#include <cstddef>
#include <cstdint>

namespace softcam {

class FrameBuffer {
 public:
  FrameBuffer() = default;
  FrameBuffer(const FrameBuffer&) = delete;
  FrameBuffer& operator=(const FrameBuffer&) = delete;
  FrameBuffer(FrameBuffer&& other) noexcept;
  FrameBuffer& operator=(FrameBuffer&& other) noexcept;
  ~FrameBuffer();

  static FrameBuffer create(int width, int height, float framerate = 0.0f);
  static FrameBuffer open();

  explicit operator bool() const { return width_ > 0 && height_ > 0; }
  void* handle() const { return const_cast<std::uint8_t*>(view_); }
  int width() const { return width_; }
  int height() const { return height_; }
  float framerate() const { return framerate_; }
  std::uint64_t frameCounter() const { return sequence_; }
  bool active() const { return mapping_ != nullptr && view_ != nullptr; }
  bool connected() const { return active(); }

  void deactivate() {}
  void write(const void*) {}
  void transferToDIB(void* image_bits, std::uint64_t* out_frame_counter);
  bool waitForNewFrame(std::uint64_t frame_counter, float time_out = 0.5f);
  void release();

 private:
  HANDLE mapping_ = nullptr;
  const std::uint8_t* view_ = nullptr;
  std::size_t mapping_bytes_ = 0;
  int width_ = 0;
  int height_ = 0;
  float framerate_ = 30.0f;
  std::uint64_t sequence_ = 0;
};

} // namespace softcam
