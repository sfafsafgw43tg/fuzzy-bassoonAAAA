cmake_minimum_required(VERSION 3.25)
project(octo_camera LANGUAGES CXX)

if (NOT WIN32)
  message(FATAL_ERROR "Octo Camera is a Windows Media Foundation component")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(octo-camera-source SHARED
  camera_source.cpp
  camera_stream.cpp
  media_types.cpp
  shared_frame_reader.cpp
  class_factory.cpp
  octo_camera_guids.cpp
  dllmain.cpp
)

target_compile_definitions(octo-camera-source PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX OCTO_CAMERA_EXPORTS)
target_include_directories(octo-camera-source PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(octo-camera-source PRIVATE mfplat mf mfsensorgroup mfuuid shlwapi)
set_target_properties(octo-camera-source PROPERTIES OUTPUT_NAME "octo-camera-source")

add_executable(octo-cameractl cameractl.cpp registration.cpp octo_camera_guids.cpp)
target_compile_definitions(octo-cameractl PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_include_directories(octo-cameractl PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(octo-cameractl PRIVATE mfplat ole32 advapi32 shell32 strmiids)

install(TARGETS octo-camera-source octo-cameractl RUNTIME DESTINATION . LIBRARY DESTINATION . ARCHIVE DESTINATION .)
