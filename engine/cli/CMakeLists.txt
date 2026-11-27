cmake_minimum_required(VERSION 3.24)
project(t2s_transcribe LANGUAGES C CXX)

set(MUSCRIPTOR_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(MUSCRIPTOR_BUILD_BENCH OFF CACHE BOOL "" FORCE)
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../muscriptor.cpp/cpp muscriptor)

add_executable(t2s_transcribe transcribe.cpp)
target_link_libraries(t2s_transcribe PRIVATE muscriptor_ggml)
