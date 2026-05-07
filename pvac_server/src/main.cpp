/*
    pvac-local-server v2.0.0
    Local PVAC operations server for OctWa wallet extension.

    Endpoints:
        GET  /health              -- liveness check
        POST /decrypt_to_public   -- build signed decrypt tx
        POST /stealth_send        -- build signed stealth send tx

    No auth token. Binds to 127.0.0.1 only (localhost).
    Default port: 9090. Pass custom port as first argument.

    Both heavy endpoints use parallel execution:
      - encrypt + get_balance run concurrently (saves ~5s)
      - stealth_send runs both range proofs concurrently (saves ~200s)

    License: GPL v2+
*/

#include <iostream>
#include <string>
#include <thread>
#include <future>
#include <atomic>
#include <csignal>
#include <chrono>
#include <ctime>
#include <algorithm>

#include "../lib/httplib.h"
#include "../lib/json.hpp"
#include "pvac_ops.hpp"
#include "pvac_ops_parallel.hpp"

extern "C" {
#include "../lib/tweetnacl.h"
}

using json = nlohmann::json;

static std::atomic<bool> g_running{true};

static void signal_handler(int) {
    g_running.store(false, std::memory_order_relaxed);
}

// -- Logging -------------------------------------------------------------------

static void log(const char* level, const std::string& msg) {
    auto now = std::chrono::system_clock::now();
    auto t   = std::chrono::system_clock::to_time_t(now);
    char buf[20];
    std::strftime(buf, sizeof(buf), "%H:%M:%S", std::localtime(&t));
    std::cout << "[" << buf << "] [" << level << "] " << msg << "\n";
    std::cout.flush();
}

static void log_info(const std::string& msg) { log("INFO ", msg); }
static void log_ok  (const std::string& msg) { log("OK   ", msg); }
static void log_err (const std::string& msg) { log("ERROR", msg); }

// -- Helpers -------------------------------------------------------------------

static json make_error(const std::string& msg) {
    return {{"success", false}, {"error", msg}};
}

static double now_ts() {
    return std::chrono::duration<double>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}

// Parse uint64 from JSON field -- accepts number or numeric string (BigInt from JS)
static bool parse_u64(const json& body, const char* field,
                      uint64_t& out, std::string& err) {
    if (!body.contains(field)) { err = std::string("Missing field: ") + field; return false; }
    const auto& v = body[field];
    try {
        if (v.is_number_unsigned()) { out = v.get<uint64_t>(); return true; }
        if (v.is_number_integer())  {
            int64_t s = v.get<int64_t>();
            if (s < 0) { err = "negative amount"; return false; }
            out = (uint64_t)s; return true;
        }
        if (v.is_string()) { out = std::stoull(v.get<std::string>()); return true; }
        err = std::string(field) + " must be number or string"; return false;
    } catch (const std::exception& e) { err = e.what(); return false; }
}

// Init PvacOps + resolve sk64 from request body
static bool init_pvac(const json& body, httplib::Response& res,
                      pvac::PvacOps& pvac_ops, std::vector<uint8_t>& sk64) {
    std::string priv_b64 = body.value("private_key", "");
    std::string pub_b64  = pvac::normalize_pub_b64(body.value("public_key", ""));
    if (priv_b64.empty()) {
        res.status = 400;
        res.set_content(make_error("Missing field: private_key").dump(), "application/json");
        return false;
    }
    try {
        sk64 = pvac::resolve_sk64(priv_b64, pub_b64);
    } catch (const std::exception& e) {
        res.status = 400;
        res.set_content(make_error(e.what()).dump(), "application/json");
        return false;
    }
    std::string seed32_b64 = octra::base64_encode(sk64.data(), 32);
    if (!pvac_ops.init(seed32_b64)) {
        res.status = 500;
        res.set_content(make_error("PVAC init failed -- check private_key").dump(), "application/json");
        return false;
    }
    return true;
}

// -- RPC URL parser -----------------------------------------------------------
// Splits "http://host:port/path" into (host, port, path) components.

struct RpcEndpoint {
    std::string host;
    std::string path;
    int         port = 80;
};

