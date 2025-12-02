import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import type { RealtimeKernel } from '../core/realtimeKernel.js';
import { Logger } from '../utils/logger.js';

export interface ClusterOptions {
  workers?: number;
  restartOnExit?: boolean;
  logLevel?: 'silent' | 'error' | 'info' | 'debug';
}

type WorkerSetupFn = () => Promise<RealtimeKernel> | RealtimeKernel;

export class ClusterManager {
  readonly options: Required<ClusterOptions>;
  private readonly logger: Logger;
  private started = false;

  constructor(options: ClusterOptions = {}) {
    this.options = {
      workers: options.workers ?? availableParallelism(),
      restartOnExit: options.restartOnExit ?? true,
      logLevel: options.logLevel ?? 'info'
    };
    this.logger = new Logger('cluster', this.options.logLevel);
  }

  async start(setupFn: WorkerSetupFn): Promise<void> {
    if (this.started) {
      throw new Error('Cluster already started');
    }

    this.started = true;

    if (cluster.isPrimary) {
      await this.startPrimary();
    } else {
      await this.startWorker(setupFn);
    }
  }

  private async startPrimary(): Promise<void> {
    this.logger.info(`Primary process ${process.pid} starting with ${this.options.workers} workers`);

    // Fork les workers
    for (let i = 0; i < this.options.workers; i++) {
      this.forkWorker();
    }

    // Redémarrer les workers qui crashent
    cluster.on('exit', (worker, code, signal) => {
      this.logger.error(`Worker ${worker.process.pid} died (${signal || code})`);

      if (this.options.restartOnExit && this.started) {
        this.logger.info('Restarting worker...');
        this.forkWorker();
      }
    });

    // Gérer les signaux de terminaison
    const shutdown = async () => {
      this.logger.info('Shutting down cluster...');
      this.started = false;

      // Envoyer un signal de shutdown à tous les workers
      for (const id in cluster.workers) {
        cluster.workers[id]?.send({ type: 'shutdown' });
      }

      // Attendre 5 secondes puis forcer l'arrêt
      setTimeout(() => {
        for (const id in cluster.workers) {
          cluster.workers[id]?.kill();
        }
        process.exit(0);
      }, 5000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  private forkWorker(): void {
    const worker = cluster.fork();
    this.logger.info(`Worker ${worker.process.pid} started`);

    worker.on('message', (msg: unknown) => {
      if (typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === 'ready') {
        this.logger.info(`Worker ${worker.process.pid} is ready`);
      }
    });
  }

  private async startWorker(setupFn: WorkerSetupFn): Promise<void> {
    this.logger.info(`Worker ${process.pid} initializing...`);

    try {
      const kernel = await setupFn();
      await kernel.start();

      // Notifier le master que le worker est prêt
      process.send?.({ type: 'ready' });

      // Écouter les messages du master
      process.on('message', async (msg: unknown) => {
        if (typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === 'shutdown') {
          this.logger.info(`Worker ${process.pid} shutting down...`);
          await kernel.stop();
          process.exit(0);
        }
      });

      this.logger.info(`Worker ${process.pid} started successfully`);
    } catch (error) {
      this.logger.error('Worker initialization failed:', error);
      process.exit(1);
    }
  }

  getStats() {
    if (!cluster.isPrimary) {
      return null;
    }

    const workers = Object.values(cluster.workers ?? {})
      .filter((w): w is NonNullable<typeof w> => w !== undefined)
      .map((w) => ({
        id: w.id,
        pid: w.process.pid,
        isDead: w.isDead()
      }));

    return {
      totalWorkers: this.options.workers,
      activeWorkers: workers.length,
      workers
    };
  }
}

export function generateMeshPeers(basePort = 9090, totalWorkers?: number): string[] {
  if (!cluster.isWorker) {
    return [];
  }

  const workerId = cluster.worker!.id;
  const numWorkers = totalWorkers ?? availableParallelism();
  const peers: string[] = [];

  for (let i = 1; i <= numWorkers; i++) {
    if (i !== workerId) {
      peers.push(`127.0.0.1:${basePort + i}`);
    }
  }

  return peers;
}
