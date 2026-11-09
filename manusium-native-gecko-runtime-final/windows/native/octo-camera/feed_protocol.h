#pragma once

#include <Windows.h>
#include <cstdint>
#include <limits>

namespace octo::camera {

inline constexpr wchar_t kFeedMappingName[] = L"Local\\OctoSuite.VirtualCamera.NV12.v1";
inline constexpr std::uint32_t kFeedMagic = 0x4F43564Du; // OCVM
inline constexpr std::uint32_t kFeedVersion = 1;
inline constexpr std::uint32_t kFormatNv12 = 1;

#pragma pack(push, 1)
struct FeedHeader {
  std::uint32_t magic;
  std::uint32_t version;
  std::uint32_t width;
  std::uint32_t height;
  std::uint32_t stride;
  std::uint32_t frameBytes;
  std::uint32_t format;
  std::uint32_t sequence;
  std::int64_t timestamp100ns;
};
#pragma pack(pop)

inline constexpr std::size_t kHeaderBytes = sizeof(FeedHeader);

inline bool IsSupportedSize(std::uint32_t width, std::uint32_t height) noexcept {
  return (width == 1280 && height == 720) || (width == 1920 && height == 1080);
}

inline bool IsValidHeader(const FeedHeader& h, std::size_t mappingBytes) noexcept {
  if (h.magic != kFeedMagic || h.version != kFeedVersion || h.format != kFormatNv12) return false;
  if (!IsSupportedSize(h.width, h.height) || h.stride < h.width) return false;
  const std::uint64_t expected = static_cast<std::uint64_t>(h.stride) * h.height * 3u / 2u;
  if (h.frameBytes != expected || h.frameBytes > mappingBytes - kHeaderBytes) return false;
  return h.sequence != 0;
}

} // namespace octo::camera
