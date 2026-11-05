#include "feed_protocol.h"
#include <Windows.h>
#include <wincodec.h>
#include <wrl/client.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {
constexpr std::uint32_t kWidth = 1280;
constexpr std::uint32_t kHeight = 720;
constexpr std::uint32_t kStride = kWidth;
constexpr std::size_t kFrameBytes = static_cast<std::size_t>(kStride) * kHeight * 3 / 2;
constexpr std::size_t kMappingBytes = octo::camera::kHeaderBytes + kFrameBytes;

struct Mapping final {
  HANDLE handle{};
  void* view{};
  ~Mapping() {
    if (view) UnmapViewOfFile(view);
    if (handle) CloseHandle(handle);
  }
};

bool readPixels(const std::wstring& file, std::uint8_t* bgr, UINT width, UINT height) {
  ComPtr<IWICImagingFactory> factory;
  if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                              IID_PPV_ARGS(&factory)))) return false;
  ComPtr<IWICBitmapDecoder> decoder;
  if (FAILED(factory->CreateDecoderFromFilename(file.c_str(), nullptr, GENERIC_READ,
                                                 WICDecodeMetadataCacheOnLoad, &decoder))) return false;
  ComPtr<IWICBitmapFrameDecode> frame;
  if (FAILED(decoder->GetFrame(0, &frame))) return false;
  ComPtr<IWICBitmapScaler> scaler;
  if (FAILED(factory->CreateBitmapScaler(&scaler))) return false;
  if (FAILED(scaler->Initialize(frame.Get(), width, height, WICBitmapInterpolationModeFant))) return false;
  ComPtr<IWICFormatConverter> converter;
  if (FAILED(factory->CreateFormatConverter(&converter))) return false;
  if (FAILED(converter->Initialize(scaler.Get(), GUID_WICPixelFormat24bppBGR,
                                   WICBitmapDitherTypeNone, nullptr, 0.0,
                                   WICBitmapPaletteTypeCustom))) return false;
  return SUCCEEDED(converter->CopyPixels(nullptr, width * 3, width * height * 3, bgr));
}

void bgrToNv12(const std::uint8_t* bgr, std::uint8_t* nv12) {
  auto clamp = [](int value) { return static_cast<std::uint8_t>(std::clamp(value, 0, 255)); };
  auto* yPlane = nv12;
  auto* uvPlane = nv12 + static_cast<std::size_t>(kWidth) * kHeight;
  for (std::uint32_t y = 0; y < kHeight; ++y) {
    for (std::uint32_t x = 0; x < kWidth; ++x) {
      const auto* p = bgr + (static_cast<std::size_t>(y) * kWidth + x) * 3;
      const int b = p[0], g = p[1], r = p[2];
      yPlane[static_cast<std::size_t>(y) * kStride + x] = clamp((77 * r + 150 * g + 29 * b + 128) >> 8);
    }
  }
  for (std::uint32_t y = 0; y < kHeight; y += 2) {
    for (std::uint32_t x = 0; x < kWidth; x += 2) {
      int sumU = 0, sumV = 0;
      for (std::uint32_t dy = 0; dy < 2; ++dy) for (std::uint32_t dx = 0; dx < 2; ++dx) {
        const auto* p = bgr + (static_cast<std::size_t>(y + dy) * kWidth + x + dx) * 3;
        const int b = p[0], g = p[1], r = p[2];
        sumU += ((-43 * r - 85 * g + 128 * b + 32768) >> 8);
        sumV += ((128 * r - 107 * g - 21 * b + 32768) >> 8);
      }
      auto* uv = uvPlane + static_cast<std::size_t>(y / 2) * kStride + x;
      uv[0] = clamp(sumU / 4);
      uv[1] = clamp(sumV / 4);
    }
  }
}

bool publish(Mapping& mapping, const std::uint8_t* frame, std::uint32_t sequence) {
  auto* header = static_cast<octo::camera::FeedHeader*>(mapping.view);
  auto* payload = static_cast<std::uint8_t*>(mapping.view) + octo::camera::kHeaderBytes;
  // Write payload first. A sequence change is the commit marker consumed by the reader.
  std::memcpy(payload, frame, kFrameBytes);
  MemoryBarrier();
  header->magic = octo::camera::kFeedMagic;
  header->version = octo::camera::kFeedVersion;
  header->width = kWidth;
  header->height = kHeight;
  header->stride = kStride;
  header->frameBytes = static_cast<std::uint32_t>(kFrameBytes);
  header->format = octo::camera::kFormatNv12;
  header->timestamp100ns = static_cast<std::int64_t>(GetTickCount64()) * 10000;
  MemoryBarrier();
  header->sequence = sequence;
  return true;
}
}

int wmain(int argc, wchar_t** argv) {
  if (argc < 2) {
    std::wcerr << L"usage: octo-camera-feed-publisher.exe <jpeg> [--once]\n";
    return 2;
  }
  const std::filesystem::path source = argv[1];
  const bool once = argc >= 3 && std::wstring(argv[2]) == L"--once";
  if (!std::filesystem::is_regular_file(source)) {
    std::wcerr << L"frame file not found: " << source << L"\n";
    return 2;
  }
  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) return 1;
  Mapping mapping;
  mapping.handle = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0,
                                      static_cast<DWORD>(kMappingBytes), octo::camera::kFeedMappingName);
  if (!mapping.handle) { CoUninitialize(); return 1; }
  mapping.view = MapViewOfFile(mapping.handle, FILE_MAP_ALL_ACCESS, 0, 0, kMappingBytes);
  if (!mapping.view) { CoUninitialize(); return 1; }
  std::vector<std::uint8_t> bgr(static_cast<std::size_t>(kWidth) * kHeight * 3);
  std::vector<std::uint8_t> nv12(kFrameBytes);
  std::uint32_t sequence = 0;
  std::string lastStamp;
  do {
    std::error_code error;
    const auto stamp = std::to_string(std::filesystem::file_size(source, error)) + ":" +
                       std::to_string(std::filesystem::last_write_time(source, error).time_since_epoch().count());
    if (stamp != lastStamp && readPixels(source.wstring(), bgr.data(), kWidth, kHeight)) {
      bgrToNv12(bgr.data(), nv12.data());
      publish(mapping, nv12.data(), ++sequence);
      lastStamp = stamp;
      std::wcout << L"published frame " << sequence << L" from " << source << std::endl;
    }
    if (once) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  } while (true);
  CoUninitialize();
  return sequence ? 0 : 1;
}
