# Boîte à outils backend temps réel

Mini-framework pour travailler rapidement avec les outils temps réel (WebSocket, WebRTC signaling, P2P backend-à-backend) dans un environnement backend unifié. Le dépôt est construit sur Turborepo et inclut le noyau `@repo/realtime-core`, écrit en TypeScript.

## Composition du monorepo

- `packages/realtime-core` — noyau de la plateforme temps réel avec gestionnaire de rooms, couche de présence et adaptateurs de transports.
- `packages/ui`, `packages/eslint-config`, `packages/typescript-config` — paquets utilitaires du template de départ (laissés tels quels).

## Capacités de @repo/realtime-core

- ⚡️ **RealtimeKernel** — répartiteur centralisé d'événements, de rooms et de présence.
- 🔌 **WebSocketTransport** — serveur WebSocket maison sans dépendances externes.
- 🔁 **WebRTCSignalingBridge** — routeur prêt pour offers/answers/candidats ICE.
- 🤝 **PeerMeshTransport** — maillage P2P léger entre nœuds backend pour synchroniser les événements.
- 🧰 Outils développeur : gestion des rooms, broadcasts, store de présence, middleware via des handlers d'événements.

## Démarrage rapide

```bash
# installation des dépendances
npm install

# vérification des types du nouveau paquet
npx turbo run check-types --filter=@repo/realtime-core

# build
npx turbo run build --filter=@repo/realtime-core
```

## Exemple minimal

`packages/realtime-core/src/examples/basic.ts` montre le lancement du noyau avec transport WebSocket, réseau P2P et WebRTC signaling activé.

Extrait de code :

```ts
const webSocketTransport = new WebSocketTransport({ port: 8080, path: '/realtime' });
const meshTransport = new PeerMeshTransport({ port: 9090 });

const kernel = new RealtimeKernel({
  transports: [webSocketTransport, meshTransport],
  logLevel: 'info'
});

const signaling = new WebRTCSignalingBridge({ autoJoinRooms: true });
signaling.attach(kernel);

kernel.on('chat:message', (message, context, toolkit) => {
  const room = (message.room as string) || 'lobby';
  toolkit.rooms.join(room);
  toolkit.rooms.broadcast(
    { type: 'chat:message', payload: { from: context.id, body: message.payload, room } },
    room,
    { exceptSelf: true }
  );
});
```

Après build, on peut lancer l'exemple avec n'importe quel runtime Node (ts-node/vite-node) ou construire le paquet et utiliser le JS généré dans `dist/`.

## Évolutions prévues

- Brancher des adaptateurs externes (par ex. MQTT, WebTransport).
- Étendre le protocole P2P (accusés de réception, filtrage de routes).
- Générer les types de messages pour le frontend.
