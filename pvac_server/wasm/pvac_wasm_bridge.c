/*
 * pvac_wasm_bridge.c
 *
 * JavaScript-friendly wrappers for PVAC functions that take uint64_t parameters.
 * Emscripten ccall does not support i64 — these wrappers accept lo/hi uint32_t
 * pairs and reconstruct the uint64_t internally.
 *
 * Naming: pvac_js_<original_name>
 */

#include <stdint.h>
#include "../pvac/pvac_c_api.h"

/* Reconstruct uint64 from two uint32 (little-endian: lo is low 32 bits) */
static inline uint64_t u64_from_lohi(uint32_t lo, uint32_t hi) {
    return ((uint64_t)hi << 32) | (uint64_t)lo;
}

/* pvac_enc_value_seeded(pk, sk, val:u64, seed) */
pvac_cipher pvac_js_enc_value_seeded(
    pvac_pubkey pk, pvac_seckey sk,
    uint32_t val_lo, uint32_t val_hi,
    const uint8_t seed[32])
{
    return pvac_enc_value_seeded(pk, sk, u64_from_lohi(val_lo, val_hi), seed);
}

/* pvac_make_zero_proof_bound(pk, sk, ct, amount:u64, blinding) */
pvac_zero_proof pvac_js_make_zero_proof_bound(
    pvac_pubkey pk, pvac_seckey sk, pvac_cipher ct,
    uint32_t amount_lo, uint32_t amount_hi,
    const uint8_t blinding[32])
{
    return pvac_make_zero_proof_bound(pk, sk, ct,
        u64_from_lohi(amount_lo, amount_hi), blinding);
}

/* pvac_pedersen_commit(amount:u64, blinding, out) */
void pvac_js_pedersen_commit(
    uint32_t amount_lo, uint32_t amount_hi,
    const uint8_t blinding[32], uint8_t out[32])
{
    pvac_pedersen_commit(u64_from_lohi(amount_lo, amount_hi), blinding, out);
}

/* pvac_make_range_proof(pk, sk, ct, value:u64) */
pvac_range_proof pvac_js_make_range_proof(
    pvac_pubkey pk, pvac_seckey sk, pvac_cipher ct,
    uint32_t value_lo, uint32_t value_hi)
{
    return pvac_make_range_proof(pk, sk, ct, u64_from_lohi(value_lo, value_hi));
}

/* pvac_make_aggregated_range_proof(pk, sk, ct, value:u64) */
pvac_agg_range_proof pvac_js_make_aggregated_range_proof(
    pvac_pubkey pk, pvac_seckey sk, pvac_cipher ct,
    uint32_t value_lo, uint32_t value_hi)
{
    return pvac_make_aggregated_range_proof(pk, sk, ct,
        u64_from_lohi(value_lo, value_hi));
}
