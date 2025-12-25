/**
 * Global event bus for client events
 * Provides pub/sub mechanism for decoupled event handling
 */

/** Generic event handler type */
export type EventHandler<T = unknown> = (event: T) => void;

/**
 * Interface for the event bus
 */
export interface IEventBus {
  /** Subscribe to an event type */
  on<T>(eventType: string, handler: EventHandler<T>): () => void;

  /** Emit an event to all subscribers */
  emit<T>(eventType: string, event: T): void;

  /** Remove all handlers for an event type */
  off(eventType: string): void;

  /** Remove all handlers for all event types */
  clear(): void;

  /** Get the number of handlers for an event type */
  listenerCount(eventType: string): number;
}

/**
 * Event bus implementation using Map of Sets
 */
class EventBusImpl implements IEventBus {
  private handlers: Map<string, Set<EventHandler<unknown>>> = new Map();

  /**
   * Subscribe to an event type
   * @param eventType - The event type to subscribe to
   * @param handler - The handler function to call when event is emitted
   * @returns Unsubscribe function
   */
  on<T>(eventType: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    const handlers = this.handlers.get(eventType)!;
    handlers.add(handler as EventHandler<unknown>);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as EventHandler<unknown>);
      // Clean up empty sets
      if (handlers.size === 0) {
        this.handlers.delete(eventType);
      }
    };
  }

  /**
   * Emit an event to all subscribers
   * Handler exceptions are caught and logged, not propagated
   * @param eventType - The event type to emit
   * @param event - The event data
   */
  emit<T>(eventType: string, event: T): void {
    const handlers = this.handlers.get(eventType);
    if (!handlers) {
      return; // Silently ignore events with no subscribers
    }

    handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        // Catch and log handler exceptions, don't propagate
        console.error(`Error in event handler for '${eventType}':`, error);
      }
    });
  }

  /**
   * Remove all handlers for an event type
   * @param eventType - The event type to clear handlers for
   */
  off(eventType: string): void {
    this.handlers.delete(eventType);
  }

  /**
   * Remove all handlers for all event types
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Get the number of handlers for an event type
   * @param eventType - The event type to check
   * @returns Number of registered handlers
   */
  listenerCount(eventType: string): number {
    return this.handlers.get(eventType)?.size ?? 0;
  }
}

// Singleton instance for global event bus
let globalEventBus: IEventBus | null = null;

/**
 * Get the global event bus instance
 * Creates one if it doesn't exist
 */
export function getEventBus(): IEventBus {
  if (!globalEventBus) {
    globalEventBus = new EventBusImpl();
  }
  return globalEventBus;
}

/**
 * Create a new event bus instance
 * Useful for testing or isolated event handling
 */
export function createEventBus(): IEventBus {
  return new EventBusImpl();
}

/**
 * Reset the global event bus (mainly for testing)
 */
export function resetEventBus(): void {
  if (globalEventBus) {
    globalEventBus.clear();
  }
  globalEventBus = null;
}

// Export the EventBus class for type checking
export { EventBusImpl as EventBus };
