# OCTWA - Octra Wallet

A secure browser-based wallet for the Octra blockchain network. Available as both a web application and Chrome/Edge browser extension.

**Encrypted by Default** — Powered by Octra HFHE

## Project Structure

```
octwa/
├── src/                    # Main wallet application
├── extensionFiles/         # Browser extension files
├── packages/sdk/           # @octwa/sdk - dApp integration SDK
├── landing/                # Landing page
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

### Web Application

<p align="center">
  <img src="public/screenshot/welcome.png" alt="Welcome" width="400">
  <br><em>Welcome Screen</em>
</p>

<p align="center">
  <img src="public/screenshot/password.png" alt="Password" width="400">
  <br><em>Password Setup</em>
</p>

<p align="center">
  <img src="public/screenshot/dashboard.png" alt="Dashboard" width="400">
  <br><em>Dashboard</em>
</p>

<p align="center">
  <img src="public/screenshot/onboarding_first.png" alt="Onboarding" width="400">
  <br><em>Onboarding - first</em>
</p>

<p align="center">
  <img src="public/screenshot/onboarding_last.png" alt="Onboarding Complete" width="400">
  <br><em>Onboarding - last</em>
</p>

<p align="center">
  <img src="public/screenshot/multiwallet.png" alt="Multi Wallet" width="400">
  <br><em>Multi Wallet Support</em>
</p>

<p align="center">
  <img src="public/screenshot/multisend.png" alt="Multi Send" width="400">
  <br><em>Multi Send</em>
</p>

<p align="center">
  <img src="public/screenshot/bulksend.png" alt="Bulk Send" width="400">
  <br><em>Bulk Send (CSV Import)</em>
</p>

<p align="center">
  <img src="public/screenshot/privacy_first.png" alt="Privacy Setup" width="400">
  <br><em>Privacy Mode Setup</em>
</p>

<p align="center">
  <img src="public/screenshot/private.png" alt="Private Mode" width="400">
  <br><em>Private Mode with FHE</em>
</p>

<p align="center">
  <img src="public/screenshot/evm_assets.png" alt="EVM Assets" width="400">
  <br><em>EVM Assets</em>
</p>

### Browser Extension (Popup)

<table>
  <tr>
    <td align="center">
      <img src="public/screenshot/popup/locked.png" alt="Locked" width="280"><br>
      <em>Locked State</em>
    </td>
    <td align="center">
      <img src="public/screenshot/popup/dashboard.png" alt="Popup Dashboard" width="280"><br>
      <em>Dashboard</em>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="public/screenshot/popup/multiwallet.png" alt="Popup Multi Wallet" width="280"><br>
      <em>Multi Wallet</em>
    </td>
    <td align="center">
      <img src="public/screenshot/popup/walletmenu.png" alt="Wallet Menu" width="280"><br>
      <em>Wallet Menu</em>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="public/screenshot/popup/publicsend.png" alt="Public Send" width="280"><br>
      <em>Public Send</em>
    </td>
    <td align="center">
      <img src="public/screenshot/popup/privatedashboard.png" alt="Private Dashboard" width="280"><br>
      <em>Private Dashboard</em>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="public/screenshot/popup/privatesend.png" alt="Private Send" width="280"><br>
      <em>Private Send</em>
    </td>
  </tr>
</table>

## Video Demo

[![OctWa Demo](https://img.youtube.com/vi/n7hdKntWBzA/maxresdefault.jpg)](https://www.youtube.com/watch?v=n7hdKntWBzA)

## License

MIT
