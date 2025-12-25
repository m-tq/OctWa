# Implementation Plan

- [x] 1. Set up core types and interfaces




  - [x] 1.1 Create adapter types and interfaces





    - Create `src/adapters/types.ts` with JobId, JobStatus, Job, ClientEventType, ClientEvent, and OctraClientAdapter interface
    - _Requirements: 1.1, 2.1, 2.2_
  - [x]* 1.2 Write property test for adapter interface conformance


    - **Property 1: Adapter Interface Conformance**


    - **Validates: Requirements 1.1, 1.3**




  - [x] 1.3 Create encrypted value types


    - Create `src/types/encrypted.ts` with EncryptedValue, DecryptionRequest, and DecryptionResult interfaces
    - _Requirements: 4.1_
  - [x] 1.4 Create capability permission types



    - Create `src/permissions/types.ts` with WalletCapability, CapabilityRequest, GrantedCapabilities, and PermissionManager interface
    - _Requirements: 5.1, 5.2_

- [x] 2. Implement Event Bus







  - [x] 2.1 Create EventBus implementation




    - Create `src/events/eventBus.ts` with on, emit, off, and clear methods
    - Implement using Map of event types to Set of handlers
    - _Requirements: 3.1_
  - [ ]* 2.2 Write property test for event bus notification
    - **Property 6: Event Bus Notifies All Subscribers**
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.6**
  - [ ]* 2.3 Write unit tests for EventBus
    - Test subscription, emission, unsubscription, and clear functionality
    - _Requirements: 3.1_

- [x] 3. Implement Job Store






  - [x] 3.1 Create JobStore implementation




    - Create `src/stores/jobStore.ts` with track, get, getAll, getByStatus, updateStatus, subscribe, and clearFinished methods
    - Use reactive state management for subscriptions
    - _Requirements: 2.2, 2.3_
  - [ ]* 3.2 Write property test for job store tracking
    - **Property 5: Job Store Tracks All Jobs**
    - **Validates: Requirements 2.2**
  - [ ]* 3.3 Write unit tests for JobStore
    - Test CRUD operations and subscription notifications
    - _Requirements: 2.2_

- [x] 4. Checkpoint - Ensure all tests pass


  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement PreClientAdapter

  - [x] 5.1 Create PreClientAdapter class



    - Create `src/adapters/preClientAdapter.ts` implementing OctraClientAdapter
    - Wrap existing API calls from `src/utils/api.ts` in adapter methods
    - Generate unique jobIds for each execute call
    - Emit events to EventBus for job lifecycle
    - _Requirements: 1.3, 2.1, 3.2_
  - [ ]* 5.2 Write property test for execute returns JobId immediately
    - **Property 4: Execute Returns JobId Immediately**
    - **Validates: Requirements 2.1**
  - [ ]* 5.3 Write property test for client events flow through event bus
    - **Property 7: Client Events Flow Through Event Bus**
    - **Validates: Requirements 3.2**
  - [ ]* 5.4 Write unit tests for PreClientAdapter
    - Test connect, execute, onEvent, disconnect, and isConnected methods
    - _Requirements: 1.3_


- [ ] 6. Implement NextClientAdapter placeholder
  - [x] 6.1 Create NextClientAdapter class


    - Create `src/adapters/nextClientAdapter.ts` implementing OctraClientAdapter
    - All methods throw NotImplementedError
    - _Requirements: 1.4_
  - [ ]* 6.2 Write property test for NextClientAdapter throws NotImplemented
    - **Property 2: NextClientAdapter Throws NotImplemented**
    - **Validates: Requirements 1.4**


- [ ] 7. Implement Adapter Factory
  - [x] 7.1 Create AdapterFactory implementation


    - Create `src/adapters/factory.ts` with getAdapter, switchClient, and getClientType methods
    - Return PreClientAdapter or NextClientAdapter based on configuration
    - _Requirements: 1.5_
  - [ ]* 7.2 Write property test for adapter factory returns correct type
    - **Property 3: Adapter Factory Returns Correct Type**
    - **Validates: Requirements 1.5**
  - [ ]* 7.3 Write unit tests for AdapterFactory
    - Test adapter creation and switching
    - _Requirements: 1.5_

