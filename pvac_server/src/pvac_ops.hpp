/*
    PVAC Operations Wrapper
    All PVAC C-API handles are freed exactly once via RAII guards.
    No raw C-API calls outside this file — everything goes through PvacBridge.
*/
#pragma once
#include <string>
#include <vector>
#include <cstdint>
#include <stdexcept>
#include "../lib/pvac_bridge.hpp"
#include "../lib/stealth.hpp"
#include "../lib/crypto_utils.hpp"
#include "../lib/tx_builder.hpp"
#include "../lib/json.hpp"
#include "../lib/httplib.h"

extern "C" {
#include "../lib/tweetnacl.h"
}

using json = nlohmann::json;

namespace pvac {

// ─── RPC helper: ensure PVAC pubkey is registered on the node ────────────────
// Parses rpc_url (http://host:port/path), calls octra_pvacPubkey to check,
// then octra_registerPvacPubkey if not yet registered.
// Returns true if already registered or successfully registered.
// Returns false (non-fatal) if rpc_url is empty or registration fails —
// the tx will still be built; the node will reject it if the key is missing.
inline bool ensure_pvac_registered_on_node(
    const std::string& rpc_url,
    const std::string& address,
    const std::string& pvac_pubkey_b64,
    const std::string& reg_sig,
    const std::string& wallet_pub_b64,
    const std::string& aes_kat_hex)
{
    if (rpc_url.empty()) return false;

    // Parse URL
    std::string host, path;
    int port = 80;
    std::string u = rpc_url;
    if (u.rfind("https://", 0) == 0) { u = u.substr(8); port = 443; }
    else if (u.rfind("http://", 0) == 0) { u = u.substr(7); }
    auto slash = u.find('/');
    if (slash != std::string::npos) { path = u.substr(slash); host = u.substr(0, slash); }
    else { path = "/rpc"; host = u; }
    auto colon = host.find(':');
    if (colon != std::string::npos) { port = std::stoi(host.substr(colon + 1)); host = host.substr(0, colon); }

    auto make_rpc = [&](const std::string& method, const json& params) -> json {
        json req;
        req["jsonrpc"] = "2.0";
        req["method"] = method;
        req["params"] = params;
        req["id"] = 1;
        std::string body = req.dump();
        httplib::Headers hdrs = {{"Content-Type", "application/json"}};
        std::string resp_body;
        // Use plain HTTP client (SSL not required for local/LAN node)
        httplib::Client cli(host, port);
        cli.set_connection_timeout(10, 0);
        cli.set_read_timeout(10, 0);
        auto res = cli.Post(path, hdrs, body, "application/json");
        if (!res) return {};
        resp_body = res->body;
        try { return json::parse(resp_body); } catch (...) { return {}; }
    };

    try {
        // Check if already registered
        auto check = make_rpc("octra_pvacPubkey", json::array({address}));
        if (!check.empty() && check.contains("result")) {
            auto& r = check["result"];
            if (r.is_object() && r.contains("pvac_pubkey") && !r["pvac_pubkey"].is_null()) {
                std::string remote = r["pvac_pubkey"].get<std::string>();
                if (remote == pvac_pubkey_b64) return true; // already registered
                // Different key — conflict, skip registration
                fprintf(stderr, "[pvac] key conflict for %s — skipping registration\n", address.c_str());
                return false;
            }
        }

        // Not registered — register now
        auto reg = make_rpc("octra_registerPvacPubkey",
            json::array({address, pvac_pubkey_b64, reg_sig, wallet_pub_b64, aes_kat_hex}));
        if (!reg.empty() && reg.contains("result")) {
            fprintf(stderr, "[pvac] pubkey registered for %s\n", address.c_str());
            return true;
        }
        if (!reg.empty() && reg.contains("error")) {
            auto& e = reg["error"];
            std::string msg = e.is_object() ? e.value("message", "") : e.dump();
            if (msg.find("already registered") != std::string::npos) return true;
            fprintf(stderr, "[pvac] register failed for %s: %s\n", address.c_str(), msg.c_str());
        }
    } catch (const std::exception& ex) {
        fprintf(stderr, "[pvac] ensure_registered exception: %s\n", ex.what());
    }
    return false;
}

// ─── RAII wrappers for PVAC opaque handles ───────────────────────────────────

struct CipherGuard {
    pvac_cipher h = nullptr;
    explicit CipherGuard(pvac_cipher c) : h(c) {}
    ~CipherGuard() { if (h) pvac_free_cipher(h); }
    CipherGuard(const CipherGuard&) = delete;
    CipherGuard& operator=(const CipherGuard&) = delete;
    pvac_cipher get() const { return h; }
    pvac_cipher release() { pvac_cipher tmp = h; h = nullptr; return tmp; }
};

struct RangeProofGuard {
    pvac_range_proof h = nullptr;
    explicit RangeProofGuard(pvac_range_proof r) : h(r) {}
    ~RangeProofGuard() { if (h) pvac_free_range_proof(h); }
    RangeProofGuard(const RangeProofGuard&) = delete;
    RangeProofGuard& operator=(const RangeProofGuard&) = delete;
    pvac_range_proof get() const { return h; }
};

struct ZeroProofGuard {
    pvac_zero_proof h = nullptr;
    explicit ZeroProofGuard(pvac_zero_proof z) : h(z) {}
    ~ZeroProofGuard() { if (h) pvac_free_zero_proof(h); }
    ZeroProofGuard(const ZeroProofGuard&) = delete;
    ZeroProofGuard& operator=(const ZeroProofGuard&) = delete;
    pvac_zero_proof get() const { return h; }
};

// ─── Key helper ──────────────────────────────────────────────────────────────

// Returns 64-byte Ed25519 sk from either 32-byte seed or 64-byte sk (base64).
// Throws std::runtime_error on invalid input.
inline std::vector<uint8_t> resolve_sk64(const std::string& priv_b64,
                                          const std::string& pub_b64 = "") {
    auto raw = octra::base64_decode(priv_b64);
    if (raw.size() == 64) return raw;

    if (raw.size() == 32) {
        // Derive full 64-byte Ed25519 sk from seed
        std::vector<uint8_t> sk64(64);
        uint8_t pk[32];
        octra::keypair_from_seed(raw.data(), sk64.data(), pk);
        // Verify against supplied public key if provided
        if (!pub_b64.empty()) {
            auto pk_raw = octra::base64_decode(pub_b64);
            if (pk_raw.size() == 32 && memcmp(pk, pk_raw.data(), 32) != 0) {
                throw std::runtime_error("Public key mismatch with derived key");
            }
        }
        return sk64;
    }

    throw std::runtime_error("Invalid private key length: " +
                             std::to_string(raw.size()) + " bytes (expected 32 or 64)");
}

// ─── PvacOps ─────────────────────────────────────────────────────────────────

class PvacOps {
    octra::PvacBridge bridge_;
    bool initialized_ = false;

public:
    PvacOps() = default;

