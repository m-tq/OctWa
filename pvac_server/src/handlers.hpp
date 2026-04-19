/*
    Request Handlers — one handler per endpoint, no code duplication.
    All PVAC handles freed via RAII in pvac_ops.hpp.
*/
#pragma once
#include <string>
#include <chrono>
#include "../lib/httplib.h"
#include "../lib/json.hpp"
#include "auth.hpp"
#include "pvac_ops.hpp"
#include "logger.hpp"

using json = nlohmann::json;

namespace pvac {

class Handlers {
    Auth& auth_;

    // ── Helpers ───────────────────────────────────────────────────────────────

    static json err(const std::string& msg) {
        return {{"success", false}, {"error", msg}};
    }

    static json ok_base(const std::string& jid) {
        return {{"success", true}, {"job_id", jid}};
    }

    bool check_auth(const httplib::Request& req,
                    httplib::Response& res,
                    const std::string& jid) {
        auto hdr = req.get_header_value("Authorization");
        bool valid = (hdr.size() > 7 &&
                      hdr.substr(0, 7) == "Bearer " &&
                      auth_.validate(hdr.substr(7)));
        if (!valid) {
            Logger::log_error(jid, "Authentication failed");
            res.status = 401;
            res.set_content(err("Unauthorized").dump(), "application/json");
        }
        return valid;
    }

    bool parse_body(const httplib::Request& req,
                    httplib::Response& res,
                    const std::string& jid,
                    json& out) {
        try {
            out = json::parse(req.body);
            return true;
        } catch (const std::exception& e) {
            Logger::log_error(jid, std::string("JSON parse error: ") + e.what());
            res.status = 400;
            res.set_content(err("Invalid JSON").dump(), "application/json");
            return false;
        }
    }

    static double now_ts() {
        return std::chrono::duration<double>(
            std::chrono::system_clock::now().time_since_epoch()).count();
    }

    // Resolve sk64 and initialise PvacOps.
    // Returns false and sets res on error.
    static bool init_pvac(const json& body,
                          httplib::Response& res,
                          const std::string& jid,
                          PvacOps& pvac,
                          std::vector<uint8_t>& sk64) {
        std::string priv_b64 = body.value("private_key", "");
        std::string pub_b64  = body.value("public_key",  "");
        if (priv_b64.empty()) {
            Logger::log_error(jid, "Missing private_key");
            res.status = 400;
            res.set_content(err("Missing private_key").dump(), "application/json");
            return false;
        }
        try {
            sk64 = resolve_sk64(priv_b64, pub_b64);
        } catch (const std::exception& e) {
            Logger::log_error(jid, e.what());
            res.status = 400;
            res.set_content(err(e.what()).dump(), "application/json");
            return false;
        }

        // PvacBridge only needs the 32-byte seed (first 32 bytes of sk64)
        std::string seed32_b64 = octra::base64_encode(sk64.data(), 32);
        if (!pvac.init(seed32_b64)) {
            Logger::log_error(jid, "PVAC init failed");
            res.status = 500;
            res.set_content(err("PVAC init failed").dump(), "application/json");
            return false;
        }
        Logger::log_step(jid, "PVAC initialized");
        return true;
    }

    static void send_result(httplib::Response& res,
                            const std::string& jid,
                            const PvacOps::TxResult& result) {
        if (!result.success) {
            res.status = 500;
            res.set_content(err(result.error).dump(), "application/json");
            return;
        }
        json resp = ok_base(jid);
        resp["tx"] = result.tx_data;
        res.set_content(resp.dump(), "application/json");
    }

public:
    explicit Handlers(Auth& auth) : auth_(auth) {}

    // ── GET /health ───────────────────────────────────────────────────────────
    void handle_health(const httplib::Request&, httplib::Response& res) {
        json j = {{"status", "ok"}, {"version", "1.0.0"}};
        res.set_content(j.dump(), "application/json");
    }

    // ── POST /api/decrypt_balance ─────────────────────────────────────────────
    void handle_decrypt_balance(const httplib::Request& req, httplib::Response& res) {
        auto jid = Logger::start_request("POST /api/decrypt_balance");
        if (!check_auth(req, res, jid)) return;

        json body;
        if (!parse_body(req, res, jid, body)) return;

        if (!body.contains("cipher") || !body.contains("private_key")) {
            Logger::log_error(jid, "Missing cipher or private_key");
            res.status = 400;
            res.set_content(err("Missing required fields: cipher, private_key").dump(),
                            "application/json");
            return;
        }

        std::string cipher = body["cipher"].get<std::string>();
        Logger::log_step(jid, "Cipher length: " + std::to_string(cipher.size()));

        PvacOps pvac;
        std::vector<uint8_t> sk64;
        if (!init_pvac(body, res, jid, pvac, sk64)) return;

        Logger::log_step(jid, "Decrypting balance...");
        auto result = pvac.decrypt_balance(cipher);
        if (!result.success) {
            Logger::log_error(jid, result.error);
            res.status = 500;
            res.set_content(err(result.error).dump(), "application/json");
            return;
        }

        Logger::log_success(jid, std::to_string(result.balance / 1e6) + " OCT");
        json resp = ok_base(jid);
        resp["balance"]     = result.balance;
        resp["balance_oct"] = result.balance / 1e6;
        res.set_content(resp.dump(), "application/json");
    }

