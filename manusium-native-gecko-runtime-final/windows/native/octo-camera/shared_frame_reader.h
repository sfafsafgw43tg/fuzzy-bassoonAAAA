#pragma once

#include "frame_queue.h"
#include <memory>

namespace octo::camera {

class SharedFrameReader final {
 public:
  SharedFrameReader() = default;
  ~SharedFrameReader();
  bool ReadLatest(Frame& frame, std::uint32_t width, std::uint32_t height);

 private:
  void* mapping_ = nullptr;
  void* view_ = nullptr;
  std::size_t mappingBytes_ = 0;
};

} // namespace octo::camera