- [x] 8. Checkpoint - Ensure all tests pass


  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Permission Manager

  - [x] 9.1 Create PermissionManager implementation


    - Create `src/permissions/permissionManager.ts` implementing PermissionManager interface
    - Store granted capabilities in localStorage/chrome.storage
    - Integrate with existing ConnectedDAppsManager
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ]* 9.2 Write property test for capability grants match approvals
    - **Property 10: Capability Grants Match Approvals**
    - **Validates: Requirements 5.3**
  - [ ]* 9.3 Write property test for denied capabilities not granted
    - **Property 11: Denied Capabilities Not Granted**
    - **Validates: Requirements 5.4**
  - [ ]* 9.4 Write property test for revocation removes capabilities
    - **Property 12: Revocation Removes Capabilities**
    - **Validates: Requirements 5.5**
  - [ ]* 9.5 Write property test for operations require capabilities
    - **Property 13: Operations Require Capabilities**
    - **Validates: Requirements 5.6, 5.7**
  - [ ]* 9.6 Write unit tests for PermissionManager
    - Test requestCapabilities, hasCapability, getCapabilities, revokeCapabilities
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_


- [ ] 10. Implement Encrypted Value Handling
  - [x] 10.1 Create EncryptedValue utilities


    - Create `src/utils/encryptedValue.ts` with helper functions for creating, checking, and displaying encrypted values
    - Implement isEncrypted, createEncryptedValue, and getDisplayValue functions
    - _Requirements: 4.1, 4.2_
  - [x] 10.2 Create decryption service


    - Create `src/services/decryptionService.ts` with decrypt function that requires userConsent
    - Integrate with existing crypto utilities
    - _Requirements: 4.3, 4.4_
  - [ ]* 10.3 Write property test for encrypted values remain opaque
    - **Property 8: Encrypted Values Remain Opaque**
    - **Validates: Requirements 4.1**
  - [ ]* 10.4 Write property test for decryption requires user consent
    - **Property 9: Decryption Requires User Consent**
    - **Validates: Requirements 4.3, 4.4**
  - [ ]* 10.5 Write unit tests for encrypted value handling
    - Test EncryptedValue creation, display, and decryption flow
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 11. Checkpoint - Ensure all tests pass


  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Create UI Components for Encrypted Values

  - [x] 12.1 Create EncryptedValueDisplay component


    - Create `src/components/EncryptedValueDisplay.tsx` that shows lock icon for encrypted values
    - Add decrypt button that triggers user consent flow
    - _Requirements: 4.2, 4.3_
  - [x] 12.2 Create DecryptionConsentDialog component


    - Create `src/components/DecryptionConsentDialog.tsx` for explicit user consent
    - _Requirements: 4.4_
  - [ ]* 12.3 Write unit tests for encrypted value UI components
    - Test rendering of encrypted indicator and consent flow
    - _Requirements: 4.2, 4.3, 4.4_

- [x] 13. Create UI Components for Job Tracking

  - [x] 13.1 Create JobStatusIndicator component


    - Create `src/components/JobStatusIndicator.tsx` showing pending/completed/failed states
    - _Requirements: 2.4_
  - [x] 13.2 Create ActivityPanel component


    - Create `src/components/ActivityPanel.tsx` for displaying async jobs and transactions
    - Subscribe to JobStore for real-time updates
    - _Requirements: 6.2_
  - [ ]* 13.3 Write unit tests for job tracking UI components
    - Test status display and real-time updates
    - _Requirements: 2.4, 6.2_

- [x] 14. Create UI Components for Capability Permissions

  - [x] 14.1 Create CapabilityApprovalDialog component


    - Create `src/components/CapabilityApprovalDialog.tsx` for displaying capability requests
    - Show list of requested capabilities with descriptions
    - _Requirements: 5.2_
  - [x] 14.2 Update DAppConnection component


    - Modify `src/components/DAppConnection.tsx` to use new capability model
    - Replace simple permissions with WalletCapability types
    - _Requirements: 5.1, 5.2_
  - [ ]* 14.3 Write unit tests for capability permission UI components
    - Test capability display and approval/denial flow
    - _Requirements: 5.2_

