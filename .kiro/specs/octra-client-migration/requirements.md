# Requirements Document

## Introduction

This document specifies the requirements for migrating OctWa (web app + browser extension wallet) to be compatible with the upcoming Octra new client release. The migration introduces a client-agnostic architecture that supports encrypted runtime sessions, async compute jobs, encrypted-first data model, event-based result delivery, and expanded wallet key capabilities. The goal is to refactor the codebase without rewriting it, ensuring that future integration with the new Octra client requires only implementing a new adapter.

## Glossary

- **OctWa**: The Octra Web Application and browser extension wallet being migrated
- **Octra Client**: The blockchain client software that OctWa communicates with
- **Pre-Client**: The legacy Octra client with synchronous, RPC-like transaction handling
- **New Client**: The upcoming Octra client with encrypted sessions, async jobs, and event-driven architecture
- **Client Adapter**: An abstraction layer that decouples UI/SDK from specific client implementations
- **Job**: An async operation tracked by a unique identifier, representing transactions or runtime calls
- **JobId**: A unique identifier for tracking async operations
- **Event Bus**: A global event-handling mechanism for client events
- **Encrypted Value**: An opaque encrypted data blob that requires explicit user-initiated decryption
- **Capability**: A specific permission that a dApp can request from the wallet (e.g., tx_sign, decrypt_result)
- **dApp**: A decentralized application that interacts with the wallet

## Requirements

### Requirement 1: Client Adapter Abstraction

**User Story:** As a developer, I want a client abstraction layer that decouples UI and SDK from any specific Octra client implementation, so that I can switch between pre-client and new client without modifying UI code.

#### Acceptance Criteria

1. WHEN the system initializes THEN the OctWa SHALL load client operations through a single TypeScript interface (OctraClientAdapter)
2. WHEN a UI component needs to perform a blockchain operation THEN the component SHALL call the adapter factory, never the client directly
3. WHEN the pre-client is used THEN the OctWa SHALL wrap existing logic in a PreClientAdapter implementation
4. WHEN the new client is needed THEN the OctWa SHALL provide a placeholder NextClientAdapter with methods that throw NotImplemented errors
5. WHEN the adapter factory is called THEN the OctWa SHALL return the appropriate adapter based on configuration

### Requirement 2: Async Job Model for Transactions

**User Story:** As a user, I want all blockchain operations to be tracked as async jobs, so that I can monitor their progress without assuming immediate results.

#### Acceptance Criteria

1. WHEN a transaction or runtime call is initiated THEN the OctWa SHALL return a jobId instead of waiting for completion
2. WHEN a job is created THEN the OctWa SHALL track the job in a job store with states: pending, completed, or failed
3. WHEN a job status changes THEN the OctWa SHALL update the status via events, not return values
4. WHEN displaying transaction status THEN the UI SHALL show the current job state without assuming immediate finality

### Requirement 3: Internal Event Bus

**User Story:** As a developer, I want a global event-handling mechanism for client events, so that UI components can react to events instead of polling or blocking calls.

#### Acceptance Criteria

1. WHEN the system initializes THEN the OctWa SHALL create a global event bus (EventEmitter, observable, or store-based)
2. WHEN a client event occurs THEN the client adapter SHALL feed the event into the event bus
3. WHEN a job_started event is emitted THEN the event bus SHALL notify all subscribers
4. WHEN a job_completed event is emitted THEN the event bus SHALL notify all subscribers with the result
5. WHEN a job_failed event is emitted THEN the event bus SHALL notify all subscribers with the error
6. WHEN an encrypted_result_ready event is emitted THEN the event bus SHALL notify all subscribers
7. WHEN a UI component needs event updates THEN the component SHALL subscribe to the event bus instead of polling

### Requirement 4: Encrypted Data Handling

**User Story:** As a user, I want encrypted data to be treated as opaque by default, so that my sensitive information is protected until I explicitly choose to decrypt it.

#### Acceptance Criteria

1. WHEN the system receives balance, transaction result, or contract output data THEN the OctWa SHALL treat the data as an opaque EncryptedValue type
2. WHEN displaying an encrypted value THEN the UI SHALL show a locked indicator (🔒 "Encrypted") instead of the raw data
3. WHEN a user wants to view encrypted data THEN the user SHALL explicitly initiate the decryption action
4. WHEN decryption is requested THEN the OctWa SHALL require explicit user consent before proceeding
5. WHEN handling encrypted payloads THEN the OctWa SHALL NOT log the encrypted data

### Requirement 5: Wallet Capability Permission Model

**User Story:** As a user, I want dApps to request specific wallet capabilities, so that I can control exactly what permissions each dApp has.

#### Acceptance Criteria

1. WHEN a dApp connects THEN the dApp SHALL request specific capabilities (tx_sign, runtime_execute, decrypt_result, reencrypt_for_third_party)
2. WHEN capabilities are requested THEN the wallet UI SHALL display a permission prompt showing the requested capabilities
3. WHEN the user approves capabilities THEN the OctWa SHALL grant only the approved capabilities to the dApp
4. WHEN the user denies capabilities THEN the OctWa SHALL reject the capability request
5. WHEN a user wants to revoke permissions THEN the wallet UI SHALL allow revoking previously granted capabilities
6. WHEN a dApp attempts an operation without the required capability THEN the OctWa SHALL reject the operation
7. WHEN decrypt or re-encrypt operations are attempted THEN the OctWa SHALL require explicit capability approval (no silent operations)

### Requirement 6: UI Layout Separation

**User Story:** As a developer, I want the wallet UI separated from runtime/app UI, so that future runtime and contract interaction features can be added without redesigning the wallet.

#### Acceptance Criteria

1. WHEN the UI is rendered THEN the OctWa SHALL display a WalletPanel for keys, accounts, and permissions
2. WHEN the UI is rendered THEN the OctWa SHALL display an Activity/Jobs Panel for async compute and transaction tracking
3. WHEN the UI is rendered THEN the OctWa SHALL provide structure for an App/Contract Interaction Panel (future use)
4. WHEN new runtime features are added THEN the UI structure SHALL accommodate them without requiring a redesign
5. WHEN viewing the wallet THEN the UI SHALL NOT be hardcoded to "send transaction" functionality only

### Requirement 7: Legacy Pre-Client Assumption Removal

**User Story:** As a developer, I want all legacy pre-client assumptions removed from the codebase, so that the system works correctly with both synchronous and asynchronous client implementations.

#### Acceptance Criteria

1. WHEN processing client output THEN the OctWa SHALL treat all outputs as structured events, not CLI strings
2. WHEN handling balances THEN the OctWa SHALL NOT assume plaintext values
3. WHEN handling transaction results THEN the OctWa SHALL NOT assume tx hash equals result
4. WHEN waiting for responses THEN the OctWa SHALL NOT assume synchronous RPC responses
5. WHEN parsing output THEN the OctWa SHALL NOT use hardcoded output string parsing
