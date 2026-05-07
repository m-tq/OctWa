# UI/UX Bug Fix Summary

**Date:** 2026-05-07  
**Scope:** `main` project (OctWa React/TypeScript wallet extension)

---

## Bugs Fixed

### 1. Splash Screen Shown on Every Open (Critical — Hang/Delay)

**Files:** `src/PopupApp.tsx`, `src/ExpandedApp.tsx`

**Problem:** `showSplash` was initialized to `true`, causing the 1.5-second animated splash screen to appear every single time the popup or expanded view was opened — even when the wallet was already set up. This created a perceived hang/freeze on every open.

**Fix:** Changed `showSplash` initial state to `false`. Splash is now only triggered inside `loadInitialData` when no wallet exists (fresh install path). Returning users go directly to the loading spinner or dashboard.

---

### 2. RPC Request Timeout Too Long (Critical — UI Freeze)

**Files:** `src/services/rpcHelper.ts`, `src/utils/api.ts`

**Problem:** All RPC and API requests used a 300-second (5-minute) `AbortSignal.timeout`. A slow or unreachable node would cause the UI to appear completely frozen for up to 5 minutes with no feedback.

**Fix:** Reduced timeout to 30 seconds.

---

### 3. Cache Not Updated After Transactions (Critical — Stale Balance)

**Files:** `src/components/WalletDashboard.tsx`, `src/components/EncryptBalanceDialog.tsx`, `src/components/DecryptBalanceDialog.tsx`, `src/components/PrivateTransfer.tsx`, `src/components/ClaimTransfers.tsx`, `src/components/SendTransaction.tsx`, `src/components/MultiSend.tsx`, `src/components/FileMultiSend.tsx`

**Problem:** After any transaction completed, the `cacheService` localStorage fast-cache was not updated immediately. The `silentRefreshAfterTx` only ran after a 3-second delay, and used a stale closure for `encryptedBalance`. This meant:
- After decrypt: encrypted balance showed old value until next full refresh
- After stealth send: encrypted balance not propagated to WalletDashboard
- After claim: encrypted balance not updated in parent
- After standard/multi/bulk send: public balance cache stayed stale
- `FileMultiSend` never called `onTransactionSuccess` at all

**Fix per transaction type:**

| Tx Type | Fix |
|---------|-----|
| **Encrypt** | `EncryptBalanceDialog.onSuccess` now passes `(freshPublic, freshEnc, freshNonce)` → `updateCacheAfterTx()` called immediately |
| **Decrypt** | Same as encrypt |
| **Stealth Send** | `PrivateTransfer` now calls `onEncryptedBalanceUpdate` callback → `handleEncryptedBalanceUpdate()` updates state + cache |
| **Claim Stealth** | `ClaimTransfers` now calls `onEncryptedBalanceUpdate` after single claim and claim-all → same handler |
| **Standard Send** | `SendTransaction` passes `freshBalance`/`freshNonce` in `onTransactionSuccess` → `handleTransactionSuccess` writes cache immediately |
| **Multi Send** | Same as standard send |
| **Bulk Send** | `FileMultiSend` now destructures and calls `onTransactionSuccess` (was missing entirely) |

**New functions added to `WalletDashboard`:**
- `updateCacheAfterTx(freshPublic, freshEnc, freshNonce)` — writes full cache entry with fresh data
- `handleEncryptedBalanceUpdate(freshEnc)` — updates encrypted balance state + cache, used by PrivateTransfer/ClaimTransfers

**`silentRefreshAfterTx` fix:** Now uses `freshEncrypted?.encrypted ?? encryptedBalance?.encrypted ?? 0` (nullish coalescing) instead of `||` to avoid treating `0` as falsy when encrypted balance is legitimately zero.

---

### 4. Balance Load Failure — Silent, No Retry (High — Blank State)

**File:** `src/components/WalletDashboard.tsx`

**Problem:** When the balance fetch failed and no cache was available, the balance area showed `0.00000000 OCT` with no indication of failure.

**Fix:** Added `balanceError` state, inline error UI with "Failed to load balance" + **Retry** button in both popup and expanded views.

---

### 5. Caps Lock Detection Bug in UnlockWallet (Medium — Wrong Warning)

**File:** `src/components/UnlockWallet.tsx`

**Problem:** The `keydown` handler only set `capsLockOn = true` but never `false`. Warning would never disappear after turning caps lock off.

**Fix:** Both `keydown` and `keyup` handlers now read `e.getModifierState('CapsLock')`.

---

### 6. `border-3` Invalid Tailwind Class — Invisible Spinner (Medium — Visual Bug)

**File:** `src/PopupApp.tsx`

**Problem:** Three loading spinners used `border-3` (not a valid Tailwind class). Spinners rendered without a visible border.

**Fix:** Replaced all `border-3` with `border-2`.

---

### 7. `connectionRequest` Typed as `any` (Low — Type Safety)

**File:** `src/App.tsx`

**Fix:** Changed type to `unknown`.

---

## Summary Table

| # | File(s) | Issue | Severity |
|---|---------|-------|----------|
| 1 | PopupApp, ExpandedApp | Splash on every open | Critical |
| 2 | rpcHelper, api | 300s RPC timeout → UI freeze | Critical |
| 3 | WalletDashboard + 7 components | Cache not updated after tx | Critical |
| 4 | WalletDashboard | Silent balance failure, no retry | High |
| 5 | UnlockWallet | Caps lock never clears | Medium |
| 6 | PopupApp | `border-3` invalid → invisible spinner | Medium |
| 7 | App.tsx | `any` type on state | Low |
