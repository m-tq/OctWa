cmake_minimum_required(VERSION 3.15)
project(pvac_server VERSION 2.0.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)

# ── Static binary option (default ON) ────────────────────────────────────────
# Produces a single self-contained executable with no runtime DLL/SO deps.
option(PVAC_STATIC "Build fully static binary (no runtime DLL/SO dependencies)" ON)

# ── Compiler flags ────────────────────────────────────────────────────────────
if(MSVC)
    add_compile_options(/W4 /O2 /EHsc /arch:AVX2)
    if(PVAC_STATIC)
        # Static CRT on MSVC
        set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    endif()
else()
    # PVAC library requires hardware AES-NI + SSE2 (x86_64)
    add_compile_options(
        -Wall -Wextra -O2
        -maes -msse2 -msse4.1
        -fstack-protector-strong
        -fno-strict-overflow
        -Wno-unused-parameter
        -Wno-unused-but-set-variable
        -Wno-redundant-decls
        -Wno-parentheses
    )
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        add_compile_options(-fsanitize=address,undefined -g)
        add_link_options(-fsanitize=address,undefined)
        message(STATUS "  ASan/UBSan: ENABLED (Debug build)")
    endif()
    if(PVAC_STATIC)
        # Static link: libstdc++, libgcc, and (on Linux) attempt full static
        add_link_options(-static-libstdc++ -static-libgcc)
        if(UNIX AND NOT APPLE)
            # On Linux with glibc, -static can cause issues with DNS/threads.
            # Use partial static: static libstdc++/libgcc, dynamic glibc.
            # For fully static, build on Alpine/musl or use -static carefully.
            message(STATUS "  Static: libstdc++ + libgcc (glibc dynamic)")
        endif()
    endif()
endif()

# ── OpenSSL: prefer static libs ───────────────────────────────────────────────
if(PVAC_STATIC)
    # Tell OpenSSL headers we are linking statically — prevents __declspec(dllimport)
    # which would force dynamic linking even when .a is specified.
    add_compile_definitions(OPENSSL_STATIC)
    # Tell FindOpenSSL to prefer static (.a) over shared (.so/.dll)
    set(OPENSSL_USE_STATIC_LIBS TRUE)
    # On Windows with Strawberry Perl, static libs are libssl.a / libcrypto.a
    if(WIN32)
        set(OPENSSL_MSVC_STATIC_RT TRUE)
    endif()
endif()

find_package(OpenSSL REQUIRED)
find_package(Threads REQUIRED)

# ── Include paths ─────────────────────────────────────────────────────────────
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/lib
    ${CMAKE_CURRENT_SOURCE_DIR}/pvac
    ${CMAKE_CURRENT_SOURCE_DIR}/pvac/include
    ${OPENSSL_INCLUDE_DIR}
)

# ── Sources ───────────────────────────────────────────────────────────────────
set(SOURCES
    src/main.cpp
    lib/tweetnacl.c
    lib/randombytes.c
)

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/wasm/pvac_wasm_bridge.c")
    list(APPEND SOURCES wasm/pvac_wasm_bridge.c)
endif()

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/pvac/pvac_c_api.cpp")
    list(APPEND SOURCES pvac/pvac_c_api.cpp)
    message(STATUS "  PVAC C API: found")
else()
    message(WARNING "  PVAC C API: NOT found")
endif()

# ── Executable ────────────────────────────────────────────────────────────────
add_executable(pvac_server ${SOURCES})

# ── Link libraries ────────────────────────────────────────────────────────────
if(PVAC_STATIC AND NOT MSVC)
    # Note: Strawberry Perl's libcrypto.a is an import library (not true static).
    # We link against it normally and bundle the DLL next to the exe.
    target_link_libraries(pvac_server
        OpenSSL::SSL
        OpenSSL::Crypto
        Threads::Threads
    )
    message(STATUS "  OpenSSL: via import library (DLL will be bundled)")
else()
    target_link_libraries(pvac_server
        OpenSSL::SSL
        OpenSSL::Crypto
        Threads::Threads
    )
endif()

if(WIN32)
    target_link_libraries(pvac_server ws2_32 crypt32 bcrypt)
    if(PVAC_STATIC AND NOT MSVC)
        # Force static linking on Windows MinGW
        target_link_options(pvac_server PRIVATE -static)
        # pvac_c_api.cpp uses OpenSSL internally and may still need the DLL.
        # Copy it next to the exe so users only need the build/ folder.
        if(OPENSSL_ROOT_DIR AND EXISTS "${OPENSSL_ROOT_DIR}/bin/libcrypto-3-x64__.dll")
            add_custom_command(TARGET pvac_server POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${OPENSSL_ROOT_DIR}/bin/libcrypto-3-x64__.dll"
                    $<TARGET_FILE_DIR:pvac_server>
                COMMENT "Bundling libcrypto-3-x64__.dll next to pvac_server.exe"
            )
            message(STATUS "  libcrypto DLL: bundled in build dir")
        endif()
    endif()
elseif(UNIX AND NOT APPLE)
    target_link_libraries(pvac_server dl)
endif()

# ── Strip release binary ──────────────────────────────────────────────────────
if(CMAKE_BUILD_TYPE STREQUAL "Release" AND NOT MSVC)
    add_custom_command(TARGET pvac_server POST_BUILD
        COMMAND ${CMAKE_STRIP} $<TARGET_FILE:pvac_server>
        COMMENT "Stripping debug symbols from release binary"
    )
endif()

# ── Install ───────────────────────────────────────────────────────────────────
install(TARGETS pvac_server DESTINATION bin)

# ── Summary ───────────────────────────────────────────────────────────────────
message(STATUS "pvac-local-server ${PROJECT_VERSION}")
message(STATUS "  C++ Standard : ${CMAKE_CXX_STANDARD}")
message(STATUS "  Build Type   : ${CMAKE_BUILD_TYPE}")
message(STATUS "  OpenSSL      : ${OPENSSL_VERSION}")
message(STATUS "  Static binary: ${PVAC_STATIC}")
