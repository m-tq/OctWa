#pragma once

#include <cstdint>
#include <cstring>
#include <vector>
#include <string>

#include "../core/types.hpp"
#include "../core/hash.hpp"
#include "toeplitz.hpp"
#include "../core/ct_safe.hpp"

#if defined(__AES__) && defined(__SSE2__)
#include <wmmintrin.h>
#include <emmintrin.h>
#define PVAC_USE_AESNI 1
#define PVAC_USE_ARM_AES 0
#elif defined(__aarch64__) && defined(__ARM_FEATURE_CRYPTO)
#include <arm_neon.h>
#define PVAC_USE_AESNI 0
#define PVAC_USE_ARM_AES 1
#elif defined(__aarch64__) && defined(__APPLE__)
#include <arm_neon.h>
#define PVAC_USE_AESNI 0
#define PVAC_USE_ARM_AES 1
#else
#define PVAC_USE_AESNI 0
#define PVAC_USE_ARM_AES 0
#endif

namespace pvac {

inline Fp hash_to_fp_nonzero(uint64_t lo, uint64_t hi) {
    Fp r = fp_from_words(lo, hi & MASK63);
    uint64_t orv = r.lo | r.hi;
    uint64_t mask_zero = ((orv | -orv) >> 63) ^ 1;
    mask_zero = 0u - mask_zero;

    Fp one = fp_from_u64(1);

    Fp out;
    out.lo = (r.lo & ~mask_zero) | (one.lo & mask_zero);
    out.hi = (r.hi & ~mask_zero) | (one.hi & mask_zero);
    return out;
}

#if PVAC_USE_AESNI

struct AesCtr256 {
    __m128i rk[15];
    __m128i ctr;
    alignas(16) uint64_t buf[2] = {0, 0};
    bool has_buf = false;

    static inline __m128i key_expand(__m128i k, __m128i t) {
        t = _mm_shuffle_epi32(t, 0xFF);
        k = _mm_xor_si128(k, _mm_slli_si128(k, 4));
        k = _mm_xor_si128(k, _mm_slli_si128(k, 4));
        k = _mm_xor_si128(k, _mm_slli_si128(k, 4));
        return _mm_xor_si128(k, t);
    }

    static inline __m128i key_expand2(__m128i k1, __m128i k2) {
        __m128i t = _mm_aeskeygenassist_si128(k2, 0);
        t = _mm_shuffle_epi32(t, 0xAA);
        k1 = _mm_xor_si128(k1, _mm_slli_si128(k1, 4));
        k1 = _mm_xor_si128(k1, _mm_slli_si128(k1, 4));
        k1 = _mm_xor_si128(k1, _mm_slli_si128(k1, 4));
        return _mm_xor_si128(k1, t);
    }

    void init(const uint8_t key[32], uint64_t nonce) {
        __m128i k0 = _mm_loadu_si128((const __m128i*)key);
        __m128i k1 = _mm_loadu_si128((const __m128i*)(key + 16));

        rk[0] = k0;
        rk[1] = k1;
        rk[2] = key_expand(k0, _mm_aeskeygenassist_si128(k1, 0x01)); k0 = rk[2];
        rk[3] = key_expand2(k1, k0); k1 = rk[3];
        rk[4] = key_expand(k0, _mm_aeskeygenassist_si128(k1, 0x02)); k0 = rk[4];
        rk[5] = key_expand2(k1, k0); k1 = rk[5];
        rk[6] = key_expand(k0, _mm_aeskeygenassist_si128(k1, 0x04)); k0 = rk[6];
        rk[7] = key_expand2(k1, k0); k1 = rk[7];
        rk[8] = key_expand(k0, _mm_aeskeygenassist_si128(k1, 0x08)); k0 = rk[8];
        rk[9] = key_expand2(k1, k0); k1 = rk[9];
        rk[10] = key_expand(k0, _mm_aeskeygenassist_si128(k1, 0x10)); k0 = rk[10];
        rk[11] = key_expand2(k1, k0); k1 = rk[11];
        rk[12] = key_expand(k0, _mm_aeskeygenassist_si128(k1, 0x20)); k0 = rk[12];
        rk[13] = key_expand2(k1, k0); k1 = rk[13];
        rk[14] = key_expand(k0, _mm_aeskeygenassist_si128(k1, 0x40));

        ctr = _mm_set_epi64x(0, (long long)nonce);
        has_buf = false;
    }

