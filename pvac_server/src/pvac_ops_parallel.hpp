/*
    pvac_ops_parallel.hpp -- Parallel-optimized decrypt_to_public and stealth_send.

    Strategy:
      decrypt_to_public:
        - encrypt(amount) and get_balance(current_cipher) run concurrently
          (both independent, each ~5s) -> saves ~5s

      stealth_send:
        - encrypt(amount) and get_balance(current_cipher) run concurrently
        - make_range_proof(ct_delta) and make_range_proof(ct_new) run concurrently
          (both independent, each ~200s) -> halves range proof wall-clock time

    Thread budget: floor(hardware_concurrency * 0.8), minimum 1.
*/
#pragma once

#include <thread>
#include <future>
#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>
#include <stdexcept>
#include <iostream>
#include <chrono>
#include <ctime>

#include "pvac_ops.hpp"
#include "../pvac/pvac_c_api.h"

namespace pvac {

// -- Thread budget: 80% of logical cores, at least 1 -------------------------

inline unsigned thread_budget() {
    unsigned hw = std::thread::hardware_concurrency();
    if (hw <= 1) return 1;
    return std::max(1u, (unsigned)(hw * 0.8));
}

// -- Step logger with elapsed time ---------------------------------------------

struct StepLogger {
    std::chrono::steady_clock::time_point start;
    std::chrono::steady_clock::time_point last;

    StepLogger() : start(std::chrono::steady_clock::now()), last(start) {}

    void step(const std::string& msg) {
        auto now = std::chrono::steady_clock::now();
        auto total_ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - start).count();
        auto delta_ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - last).count();
        last = now;

        auto t = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
        char buf[20];
        std::strftime(buf, sizeof(buf), "%H:%M:%S", std::localtime(&t));
        std::cout << "[" << buf << "] [STEP ] +" << delta_ms << "ms  " << msg
                  << "  (total " << total_ms << "ms)\n";
        std::cout.flush();
    }

    long total_ms() const {
        return std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - start).count();
    }
};

// -- Shared tx builder ---------------------------------------------------------

inline json build_signed_tx(
    const std::string& from, const std::string& to,
    const std::string& amount, int nonce, const std::string& ou,
    double timestamp, const std::string& op_type,
    const std::string& encrypted_data,
    const uint8_t* sk64, const std::string& pub_b64)
{
    octra::Transaction tx;
    tx.from           = from;
    tx.to_            = to;
    tx.amount         = amount;
    tx.nonce          = nonce;
    tx.ou             = ou;
    tx.timestamp      = timestamp;
    tx.op_type        = op_type;
    tx.encrypted_data = encrypted_data;

    std::string msg = octra::canonical_json(tx);
    tx.signature = octra::ed25519_sign_detached(
        reinterpret_cast<const uint8_t*>(msg.data()), msg.size(), sk64);
    tx.public_key = pub_b64;
    return octra::build_tx_json(tx);
}

// -- Parallel decrypt_to_public ------------------------------------------------
//
// Mirrors webcli /api/decrypt exactly, with:
//   - Step-by-step logging
//   - encrypt(amount) + get_balance(current_cipher) run concurrently
//
// Key fixes vs original:
//   - Uses pvac_dec_value (not pvac_dec_value_fp) to match WASM decryptValue
//   - Only invalidates client balance hint when cipher actually changed on-chain
//   - Guards new_val against underflow before uint64_t cast

