import cluster from 'node:cluster';
import {
  ClusterManager,
  generateMeshPeers,
  PeerMeshTransport,
  RealtimeKernel,
  WebSocketTransport
} from '../index.js';
import type { ClientContext, HandlerToolkit, RealtimeMessage } from '../types/index.js';

/**
 * Exemple simple de clustering avec echo server
 *
 * Le master fork plusieurs workers (auto-détection du nombre de CPU)
 * Chaque worker écoute sur le même port WebSocket (OS load-balancing)
 * Les workers communiquent via P2P mesh
 *
 * Pour tester:
 * 1. npm run example:cluster
 * 2. Connecter des clients WebSocket à ws://localhost:8080/realtime
 * 3. Envoyer: { "type": "echo", "payload": "hello" }
 * 4. Le worker qui répond s'identifie dans la réponse
 */

async function bootstrap() {
  const manager = new ClusterManager({
    // Auto-detect nombre de CPU disponibles
    restartOnExit: true,
    logLevel: 'info'
  });

  await manager.start(async () => {
    const kernel = new RealtimeKernel({ logLevel: 'info' });

    // WebSocket partagé entre tous les workers (OS load-balance)
    const wsTransport = new WebSocketTransport({
      port: 8080,
      path: '/realtime'
    });
    kernel.useTransport(wsTransport);

    // P2P mesh pour communication inter-workers
    const numWorkers = manager.options.workers;
    const peers = generateMeshPeers(9090, numWorkers);
    const meshTransport = new PeerMeshTransport({
      port: 9090 + cluster.worker!.id,
      peers: peers
    });
    kernel.useTransport(meshTransport);

    // Handler echo simple
    kernel.on('echo', (message: RealtimeMessage, context: ClientContext, toolkit: HandlerToolkit) => {
      toolkit.reply({
        type: 'echo:response',
        payload: {
          original: message.payload,
          workerId: cluster.worker!.id,
          workerPid: process.pid,
          clientId: context.id,
          timestamp: Date.now()
        }
      });
    });

    // Handler ping/pong
    kernel.on('ping', (message: RealtimeMessage, _context: ClientContext, toolkit: HandlerToolkit) => {
      toolkit.reply({
        type: 'pong',
        payload: {
          workerId: cluster.worker!.id,
          timestamp: Date.now()
        }
      });
    });

    // Logger pour tous les messages (wildcard)
    kernel.on('*', (message: RealtimeMessage, context: ClientContext, toolkit: HandlerToolkit) => {
      toolkit.log(`Received message type: ${message.type} from client: ${context.id}`);
    });

    console.log(`Worker ${cluster.worker!.id} (PID: ${process.pid}) ready on:`);
    console.log(`  - WebSocket: ws://localhost:8080/realtime`);
    console.log(`  - P2P Mesh: localhost:${9090 + cluster.worker!.id}`);
    console.log(`  - Peers: ${peers.join(', ') || 'none (only worker)'}`);

    return kernel;
  });

  // Si c'est le master, afficher les stats toutes les 30 secondes
  if (cluster.isPrimary) {
    setInterval(() => {
      const stats = manager.getStats();
      if (stats) {
        console.log('\n📊 Cluster Stats:');
        console.log(`  Total workers: ${stats.totalWorkers}`);
        console.log(`  Active workers: ${stats.activeWorkers}`);
        console.log(`  Workers: ${stats.workers.map(w => `#${w.id} (PID: ${w.pid})`).join(', ')}`);
      }
    }, 30000);

    console.log('\n✅ Cluster started successfully!');
    console.log('📝 Test with:');
    console.log('  wscat -c ws://localhost:8080/realtime');
    console.log('  > { "type": "echo", "payload": "hello from client" }');
    console.log('  > { "type": "ping" }');
    console.log('\n⏹️  Press Ctrl+C to stop\n');
  }
}

bootstrap().catch((error) => {
  console.error('Failed to start cluster:', error);
  process.exit(1);
});