    inline __m128i encrypt_ctr() {
        __m128i t = _mm_xor_si128(ctr, rk[0]);
        t = _mm_aesenc_si128(t, rk[1]);
        t = _mm_aesenc_si128(t, rk[2]);
        t = _mm_aesenc_si128(t, rk[3]);
        t = _mm_aesenc_si128(t, rk[4]);
        t = _mm_aesenc_si128(t, rk[5]);
        t = _mm_aesenc_si128(t, rk[6]);
        t = _mm_aesenc_si128(t, rk[7]);
        t = _mm_aesenc_si128(t, rk[8]);
        t = _mm_aesenc_si128(t, rk[9]);
        t = _mm_aesenc_si128(t, rk[10]);
        t = _mm_aesenc_si128(t, rk[11]);
        t = _mm_aesenc_si128(t, rk[12]);
        t = _mm_aesenc_si128(t, rk[13]);
        t = _mm_aesenclast_si128(t, rk[14]);
        ctr = _mm_add_epi64(ctr, _mm_set_epi64x(0, 1));
        return t;
    }

    inline uint64_t next_u64() {
        if (has_buf) {
            has_buf = false;
            return buf[1];
        }
        __m128i ct = encrypt_ctr();
        _mm_store_si128((__m128i*)buf, ct);
        has_buf = true;
        return buf[0];
    }

    inline void fill_u64(uint64_t* out, size_t n) {
        size_t i = 0;
        if (has_buf && n > 0) {
            out[0] = buf[1];
            has_buf = false;
            i = 1;
        }
        alignas(16) uint64_t tmp[2];
        for (; i + 1 < n; i += 2) {
            __m128i ct = encrypt_ctr();
            _mm_store_si128((__m128i*)tmp, ct);
            out[i] = tmp[0];
            out[i + 1] = tmp[1];
        }
        if (i < n) {
            __m128i ct = encrypt_ctr();
            _mm_store_si128((__m128i*)buf, ct);
            out[i] = buf[0];
            has_buf = true;
        }
    }

    inline uint64_t bounded(uint64_t M) {
        if (M <= 1) return 0;
        uint64_t lim = UINT64_MAX - (UINT64_MAX % M);
        for (;;) {
            uint64_t x = next_u64();
            if (x < lim) return x % M;
        }
    }
};

#elif PVAC_USE_ARM_AES

struct AesCtr256 {
    uint8x16_t rk[15];
    uint64_t ctr_val;
    alignas(16) uint64_t buf[2] = {0, 0};
    bool has_buf = false;

    static inline uint8x16_t aes_round(uint8x16_t state, uint8x16_t zero, uint8x16_t key) {
        return veorq_u8(vaesmcq_u8(vaeseq_u8(state, zero)), key);
    }

    static inline uint8x16_t aes_round_last(uint8x16_t state, uint8x16_t zero, uint8x16_t final_key) {
        return veorq_u8(vaeseq_u8(state, zero), final_key);
    }

    static inline uint32_t sub_word(uint32_t w) {
        uint8x16_t zero = vdupq_n_u8(0);
        uint8x16_t v = vreinterpretq_u8_u32(vdupq_n_u32(w));
        v = vaeseq_u8(v, zero);
        return vgetq_lane_u32(vreinterpretq_u32_u8(v), 0);
    }

    static inline void key_expand_256(const uint8_t key[32], uint8x16_t rk_out[15]) {
        static const uint8_t rcon[] = {0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40};
        uint32_t w[60];
        std::memcpy(w, key, 32);

        for (int i = 8; i < 60; ++i) {
            uint32_t t = w[i - 1];
            if (i % 8 == 0) {
                t = sub_word((t >> 8) | (t << 24)) ^ ((uint32_t)rcon[i / 8 - 1]);
            } else if (i % 8 == 4) {
                t = sub_word(t);
            }
            w[i] = w[i - 8] ^ t;
        }

        for (int i = 0; i < 15; ++i)
            rk_out[i] = vld1q_u8((const uint8_t*)(w + 4 * i));
    }

