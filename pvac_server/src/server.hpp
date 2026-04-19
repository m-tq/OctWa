/*
    HTTP Server
    Runs httplib::Server on a background thread so main() can handle signals.
    All routes registered before listen() is called.
*/
#pragma once
#include <string>
#include <thread>
#include <atomic>
#include <memory>
#include <stdexcept>
#include "../lib/httplib.h"
#include "auth.hpp"
#include "handlers.hpp"
#include "logger.hpp"

namespace pvac {

class Server {
    int                              port_;
    Auth&                            auth_;
    std::unique_ptr<httplib::Server> svr_;
    std::unique_ptr<Handlers>        handlers_;
    std::thread                      listen_thread_;
    std::atomic<bool>                started_{false};

public:
    Server(int port, Auth& auth)
        : port_(port), auth_(auth) {}

    ~Server() { stop(); }

    // Non-copyable, non-movable
    Server(const Server&)            = delete;
    Server& operator=(const Server&) = delete;

    bool start() {
        if (started_) return false;

        // Create fresh server and handlers
        svr_      = std::make_unique<httplib::Server>();
        handlers_ = std::make_unique<Handlers>(auth_);

        // Timeouts
        svr_->set_read_timeout(60, 0);
        svr_->set_write_timeout(60, 0);
        svr_->set_keep_alive_timeout(30);
        svr_->set_keep_alive_max_count(100);

        // CORS pre-flight
        svr_->set_post_routing_handler([](const httplib::Request&,
                                          httplib::Response& res) {
            res.set_header("Access-Control-Allow-Origin",  "*");
            res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.set_header("Access-Control-Allow-Headers",
                           "Content-Type, Authorization");
        });
        svr_->Options(".*", [](const httplib::Request&, httplib::Response& res) {
            res.status = 204;
        });

        // Exception handler — prevents server crash on handler exceptions
        svr_->set_exception_handler(
            [](const httplib::Request& req, httplib::Response& res,
               std::exception_ptr ep) {
                std::string msg = "internal error";
                try {
                    if (ep) std::rethrow_exception(ep);
                } catch (const std::exception& e) {
                    msg = e.what();
                } catch (...) {}
                Logger::info("[EXCEPTION] " + req.method + " " + req.path + ": " + msg);
                res.status = 500;
                json j = {{"success", false}, {"error", msg}};
                res.set_content(j.dump(), "application/json");
            });

        // Error handler for unknown routes
        svr_->set_error_handler([](const httplib::Request& req,
                                   httplib::Response& res) {
            if (res.body.empty()) {
                json j = {{"success", false},
                          {"error", "Not found: " + req.method + " " + req.path}};
                res.set_content(j.dump(), "application/json");
            }
        });

        // ── Routes ────────────────────────────────────────────────────────────
        // Capture raw pointer — safe because handlers_ outlives all requests
        // (we join the thread before destroying handlers_)
        Handlers* h = handlers_.get();

        svr_->Get("/health",
            [h](const httplib::Request& req, httplib::Response& res) {
                h->handle_health(req, res);
            });

        svr_->Post("/api/decrypt_balance",
            [h](const httplib::Request& req, httplib::Response& res) {
                h->handle_decrypt_balance(req, res);
            });

        svr_->Post("/api/encrypt_balance",
            [h](const httplib::Request& req, httplib::Response& res) {
                h->handle_encrypt_balance(req, res);
            });

        svr_->Post("/api/decrypt_to_public",
            [h](const httplib::Request& req, httplib::Response& res) {
                h->handle_decrypt_to_public(req, res);
            });

        svr_->Post("/api/stealth_send",
            [h](const httplib::Request& req, httplib::Response& res) {
                h->handle_stealth_send(req, res);
            });

        svr_->Post("/api/claim_stealth",
            [h](const httplib::Request& req, httplib::Response& res) {
                h->handle_claim_stealth(req, res);
            });

        svr_->Post("/api/scan_stealth",
            [h](const httplib::Request& req, httplib::Response& res) {
                h->handle_scan_stealth(req, res);
            });

        // Bind before spawning thread so we can detect port conflicts early
        if (!svr_->bind_to_port("127.0.0.1", port_)) {
            Logger::info("[ERROR] Failed to bind to port " + std::to_string(port_));
            return false;
        }

        started_ = true;

        // Run listen loop on a background thread
        listen_thread_ = std::thread([this]() {
            Logger::info("Listening on 127.0.0.1:" + std::to_string(port_));
            svr_->listen_after_bind();
            Logger::info("Listen loop exited");
        });

        return true;
    }

    void stop() {
        if (!started_) return;
        started_ = false;

        if (svr_) svr_->stop();

        if (listen_thread_.joinable()) listen_thread_.join();

        // Destroy in correct order: handlers before server
        handlers_.reset();
        svr_.reset();
    }

    bool is_running() const { return started_.load(); }
};

} // namespace pvac
