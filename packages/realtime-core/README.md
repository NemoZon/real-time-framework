# @repo/realtime-core

Mini-framework pour créer des services backend en temps réel. Inclut un noyau pour gérer les connexions, une abstraction de transports et des adaptateurs prêts pour WebSocket, WebRTC signaling et un maillage P2P entre nœuds.

## Principales entités

- **RealtimeKernel** — gestionnaire d'événements, de rooms et de presence. Les handlers sont attachés par type de message.
- **RealtimeHub** — stocke les connexions, envoie les événements aux clients, gère l'appartenance aux rooms.
- **Transports** :
  - `WebSocketTransport` — implémentation maison d'un serveur WebSocket en Node.js pur.
  - `WebRTCSignalingBridge` — routage des offer/answer/candidate entre les participants.
  - `PeerMeshTransport` — réseau TCP entre nœuds backend pour échanger des messages sans broker central.

## Installation

Le paquet fait partie du monorepo, mais peut être construit de façon isolée :

```bash
npm install
npx turbo run build --filter=@repo/realtime-core
# lancer l'exemple prêt à l'emploi
npm run example:chat --workspace=@repo/realtime-core
```

## Exemple rapide

```ts
import {
  PeerMeshTransport,
  RealtimeKernel,
  WebRTCSignalingBridge,
  WebSocketTransport
} from '@repo/realtime-core';

const kernel = new RealtimeKernel({
  transports: [
    new WebSocketTransport({ port: 8080, path: '/realtime' }),
    new PeerMeshTransport({ port: 9090, peers: ['127.0.0.1:9091'] })
  ],
  logLevel: 'debug'
});

new WebRTCSignalingBridge({ autoJoinRooms: true }).attach(kernel);

kernel.on('chat:message', (message, context, toolkit) => {
  const room = (message.room as string) || 'general';
  toolkit.rooms.join(room);
  toolkit.rooms.broadcast(
    {
      type: 'chat:message',
      payload: { from: context.id, body: message.payload }
    },
    room,
    { exceptSelf: true }
  );
});

kernel.start();
```

## Extension

1. **Nouveaux transports** — héritez de `BaseTransport`, implémentez `onStart/onStop` et enregistrez les clients via `this.hub.registerClient(...)`.
2. **Middleware** — ajoutez des handlers universels via `kernel.on('*', handler)`.
3. **Mise à l'échelle** — connectez plusieurs nœuds `PeerMeshTransport` et traitez les événements `mesh:*` pour la fédération.

## Exemple d'utilisation

Le fichier `src/examples/basic.ts` montre l'assemblage de tous les adaptateurs et peut servir de point de départ pour l'intégration.
