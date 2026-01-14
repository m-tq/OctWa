# Sample dApp - Octra SDK Integration

This is a sample dApp demonstrating how to integrate with the Octra Wallet extension using the capability-based SDK.

## Features

- **Connect to Circle**: Establish a session without signing
- **Request Capabilities**: Request scoped authorization (read/write/compute)
- **Invoke Methods**: Execute methods using granted capabilities
- **Event Handling**: Listen for SDK events
- **Activity Log**: View all SDK operations

## How to Use

### 1. Start a Local Server

```bash
# Using Python
python -m http.server 8080

# Using Node.js
npx serve .

# Using PHP
php -S localhost:8080
```

### 2. Open in Browser

Navigate to `http://localhost:8080` in your browser.

### 3. Install Octra Wallet Extension

Make sure the Octra Wallet extension is installed and set up.

### 4. Connect

1. Click "Connect to Circle" button
2. Approve the connection in the wallet popup
3. The session will be established (no signing required)

### 5. Request Capability

1. Select a scope (read/write/compute)
2. Enter methods you want access to
3. Click "Request Capability"
4. Approve in the wallet popup

### 6. Invoke Method

1. Select a granted capability
2. Select a method from that capability
3. Optionally add a payload
4. Click "Invoke Method"
5. Approve in the wallet popup

## SDK API

```javascript
// Connect (no signing)
const connection = await window.octra.connect({
  circle: 'my-circle-id',
  appOrigin: window.location.origin
});

// Request capability
const capability = await window.octra.requestCapability({
  circle: 'my-circle-id',
  methods: ['getData', 'setData'],
  scope: 'write',
  encrypted: false,
  ttlSeconds: 3600
});

// Invoke method
const result = await window.octra.invoke({
  capabilityId: capability.id,
  method: 'getData',
  payload: new Uint8Array([1, 2, 3]),
  nonce: Date.now(),
  timestamp: Date.now()
});

// Disconnect
await window.octra.disconnect();

// Events
window.octra.on('connect', (data) => console.log('Connected', data));
window.octra.on('disconnect', () => console.log('Disconnected'));
window.octra.on('capabilityGranted', (data) => console.log('Capability', data));
```

## Key Differences from EVM

| EVM Model | Octra Model |
|-----------|-------------|
| `connect → sign message → trust address` | `connect → issue capability → verify scoped authority` |
| Address-based authorization | Capability-based authorization |
| `signMessage()` available | NO arbitrary signing |
| Session cookies | Cryptographic capabilities |

## Security

- No arbitrary message signing
- All capabilities are scoped and time-limited
- Replay protection via nonces
- Origin binding for capabilities
