/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_NAME__: string;
declare const __APP_TITLE__: string;

interface ImportMetaEnv {
  readonly VITE_APP_TITLE?:          string
  readonly VITE_APP_VERSION?:        string
  readonly VITE_APP_ENVIRONMENT?:    string
  readonly VITE_INFURA_API_KEY?:     string
  readonly VITE_ETHERSCAN_API_KEY?:  string
  readonly VITE_ONS_CONTRACT_DEVNET?:  string
  readonly VITE_ONS_CONTRACT_MAINNET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
