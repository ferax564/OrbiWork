cmake_minimum_required(VERSION 3.22.1)

project(orbihighlights LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(ORBI_HIGHLIGHTS_ROOT "${CMAKE_SOURCE_DIR}/..")

add_library(
  orbihighlights SHARED
  src/main/cpp/cpp-adapter.cpp
  "${ORBI_HIGHLIGHTS_ROOT}/cpp/HybridOrbiHighlights.cpp"
  "${ORBI_HIGHLIGHTS_ROOT}/cpp/Utf16ToUtf8.cpp"
  "${ORBI_HIGHLIGHTS_ROOT}/cpp/orbi_highlights.c"
  "${ORBI_HIGHLIGHTS_ROOT}/Vendor/highlights/highlights.c"
  "${ORBI_HIGHLIGHTS_ROOT}/Vendor/wasm2c/wasm-rt-impl.c"
  "${ORBI_HIGHLIGHTS_ROOT}/Vendor/wasm2c/wasm-rt-mem-impl.c"
)

include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/orbihighlights+autolinking.cmake)

target_include_directories(
  orbihighlights
  PRIVATE "${ORBI_HIGHLIGHTS_ROOT}/cpp" "${ORBI_HIGHLIGHTS_ROOT}/Vendor"
          "${ORBI_HIGHLIGHTS_ROOT}/Vendor/highlights" "${ORBI_HIGHLIGHTS_ROOT}/Vendor/wasm2c"
)

# Plain malloc memory with explicit bounds checks: no guard-page signal
# handlers competing with ART's.
target_compile_definitions(
  orbihighlights PRIVATE WASM_RT_USE_MMAP=0 WASM_RT_MEMCHECK_BOUNDS_CHECK=1
                       WASM_RT_SKIP_SIGNAL_RECOVERY=1
)

# The lexers are generated code; keep them fast in debug builds too.
target_compile_options(orbihighlights PRIVATE -O2)

target_link_options(
  orbihighlights PRIVATE "-Wl,-z,common-page-size=16384" "-Wl,-z,max-page-size=16384"
)
