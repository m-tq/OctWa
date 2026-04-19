/*
    Request Logger — thread-safe, header-only with inline static storage
*/
#pragma once
#include <string>
#include <iostream>
#include <iomanip>
#include <sstream>
#include <chrono>
#include <random>
#include <mutex>

namespace pvac {

class Logger {
public:
    static std::mutex& mutex() {
        static std::mutex m;
        return m;
    }

    static std::string generate_job_id() {
        static std::mt19937 gen(std::random_device{}());
        static std::uniform_int_distribution<> dis(0, 35);
        const char chars[] = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        std::string id;
        id.reserve(8);
        for (int i = 0; i < 8; i++) id += chars[dis(gen)];
        return id;
    }

    static std::string timestamp() {
        auto now = std::chrono::system_clock::now();
        auto t   = std::chrono::system_clock::to_time_t(now);
        auto ms  = std::chrono::duration_cast<std::chrono::milliseconds>(
                       now.time_since_epoch()) % 1000;
        std::ostringstream ss;
        ss << std::put_time(std::localtime(&t), "%H:%M:%S")
           << '.' << std::setfill('0') << std::setw(3) << ms.count();
        return ss.str();
    }

    static std::string start_request(const std::string& endpoint) {
        std::lock_guard<std::mutex> lk(mutex());
        std::string jid = generate_job_id();
        std::cout << "\n[" << timestamp() << "] [REQUEST] " << endpoint
                  << " [JOB:" << jid << "]\n";
        return jid;
    }

    static void log_step(const std::string& jid, const std::string& msg) {
        std::lock_guard<std::mutex> lk(mutex());
        std::cout << "[" << timestamp() << "] [" << jid << "] " << msg << "\n";
    }

    static void log_success(const std::string& jid, const std::string& msg = "") {
        std::lock_guard<std::mutex> lk(mutex());
        std::cout << "[" << timestamp() << "] [" << jid << "] [OK]";
        if (!msg.empty()) std::cout << " " << msg;
        std::cout << "\n";
    }

    static void log_error(const std::string& jid, const std::string& err) {
        std::lock_guard<std::mutex> lk(mutex());
        std::cerr << "[" << timestamp() << "] [" << jid << "] [ERR] " << err << "\n";
    }

    static void log_warn(const std::string& jid, const std::string& msg) {
        std::lock_guard<std::mutex> lk(mutex());
        std::cout << "[" << timestamp() << "] [" << jid << "] [WARN] " << msg << "\n";
    }

    static void info(const std::string& msg) {
        std::lock_guard<std::mutex> lk(mutex());
        std::cout << "[" << timestamp() << "] [INFO] " << msg << "\n";
    }
};

} // namespace pvac
