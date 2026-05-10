// Tiny LRU cache with per-entry TTL, no dependencies.
// Used internally by the resolver to avoid hammering the RPC when a user
// types a recipient that happens to be an ONS label.

interface Entry<V> {
  value:    V
  expires:  number
}

export class TtlCache<V> {
  private map = new Map<string, Entry<V>>()
  constructor(
    private readonly capacity: number = 128,
    private readonly defaultTtlMs: number = 15_000,
  ) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (entry.expires <= Date.now()) {
      this.map.delete(key)
      return undefined
    }
    // Refresh LRU position without resetting the TTL.
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: string, value: V, ttlMs: number = this.defaultTtlMs): void {
    const entry: Entry<V> = { value, expires: Date.now() + ttlMs }
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, entry)
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  invalidate(key: string): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }
}
