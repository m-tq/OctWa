// Structured logger with environment-based level filtering and PVAC job tracking.

enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

class Logger {
  private currentLevel: LogLevel;
  private readonly isDevelopment: boolean;

  constructor() {
    this.isDevelopment = import.meta.env.DEV || process.env.NODE_ENV === 'development';
    this.currentLevel = this.isDevelopment ? LogLevel.DEBUG : LogLevel.WARN;
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.currentLevel;
  }

  private stripEmoji(message: string): string {
    return message.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();
  }

  private timestamp(): string {
    const now = new Date();
    return `${now.toTimeString().split(' ')[0]}.${now.getMilliseconds().toString().padStart(3, '0')}`;
  }

  error(message: string, error?: unknown): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    console.error(`[${this.timestamp()}] [ERROR] ${this.stripEmoji(message)}`, error ?? '');
  }

  warn(message: string, data?: unknown): void {
    if (!this.shouldLog(LogLevel.WARN)) return;
    const prefix = `[${this.timestamp()}] [WARN] ${this.stripEmoji(message)}`;
    data !== undefined ? console.warn(prefix, data) : console.warn(prefix);
  }

  info(_message: string, _data?: unknown): void { /* dev-only, stripped in production */ }

  debug(_message: string, _data?: unknown): void { /* dev-only, stripped in production */ }

  pvacStart(_operation: string, _requestId: string, _jobId?: string): void { /* dev-only */ }

  pvacStep(_jobId: string, _step: string): void { /* dev-only */ }

  pvacSuccess(_operation: string, _jobId: string, _message: string, _duration?: number): void { /* dev-only */ }

  pvacError(operation: string, jobId: string, error: unknown): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    const errorMsg = error instanceof Error ? error.message : String(error) || 'Unknown error';
    console.error(`[${this.timestamp()}] [PVAC] ${this.stripEmoji(operation)} [JOB:${jobId}] ERROR ${errorMsg}`);
  }

  optimistic(_action: string, _updateId: string, _message: string): void { /* dev-only */ }

  perf(_operation: string, _duration: number, _threshold = 1000): void { /* dev-only */ }

  prod(_message: string): void { /* stripped in production */ }
}

export const logger = new Logger();