inline PvacOps::TxResult decrypt_to_public_parallel(
    PvacOps& /*ops*/,
    octra::PvacBridge& bridge,
    int64_t amount,
    const std::string& current_cipher,
    const std::string& address,
    int nonce,
    const uint8_t* sk64,
    const std::string& pub_b64,
    double timestamp,
    const std::string& ou,
    int64_t current_balance_hint = -1)  // -1 = not provided, server will decrypt
{
    PvacOps::TxResult r;
    StepLogger log;

    try {
        uint8_t seed[32], blinding[32];
        octra::random_bytes(seed, 32);
        octra::random_bytes(blinding, 32);

        pvac_cipher ct_amt_raw = nullptr;
        int64_t current_balance = 0;

        if (current_balance_hint >= 0) {
            // Use pre-computed balance from extension (WASM-decrypted) -- avoids
            // re-decrypting the cipher which may give a different field element value.
            log.step("Encrypting amount (balance provided by client)...");
            current_balance = current_balance_hint;
            const uint8_t* seed_ptr = seed;
            ct_amt_raw = pvac_enc_value_seeded(bridge.pk(), bridge.sk(),
                                               (uint64_t)amount, seed_ptr);
            log.step("Encrypt done  balance=" + std::to_string(current_balance)
                     + "  amount=" + std::to_string(amount));
        } else {
            // Fallback: encrypt + decrypt in parallel.
            // Use pvac_dec_value (not pvac_dec_value_fp) to match the WASM
            // decryptValue behaviour -- both use the same discrete-log lookup
            // table and return the same uint64 for normal balance values.
            log.step("Encrypting amount + reading current balance (parallel)...");
            const uint8_t* seed_ptr = seed;
            auto fut_enc = std::async(std::launch::async, [&]() -> pvac_cipher {
                return pvac_enc_value_seeded(bridge.pk(), bridge.sk(),
                                             (uint64_t)amount, seed_ptr);
            });
            auto fut_bal = std::async(std::launch::async, [&]() -> int64_t {
                if (current_cipher.empty() || current_cipher == "0") return 0;
                pvac_cipher ct = bridge.decode_cipher(current_cipher);
                if (!ct) return 0;
                uint64_t val = pvac_dec_value(bridge.pk(), bridge.sk(), ct);
                pvac_free_cipher(ct);
                return static_cast<int64_t>(val);
            });
            ct_amt_raw      = fut_enc.get();
            current_balance = fut_bal.get();
            log.step("Encrypt + balance done  balance=" + std::to_string(current_balance)
                     + "  amount=" + std::to_string(amount));
        }

        if (!ct_amt_raw)
            throw std::runtime_error("encrypt returned null");
        if (amount > current_balance)
            throw std::runtime_error("Insufficient encrypted balance ("
                + std::to_string(amount) + " > " + std::to_string(current_balance) + ")");

        CipherGuard ct_amt(ct_amt_raw);
        std::string cipher_str = bridge.encode_cipher(ct_amt.get());
        log.step("Amount cipher encoded  len=" + std::to_string(cipher_str.size())
                 + "  current_cipher_len=" + std::to_string(current_cipher.size()));

        // Step 3: Pedersen commitment + zero proof (depends on ct_amt)
        log.step("Building Pedersen commitment...");
        auto amt_commit = bridge.pedersen_commit((uint64_t)amount, blinding);
        std::string amt_commit_b64 = octra::base64_encode(amt_commit.data(), 32);

        log.step("Building zero-knowledge proof...");
        ZeroProofGuard zkp(bridge.make_zero_proof_bound(
            ct_amt.get(), (uint64_t)amount, blinding));
        if (!zkp.get()) throw std::runtime_error("zero proof returned null");
        std::string zp_str = bridge.encode_zero_proof(zkp.get());
        log.step("Zero proof done  len=" + std::to_string(zp_str.size()));

        // Step 4: ct_sub to get new balance cipher
        log.step("Decoding current cipher + computing ct_sub...");
        CipherGuard ct_cur(bridge.decode_cipher(current_cipher));
        if (!ct_cur.get()) throw std::runtime_error("Failed to decode current cipher");

        // Use ct_sub (cipher - cipher) to match what node computes on-chain
        CipherGuard ct_new(bridge.ct_sub(ct_cur.get(), ct_amt.get()));
        if (!ct_new.get()) throw std::runtime_error("ct_sub returned null");

        // Guard against underflow before cast.
        // current_balance >= amount is already checked above, but be explicit.
        int64_t new_val_signed = current_balance - amount;
        if (new_val_signed < 0)
            throw std::runtime_error("new balance underflow: current_balance="
                + std::to_string(current_balance) + " amount=" + std::to_string(amount));
        uint64_t new_val = static_cast<uint64_t>(new_val_signed);
        log.step("ct_sub done  new_balance=" + std::to_string(new_val));

        // Step 5: aggregated range proof -- matches webcli /api/decrypt exactly.
        // webcli uses pvac_make_aggregated_range_proof + pvac_serialize_agg_range_proof.
        // Non-aggregated causes bad_range_proof_balance on devnet.
        log.step("Building aggregated range proof  new_val=" + std::to_string(new_val) + "...");
        pvac_agg_range_proof arp = pvac_make_aggregated_range_proof(
            bridge.pk(), bridge.sk(), ct_new.get(), new_val);
        if (!arp) throw std::runtime_error("aggregated range proof returned null");

        size_t rp_len = 0;
        uint8_t* rp_data = pvac_serialize_agg_range_proof(arp, &rp_len);
        std::string rp_bal_str = std::string("rp_v1|") +
                                 octra::base64_encode(rp_data, rp_len);
        pvac_free_bytes(rp_data);
        pvac_free_agg_range_proof(arp);
        log.step("Range proof done  format=aggregated  len=" + std::to_string(rp_bal_str.size()));

        // Step 6: build + sign tx
        log.step("Signing transaction...");
        json enc_data;
        enc_data["cipher"]              = cipher_str;
        enc_data["amount_commitment"]   = amt_commit_b64;
        enc_data["zero_proof"]          = zp_str;
        enc_data["blinding"]            = octra::base64_encode(blinding, 32);
        enc_data["range_proof_balance"] = rp_bal_str;

        r.success = true;
        r.tx_data = build_signed_tx(address, address, std::to_string(amount),
                                    nonce, ou, timestamp, "decrypt",
                                    enc_data.dump(), sk64, pub_b64);
        log.step("Done  total=" + std::to_string(log.total_ms()) + "ms");
    } catch (const std::exception& e) {
        r.error = std::string("decrypt_to_public: ") + e.what();
    }
    return r;
}