    // Initialize from 32-byte seed (base64). The bridge only needs the seed.
    bool init(const std::string& seed32_b64) {
        initialized_ = bridge_.init(seed32_b64);
        return initialized_;
    }

    bool is_initialized() const { return initialized_; }

    // ── 0. Get PVAC public key ────────────────────────────────────────────────
    std::string get_pvac_pubkey_b64() {
        if (!initialized_) return "";
        return bridge_.serialize_pubkey_b64();
    }

    std::vector<uint8_t> get_pvac_pubkey_raw() {
        if (!initialized_) return {};
        return bridge_.serialize_pubkey();
    }

    // ── 0b. Ensure PVAC pubkey registered on node ─────────────────────────────
    // Call before any encrypt/decrypt/stealth operation.
    // rpc_url: e.g. "http://46.101.86.250:8080"
    // sk64: 64-byte Ed25519 signing key
    // wallet_pub_b64: base64 Ed25519 public key
    // address: wallet address
    void ensure_registered(const std::string& rpc_url,
                           const std::string& address,
                           const uint8_t* sk64,
                           const std::string& wallet_pub_b64) {
        if (!initialized_ || rpc_url.empty()) return;
        auto pk_raw = bridge_.serialize_pubkey();
        std::string pk_blob(pk_raw.begin(), pk_raw.end());
        std::string pvac_pub_b64 = bridge_.serialize_pubkey_b64();
        std::string reg_sig = octra::sign_register_request(address, pk_blob, sk64);

        // Compute AES KAT
        uint8_t kat_buf[16];
        pvac_aes_kat(kat_buf);
        char kat_hex[33];
        for (int i = 0; i < 16; i++) std::snprintf(kat_hex + i * 2, 3, "%02x", kat_buf[i]);
        kat_hex[32] = 0;

        ensure_pvac_registered_on_node(rpc_url, address, pvac_pub_b64,
                                       reg_sig, wallet_pub_b64, std::string(kat_hex));
    }

