# @repo/realtime-core

Мини-фреймворк для построения backend-сервисов реального времени. Включает ядро для управления соединениями, абстракцию транспортов и готовые адаптеры для WebSocket, WebRTC signaling и P2P mesh между нодами.

## Основные сущности

- **RealtimeKernel** — диспетчер событий, комнат и presence. Обработчики навешиваются по типам сообщений.
- **RealtimeHub** — хранит подключения, отправляет события клиентам, управляет membership комнат.
- **Transports**:
  - `WebSocketTransport` — собственная реализация WebSocket-сервера на чистом Node.js.
  - `WebRTCSignalingBridge` — маршрутизация offer/answer/candidate между участниками.
  - `PeerMeshTransport` — TCP-сеть между backend-нодами для обмена сообщениями без центрального брокера.

## Установка

Пакет входит в монорепозиторий, но его можно собирать изолированно:

```bash
npm install
npx turbo run build --filter=@repo/realtime-core
# запуск готового примера
npm run example:chat --workspace=@repo/realtime-core
```

## Быстрый пример

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

## Расширение

1. **Новые транспорты** — унаследуйтесь от `BaseTransport`, реализуйте `onStart/onStop` и регистрируйте клиентов через `this.hub.registerClient(...)`.
2. **Middleware** — добавляйте универсальные обработчики через `kernel.on('*', handler)`.
3. **Масштабирование** — подключите несколько `PeerMeshTransport` нод и обрабатывайте события `mesh:*` для федерации.

## Пример использования

Файл `src/examples/basic.ts` демонстрирует связку всех адаптеров и может служить отправной точкой для интеграции.