// -- Parallel stealth_send -----------------------------------------------------
//
// Mirrors webcli /api/stealth/send exactly, with:
//   - Step-by-step logging
//   - encrypt(amount) + get_balance run concurrently
//   - Both range proofs run concurrently

inline PvacOps::TxResult stealth_send_parallel(
    PvacOps& /*ops*/,
    octra::PvacBridge& bridge,
    const std::string& to_address,
    int64_t amount,
    const std::string& current_cipher,
    const std::string& recipient_view_pubkey_b64,
    const std::string& from_address,
    int nonce,
    const uint8_t* sk64,
    const std::string& pub_b64,
    double timestamp,
    const std::string& ou)
{
    PvacOps::TxResult r;
    StepLogger log;

    try {
        auto their_vpub = octra::base64_decode(recipient_view_pubkey_b64);
        if (their_vpub.size() != 32)
            throw std::runtime_error("Invalid recipient view pubkey size");

        // ECDH + stealth tag (fast)
        log.step("ECDH + stealth tag...");
        uint8_t eph_sk[32], eph_pk[32];
        octra::random_bytes(eph_sk, 32);
        crypto_scalarmult_base(eph_pk, eph_sk);

        auto shared    = octra::ecdh_shared_secret(eph_sk, their_vpub.data());
        octra::secure_zero(eph_sk, 32);

        auto stag      = octra::compute_stealth_tag(shared);
        auto claim_sec = octra::compute_claim_secret(shared);
        auto claim_pub = octra::compute_claim_pub(claim_sec, to_address);

        uint8_t r_blind[32];
        octra::random_bytes(r_blind, 32);
        std::string enc_amount = octra::encrypt_stealth_amount(
            shared, (uint64_t)amount, r_blind);
        log.step("ECDH done");

        // Step 1+2 in parallel: encrypt delta AND get current balance
        log.step("Encrypting delta + reading current balance (parallel)...");
        uint8_t seed[32];
        octra::random_bytes(seed, 32);

        pvac_cipher ct_delta_raw = nullptr;
        int64_t current_balance  = 0;
        {
            const uint8_t* seed_ptr = seed;
            auto fut_enc = std::async(std::launch::async, [&]() -> pvac_cipher {
                return pvac_enc_value_seeded(bridge.pk(), bridge.sk(),
                                             (uint64_t)amount, seed_ptr);
            });
            // Use pvac_dec_value (not pvac_dec_value_fp / get_balance) to match
            // the WASM decryptValue behaviour and avoid field-element sign issues.
            auto fut_bal = std::async(std::launch::async, [&]() -> int64_t {
                if (current_cipher.empty() || current_cipher == "0") return 0;
                pvac_cipher ct = bridge.decode_cipher(current_cipher);
                if (!ct) return 0;
                uint64_t val = pvac_dec_value(bridge.pk(), bridge.sk(), ct);
                pvac_free_cipher(ct);
                return static_cast<int64_t>(val);
            });
            ct_delta_raw    = fut_enc.get();
            current_balance = fut_bal.get();
        }
        log.step("Encrypt + balance done  balance=" + std::to_string(current_balance));

        if (!ct_delta_raw)
            throw std::runtime_error("encrypt delta returned null");
        if (amount > current_balance)
            throw std::runtime_error("Insufficient encrypted balance");

        CipherGuard ct_delta(ct_delta_raw);
        std::string delta_cipher_str = bridge.encode_cipher(ct_delta.get());
        auto commitment = bridge.commit_ct(ct_delta.get());
        std::string commitment_b64 = octra::base64_encode(commitment.data(), 32);
        log.step("Delta cipher encoded  len=" + std::to_string(delta_cipher_str.size()));

        // Step 3: ct_sub
        log.step("Computing ct_sub for new balance cipher...");
        CipherGuard ct_cur(bridge.decode_cipher(current_cipher));
        if (!ct_cur.get()) throw std::runtime_error("Failed to decode current cipher");

        CipherGuard ct_new(bridge.ct_sub(ct_cur.get(), ct_delta.get()));
        if (!ct_new.get()) throw std::runtime_error("ct_sub returned null");

        // Guard against underflow before cast.
        int64_t new_val_signed = current_balance - amount;
        if (new_val_signed < 0)
            throw std::runtime_error("new balance underflow: current_balance="
                + std::to_string(current_balance) + " amount=" + std::to_string(amount));
        uint64_t new_val = static_cast<uint64_t>(new_val_signed);
        log.step("ct_sub done  new_balance=" + std::to_string(new_val));

        // Zero proof (fast, do before range proofs)
        log.step("Building send zero proof...");
        ZeroProofGuard send_zp(bridge.make_zero_proof_bound(
            ct_delta.get(), (uint64_t)amount, r_blind));
        if (!send_zp.get()) throw std::runtime_error("send_zero_proof returned null");
        std::string send_zp_str = bridge.encode_zero_proof(send_zp.get());
        log.step("Zero proof done");

        // Step 4+5 in parallel: both range proofs concurrently
        log.step("Building range proofs in parallel (delta + balance)...");
        std::string rp_delta_str, rp_bal_str;
        {
            pvac_cipher ct_delta_h = ct_delta.get();
            pvac_cipher ct_new_h   = ct_new.get();
            pvac_pubkey pk_h       = bridge.pk();
            pvac_seckey sk_h       = bridge.sk();

            auto fut_rp_delta = std::async(std::launch::async, [&]() -> std::string {
                pvac_range_proof rp = pvac_make_range_proof(
                    pk_h, sk_h, ct_delta_h, (uint64_t)amount);
                if (!rp) return "";
                size_t len = 0;
                uint8_t* data = pvac_serialize_range_proof(rp, &len);
                std::string s = std::string("rp_v1|") + octra::base64_encode(data, len);
                pvac_free_bytes(data);
                pvac_free_range_proof(rp);
                return s;
            });

            auto fut_rp_bal = std::async(std::launch::async, [&]() -> std::string {
                pvac_range_proof rp = pvac_make_range_proof(
                    pk_h, sk_h, ct_new_h, new_val);
                if (!rp) return "";
                size_t len = 0;
                uint8_t* data = pvac_serialize_range_proof(rp, &len);
                std::string s = std::string("rp_v1|") + octra::base64_encode(data, len);
                pvac_free_bytes(data);
                pvac_free_range_proof(rp);
                return s;
            });

            rp_delta_str = fut_rp_delta.get();
            rp_bal_str   = fut_rp_bal.get();
        }

        if (rp_delta_str.empty()) throw std::runtime_error("range proof delta failed");
        if (rp_bal_str.empty())   throw std::runtime_error("range proof balance failed");
        log.step("Range proofs done  delta_len=" + std::to_string(rp_delta_str.size())
                 + "  bal_len=" + std::to_string(rp_bal_str.size()));

        auto amt_commit = bridge.pedersen_commit((uint64_t)amount, r_blind);
        std::string amt_commit_b64 = octra::base64_encode(amt_commit.data(), 32);

        log.step("Signing transaction...");
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

        r.success = true;
        r.tx_data = build_signed_tx(from_address, "stealth", "0",
                                    nonce, ou, timestamp, "stealth",
                                    stealth_data.dump(), sk64, pub_b64);
        log.step("Done  total=" + std::to_string(log.total_ms()) + "ms");
    } catch (const std::exception& e) {
        r.error = std::string("stealth_send: ") + e.what();
    }
    return r;
}

} // namespace pvac
