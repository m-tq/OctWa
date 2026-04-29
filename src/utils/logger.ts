/**
 * Centralized Logger Utility
 * 
 * Provides structured logging with:
 * - Log levels (ERROR, WARN, INFO, DEBUG)
 * - Environment-based filtering
 * - Minimal output for production
 * - Job ID tracking for PVAC requests
 * - Performance-friendly
 */

enum LogLevel {
  ERROR = 0,   // Always shown - critical errors
  WARN = 1,    // Production + dev - warnings
  INFO = 2,    // Dev only - informational
  DEBUG = 3    // Dev only - verbose debugging
}

class Logger {
  private currentLevel: LogLevel;
  private isDevelopment: boolean;

  constructor() {
    // Detect environment
    this.isDevelopment = import.meta.env.DEV || process.env.NODE_ENV === 'development';
    
    // Set log level based on environment
    this.currentLevel = this.isDevelopment ? LogLevel.DEBUG : LogLevel.WARN;
  }

  /**
   * Set log level manually
   */
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  /**
   * Check if level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return level <= this.currentLevel;
  }

  /**
   * Remove emoji from log message
   */
  private removeEmoji(message: string): string {
    // Remove emoji characters (Unicode ranges for emoji)
    return message.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();
  }

  /**
   * Format timestamp
   */
  private timestamp(): string {
    const now = new Date();
    return now.toTimeString().split(' ')[0] + '.' + now.getMilliseconds().toString().padStart(3, '0');
  }

  /**
   * Log error (always shown)
   */
  error(message: string, error?: any): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    
    console.error(`[${this.timestamp()}] [ERROR] ${this.removeEmoji(message)}`, error || '');
  }

  /**
   * Log warning
   */
  warn(message: string, data?: any): void {
    if (!this.shouldLog(LogLevel.WARN)) return;
    
    if (data) {
      console.warn(`[${this.timestamp()}] [WARN] ${this.removeEmoji(message)}`, data);
    } else {
      console.warn(`[${this.timestamp()}] [WARN] ${this.removeEmoji(message)}`);
    }
  }

  /**
   * Log info (dev only)
   */
  info(_message: string, _data?: any): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    // Logs removed for production
  }

  /**
   * Log debug (dev only, verbose)
   */
  debug(_message: string, _data?: any): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    // Logs removed for production
  }

  /**
   * PVAC operation started
   */
  pvacStart(_operation: string, _requestId: string, _jobId?: string): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    // Logs removed for production
  }

  /**
   * PVAC operation step
   */
  pvacStep(_jobId: string, _step: string): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    // Logs removed for production
  }

  /**
   * PVAC operation success
   */
  pvacSuccess(_operation: string, _jobId: string, _message: string, _duration?: number): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    // Logs removed for production
  }

  /**
   * PVAC operation error
   */
  pvacError(operation: string, jobId: string, error: any): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    
    const errorMsg = error?.message || error || 'Unknown error';
    console.error(`[${this.timestamp()}] [PVAC] ${this.removeEmoji(operation)} [JOB:${jobId}] ERROR ${errorMsg}`);
  }

  /**
   * Optimistic update log
   */
  optimistic(_action: string, _updateId: string, _message: string): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    // Logs removed for production
  }

  /**
   * Performance metric
   */
  perf(_operation: string, _duration: number, _threshold: number = 1000): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    // Logs removed for production
  }

  /**
   * Minimal production log (always shown, very brief)
   */
  prod(_message: string): void {
    // Logs removed for production
  }
}

// Export singleton
export const logger = new Logger();