    // ── 1. Decrypt encrypted balance ─────────────────────────────────────────
    struct DecryptBalanceResult {
        bool success = false;
        int64_t balance = 0;
        std::string error;
    };

    DecryptBalanceResult decrypt_balance(const std::string& cipher) {
        DecryptBalanceResult r;
        if (!initialized_) { r.error = "PVAC not initialized"; return r; }
        if (cipher.empty() || cipher == "0") {
            r.success = true; r.balance = 0; return r;
        }
        try {
            r.balance  = bridge_.get_balance(cipher);
            r.success  = true;
        } catch (const std::exception& e) {
            r.error = std::string("Decryption failed: ") + e.what();
        }
        return r;
    }

    // ── 2. Encrypt balance (public → private) ────────────────────────────────
    struct TxResult {
        bool success = false;
        json tx_data;
        std::string error;
    };

    TxResult encrypt_balance(int64_t amount,
                              const std::string& address,
                              int nonce,
                              const uint8_t* sk64,
                              const std::string& pub_b64,
                              double timestamp,
                              const std::string& ou,
                              const std::string& rpc_url = "") {
        TxResult r;
        if (!initialized_) { r.error = "PVAC not initialized"; return r; }
        try {
            // Auto-register PVAC pubkey on node if rpc_url provided
            ensure_registered(rpc_url, address, sk64, pub_b64);
            uint8_t seed[32], blinding[32];
            octra::random_bytes(seed, 32);
            octra::random_bytes(blinding, 32);

            CipherGuard ct(bridge_.encrypt((uint64_t)amount, seed));
            if (!ct.get()) throw std::runtime_error("encrypt returned null cipher");

            std::string cipher_str = bridge_.encode_cipher(ct.get());

            auto amt_commit = bridge_.pedersen_commit((uint64_t)amount, blinding);
            std::string amt_commit_b64 = octra::base64_encode(amt_commit.data(), 32);

            ZeroProofGuard zkp(bridge_.make_zero_proof_bound(ct.get(), (uint64_t)amount, blinding));
            if (!zkp.get()) throw std::runtime_error("zero proof returned null");
            std::string zp_str = bridge_.encode_zero_proof(zkp.get());

            json enc_data;
            enc_data["cipher"]             = cipher_str;
            enc_data["amount_commitment"]  = amt_commit_b64;
            enc_data["zero_proof"]         = zp_str;
            enc_data["blinding"]           = octra::base64_encode(blinding, 32);

            json tx = build_and_sign_tx(address, address, std::to_string(amount),
                               nonce, ou, timestamp, "encrypt", enc_data.dump(),
                               sk64, pub_b64);

            r.success  = true;
            r.tx_data  = std::move(tx);
        } catch (const std::exception& e) {
            r.error = std::string("encrypt_balance: ") + e.what();
        }
        return r;
    }