static RpcEndpoint parse_rpc_url(const std::string& rpc_url) {
    RpcEndpoint ep;
    std::string u = rpc_url;
    if (u.rfind("https://", 0) == 0) { u = u.substr(8); ep.port = 443; }
    else if (u.rfind("http://", 0) == 0) { u = u.substr(7); }
    auto slash = u.find('/');
    if (slash != std::string::npos) { ep.path = u.substr(slash); ep.host = u.substr(0, slash); }
    else { ep.path = "/rpc"; ep.host = u; }
    auto colon = ep.host.find(':');
    if (colon != std::string::npos) {
        ep.port = std::stoi(ep.host.substr(colon + 1));
        ep.host = ep.host.substr(0, colon);
    }
    return ep;
}

// -- Fresh cipher fetch -------------------------------------------------------
// Fetch the latest encrypted balance cipher for `address` directly from the
// node. Mirrors webcli's get_encrypted_balance() call.
//
// Returns the fresh cipher string, or empty string on failure.
// If the cipher changed, `balance_hint_out` is set to -1 (invalidated).

static std::string fetch_fresh_cipher(
    const std::string& rpc_url,
    const std::string& address,
    const std::string& pub_b64,
    const std::vector<uint8_t>& sk64,
    const std::string& current_cipher,
    int64_t& balance_hint_out)
{
    if (rpc_url.empty()) return current_cipher;

    try {
        auto ep = parse_rpc_url(rpc_url);
        httplib::Client cli(ep.host, ep.port);
        cli.set_connection_timeout(10, 0);
        cli.set_read_timeout(10, 0);

        std::string msg_str = "octra_encryptedBalance|" + address;
        std::string sig = octra::ed25519_sign_detached(
            reinterpret_cast<const uint8_t*>(msg_str.data()), msg_str.size(),
            sk64.data());

        json rpc_req;
        rpc_req["jsonrpc"] = "2.0";
        rpc_req["method"]  = "octra_encryptedBalance";
        rpc_req["params"]  = json::array({address, sig, pub_b64});
        rpc_req["id"]      = 1;

        auto r = cli.Post(ep.path, {{"Content-Type", "application/json"}},
                          rpc_req.dump(), "application/json");
        if (!r || r->status != 200) {
            log_err("fetch_fresh_cipher: HTTP " + (r ? std::to_string(r->status) : "no response"));
            return current_cipher;
        }

        auto resp = json::parse(r->body);
        if (!resp.contains("result")) {
            if (resp.contains("error"))
                log_err("fetch_fresh_cipher RPC error: " + resp["error"].dump().substr(0, 80));
            return current_cipher;
        }

        auto& res_val = resp["result"];
        std::string fresh;
        if (res_val.is_object())      fresh = res_val.value("cipher", "");
        else if (res_val.is_string()) fresh = res_val.get<std::string>();

        if (fresh.empty() || fresh == "0" || fresh.rfind("hfhe_v1|", 0) != 0) {
            log_info("fetch_fresh_cipher: node returned unusable cipher ('" +
                     fresh.substr(0, 20) + "')");
            return current_cipher;
        }

        bool changed = (fresh != current_cipher);
        log_info("Fresh cipher  len=" + std::to_string(fresh.size()) +
                 (changed ? "  [DIFFERENT - invalidating balance hint]"
                          : "  [same - keeping balance hint]"));
        if (changed) balance_hint_out = -1;
        return fresh;

    } catch (const std::exception& e) {
        log_err(std::string("fetch_fresh_cipher exception: ") + e.what());
        return current_cipher;
    }
}

// -- Fresh nonce helper -------------------------------------------------------
// Fetch the latest nonce for `address` from the node, including staging check.
// Returns the next nonce to use (pending_nonce + 1, or staging max + 1).