- [x] 15. Checkpoint - Ensure all tests pass


  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Refactor UI Layout for Panel Separation

  - [x] 16.1 Create WalletPanel component



    - Extract wallet-specific functionality from WalletDashboard into `src/components/WalletPanel.tsx`
    - Include keys, accounts, and permissions management
    - _Requirements: 6.1_
  - [x] 16.2 Create ContractPanel placeholder


    - Create `src/components/ContractPanel.tsx` as placeholder for future contract interactions
    - _Requirements: 6.3_
  - [x] 16.3 Update WalletDashboard layout

    - Refactor `src/components/WalletDashboard.tsx` to use separated panels
    - Add tab navigation between WalletPanel, ActivityPanel, and ContractPanel
    - _Requirements: 6.4, 6.5_
  - [ ]* 16.4 Write unit tests for panel separation
    - Test panel rendering and navigation
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 17. Refactor SendTransaction to use Adapter

  - [x] 17.1 Update SendTransaction component


    - Modify `src/components/SendTransaction.tsx` to use AdapterFactory instead of direct API calls
    - Use execute() method and track jobs via JobStore
    - Subscribe to events for transaction status updates
    - _Requirements: 1.2, 2.1, 2.3, 2.4_
  - [ ]* 17.2 Write property test for client outputs are structured events
    - **Property 14: Client Outputs Are Structured Events**
    - **Validates: Requirements 7.1**
  - [ ]* 17.3 Write unit tests for refactored SendTransaction
    - Test adapter usage and job tracking
    - _Requirements: 1.2, 2.1_

- [x] 18. Refactor Balance Display to Handle Encrypted Values

  - [x] 18.1 Update PublicBalance component

    - Modify `src/components/PublicBalance.tsx` to handle EncryptedValue type
    - Use EncryptedValueDisplay for encrypted balances
    - _Requirements: 4.1, 4.2, 7.2_
  - [x] 18.2 Update PrivateBalance component

    - Modify `src/components/PrivateBalance.tsx` to handle EncryptedValue type
    - _Requirements: 4.1, 4.2, 7.2_
  - [ ]* 18.3 Write property test for balance handling supports encrypted values
    - **Property 15: Balance Handling Supports Encrypted Values**
    - **Validates: Requirements 7.2**
  - [ ]* 18.4 Write unit tests for balance display with encrypted values
    - Test rendering of both encrypted and plaintext balances
    - _Requirements: 4.1, 4.2, 7.2_

- [x] 19. Checkpoint - Ensure all tests pass


  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Remove Legacy Pre-Client Assumptions


  - [x] 20.1 Audit and refactor API response handling


    - Review `src/utils/api.ts` for hardcoded string parsing
    - Replace with structured event handling
    - _Requirements: 7.1, 7.5_
  - [x] 20.2 Remove synchronous response assumptions

    - Audit codebase for assumptions about immediate transaction results
    - Replace with job-based async handling
    - _Requirements: 7.3, 7.4_
  - [ ]* 20.3 Write integration tests for async flow
    - Test complete transaction flow using adapter and job tracking
    - _Requirements: 7.1, 7.3, 7.4_

- [x] 21. Update SDK to Use Adapter

  - [x] 21.1 Refactor OctraSDK to use AdapterFactory


    - Modify `packages/sdk/src/sdk.ts` to use adapter internally
    - Maintain backward-compatible public API
    - _Requirements: 1.2_
  - [x] 21.2 Add capability support to SDK


    - Extend SDK connect method to support WalletCapability types
    - _Requirements: 5.1_
  - [ ]* 21.3 Write unit tests for SDK adapter integration
    - Test SDK methods use adapter correctly
    - _Requirements: 1.2_

- [x] 22. Final Checkpoint - Ensure all tests pass



  - Ensure all tests pass, ask the user if questions arise.