    // ── 3. Decrypt balance (private → public) ────────────────────────────────
    TxResult decrypt_to_public(int64_t amount,
                                const std::string& current_cipher,
                                const std::string& address,
                                int nonce,
                                const uint8_t* sk64,
                                const std::string& pub_b64,
                                double timestamp,
                                const std::string& ou,
                                const std::string& rpc_url = "") {
        TxResult r;
        if (!initialized_) { r.error = "PVAC not initialized"; return r; }
        try {
            // Auto-register PVAC pubkey on node if rpc_url provided
            ensure_registered(rpc_url, address, sk64, pub_b64);
            uint8_t seed[32], blinding[32];
            octra::random_bytes(seed, 32);
            octra::random_bytes(blinding, 32);

            // Cipher for the amount being decrypted
            CipherGuard ct_amt(bridge_.encrypt((uint64_t)amount, seed));
            if (!ct_amt.get()) throw std::runtime_error("encrypt returned null");

            std::string cipher_str = bridge_.encode_cipher(ct_amt.get());

            auto amt_commit = bridge_.pedersen_commit((uint64_t)amount, blinding);
            std::string amt_commit_b64 = octra::base64_encode(amt_commit.data(), 32);

            ZeroProofGuard zkp(bridge_.make_zero_proof_bound(ct_amt.get(), (uint64_t)amount, blinding));
            if (!zkp.get()) throw std::runtime_error("zero proof returned null");
            std::string zp_str = bridge_.encode_zero_proof(zkp.get());

            // Compute new balance cipher
            int64_t current_balance = bridge_.get_balance(current_cipher);
            if (amount > current_balance)
                throw std::runtime_error("Insufficient encrypted balance");

            CipherGuard ct_cur(bridge_.decode_cipher(current_cipher));
            if (!ct_cur.get()) throw std::runtime_error("Failed to decode current cipher");

            CipherGuard ct_new(bridge_.ct_sub(ct_cur.get(), ct_amt.get()));
            if (!ct_new.get()) throw std::runtime_error("ct_sub returned null");

            uint64_t new_val = (uint64_t)(current_balance - amount);

            // Aggregated range proof on new balance
            pvac_agg_range_proof arp = pvac_make_aggregated_range_proof(
                bridge_.pk(), bridge_.sk(), ct_new.get(), new_val);
            if (!arp) throw std::runtime_error("aggregated range proof returned null");

            size_t arp_len = 0;
            uint8_t* arp_data = pvac_serialize_agg_range_proof(arp, &arp_len);
            std::string rp_bal_str = std::string("rp_v1|") +
                                     octra::base64_encode(arp_data, arp_len);
            pvac_free_bytes(arp_data);
            pvac_free_agg_range_proof(arp);

            json enc_data;
            enc_data["cipher"]              = cipher_str;
            enc_data["amount_commitment"]   = amt_commit_b64;
            enc_data["zero_proof"]          = zp_str;
            enc_data["blinding"]            = octra::base64_encode(blinding, 32);
            enc_data["range_proof_balance"] = rp_bal_str;

            json tx = build_and_sign_tx(address, address, std::to_string(amount),
                               nonce, ou, timestamp, "decrypt", enc_data.dump(),
                               sk64, pub_b64);

            r.success = true;
            r.tx_data = std::move(tx);
        } catch (const std::exception& e) {
            r.error = std::string("decrypt_to_public: ") + e.what();
        }
        return r;
    }

