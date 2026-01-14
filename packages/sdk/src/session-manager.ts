import type { Connection } from './types';

/**
 * Manages connection state and session lifecycle.
 * Session state is NOT persisted - cleared on page reload.
 */
export class SessionManager {
  private connection: Connection | null = null;

  /**
   * Set the current connection
   */
  setConnection(conn: Connection): void {
    this.connection = conn;
  }

  /**
   * Get the current connection
   */
  getConnection(): Connection | null {
    return this.connection;
  }

  /**
   * Clear the current connection
   */
  clearConnection(): void {
    this.connection = null;
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.connection !== null;
  }

  /**
   * Get the current Circle ID (if connected)
   */
  getCircle(): string | undefined {
    return this.connection?.circle;
  }
}
