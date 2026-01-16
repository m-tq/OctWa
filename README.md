# OCTWA - Octra Wallet

A secure browser-based wallet for the Octra blockchain network. Available as both a web application and Chrome/Edge browser extension.

**Encrypted by Default** — Powered by Octra HFHE

## Project Structure

```
octwa/
├── src/                    # Main wallet application
├── extensionFiles/         # Browser extension files
├── packages/sdk/           # @octwa/sdk - dApp integration SDK
├── intents-api/            # Intent-based swap backend
├── octwa-dex/              # DEX frontend (OCT ⇄ ETH swaps)
├── landing/                # Landing page
└── scripts/                # Build scripts
```

## Related Projects

| Project | Description | README |
|---------|-------------|--------|
| `packages/sdk` | SDK for dApp integration | [packages/sdk/README.md](packages/sdk/README.md) |
| `intents-api` | Swap backend API | [intents-api/README.md](intents-api/README.md) |
| `octwa-dex` | DEX frontend | [octwa-dex/README.md](octwa-dex/README.md) |

## Security Features

### Encryption & Key Management
- **PBKDF2 Key Derivation** - 310,000 iterations with 32-byte salt
- **AES-256-GCM Encryption** - All wallet data encrypted with master password
- **Encrypted-Only Storage** - Private keys NEVER stored unencrypted
- **Session Key Isolation** - Unique encryption key per session

### Session Security
- **Auto-Lock Protection** - Automatic locking after 15 minutes
- **Cross-Tab Sync** - Lock state synchronized across views
- **Browser Close Lock** - Auto-locks when browser closes

### Access Control
- **Rate Limiting** - 5 failed attempts triggers 5-minute lockout
- **Password Strength Validation** - Real-time strength indicator
- **Password Re-verification** - Required for sensitive operations

## Features

### Wallet Management
- Create/Import wallets (BIP39 mnemonic)
- Multiple wallet support
- Secure private key export

### Transactions
- Standard send
- Multi-send (multiple recipients)
- Bulk send (CSV import)
- Transaction history

### Privacy (Confidential Transactions)
- Public/Private mode toggle
- Encrypt/Decrypt balance
- Private transfers with FHE

### dApp Integration
- Web3 provider (`window.octra`)
- Connection approval flow
- Transaction signing
- Smart contract interaction

## Quick Start

```bash
# Install dependencies
npm install

# Development
npm run dev

# Build for production
npm run build:prod

# Build browser extension
npm run build:extension
```

## Browser Extension

1. Build: `npm run build:extension`
2. Open `chrome://extensions` or `edge://extensions`
3. Enable Developer mode
4. Load unpacked → select `dist` folder

## Configuration

Default RPC: `https://octra.network`

Manage providers via UI (RPC Provider Manager) or seed `localStorage` key `rpcProviders`.

## Screenshots

<p align="center">
  <img src="public/screenshot/dashboard.png" alt="Dashboard" width="400">
  <br><em>Dashboard</em>
</p>

<p align="center">
  <img src="public/screenshot/private.png" alt="Private Mode" width="400">
  <br><em>Private Mode with FHE</em>
</p>

## Video Demo

[![OctWa Demo](https://img.youtube.com/vi/n7hdKntWBzA/maxresdefault.jpg)](https://www.youtube.com/watch?v=n7hdKntWBzA)

## License

MIT