    // ── 4. Stealth send ──────────────────────────────────────────────────────
    TxResult stealth_send(const std::string& to_address,
                          int64_t amount,
                          const std::string& current_cipher,
                          const std::string& recipient_view_pubkey_b64,
                          const std::string& from_address,
                          int nonce,
                          const uint8_t* sk64,
                          const std::string& pub_b64,
                          double timestamp,
                          const std::string& ou,
                          const std::string& rpc_url = "") {
        TxResult r;
        if (!initialized_) { r.error = "PVAC not initialized"; return r; }
        try {
            // Auto-register PVAC pubkey on node if rpc_url provided
            ensure_registered(rpc_url, from_address, sk64, pub_b64);
            auto their_vpub = octra::base64_decode(recipient_view_pubkey_b64);
            if (their_vpub.size() != 32)
                throw std::runtime_error("Invalid recipient view pubkey size");

            // Ephemeral keypair
            uint8_t eph_sk[32], eph_pk[32];
            octra::random_bytes(eph_sk, 32);
            crypto_scalarmult_base(eph_pk, eph_sk);

            // ECDH
            auto shared = octra::ecdh_shared_secret(eph_sk, their_vpub.data());
            octra::secure_zero(eph_sk, 32);

            auto stag      = octra::compute_stealth_tag(shared);
            auto claim_sec = octra::compute_claim_secret(shared);
            auto claim_pub = octra::compute_claim_pub(claim_sec, to_address);

            uint8_t r_blind[32];
            octra::random_bytes(r_blind, 32);
            std::string enc_amount = octra::encrypt_stealth_amount(shared, (uint64_t)amount, r_blind);

            // FHE encrypt delta
            uint8_t seed[32];
            octra::random_bytes(seed, 32);
            CipherGuard ct_delta(bridge_.encrypt((uint64_t)amount, seed));
            if (!ct_delta.get()) throw std::runtime_error("encrypt delta returned null");

            std::string delta_cipher_str = bridge_.encode_cipher(ct_delta.get());
            auto commitment = bridge_.commit_ct(ct_delta.get());
            std::string commitment_b64 = octra::base64_encode(commitment.data(), 32);

            // New balance cipher
            int64_t current_balance = bridge_.get_balance(current_cipher);
            if (amount > current_balance)
                throw std::runtime_error("Insufficient encrypted balance");

            CipherGuard ct_cur(bridge_.decode_cipher(current_cipher));
            if (!ct_cur.get()) throw std::runtime_error("Failed to decode current cipher");

            CipherGuard ct_new(bridge_.ct_sub(ct_cur.get(), ct_delta.get()));
            if (!ct_new.get()) throw std::runtime_error("ct_sub returned null");

            uint64_t new_val = (uint64_t)(current_balance - amount);

            // Range proofs
            RangeProofGuard rp_delta(bridge_.make_range_proof(ct_delta.get(), (uint64_t)amount));
            if (!rp_delta.get()) throw std::runtime_error("range proof delta returned null");

            RangeProofGuard rp_bal(bridge_.make_range_proof(ct_new.get(), new_val));
            if (!rp_bal.get()) throw std::runtime_error("range proof balance returned null");

            std::string rp_delta_str = bridge_.encode_range_proof(rp_delta.get());
            std::string rp_bal_str   = bridge_.encode_range_proof(rp_bal.get());

            auto amt_commit = bridge_.pedersen_commit((uint64_t)amount, r_blind);
            std::string amt_commit_b64 = octra::base64_encode(amt_commit.data(), 32);

            // send_zero_proof: bound zero proof on ct_delta using r_blind
            // Proves delta_cipher encrypts the same value as amount_commitment
            // Required by node: "send_zero_proof does not bind delta_cipher to amount_commitment"
            ZeroProofGuard send_zp(bridge_.make_zero_proof_bound(ct_delta.get(), (uint64_t)amount, r_blind));
            if (!send_zp.get()) throw std::runtime_error("send_zero_proof returned null");
            std::string send_zp_str = bridge_.encode_zero_proof(send_zp.get());

            json stealth_data;
            stealth_data["version"]             = 5;
            stealth_data["delta_cipher"]        = delta_cipher_str;
            stealth_data["commitment"]          = commitment_b64;
            stealth_data["range_proof_delta"]   = rp_delta_str;
            stealth_data["range_proof_balance"] = rp_bal_str;
            stealth_data["eph_pub"]             = octra::base64_encode(eph_pk, 32);
            stealth_data["stealth_tag"]         = octra::hex_encode(stag.data(), 16);
            stealth_data["enc_amount"]          = enc_amount;
            stealth_data["claim_pub"]           = octra::hex_encode(claim_pub.data(), 32);
            stealth_data["amount_commitment"]   = amt_commit_b64;
            stealth_data["send_zero_proof"]     = send_zp_str;

            json tx = build_and_sign_tx(from_address, "stealth", "0",
                               nonce, ou, timestamp, "stealth", stealth_data.dump(),
                               sk64, pub_b64);

            r.success = true;
            r.tx_data = std::move(tx);
        } catch (const std::exception& e) {
            r.error = std::string("stealth_send: ") + e.what();
        }
        return r;
    }