    // ── POST /api/encrypt_balance ─────────────────────────────────────────────
    void handle_encrypt_balance(const httplib::Request& req, httplib::Response& res) {
        auto jid = Logger::start_request("POST /api/encrypt_balance");
        if (!check_auth(req, res, jid)) return;

        json body;
        if (!parse_body(req, res, jid, body)) return;

        for (const char* f : {"amount", "private_key", "public_key", "address", "nonce"}) {
            if (!body.contains(f)) {
                Logger::log_error(jid, std::string("Missing field: ") + f);
                res.status = 400;
                res.set_content(err(std::string("Missing field: ") + f).dump(), "application/json");
                return;
            }
        }

        int64_t amount = body["amount"].get<int64_t>();
        std::string address = body["address"].get<std::string>();
        int nonce = body["nonce"].get<int>();
        std::string ou = body.value("ou", "10000");
        std::string pub_b64 = body["public_key"].get<std::string>();

        Logger::log_step(jid, "amount=" + std::to_string(amount / 1e6) + " OCT  nonce=" + std::to_string(nonce));

        PvacOps pvac;
        std::vector<uint8_t> sk64;
        if (!init_pvac(body, res, jid, pvac, sk64)) return;

        Logger::log_step(jid, "Building encrypt tx...");
        auto result = pvac.encrypt_balance(amount, address, nonce,
                                           sk64.data(), pub_b64,
                                           now_ts(), ou);
        Logger::log_success(jid, "Encrypted " + std::to_string(amount / 1e6) + " OCT");
        send_result(res, jid, result);
    }

    // ── POST /api/decrypt_to_public ───────────────────────────────────────────
    void handle_decrypt_to_public(const httplib::Request& req, httplib::Response& res) {
        auto jid = Logger::start_request("POST /api/decrypt_to_public");
        if (!check_auth(req, res, jid)) return;

        json body;
        if (!parse_body(req, res, jid, body)) return;

        for (const char* f : {"amount", "private_key", "public_key",
                               "current_cipher", "address", "nonce"}) {
            if (!body.contains(f)) {
                Logger::log_error(jid, std::string("Missing field: ") + f);
                res.status = 400;
                res.set_content(err(std::string("Missing field: ") + f).dump(), "application/json");
                return;
            }
        }

        int64_t amount         = body["amount"].get<int64_t>();
        std::string address    = body["address"].get<std::string>();
        int nonce              = body["nonce"].get<int>();
        std::string ou         = body.value("ou", "10000");
        std::string pub_b64    = body["public_key"].get<std::string>();
        std::string cur_cipher = body["current_cipher"].get<std::string>();

        Logger::log_step(jid, "amount=" + std::to_string(amount / 1e6) + " OCT  nonce=" + std::to_string(nonce));

        PvacOps pvac;
        std::vector<uint8_t> sk64;
        if (!init_pvac(body, res, jid, pvac, sk64)) return;

        Logger::log_step(jid, "Building decrypt tx...");
        auto result = pvac.decrypt_to_public(amount, cur_cipher, address, nonce,
                                             sk64.data(), pub_b64,
                                             now_ts(), ou);
        Logger::log_success(jid, "Decrypted " + std::to_string(amount / 1e6) + " OCT");
        send_result(res, jid, result);
    }

    // ── POST /api/stealth_send ────────────────────────────────────────────────
    void handle_stealth_send(const httplib::Request& req, httplib::Response& res) {
        auto jid = Logger::start_request("POST /api/stealth_send");
        if (!check_auth(req, res, jid)) return;

        json body;
        if (!parse_body(req, res, jid, body)) return;

        for (const char* f : {"to_address", "amount", "private_key", "public_key",
                               "current_cipher", "recipient_view_pubkey",
                               "from_address", "nonce"}) {
            if (!body.contains(f)) {
                Logger::log_error(jid, std::string("Missing field: ") + f);
                res.status = 400;
                res.set_content(err(std::string("Missing field: ") + f).dump(), "application/json");
                return;
            }
        }

        std::string to_addr   = body["to_address"].get<std::string>();
        int64_t amount        = body["amount"].get<int64_t>();
        std::string pub_b64   = body["public_key"].get<std::string>();
        std::string cur_cipher= body["current_cipher"].get<std::string>();
        std::string rcpt_vpub = body["recipient_view_pubkey"].get<std::string>();
        std::string from_addr = body["from_address"].get<std::string>();
        int nonce             = body["nonce"].get<int>();
        std::string ou        = body.value("ou", "5000");

        Logger::log_step(jid, "from=" + from_addr + "  to=" + to_addr +
                              "  amount=" + std::to_string(amount / 1e6) + " OCT");

        PvacOps pvac;
        std::vector<uint8_t> sk64;
        if (!init_pvac(body, res, jid, pvac, sk64)) return;

        Logger::log_step(jid, "Building stealth tx...");
        auto result = pvac.stealth_send(to_addr, amount, cur_cipher, rcpt_vpub,
                                        from_addr, nonce, sk64.data(), pub_b64,
                                        now_ts(), ou);
        Logger::log_success(jid, "Stealth send " + std::to_string(amount / 1e6) + " OCT");
        send_result(res, jid, result);
    }

