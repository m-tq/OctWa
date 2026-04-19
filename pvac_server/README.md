# PVAC Server - Local Cryptographic Operations Server

## Overview

PVAC (Publicly Verifiable Arithmetic Computations) Server is a local C++ server that handles heavy cryptographic operations for the OctWa wallet extension. It uses WebSocket and REST API with secure authentication.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser Extension (JavaScript)                             │
│  - UI/UX                                                     │
│  - Wallet management                                         │
│  - Transaction building                                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ WebSocket/REST + Auth Token
                 │
┌────────────────▼────────────────────────────────────────────┐
│  PVAC Server (C++ Local Server)                             │
│  - Encrypted balance decryption                             │
│  - Balance encryption                                        │
│  - Balance decryption                                        │
│  - Stealth send                                              │
│  - Claim stealth                                             │
│  - Scan stealth transfers                                    │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ Uses PVAC C++ Library
                 │
┌────────────────▼────────────────────────────────────────────┐
│  PVAC Library (Homomorphic Encryption)                      │
│  - FHE operations                                            │
│  - Cryptographic proofs                                      │
└─────────────────────────────────────────────────────────────┘
```

## Features

### Supported Operations

1. **Encrypted Balance Decryption**
   - Decrypt HFHE cipher to get actual balance
   - Input: cipher (base64), private key
   - Output: decrypted balance (raw integer)

2. **Encrypt Balance**
   - Encrypt public balance to private balance
   - Input: amount, private key, public key
   - Output: transaction proof

3. **Decrypt Balance**
   - Decrypt private balance to public balance
   - Input: amount, private key, current cipher
   - Output: transaction proof

4. **Stealth Send**
   - Send private transfer to recipient
   - Input: recipient address, amount, private key
   - Output: stealth transaction

5. **Claim Stealth**
   - Claim received stealth transfer
   - Input: stealth output, private key
   - Output: claim transaction

6. **Scan Stealth Transfers**
   - Scan blockchain for stealth transfers
   - Input: private key, from_epoch
   - Output: list of claimable transfers

## Security

### Authentication

- **Auth Token**: Random 32-byte token generated on server start
- **Token Storage**: Saved to `~/.octwa/pvac_token`
- **Token Validation**: All requests must include valid token

### Connection Security

- **Local Only**: Server binds to `127.0.0.1` (localhost only)
- **No Remote Access**: Cannot be accessed from network
- **Token Required**: All endpoints require authentication

### Data Security

- **No Storage**: Private keys never stored on disk
- **Memory Only**: All sensitive data in memory only
- **Secure Cleanup**: Memory zeroed after use

## API Endpoints

### REST API

#### 1. Health Check
```
GET /health
Response: {"status": "ok", "version": "1.0.0"}
```

#### 2. Decrypt Encrypted Balance
```
POST /api/decrypt_balance
Headers: Authorization: Bearer <token>
Body: {
  "cipher": "hfhe_v1|<base64>",
  "private_key": "<base64>"
}
Response: {
  "success": true,
  "balance": 50000,
  "balance_oct": "0.05"
}
```

#### 3. Encrypt Balance
```
POST /api/encrypt_balance
Headers: Authorization: Bearer <token>
Body: {
  "amount": 50000,
  "private_key": "<base64>",
  "public_key": "<base64>",
  "address": "oct1...",
  "nonce": 123
}
Response: {
  "success": true,
  "tx": { ... }
}
```

#### 4. Decrypt Balance (to public)
```
POST /api/decrypt_to_public
Headers: Authorization: Bearer <token>
Body: {
  "amount": 50000,
  "private_key": "<base64>",
  "current_cipher": "hfhe_v1|...",
  "address": "oct1...",
  "nonce": 123
}
Response: {
  "success": true,
  "tx": { ... }
}
```

#### 5. Create Stealth Send
```
POST /api/stealth_send
Headers: Authorization: Bearer <token>
Body: {
  "to_address": "oct1...",
  "amount": 50000,
  "private_key": "<base64>",
  "from_address": "oct1...",
  "nonce": 123
}
Response: {
  "success": true,
  "tx": { ... }
}
```

#### 6. Claim Stealth Transfer
```
POST /api/claim_stealth
Headers: Authorization: Bearer <token>
Body: {
  "stealth_output": { ... },
  "private_key": "<base64>",
  "address": "oct1...",
  "nonce": 123
}
Response: {
  "success": true,
  "tx": { ... }
}
```

#### 7. Scan Stealth Transfers
```
POST /api/scan_stealth
Headers: Authorization: Bearer <token>
Body: {
  "private_key": "<base64>",
  "from_epoch": 0,
  "rpc_url": "http://..."
}
Response: {
  "success": true,
  "transfers": [
    {
      "amount": 50000,
      "epoch": 123,
      "stealth_output": { ... }
    }
  ]
}
```

### WebSocket API

```
ws://127.0.0.1:8765/ws?token=<auth_token>