    // ── 5. Claim stealth transfer ────────────────────────────────────────────
    TxResult claim_stealth(const json& stealth_output,
                           const std::string& address,
                           int nonce,
                           const uint8_t* sk64,
                           const std::string& pub_b64,
                           double timestamp,
                           const std::string& ou) {
        TxResult r;
        if (!initialized_) { r.error = "PVAC not initialized"; return r; }
        try {
            std::string eph_pub_b64 = stealth_output.at("eph_pub").get<std::string>();
            std::string enc_amount  = stealth_output.at("enc_amount").get<std::string>();
            std::string output_id;
            if (stealth_output["id"].is_string())
                output_id = stealth_output["id"].get<std::string>();
            else
                output_id = std::to_string(stealth_output["id"].get<int64_t>());

            // Derive view keypair from Ed25519 sk
            uint8_t view_sk[32], view_pk[32];
            octra::derive_view_keypair(sk64, view_sk, view_pk);

            auto eph_raw = octra::base64_decode(eph_pub_b64);
            if (eph_raw.size() != 32) {
                octra::secure_zero(view_sk, 32);
                throw std::runtime_error("Invalid ephemeral pubkey size");
            }

            auto shared = octra::ecdh_shared_secret(view_sk, eph_raw.data());
            octra::secure_zero(view_sk, 32);

            auto dec = octra::decrypt_stealth_amount(shared, enc_amount);
            if (!dec.has_value())
                throw std::runtime_error("Failed to decrypt stealth amount");

            auto cs = octra::compute_claim_secret(shared);

            uint8_t seed[32];
            octra::random_bytes(seed, 32);
            CipherGuard ct_claim(bridge_.encrypt(dec->amount, seed));
            if (!ct_claim.get()) throw std::runtime_error("encrypt claim returned null");

            std::string claim_cipher_str = bridge_.encode_cipher(ct_claim.get());
            auto commit = bridge_.commit_ct(ct_claim.get());
            std::string commit_b64 = octra::base64_encode(commit.data(), 32);

            ZeroProofGuard zkp(bridge_.make_zero_proof_bound(
                ct_claim.get(), dec->amount, dec->blinding.data()));
            if (!zkp.get()) throw std::runtime_error("zero proof returned null");
            std::string zp_str = bridge_.encode_zero_proof(zkp.get());

            json claim_data;
            claim_data["version"]      = 5;
            claim_data["output_id"]    = stealth_output["id"]; // preserve original type (int/string) — matches webcli
            claim_data["claim_cipher"] = claim_cipher_str;
            claim_data["commitment"]   = commit_b64;
            claim_data["claim_secret"] = octra::hex_encode(cs.data(), 32);
            claim_data["zero_proof"]   = zp_str;

            // Webcli uses amount="0" and to_=address for claim
            json tx = build_and_sign_tx(address, address, "0",
                               nonce, ou, timestamp, "claim", claim_data.dump(),
                               sk64, pub_b64);

            r.success = true;
            r.tx_data = std::move(tx);
        } catch (const std::exception& e) {
            r.error = std::string("claim_stealth: ") + e.what();
        }
        return r;
    }

