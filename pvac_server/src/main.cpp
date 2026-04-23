/*
    PVAC Server — Local Cryptographic Operations Server

    Handles heavy cryptographic operations for OctWa wallet extension:
      - Encrypted balance decryption
      - Balance encryption / decryption
      - Stealth send / claim / scan

    Security:
      - Binds to 127.0.0.1 only
      - Auth token required on every request
      - Private keys never stored; used only for the duration of a request

    License: GPL v2+
*/

#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <csignal>
#include <chrono>
#include <cstdlib>

#include "auth.hpp"
#include "server.hpp"
#include "logger.hpp"

// ── Global shutdown flag ──────────────────────────────────────────────────────
static std::atomic<bool> g_running{true};

static void signal_handler(int sig) {
    (void)sig;
    // Write is async-signal-safe; std::cout is not, but acceptable for debug
    const char msg[] = "\n[SIGNAL] Shutdown requested...\n";
    (void)write(STDOUT_FILENO, msg, sizeof(msg) - 1);
    g_running.store(false, std::memory_order_relaxed);
}

// ── Banner / info ─────────────────────────────────────────────────────────────
static void print_banner() {
    std::cout <<
        "\n"
        "============================================================\n"
        "   ____  _   _____   ____                                   \n"
        "  |  _ \\| | / / _ \\ / ___|                                \n"
        "  | |_) | |/ / |_| | |                                      \n"
        "  |  __/|   <|  _  | |___                                   \n"
        "  |_|   |_|\\_\\_| |_|\\____|                              \n"
        "                                                             \n"
        "  PVAC Server v1.0.0                                        \n"
        "  Publicly Verifiable Arithmetic Computations               \n"
        "  Local Cryptographic Operations for OctWa Wallet           \n"
        "============================================================\n\n";
}

static void print_info(const std::string& token_path,
                       const std::string& token,
                       int port) {
    std::cout <<
        "\n[SERVER INFO]\n"
        "------------------------------------------------------------\n"
        "  HTTP Address : http://127.0.0.1:" << port << "\n"
        "  Token File   : " << token_path << "\n"
        "  Auth Token   : " << token << "\n"
        "------------------------------------------------------------\n"
        "  Endpoints:\n"
        "    GET  /health\n"
        "    POST /api/ensure_pvac_registered\n"
        "    POST /api/get_pvac_pubkey\n"
        "    POST /api/decrypt_balance\n"
        "    POST /api/encrypt_balance\n"
        "    POST /api/decrypt_to_public\n"
        "    POST /api/stealth_send\n"
        "    POST /api/claim_stealth\n"
        "    POST /api/scan_stealth\n"
        "============================================================\n\n";
}

// ── main ──────────────────────────────────────────────────────────────────────
int main(int argc, char* argv[]) {
    // Parse port argument
    int port = 8765;
    if (argc > 1) {
        try {
            int p = std::stoi(argv[1]);
            if (p > 0 && p < 65536) port = p;
            else std::cerr << "[WARN] Invalid port, using default 8765\n";
        } catch (...) {
            std::cerr << "[WARN] Invalid port argument, using default 8765\n";
        }
    }

    print_banner();

    // Install signal handlers
    std::signal(SIGINT,  signal_handler);
    std::signal(SIGTERM, signal_handler);
#ifndef _WIN32
    std::signal(SIGPIPE, SIG_IGN); // ignore broken pipe
#endif

    try {
        // ── Auth ──────────────────────────────────────────────────────────────
        pvac::Auth auth;
        if (!auth.init()) {
            std::cerr << "[FATAL] Failed to initialize authentication\n";
            return 1;
        }

        // ── Server ────────────────────────────────────────────────────────────
        pvac::Server server(port, auth);
        if (!server.start()) {
            std::cerr << "[FATAL] Failed to start server on port " << port << "\n";
            return 1;
        }

        print_info(auth.get_token_path(), auth.get_token(), port);
        pvac::Logger::info("Server ready. Press Ctrl+C to stop.");

        // ── Main loop — wait for shutdown signal ──────────────────────────────
        while (g_running.load(std::memory_order_relaxed)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }

        // ── Graceful shutdown ─────────────────────────────────────────────────
        pvac::Logger::info("Shutting down...");
        server.stop();
        pvac::Logger::info("Server stopped. Goodbye!");

    } catch (const std::exception& e) {
        std::cerr << "[FATAL] Unhandled exception: " << e.what() << "\n";
        return 1;
    } catch (...) {
        std::cerr << "[FATAL] Unknown exception\n";
        return 1;
    }

    return 0;
}