static int fetch_fresh_nonce(
    const RpcEndpoint& ep,
    const std::string& address,
    int fallback_nonce)
{
    try {
        httplib::Client cli(ep.host, ep.port);
        cli.set_connection_timeout(10, 0);
        cli.set_read_timeout(10, 0);

        // 1. Get balance (confirmed + pending nonce)
        json rpc_req;
        rpc_req["jsonrpc"] = "2.0";
        rpc_req["method"]  = "octra_balance";
        rpc_req["params"]  = json::array({address});
        rpc_req["id"]      = 10;
        auto r = cli.Post(ep.path, {{"Content-Type", "application/json"}},
                          rpc_req.dump(), "application/json");
        if (!r || r->status != 200) return fallback_nonce;

        auto resp = json::parse(r->body);
        if (!resp.contains("result") || !resp["result"].is_object()) return fallback_nonce;

        int confirmed = resp["result"].value("nonce", fallback_nonce - 1);
        int pending   = resp["result"].value("pending_nonce", confirmed);

        // Use confirmed_nonce + 1 as the base.
        // pending_nonce can be far ahead if there are many unconfirmed txs,
        // causing "nonce too far ahead". The node only accepts nonces within
        // a small gap from the confirmed nonce.
        // If confirmed+1 is already taken by a pending tx, the node will
        // reject with "duplicate nonce" — but that's better than "too far ahead".
        int next = confirmed + 1;

        // Only advance past confirmed+1 if staging shows our tx already there
        // (to avoid duplicate nonce collision with our own pending txs).
        json staging_req;
        staging_req["jsonrpc"] = "2.0";
        staging_req["method"]  = "staging_view";
        staging_req["params"]  = json::array();
        staging_req["id"]      = 11;
        auto rs = cli.Post(ep.path, {{"Content-Type", "application/json"}},
                           staging_req.dump(), "application/json");
        if (rs && rs->status == 200) {
            try {
                auto sr = json::parse(rs->body);
                auto& sdata = sr.contains("result") ? sr["result"] : sr;
                auto txs = sdata.value("transactions",
                           sdata.value("staged_transactions", json::array()));
                for (auto& stx : txs) {
                    if (stx.value("from", "") == address) {
                        int sn = stx.value("nonce", 0);
                        if (sn >= next) next = sn + 1;
                    }
                }
            } catch (...) {}
        }

        log_info("fetch_fresh_nonce  confirmed=" + std::to_string(confirmed)
                 + "  pending=" + std::to_string(pending)
                 + "  next=" + std::to_string(next));
        return next;
    } catch (...) {
        return fallback_nonce;
    }
}

// -- Helper: re-sign a tx with a new nonce ------------------------------------

static void resign_tx_with_nonce(
    json& tx_data,
    int new_nonce,
    const std::vector<uint8_t>& sk64,
    const std::string& pub_b64)
{
    tx_data["nonce"] = new_nonce;
    octra::Transaction tx;
    tx.from           = tx_data["from"].get<std::string>();
    tx.to_            = tx_data["to_"].get<std::string>();
    tx.amount         = tx_data["amount"].get<std::string>();
    tx.nonce          = new_nonce;
    tx.ou             = tx_data["ou"].get<std::string>();
    tx.timestamp      = tx_data["timestamp"].get<double>();
    tx.op_type        = tx_data["op_type"].get<std::string>();
    tx.encrypted_data = tx_data["encrypted_data"].get<std::string>();
    std::string msg   = octra::canonical_json(tx);
    tx.signature      = octra::ed25519_sign_detached(
        reinterpret_cast<const uint8_t*>(msg.data()), msg.size(), sk64.data());
    tx.public_key     = pub_b64;
    tx_data           = octra::build_tx_json(tx);
}

//
// Body: { private_key, public_key, address, amount, current_cipher, nonce, ou, timestamp? }
// Returns: { success: true, tx: { ...signed tx... } }
//
// Parallel optimizations:
//   - encrypt(amount) and get_balance(current_cipher) run concurrently