    // ── POST /api/claim_stealth ───────────────────────────────────────────────
    void handle_claim_stealth(const httplib::Request& req, httplib::Response& res) {
        auto jid = Logger::start_request("POST /api/claim_stealth");
        if (!check_auth(req, res, jid)) return;

        json body;
        if (!parse_body(req, res, jid, body)) return;

        for (const char* f : {"stealth_output", "private_key", "public_key",
                               "address", "nonce"}) {
            if (!body.contains(f)) {
                Logger::log_error(jid, std::string("Missing field: ") + f);
                res.status = 400;
                res.set_content(err(std::string("Missing field: ") + f).dump(), "application/json");
                return;
            }
        }

        json stealth_output = body["stealth_output"];
        std::string address = body["address"].get<std::string>();
        int nonce           = body["nonce"].get<int>();
        std::string ou      = body.value("ou", "3000");
        std::string pub_b64 = body["public_key"].get<std::string>();

        Logger::log_step(jid, "address=" + address + "  nonce=" + std::to_string(nonce));

        PvacOps pvac;
        std::vector<uint8_t> sk64;
        if (!init_pvac(body, res, jid, pvac, sk64)) return;

        Logger::log_step(jid, "Building claim tx...");
        auto result = pvac.claim_stealth(stealth_output, address, nonce,
                                         sk64.data(), pub_b64,
                                         now_ts(), ou);
        Logger::log_success(jid, "Claimed stealth transfer");
        send_result(res, jid, result);
    }

    // ── POST /api/scan_stealth ────────────────────────────────────────────────
    void handle_scan_stealth(const httplib::Request& req, httplib::Response& res) {
        auto jid = Logger::start_request("POST /api/scan_stealth");
        if (!check_auth(req, res, jid)) return;

        json body;
        if (!parse_body(req, res, jid, body)) return;

        if (!body.contains("private_key") || !body.contains("stealth_outputs")) {
            Logger::log_error(jid, "Missing private_key or stealth_outputs");
            res.status = 400;
            res.set_content(err("Missing required fields: private_key, stealth_outputs").dump(),
                            "application/json");
            return;
        }

        json stealth_outputs = body["stealth_outputs"];
        Logger::log_step(jid, "Scanning " + std::to_string(stealth_outputs.size()) + " outputs...");

        // Scanning only needs the sk64 — no PVAC crypto needed
        std::string priv_b64 = body["private_key"].get<std::string>();
        std::string pub_b64  = body.value("public_key", "");
        std::vector<uint8_t> sk64;
        try {
            sk64 = resolve_sk64(priv_b64, pub_b64);
        } catch (const std::exception& e) {
            Logger::log_error(jid, e.what());
            res.status = 400;
            res.set_content(err(e.what()).dump(), "application/json");
            return;
        }

        PvacOps pvac; // not initialised — scan_stealth doesn't use bridge_
        auto result = pvac.scan_stealth(sk64.data(), stealth_outputs);

        if (!result.success) {
            Logger::log_error(jid, result.error);
            res.status = 500;
            res.set_content(err(result.error).dump(), "application/json");
            return;
        }

        Logger::log_success(jid, "Found " + std::to_string(result.transfers.size()) + " transfers");

        json transfers = json::array();
        for (const auto& t : result.transfers) {
            json item;
            item["id"]             = t.id;
            item["amount"]         = t.amount;
            item["amount_oct"]     = t.amount / 1e6;
            item["epoch"]          = t.epoch;
            item["sender"]         = t.sender;
            item["tx_hash"]        = t.tx_hash;
            item["claim_secret"]   = t.claim_secret;
            item["blinding"]       = t.blinding;
            item["stealth_output"] = t.full_output;
            transfers.push_back(std::move(item));
        }

        json resp = ok_base(jid);
        resp["transfers"] = transfers;
        resp["count"]     = transfers.size();
        res.set_content(resp.dump(), "application/json");
    }
};

} // namespace pvac
