# OCTWA - Octra Wallet

A secure browser-based wallet for the Octra blockchain network. Available as both a web application and Chrome/Edge browser extension.

**Encrypted by Default** — Powered by Octra HFHE

## Project Structure

```
octwa/
├── src/                    # Main wallet application
├── extensionFiles/         # Browser extension files
├── packages/sdk/           # @octwa/sdk - dApp integration SDK
└── scripts/                # Build scripts
```

## SDK

The `@octwa/sdk` package is available on npm for dApp integration:

```bash
npm install @octwa/sdk
```

See [packages/sdk/README.md](packages/sdk/README.md) for documentation.

## Security Features

### Encryption & Key Management
- **PBKDF2 Key Derivation** - 310,000 iterations with 32-byte salt
- **AES-256-GCM Encryption** - All wallet data encrypted with master password
- **Encrypted-Only Storage** - Private keys NEVER stored unencrypted
- **Session Key Isolation** - Unique encryption key per session

### Session Security
- **Auto-Lock Protection** - Automatic locking after 15 minutes of inactivity
- **Cross-Tab Sync** - Lock state synchronized across all views (popup, expanded, web)
- **Browser Close Lock** - Auto-locks when browser closes

### Access Control
- **Rate Limiting** - 5 failed attempts triggers 5-minute lockout
- **Password Strength Validation** - Real-time strength indicator
- **Password Re-verification** - Required for sensitive operations (export keys, etc.)

## Features

### Wallet Management
- Create new wallet with BIP39 mnemonic (12/24 words)
- Import existing wallet via mnemonic phrase
- Multiple wallet support with instant switching
- Cached wallet data for seamless switching experience
- Drag & drop wallet reordering
- Custom wallet labels/names
- Secure private key export with password verification

### Transactions
- Standard OCT send with address book integration
- Multi-send (multiple recipients in single transaction)
- Bulk send via CSV file import
- Transaction history with filtering (All/Sent/Received/Contract)
- Real-time transaction status tracking
- Pending transaction monitoring

### Privacy Mode (Confidential Transactions)
- Public/Private mode toggle
- Encrypt balance (convert public OCT to private)
- Decrypt balance (convert private OCT to public)
- Private transfers using Fully Homomorphic Encryption (FHE)
- Claim incoming private transfers
- Separate activity history for private transactions

### EVM Compatibility
- Dual address support (Octra native + EVM address)
- Multi-network support (Ethereum, Polygon, BSC, Arbitrum, etc.)
- Custom network configuration
- ERC-20 token management
- NFT viewing and transfers
- Gas price estimation
- EVM transaction history

### Address Book
- Save frequently used addresses with labels
- Quick address selection during transfers
- Import/Export address book

### dApp Integration
- Web3 provider (`window.octra`)
- Circle-based connection model
- Capability-based permissions with TTL
- Connection approval flow with site info
- Transaction signing requests
- Intent-based swaps (OCT ⇄ ETH)
- Smart contract interaction support
- Connected dApps manager

### User Interface
- Responsive design (Popup mode & Expanded mode)
- Dark/Light theme toggle
- Onboarding flow for new users
- Real-time balance updates
- RPC provider manager with status indicator
- Animated 3D background

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

## Network Determination

The active network is determined by the wallet/extension and returned in `connection.network`. dApps must follow this value for API selection, explorer links, and transaction behavior. If a dApp requires a specific network, it should prompt the user to switch networks in the wallet and then reconnect.

## License

MIT
