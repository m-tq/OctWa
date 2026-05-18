/**
 * Ambient module declaration for the Emscripten-generated PVAC WASM loader.
 * The actual files are src/lib/pvac/wasm-runtime/build/pvac_wasm.mjs (single-thread)
 * and src/lib/pvac/wasm-runtime/build/pvac_wasm_mt.mjs (multi-thread / SIMD), both
 * produced by the upstream pvac_wasm package's build-wasm.sh.
 */

declare module '*/pvac_wasm.mjs' {
  interface PvacEmscriptenModule {
    ccall(name: string, returnType: string | null, argTypes: string[], args: unknown[]): unknown
    getValue(ptr: number, type: string): number
    HEAPU8: Uint8Array
    _malloc(size: number): number
    _free(ptr: number): void
  }

  const PvacModule: (opts?: object) => Promise<PvacEmscriptenModule>
  export default PvacModule
}

declare module '*/pvac_wasm_mt.mjs' {
  interface PvacEmscriptenModule {
    ccall(name: string, returnType: string | null, argTypes: string[], args: unknown[]): unknown
    getValue(ptr: number, type: string): number
    HEAPU8: Uint8Array
    _malloc(size: number): number
    _free(ptr: number): void
  }

  const PvacModule: (opts?: object) => Promise<PvacEmscriptenModule>
  export default PvacModule
}

