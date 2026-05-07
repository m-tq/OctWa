/*
    pvac_ops.hpp -- PVAC operations wrapper.

    Exposes PvacOps with bridge_ref() so pvac_ops_parallel.hpp can access
    the bridge directly for parallel execution.
*/
#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <stdexcept>
#include "../lib/pvac_bridge.hpp"
#include "../lib/stealth.hpp"
#include "../crypto_utils.hpp"
#include "../lib/tx_builder.hpp"
#include "../lib/json.hpp"
#include "../lib/httplib.h"

extern "C" {
#include "../lib/tweetnacl.h"
}

using json = nlohmann::json;

namespace pvac {

// -- RAII guards for PVAC handles ---------------------------------------------

struct CipherGuard {
    pvac_cipher h = nullptr;
    explicit CipherGuard(pvac_cipher c) : h(c) {}
    ~CipherGuard() { if (h) pvac_free_cipher(h); }
    CipherGuard(const CipherGuard&) = delete;
    CipherGuard& operator=(const CipherGuard&) = delete;
    pvac_cipher get() const { return h; }
};

struct ZeroProofGuard {
    pvac_zero_proof h = nullptr;
    explicit ZeroProofGuard(pvac_zero_proof z) : h(z) {}
    ~ZeroProofGuard() { if (h) pvac_free_zero_proof(h); }
    ZeroProofGuard(const ZeroProofGuard&) = delete;
    ZeroProofGuard& operator=(const ZeroProofGuard&) = delete;
    pvac_zero_proof get() const { return h; }
};

// -- Key helpers ---------------------------------------------------------------

// Normalize public key to base64.
// The extension stores pubkeys as hex; the node and signing code expect base64.
inline std::string normalize_pub_b64(const std::string& pub) {
    if (pub.empty()) return pub;
    bool is_hex = (pub.size() == 64);
    if (is_hex) {
        for (char c : pub) {
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
                is_hex = false;
                break;
            }
        }
    }
    if (!is_hex) return pub;  // already base64
    auto raw = octra::hex_decode(pub);
    return octra::base64_encode(raw.data(), raw.size());
}

// Returns 64-byte Ed25519 sk from either 32-byte seed or 64-byte sk (base64).
inline std::vector<uint8_t> resolve_sk64(const std::string& priv_b64,
                                          const std::string& pub_b64 = "") {
    auto raw = octra::base64_decode(priv_b64);
    if (raw.size() == 64) return raw;

    if (raw.size() == 32) {
        std::vector<uint8_t> sk64(64);
        uint8_t pk[32];
        octra::keypair_from_seed(raw.data(), sk64.data(), pk);
        if (!pub_b64.empty()) {
            auto pk_raw = octra::base64_decode(pub_b64);
            if (pk_raw.size() == 32 && memcmp(pk, pk_raw.data(), 32) != 0)
                throw std::runtime_error("Public key mismatch with derived key");
        }
        return sk64;
    }

    throw std::runtime_error("Invalid private key length: " +
                             std::to_string(raw.size()) + " bytes (expected 32 or 64)");
}

// -- PvacOps -------------------------------------------------------------------

class PvacOps {
    octra::PvacBridge bridge_;
    bool initialized_ = false;

public:
    PvacOps() = default;

    bool init(const std::string& seed32_b64) {
        initialized_ = bridge_.init(seed32_b64);
        return initialized_;
    }

    bool is_initialized() const { return initialized_; }

    // Expose bridge for parallel operations in pvac_ops_parallel.hpp
    octra::PvacBridge& bridge_ref() { return bridge_; }

    struct TxResult {
        bool success = false;
        json tx_data;
        std::string error;
    };
};

} // namespace pvac