static void handle_decrypt_to_public(const httplib::Request& req, httplib::Response& res) {
    log_info("POST /decrypt_to_public  body_len=" + std::to_string(req.body.size()));
    auto t0 = std::chrono::steady_clock::now();

    json body;
    try { body = json::parse(req.body); }
    catch (const std::exception& e) {
        log_err(std::string("JSON parse: ") + e.what());
        res.status = 400; res.set_content(make_error("Invalid JSON").dump(), "application/json"); return;
    }

    for (const char* f : {"private_key", "public_key", "address", "amount", "current_cipher", "nonce"}) {
        if (!body.contains(f)) {
            std::string msg = std::string("Missing field: ") + f;
            log_err(msg); res.status = 400; res.set_content(make_error(msg).dump(), "application/json"); return;
        }
    }

    uint64_t amount = 0; std::string err;
    if (!parse_u64(body, "amount", amount, err)) {
        log_err(err); res.status = 400; res.set_content(make_error(err).dump(), "application/json"); return;
    }

    std::string address    = body["address"].get<std::string>();
    std::string cur_cipher = body["current_cipher"].get<std::string>();
    std::string pub_b64    = pvac::normalize_pub_b64(body["public_key"].get<std::string>());
    int         nonce      = body["nonce"].get<int>();
    std::string ou         = body.value("ou", "10000");
    double      timestamp  = body.value("timestamp", now_ts());
    std::string rpc_url    = body.value("rpc_url", "");

    // Accept pre-computed current_balance from extension (WASM-decrypted).
    int64_t current_balance_hint = -1;
    if (body.contains("current_balance")) {
        uint64_t cb = 0; std::string cberr;
        if (parse_u64(body, "current_balance", cb, cberr))
            current_balance_hint = (int64_t)cb;
    }

    // Trust the cipher sent by the browser -- it already fetched fresh data
    // from the node before calling this endpoint. Server-side re-fetch can
    // return a different cipher causing balance mismatch.
    log_info("amount=" + std::to_string(amount) + "  nonce=" + std::to_string(nonce)
             + "  threads=" + std::to_string(pvac::thread_budget())
             + "  cipher_len=" + std::to_string(cur_cipher.size())
             + (current_balance_hint >= 0 ? "  balance_hint=" + std::to_string(current_balance_hint) : ""));

    pvac::PvacOps pvac_ops;
    std::vector<uint8_t> sk64;
    if (!init_pvac(body, res, pvac_ops, sk64)) return;
    log_info("PVAC keypair derived");

    auto result = pvac::decrypt_to_public_parallel(
        pvac_ops, pvac_ops.bridge_ref(),
        (int64_t)amount, cur_cipher, address, nonce,
        sk64.data(), pub_b64, timestamp, ou, current_balance_hint);

    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                  std::chrono::steady_clock::now() - t0).count();

    if (!result.success) {
        log_err("decrypt_to_public failed in " + std::to_string(ms) + "ms: " + result.error);
        res.status = 500; res.set_content(make_error(result.error).dump(), "application/json"); return;
    }

    // Note: nonce is trusted from the browser — it fetches fresh nonce before
    // calling this endpoint. Server-side re-sign is disabled to avoid
    // "nonce too far ahead" caused by pending_nonce being far ahead of confirmed.
    log_ok("decrypt_to_public done in " + std::to_string(ms) + "ms");
    json resp = {{"success", true}, {"tx", result.tx_data}};
    res.set_content(resp.dump(), "application/json");
}

// -- POST /stealth_send --------------------------------------------------------
//
// Body: { private_key, public_key, from_address, to_address, amount,
//         current_cipher, recipient_view_pubkey, nonce, ou, timestamp? }
// Returns: { success: true, tx: { ...signed tx... } }
//
// Parallel optimizations:
//   - encrypt(amount) and get_balance(current_cipher) run concurrently
//   - make_range_proof(ct_delta) and make_range_proof(ct_new) run concurrently

static void handle_stealth_send(const httplib::Request& req, httplib::Response& res) {
    log_info("POST /stealth_send  body_len=" + std::to_string(req.body.size()));
    auto t0 = std::chrono::steady_clock::now();

    json body;
    try { body = json::parse(req.body); }
    catch (const std::exception& e) {
        log_err(std::string("JSON parse: ") + e.what());
        res.status = 400; res.set_content(make_error("Invalid JSON").dump(), "application/json"); return;
    }

    for (const char* f : {"private_key", "public_key", "from_address", "to_address",
                           "amount", "current_cipher", "recipient_view_pubkey", "nonce"}) {
        if (!body.contains(f)) {
            std::string msg = std::string("Missing field: ") + f;
            log_err(msg); res.status = 400; res.set_content(make_error(msg).dump(), "application/json"); return;
        }
    }

    uint64_t amount = 0; std::string err;
    if (!parse_u64(body, "amount", amount, err)) {
        log_err(err); res.status = 400; res.set_content(make_error(err).dump(), "application/json"); return;
    }

    std::string to_addr    = body["to_address"].get<std::string>();
    std::string from_addr  = body["from_address"].get<std::string>();
    std::string cur_cipher = body["current_cipher"].get<std::string>();
    std::string rcpt_vpub  = body["recipient_view_pubkey"].get<std::string>();
    std::string pub_b64    = pvac::normalize_pub_b64(body["public_key"].get<std::string>());
    int         nonce      = body["nonce"].get<int>();
    std::string ou         = body.value("ou", "5000");
    double      timestamp  = body.value("timestamp", now_ts());
    std::string rpc_url    = body.value("rpc_url", "");

    // Trust the cipher sent by the browser -- it already fetched fresh data
    // from the node before calling this endpoint. Server-side re-fetch can
    // return a different cipher (e.g. different wallet on same node) causing
    // "Insufficient encrypted balance" even when the balance is sufficient.
    log_info("from=" + from_addr.substr(0, 12) + "  to=" + to_addr.substr(0, 12)
             + "  amount=" + std::to_string(amount)
             + "  cipher_len=" + std::to_string(cur_cipher.size()));
    log_info("threads=" + std::to_string(pvac::thread_budget()));

    pvac::PvacOps pvac_ops;
    std::vector<uint8_t> sk64;
    if (!init_pvac(body, res, pvac_ops, sk64)) return;
    log_info("PVAC keypair derived");

    auto result = pvac::stealth_send_parallel(
        pvac_ops, pvac_ops.bridge_ref(),
        to_addr, (int64_t)amount, cur_cipher, rcpt_vpub,
        from_addr, nonce, sk64.data(), pub_b64, timestamp, ou);

    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                  std::chrono::steady_clock::now() - t0).count();

    if (!result.success) {
        log_err("stealth_send failed in " + std::to_string(ms) + "ms: " + result.error);
        res.status = 500; res.set_content(make_error(result.error).dump(), "application/json"); return;
    }

    // Note: nonce is trusted from the browser — same as stealth_send.
    log_ok("stealth_send done in " + std::to_string(ms) + "ms");
    json resp = {{"success", true}, {"tx", result.tx_data}};
    res.set_content(resp.dump(), "application/json");
}