    void init(const uint8_t key[32], uint64_t nonce) {
        key_expand_256(key, rk);
        ctr_val = nonce;
        has_buf = false;
    }

    inline void encrypt_ctr_block(uint8_t out[16]) {
        alignas(16) uint64_t ctr_block[2] = {ctr_val, 0};
        uint8x16_t state = vld1q_u8((const uint8_t*)ctr_block);
        uint8x16_t zero = vdupq_n_u8(0);

        state = veorq_u8(state, rk[0]);
        state = aes_round(state, zero, rk[1]);
        state = aes_round(state, zero, rk[2]);
        state = aes_round(state, zero, rk[3]);
        state = aes_round(state, zero, rk[4]);
        state = aes_round(state, zero, rk[5]);
        state = aes_round(state, zero, rk[6]);
        state = aes_round(state, zero, rk[7]);
        state = aes_round(state, zero, rk[8]);
        state = aes_round(state, zero, rk[9]);
        state = aes_round(state, zero, rk[10]);
        state = aes_round(state, zero, rk[11]);
        state = aes_round(state, zero, rk[12]);
        state = aes_round(state, zero, rk[13]);
        state = aes_round_last(state, zero, rk[14]);

        vst1q_u8(out, state);
        ++ctr_val;
    }

    inline uint64_t next_u64() {
        if (has_buf) {
            has_buf = false;
            return buf[1];
        }
        alignas(16) uint8_t tmp[16];
        encrypt_ctr_block(tmp);
        std::memcpy(buf, tmp, 16);
        has_buf = true;
        return buf[0];
    }

    inline void fill_u64(uint64_t* out, size_t n) {
        size_t i = 0;
        if (has_buf && n > 0) {
            out[0] = buf[1];
            has_buf = false;
            i = 1;
        }
        alignas(16) uint8_t tmp[16];
        alignas(16) uint64_t pair[2];
        for (; i + 1 < n; i += 2) {
            encrypt_ctr_block(tmp);
            std::memcpy(pair, tmp, 16);
            out[i] = pair[0];
            out[i + 1] = pair[1];
        }
        if (i < n) {
            encrypt_ctr_block(tmp);
            std::memcpy(buf, tmp, 16);
            out[i] = buf[0];
            has_buf = true;
        }
    }

