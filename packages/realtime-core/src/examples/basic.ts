import {
  PeerMeshTransport,
  RealtimeKernel,
  WebRTCSignalingBridge,
  WebSocketTransport
} from '../index.js';
import type { ClientContext, HandlerToolkit, RealtimeMessage } from '../types/index.js';

async function bootstrap() {
  const webSocketTransport = new WebSocketTransport({ port: 8080, path: '/realtime' });
  const meshTransport = new PeerMeshTransport({ port: 9090 });

  const kernel = new RealtimeKernel({
    transports: [webSocketTransport, meshTransport],
    logLevel: 'info'
  });

  const signaling = new WebRTCSignalingBridge({ autoJoinRooms: true });
  signaling.attach(kernel);

  kernel.on('chat:message', (message: RealtimeMessage, context: ClientContext, toolkit: HandlerToolkit) => {
    const room = (message.room as string) || 'lobby';
    toolkit.rooms.join(room);
    toolkit.rooms.broadcast(
      {
        type: 'chat:message',
        payload: {
          from: context.id,
          body: message.payload,
          room
        }
      },
      room,
      { exceptSelf: true }
    );
  });

  kernel.on('presence:update', (message: RealtimeMessage, _context: ClientContext, toolkit: HandlerToolkit) => {
    if (message.payload && typeof message.payload === 'object') {
      toolkit.presence.update(message.payload as Record<string, unknown>);
      toolkit.reply({ type: 'presence:updated' });
    }
  });

  await kernel.start();
  console.log('Realtime kernel ready');
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
