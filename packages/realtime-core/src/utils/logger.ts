export type LogLevel = 'silent' | 'error' | 'info' | 'debug';

type LogPayload = [message?: unknown, ...rest: unknown[]];

export class Logger {
  constructor(private readonly scope = 'realtime', private level: LogLevel = 'info') {}

  setLevel(level: LogLevel) {
    this.level = level;
  }

  debug(...args: LogPayload) {
    if (this.level === 'debug') {
      console.debug(this.prefix('DEBUG'), ...args);
    }
  }

  info(...args: LogPayload) {
    if (this.level === 'debug' || this.level === 'info') {
      console.info(this.prefix('INFO'), ...args);
    }
  }

  error(...args: LogPayload) {
    if (this.level === 'silent') {
      return;
    }
    console.error(this.prefix('ERROR'), ...args);
  }

  private prefix(level: string) {
    return `[${level}] [${this.scope}]`;
  }
}
