import type { Connection } from './types';

/** Manages connection state for the current page session. Not persisted across reloads. */
export class SessionManager {
  private connection: Connection | null = null;

  setConnection(conn: Connection): void {
    this.connection = conn;
  }

  getConnection(): Connection | null {
    return this.connection;
  }

  clearConnection(): void {
    this.connection = null;
  }

  isConnected(): boolean {
    return this.connection !== null;
  }

  getCircle(): string | undefined {
    return this.connection?.circle;
  }
}
