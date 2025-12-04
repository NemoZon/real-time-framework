import {
  PeerMeshTransport,
  RealtimeKernel,
  WebRTCSignalingBridge,
  WebSocketTransport,
  type RealtimeEventMap
} from '../index.js';

async function main() {
  const templates = ['chat:join:[roomId]', 'chat:message:[roomId]'] as const;

  const kernel = new RealtimeKernel<RealtimeEventMap, typeof templates>({
    logLevel: 'info',
    transports: [
      new WebSocketTransport({ port: 8080, path: '/ws' }),
      new PeerMeshTransport({ port: 9090, peers: ['127.0.0.1:9091'] })
    ]
  });

  new WebRTCSignalingBridge({ namespace: 'rtc', autoJoinRooms: true }).attach(kernel);

  kernel.on('*', (message, context) => {
    console.log(`[event:${message.type}] from ${context.id}`, message.payload);
  });

  kernel.on(
    { eventTemplate: "chat:join:[roomId]", params: [1] },
    (message, context, toolkit) => {
      const room = (message.room as string) || 'general';
      toolkit.rooms.join(room);
      toolkit.reply({ type: 'chat:joined', payload: { room } });
      toolkit.rooms.broadcast(
        { type: 'chat:system', payload: { text: `${context.id} joined ${room}` } },
        room,
        { exceptSelf: true }
      );
    },
  );

  kernel.on(
    { eventTemplate: "chat:message:[roomId]", params: [1] },
    (message, context, toolkit) => {
      const room = (message.room as string) || 'general';
      toolkit.rooms.broadcast(
        {
          type: 'chat:message',
          payload: {
            from: context.id,
            text: (message.payload as { text?: string })?.text ?? message.payload,
            room,
          },
        },
        room,
        { exceptSelf: true },
      );
    },
  );

  kernel.on('presence:list', (_message, _context, toolkit) => {
    toolkit.reply({ type: 'presence:list', payload: toolkit.presence.list() });
  });

  await kernel.start();
  console.log('Realtime chat kernel listening on ws://localhost:8080/ws');
}

main().catch((error) => {
  console.error('Failed to start realtime chat server', error);
  process.exit(1);
});
