cmake_minimum_required(VERSION 3.25)
project(octo_directshow_camera LANGUAGES CXX)

if (NOT WIN32)
  message(FATAL_ERROR "Octo DirectShow Camera is a Windows component")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(BASE ${CMAKE_CURRENT_SOURCE_DIR}/baseclasses)
set(CORE ${CMAKE_CURRENT_SOURCE_DIR}/softcamcore)

add_library(octo-directshow-camera SHARED
  ${BASE}/amfilter.cpp
  ${BASE}/amvideo.cpp
  ${BASE}/combase.cpp
  ${BASE}/dllentry.cpp
  ${BASE}/dllsetup.cpp
  ${BASE}/mtype.cpp
  ${BASE}/source.cpp
  ${BASE}/winutil.cpp
  ${BASE}/wxdebug.cpp
  ${BASE}/wxlist.cpp
  ${BASE}/wxutil.cpp
  ${CORE}/DShowSoftcam.cpp
  ${CORE}/FrameBuffer.cpp
  ${CORE}/Misc.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/softcam.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/octo-directshow-camera.def
)

target_compile_definitions(octo-directshow-camera PRIVATE
  UNICODE _UNICODE WIN32_LEAN_AND_MEAN
  OCTO_DIRECTSHOW_CAMERA_EXPORTS
)
target_compile_options(octo-directshow-camera PRIVATE $<$<CXX_COMPILER_ID:MSVC>:/Zc:strictStrings->)
target_include_directories(octo-directshow-camera PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${BASE}
  ${CORE}
  ${CMAKE_CURRENT_SOURCE_DIR}/../octo-camera
)
target_link_libraries(octo-directshow-camera PRIVATE
  strmiids ole32 oleaut32 advapi32 winmm
)
set_target_properties(octo-directshow-camera PROPERTIES OUTPUT_NAME "octo-directshow-camera")

install(TARGETS octo-directshow-camera RUNTIME DESTINATION . LIBRARY DESTINATION . ARCHIVE DESTINATION .)
