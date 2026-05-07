#pragma once
// PVAC_POPCOUNT64: portable popcount for 64-bit integers
#if defined(__GNUC__) || defined(__clang__)
#  define PVAC_POPCOUNT64(x) __builtin_popcountll((unsigned long long)(x))
#else
static inline int pvac_popcount64_fallback(uint64_t x) {
    x = x - ((x >> 1) & 0x5555555555555555ULL);
    x = (x & 0x3333333333333333ULL) + ((x >> 2) & 0x3333333333333333ULL);
    x = (x + (x >> 4)) & 0x0f0f0f0f0f0f0f0fULL;
    return (int)((x * 0x0101010101010101ULL) >> 56);
}
#  define PVAC_POPCOUNT64(x) pvac_popcount64_fallback((uint64_t)(x))
#endif

#include <cstdint>
#include <vector>
#include <algorithm>

namespace pvac {

struct BitVec {
    size_t nbits;
    std::vector<uint64_t> w;

    static BitVec make(size_t n) {
        BitVec v;
        v.nbits = n;
        v.w.assign((n + 63) / 64, 0);
        return v;
    }

    void xor_with(const BitVec & b) {
        size_t L = std::min(w.size(), b.w.size());
        for (size_t i = 0; i < L; i++) {
            w[i] ^= b.w[i];
        }
    }

    size_t popcnt() const {
        auto pc = [](uint64_t x) {
            return (uint32_t)PVAC_POPCOUNT64(x);
        };

        size_t s = 0;
        for (uint64_t t : w) {
            s += (size_t)pc(t);
        }
        return s;
    }
};

    inline int parity64(uint64_t x) {
        x ^= x >> 32;
        x ^= x >> 16;
        x ^= x >> 8;
        x ^= x >> 4;
        x &= 0xF;
        return (0x6996 >> x) & 1;
    }
}