    inline uint64_t bounded(uint64_t M) {
        if (M <= 1) return 0;
        uint64_t lim = UINT64_MAX - (UINT64_MAX % M);
        for (;;) {
            uint64_t x = next_u64();
            if (x < lim) return x % M;
        }
    }
};

#else

// ── Software AES-256-CTR fallback (WASM / no hardware AES) ──────────────────
// Pure C++ AES-256-CTR. ~10-20x slower than AES-NI but functionally identical.
// Enabled automatically when neither __AES__ nor ARM crypto is available.
#define PVAC_USE_SW_AES 1

namespace pvac_sw_aes {

// AES S-box
static const uint8_t SBOX[256] = {
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
};

// GF(2^8) multiply by 2
static inline uint8_t xtime(uint8_t x) {
    return (uint8_t)((x << 1) ^ ((x >> 7) * 0x1b));
}

// SubWord: apply SBOX to each byte of a 32-bit word
static inline uint32_t sub_word(uint32_t w) {
    return ((uint32_t)SBOX[(w >> 24) & 0xff] << 24) |
           ((uint32_t)SBOX[(w >> 16) & 0xff] << 16) |
           ((uint32_t)SBOX[(w >>  8) & 0xff] <<  8) |
           ((uint32_t)SBOX[(w      ) & 0xff]      );
}

// RotWord: rotate word left by 8 bits
static inline uint32_t rot_word(uint32_t w) {
    return (w << 8) | (w >> 24);
}

// AES-256 key expansion: 14 rounds, 60 round key words
static void key_expand_256(const uint8_t key[32], uint32_t rk[60]) {
    static const uint32_t rcon[7] = {
        0x01000000, 0x02000000, 0x04000000, 0x08000000,
        0x10000000, 0x20000000, 0x40000000
    };
    // Load key as big-endian words
    for (int i = 0; i < 8; i++) {
        rk[i] = ((uint32_t)key[4*i+0] << 24) | ((uint32_t)key[4*i+1] << 16) |
                ((uint32_t)key[4*i+2] <<  8) | ((uint32_t)key[4*i+3]      );
    }
    for (int i = 8; i < 60; i++) {
        uint32_t t = rk[i-1];
        if (i % 8 == 0)      t = sub_word(rot_word(t)) ^ rcon[i/8 - 1];
        else if (i % 8 == 4) t = sub_word(t);
        rk[i] = rk[i-8] ^ t;
    }
}

// AES-256 encrypt one 16-byte block (ECB).
// State layout: column-major, state[byte] = state[col*4 + row]
// Input/output are raw bytes in standard AES byte order.
static void aes256_encrypt_block(const uint32_t rk[60], const uint8_t in[16], uint8_t out[16]) {
    // Load state as 4 column words (big-endian)
    uint32_t s0, s1, s2, s3;
    s0 = ((uint32_t)in[ 0]<<24)|((uint32_t)in[ 1]<<16)|((uint32_t)in[ 2]<<8)|in[ 3];
    s1 = ((uint32_t)in[ 4]<<24)|((uint32_t)in[ 5]<<16)|((uint32_t)in[ 6]<<8)|in[ 7];
    s2 = ((uint32_t)in[ 8]<<24)|((uint32_t)in[ 9]<<16)|((uint32_t)in[10]<<8)|in[11];
    s3 = ((uint32_t)in[12]<<24)|((uint32_t)in[13]<<16)|((uint32_t)in[14]<<8)|in[15];

    // AddRoundKey 0
    s0 ^= rk[0]; s1 ^= rk[1]; s2 ^= rk[2]; s3 ^= rk[3];

    // 13 full rounds (SubBytes + ShiftRows + MixColumns + AddRoundKey)
    for (int r = 1; r <= 13; r++) {
        // SubBytes + ShiftRows combined (using column words):
        // After ShiftRows, column c gets bytes from rows 0,1,2,3 of
        // original columns c, (c+1)%4, (c+2)%4, (c+3)%4
        uint32_t t0, t1, t2, t3;
        t0 = ((uint32_t)SBOX[(s0>>24)&0xff]<<24) | ((uint32_t)SBOX[(s1>>16)&0xff]<<16) |
             ((uint32_t)SBOX[(s2>> 8)&0xff]<< 8) | ((uint32_t)SBOX[(s3    )&0xff]    );
        t1 = ((uint32_t)SBOX[(s1>>24)&0xff]<<24) | ((uint32_t)SBOX[(s2>>16)&0xff]<<16) |
             ((uint32_t)SBOX[(s3>> 8)&0xff]<< 8) | ((uint32_t)SBOX[(s0    )&0xff]    );
        t2 = ((uint32_t)SBOX[(s2>>24)&0xff]<<24) | ((uint32_t)SBOX[(s3>>16)&0xff]<<16) |
             ((uint32_t)SBOX[(s0>> 8)&0xff]<< 8) | ((uint32_t)SBOX[(s1    )&0xff]    );
        t3 = ((uint32_t)SBOX[(s3>>24)&0xff]<<24) | ((uint32_t)SBOX[(s0>>16)&0xff]<<16) |
             ((uint32_t)SBOX[(s1>> 8)&0xff]<< 8) | ((uint32_t)SBOX[(s2    )&0xff]    );

        // MixColumns on each column word
        auto mc = [](uint32_t w) -> uint32_t {
            uint8_t a = (w>>24)&0xff, b = (w>>16)&0xff, c = (w>>8)&0xff, d = w&0xff;
            uint8_t r0 = xtime(a)^xtime(b)^b^c^d;
            uint8_t r1 = a^xtime(b)^xtime(c)^c^d;
            uint8_t r2 = a^b^xtime(c)^xtime(d)^d;
            uint8_t r3 = xtime(a)^a^b^c^xtime(d);
            return ((uint32_t)r0<<24)|((uint32_t)r1<<16)|((uint32_t)r2<<8)|r3;
        };
        s0 = mc(t0) ^ rk[r*4+0];
        s1 = mc(t1) ^ rk[r*4+1];
        s2 = mc(t2) ^ rk[r*4+2];
        s3 = mc(t3) ^ rk[r*4+3];
    }

    // Final round (no MixColumns)
    uint32_t t0, t1, t2, t3;
    t0 = ((uint32_t)SBOX[(s0>>24)&0xff]<<24) | ((uint32_t)SBOX[(s1>>16)&0xff]<<16) |
         ((uint32_t)SBOX[(s2>> 8)&0xff]<< 8) | ((uint32_t)SBOX[(s3    )&0xff]    );
    t1 = ((uint32_t)SBOX[(s1>>24)&0xff]<<24) | ((uint32_t)SBOX[(s2>>16)&0xff]<<16) |
         ((uint32_t)SBOX[(s3>> 8)&0xff]<< 8) | ((uint32_t)SBOX[(s0    )&0xff]    );
    t2 = ((uint32_t)SBOX[(s2>>24)&0xff]<<24) | ((uint32_t)SBOX[(s3>>16)&0xff]<<16) |
         ((uint32_t)SBOX[(s0>> 8)&0xff]<< 8) | ((uint32_t)SBOX[(s1    )&0xff]    );
    t3 = ((uint32_t)SBOX[(s3>>24)&0xff]<<24) | ((uint32_t)SBOX[(s0>>16)&0xff]<<16) |
         ((uint32_t)SBOX[(s1>> 8)&0xff]<< 8) | ((uint32_t)SBOX[(s2    )&0xff]    );
    s0 = t0 ^ rk[56]; s1 = t1 ^ rk[57]; s2 = t2 ^ rk[58]; s3 = t3 ^ rk[59];

    // Store output
    out[ 0]=(s0>>24)&0xff; out[ 1]=(s0>>16)&0xff; out[ 2]=(s0>>8)&0xff; out[ 3]=s0&0xff;
    out[ 4]=(s1>>24)&0xff; out[ 5]=(s1>>16)&0xff; out[ 6]=(s1>>8)&0xff; out[ 7]=s1&0xff;
    out[ 8]=(s2>>24)&0xff; out[ 9]=(s2>>16)&0xff; out[10]=(s2>>8)&0xff; out[11]=s2&0xff;
    out[12]=(s3>>24)&0xff; out[13]=(s3>>16)&0xff; out[14]=(s3>>8)&0xff; out[15]=s3&0xff;
}

} // namespace pvac_sw_aes

struct AesCtr256 {
    uint32_t rk[60];
    uint64_t ctr_val = 0;
    uint64_t buf[2] = {};
    bool has_buf = false;

