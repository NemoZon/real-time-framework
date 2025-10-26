import type { RealtimeHub } from '../core/realtimeHub.js';
import { Logger, LogLevel } from '../utils/logger.js';

export abstract class BaseTransport {
  protected hub!: RealtimeHub;
  protected readonly logger: Logger;

  constructor(public readonly name: string, logLevel: LogLevel = 'info') {
    this.logger = new Logger(`transport:${name}`, logLevel);
  }

  async start(hub: RealtimeHub) {
    this.hub = hub;
    await this.onStart();
  }

  async stop() {
    await this.onStop();
  }

  protected abstract onStart(): Promise<void> | void;
  protected abstract onStop(): Promise<void> | void;
}