    // ── 6. Scan stealth transfers ────────────────────────────────────────────
    struct StealthTransfer {
        std::string id;
        uint64_t    amount = 0;
        int         epoch  = 0;
        std::string sender;
        std::string tx_hash;
        std::string claim_secret;
        std::string blinding;
        json        full_output;
    };

    struct ScanResult {
        bool success = false;
        std::vector<StealthTransfer> transfers;
        std::string error;
    };

    ScanResult scan_stealth(const uint8_t* sk64, const json& stealth_outputs) {
        ScanResult r;
        try {
            uint8_t view_sk[32], view_pk[32];
            octra::derive_view_keypair(sk64, view_sk, view_pk);

            for (const auto& out : stealth_outputs) {
                if (out.value("claimed", 0) != 0) continue;
                try {
                    auto eph_raw = octra::base64_decode(out.at("eph_pub").get<std::string>());
                    if (eph_raw.size() != 32) continue;

                    auto shared   = octra::ecdh_shared_secret(view_sk, eph_raw.data());
                    auto my_tag   = octra::compute_stealth_tag(shared);
                    std::string my_tag_hex = octra::hex_encode(my_tag.data(), 16);

                    if (my_tag_hex != out.value("stealth_tag", "")) continue;

                    auto dec = octra::decrypt_stealth_amount(shared, out.value("enc_amount", ""));
                    if (!dec.has_value()) continue;

                    auto cs = octra::compute_claim_secret(shared);

                    StealthTransfer t;
                    if (out.contains("id")) {
                        t.id = out["id"].is_string()
                             ? out["id"].get<std::string>()
                             : std::to_string(out["id"].get<int64_t>());
                    }
                    t.amount       = dec->amount;
                    t.epoch        = out.value("epoch_id", 0);
                    t.sender       = out.value("sender_addr", "");
                    t.tx_hash      = out.value("tx_hash", "");
                    t.claim_secret = octra::hex_encode(cs.data(), 32);
                    t.blinding     = octra::base64_encode(dec->blinding.data(), 32);
                    t.full_output  = out;
                    r.transfers.push_back(std::move(t));
                } catch (...) {
                    continue; // skip malformed outputs
                }
            }

            octra::secure_zero(view_sk, 32);
            r.success = true;
        } catch (const std::exception& e) {
            r.error = std::string("scan_stealth: ") + e.what();
        }
        return r;
    }

private:
    // Build and sign using Transaction struct — matches webcli exactly
    // (avoids JSON round-trip precision loss on timestamp)
    static json build_and_sign_tx(const std::string& from,
                                   const std::string& to,
                                   const std::string& amount,
                                   int nonce,
                                   const std::string& ou,
                                   double timestamp,
                                   const std::string& op_type,
                                   const std::string& encrypted_data,
                                   const uint8_t* sk64,
                                   const std::string& pub_b64) {
        // Use Transaction struct directly — same as webcli canonical_json()
        octra::Transaction tx;
        tx.from           = from;
        tx.to_            = to;
        tx.amount         = amount;
        tx.nonce          = nonce;
        tx.ou             = ou;
        tx.timestamp      = timestamp;
        tx.op_type        = op_type;
        tx.encrypted_data = encrypted_data;

        // Sign using canonical_json(Transaction) — no JSON round-trip
        std::string msg = octra::canonical_json(tx);
        tx.signature = octra::ed25519_sign_detached(
            reinterpret_cast<const uint8_t*>(msg.data()), msg.size(), sk64);
        tx.public_key = pub_b64;

        // Serialize to JSON for submission
        return octra::build_tx_json(tx);
    }
};

} // namespace pvac