Messages:
{
  "id": "unique-request-id",
  "method": "decrypt_balance",
  "params": { ... }
}

Response:
{
  "id": "unique-request-id",
  "success": true,
  "result": { ... }
}
```

## Installation

### Prerequisites

- C++17 compiler (g++ or clang++)
- CMake 3.15+
- OpenSSL
- PVAC library (included)

### Build

```bash
cd pvac_server
mkdir build
cd build
cmake ..
make
```

### Run

```bash
./pvac_server
```

Server will start on `http://127.0.0.1:8765`

Auth token will be saved to `~/.octwa/pvac_token`

## Extension Integration

### 1. Read Auth Token

```javascript
// Extension reads token from file
const token = await readAuthToken();
```

### 2. Connect to Server

```javascript
// REST API
const response = await fetch('http://127.0.0.1:8765/api/decrypt_balance', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    cipher: 'hfhe_v1|...',
    private_key: '...'
  })
});

// WebSocket
const ws = new WebSocket(`ws://127.0.0.1:8765/ws?token=${token}`);
ws.onmessage = (event) => {
  const response = JSON.parse(event.data);
  console.log('Result:', response.result);
};
```

### 3. Handle Responses

```javascript
const result = await response.json();
if (result.success) {
  console.log('Balance:', result.balance_oct, 'OCT');
} else {
  console.error('Error:', result.error);
}
```

## Development

### Project Structure

```
pvac_server/
├── src/
│   ├── main.cpp              # Server entry point
│   ├── server.hpp            # HTTP/WebSocket server
│   ├── auth.hpp              # Authentication
│   ├── handlers.hpp          # Request handlers
│   └── pvac_ops.hpp          # PVAC operations
├── lib/                      # Copied from webcli
│   ├── pvac_bridge.hpp
│   ├── stealth.hpp
│   ├── tx_builder.hpp
│   └── ...
├── pvac/                     # PVAC library
│   ├── include/
│   └── pvac_c_api.cpp
├── CMakeLists.txt
└── README.md
```

### Testing

```bash
# Test health endpoint
curl http://127.0.0.1:8765/health

# Test decrypt balance (with token)
curl -X POST http://127.0.0.1:8765/api/decrypt_balance \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"cipher":"hfhe_v1|...","private_key":"..."}'
```

## Security Considerations

1. **Local Only**: Server only accessible from localhost
2. **Auth Token**: Required for all operations
3. **No Storage**: Private keys never stored
4. **Memory Security**: Sensitive data zeroed after use
5. **Token Rotation**: Token regenerated on server restart

## Performance

- **Decrypt Balance**: ~100-500ms
- **Encrypt Balance**: ~500-1000ms
- **Stealth Send**: ~500-1000ms
- **Scan Stealth**: ~1-5s (depends on epoch range)

## Troubleshooting

### Server Won't Start

- Check if port 8765 is available
- Check if PVAC library is properly linked
- Check logs in `~/.octwa/pvac_server.log`

### Authentication Failed

- Check if token file exists: `~/.octwa/pvac_token`
- Restart server to regenerate token
- Ensure extension reads correct token

### Slow Performance

- PVAC operations are CPU-intensive
- Consider upgrading CPU
- Reduce epoch range for scanning

## License

GPL v2+ (same as webcli)

## Credits

Based on Octra webcli PVAC implementation