// -- GET /health ---------------------------------------------------------------

static void handle_health(const httplib::Request&, httplib::Response& res) {
    unsigned hw = std::thread::hardware_concurrency();
    json j = {
        {"status",  "ok"},
        {"version", "2.0.0"},
        {"service", "pvac-local-server"},
        {"threads", pvac::thread_budget()},
        {"cores",   hw},
    };
    res.set_content(j.dump(), "application/json");
}

// -- main ----------------------------------------------------------------------

int main(int argc, char* argv[]) {
    int port = 9090;
    if (argc > 1) {
        try { int p = std::stoi(argv[1]); if (p > 0 && p < 65536) port = p; } catch (...) {}
    }

    std::signal(SIGINT,  signal_handler);
    std::signal(SIGTERM, signal_handler);
#ifndef _WIN32
    std::signal(SIGPIPE, SIG_IGN);
#endif

    unsigned hw      = std::thread::hardware_concurrency();
    unsigned budget  = pvac::thread_budget();

    std::cout <<
        "\n"
        "==========================================\n"
        "  pvac-local-server  v2.0.0\n"
        "  PVAC Operations Server for OctWa\n"
        "==========================================\n\n"
        "  Listening : http://127.0.0.1:" << port << "\n"
        "  CPU cores : " << hw << " logical  (" << budget << " used, 80%)\n"
        "  Endpoints :\n"
        "    GET  /health\n"
        "    POST /decrypt_to_public\n"
        "    POST /stealth_send\n\n"
        "  Press Ctrl+C to stop.\n\n";

    httplib::Server svr;
    svr.set_read_timeout(600, 0);
    svr.set_write_timeout(600, 0);

    // CORS
    svr.set_post_routing_handler([](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin",  "*");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
    });
    svr.Options(".*", [](const httplib::Request&, httplib::Response& res) { res.status = 204; });

    svr.set_exception_handler([](const httplib::Request& req, httplib::Response& res,
                                  std::exception_ptr ep) {
        std::string msg = "internal error";
        try { if (ep) std::rethrow_exception(ep); }
        catch (const std::exception& e) { msg = e.what(); }
        catch (...) {}
        log_err(req.method + " " + req.path + " unhandled: " + msg);
        res.status = 500;
        res.set_content(make_error(msg).dump(), "application/json");
    });

    svr.Get("/health",             handle_health);
    svr.Post("/decrypt_to_public", handle_decrypt_to_public);
    svr.Post("/stealth_send",      handle_stealth_send);

    if (!svr.bind_to_port("127.0.0.1", port)) {
        std::cerr << "[ERROR] Failed to bind to port " << port
                  << " -- is another instance already running?\n";
        return 1;
    }

    std::thread listen_thread([&svr]() { svr.listen_after_bind(); });

    while (g_running.load(std::memory_order_relaxed)) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    std::cout << "\n[INFO] Shutting down...\n";
    svr.stop();
    if (listen_thread.joinable()) listen_thread.join();
    std::cout << "[INFO] Stopped.\n";
    return 0;
}
