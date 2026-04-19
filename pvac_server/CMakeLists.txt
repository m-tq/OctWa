cmake_minimum_required(VERSION 3.15)
project(pvac_server VERSION 1.0.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)

# ── Compiler flags ────────────────────────────────────────────────────────────
if(MSVC)
    add_compile_options(/W4 /O2 /EHsc /arch:AVX2)
else()
    # PVAC library requires hardware AES-NI + SSE2 (x86_64)
    # -maes enables __AES__ macro checked in pvac/include/pvac/crypto/lpn.hpp
    add_compile_options(
        -Wall -Wextra -O2
        -maes -msse2 -msse4.1
        -fstack-protector-strong
        -fno-strict-overflow
    )
    # Address sanitizer in Debug builds
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        add_compile_options(-fsanitize=address,undefined -g)
        add_link_options(-fsanitize=address,undefined)
        message(STATUS "  ASan/UBSan: ENABLED (Debug build)")
    endif()
endif()

# ── Dependencies ──────────────────────────────────────────────────────────────
find_package(OpenSSL REQUIRED)
find_package(Threads REQUIRED)

# ── Include paths ─────────────────────────────────────────────────────────────
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/lib
    ${CMAKE_CURRENT_SOURCE_DIR}/pvac/include
    ${OPENSSL_INCLUDE_DIR}
)

# ── Sources ───────────────────────────────────────────────────────────────────
set(SOURCES
    src/main.cpp
    lib/tweetnacl.c
    lib/randombytes.c
)

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/pvac/pvac_c_api.cpp")
    list(APPEND SOURCES pvac/pvac_c_api.cpp)
    message(STATUS "  PVAC C API: found")
else()
    message(WARNING "  PVAC C API: NOT found — PVAC operations will fail at runtime")
endif()

# ── Executable ────────────────────────────────────────────────────────────────
add_executable(pvac_server ${SOURCES})

target_link_libraries(pvac_server
    OpenSSL::SSL
    OpenSSL::Crypto
    Threads::Threads
)

if(WIN32)
    target_link_libraries(pvac_server ws2_32 crypt32 bcrypt)
elseif(UNIX AND NOT APPLE)
    target_link_libraries(pvac_server dl)
endif()

# ── Install ───────────────────────────────────────────────────────────────────
install(TARGETS pvac_server DESTINATION bin)

# ── Summary ───────────────────────────────────────────────────────────────────
message(STATUS "PVAC Server ${PROJECT_VERSION}")
message(STATUS "  C++ Standard : ${CMAKE_CXX_STANDARD}")
message(STATUS "  Build Type   : ${CMAKE_BUILD_TYPE}")
message(STATUS "  OpenSSL      : ${OPENSSL_VERSION}")