    void init(const uint8_t key[32], uint64_t nonce) {
        pvac_sw_aes::key_expand_256(key, rk);
        ctr_val = nonce; has_buf = false;
    }
    inline void encrypt_ctr_block(uint8_t out[16]) {
        alignas(16) uint8_t ctr_block[16]={};
        std::memcpy(ctr_block, &ctr_val, 8);
        pvac_sw_aes::aes256_encrypt_block(rk, ctr_block, out);
        ++ctr_val;
    }
    inline uint64_t next_u64() {
        if (has_buf){has_buf=false;return buf[1];}
        alignas(16) uint8_t tmp[16]; encrypt_ctr_block(tmp);
        std::memcpy(buf,tmp,16); has_buf=true; return buf[0];
    }
    inline void fill_u64(uint64_t* out, size_t n) {
        size_t i=0;
        if (has_buf&&n>0){out[0]=buf[1];has_buf=false;i=1;}
        alignas(16) uint8_t tmp[16];
        for(;i+1<n;i+=2){encrypt_ctr_block(tmp);std::memcpy(out+i,tmp,16);}
        if(i<n){encrypt_ctr_block(tmp);std::memcpy(buf,tmp,16);out[i]=buf[0];has_buf=true;}
    }
    inline uint64_t bounded(uint64_t M) {
        if(M<=1)return 0;
        uint64_t lim=UINT64_MAX-(UINT64_MAX%M);
        for(;;){uint64_t x=next_u64();if(x<lim)return x%M;}
    }
};

#endif

inline uint64_t fnv1a_domain(const char* dom) {
    uint64_t h = 0xcbf29ce484222325ull;
    for (const char* p = dom; *p; ++p) {
        h ^= (uint64_t)(uint8_t)*p;
        h *= 0x100000001b3ull;
    }
    return h;
}

inline void derive_aes_key(
    const PubKey& pk,
    const SecKey& sk,
    const RSeed& seed,
    const char* dom,
    uint8_t out_key[32],
    uint64_t& out_nonce
) {
    Sha256 h;
    h.init();

    for (auto x : sk.prf_k) sha256_acc_u64(h, x);
    sha256_acc_u64(h, pk.canon_tag);

    const uint8_t* d = pk.H_digest.data();
    h.update(d, 32);

    sha256_acc_u64(h, seed.ztag);
    sha256_acc_u64(h, seed.nonce.lo);
    sha256_acc_u64(h, seed.nonce.hi);

    uint64_t dom_hash = fnv1a_domain(dom);
    sha256_acc_u64(h, dom_hash);

    h.finish(out_key);
    out_nonce = dom_hash ^ seed.nonce.lo;
}

inline void lpn_make_ybits(
    const PubKey& pk,
    const SecKey& sk,
    const RSeed& seed,
    const char* dom,
    std::vector<uint64_t>& ybits
) {
    int t = pk.prm.lpn_t;
    int n = pk.prm.lpn_n;
    size_t s_words = ((size_t)n + 63) / 64;

    uint8_t aes_key[32];
    uint64_t nonce;
    derive_aes_key(pk, sk, seed, dom, aes_key, nonce);

    AesCtr256 prg;
    prg.init(aes_key, nonce);

    ybits.assign(((size_t)t + 63) / 64, 0ull);

    int num = pk.prm.lpn_tau_num;
    int den = pk.prm.lpn_tau_den;

    std::vector<uint64_t> row_buf(s_words);

    for (int r = 0; r < t; r++) {
        prg.fill_u64(row_buf.data(), s_words);

        uint64_t acc = 0;
        for (size_t wi = 0; wi < s_words; ++wi) {
            acc ^= row_buf[wi] & sk.lpn_s_bits[wi];
        }
        int dot = parity64(acc);

        int e = (prg.bounded((uint64_t)den) < (uint64_t)num) ? 1 : 0;
        int y = dot ^ e;

        ybits[r >> 6] ^= ((uint64_t)y) << (r & 63);
    }
}

inline Fp prf_R_core(
    const PubKey& pk,
    const SecKey& sk,
    const RSeed& seed,
    const char* dom
) {
    std::vector<uint64_t> ybits;
    lpn_make_ybits(pk, sk, seed, dom, ybits);

    uint8_t toep_key[32];
    uint64_t toep_nonce;
    derive_aes_key(pk, sk, seed, Dom::TOEP, toep_key, toep_nonce);
    toep_nonce ^= fnv1a_domain(dom);

    AesCtr256 prg;
    prg.init(toep_key, toep_nonce);

    size_t top_words = ((size_t)pk.prm.lpn_t + 127u + 63u) / 64u;
    std::vector<uint64_t> top(top_words);
    prg.fill_u64(top.data(), top_words);

    uint64_t lo = 0;
    uint64_t hi = 0;
    toep_127(top, ybits, lo, hi);

    return hash_to_fp_nonzero(lo, hi);
}

inline Fp prf_R(const PubKey& pk, const SecKey& sk, const RSeed& seed) {
    Fp r1 = prf_R_core(pk, sk, seed, Dom::PRF_R1);
    Fp r2 = prf_R_core(pk, sk, seed, Dom::PRF_R2);
    Fp r3 = prf_R_core(pk, sk, seed, Dom::PRF_R3);
    return fp_mul(fp_mul(r1, r2), r3);
}

inline Fp prf_R_noise(const PubKey& pk, const SecKey& sk, const RSeed& seed) {
    Fp r1 = prf_R_core(pk, sk, seed, Dom::PRF_NOISE1);
    Fp r2 = prf_R_core(pk, sk, seed, Dom::PRF_NOISE2);
    Fp r3 = prf_R_core(pk, sk, seed, Dom::PRF_NOISE3);
    return fp_mul(fp_mul(r1, r2), r3);
}

}
