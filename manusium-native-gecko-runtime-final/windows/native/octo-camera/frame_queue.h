#pragma once

#include <cstdint>
#include <deque>
#include <mutex>
#include <utility>
#include <vector>

namespace octo::camera {

struct Frame {
  std::vector<std::uint8_t> bytes;
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint32_t stride = 0;
  std::int64_t timestamp100ns = 0;
};

class FrameQueue final {
 public:
  explicit FrameQueue(std::size_t maxDepth = 5) : maxDepth_(maxDepth) {}

  void Push(Frame frame) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (queue_.size() >= maxDepth_) queue_.pop_front();
    queue_.push_back(std::move(frame));
  }

  bool Pop(Frame& frame) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (queue_.empty()) return false;
    frame = std::move(queue_.front());
    queue_.pop_front();
    return true;
  }

  void Clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    queue_.clear();
  }

 private:
  std::mutex mutex_;
  std::deque<Frame> queue_;
  std::size_t maxDepth_;
};

} // namespace octo::camera
