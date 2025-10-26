# Real-time Backend Toolkit

Мини-фреймворк для быстрой работы с инструментами реального времени (WebSocket, WebRTC signaling, backend-to-backend P2P) в единой backend-среде. Репозиторий построен на Turborepo и включает ядро `@repo/realtime-core`, написанное на TypeScript.

## Состав монорепозитория

- `packages/realtime-core` — ядро real-time платформы с менеджером комнат, presence-слоем и адаптерами транспортов.
- `packages/ui`, `packages/eslint-config`, `packages/typescript-config` — служебные пакеты из стартового шаблона (оставлены без изменений).

## Возможности @repo/realtime-core

- ⚡️ **RealtimeKernel** — централизованный диспетчер событий, комнат и присутствия.
- 🔌 **WebSocketTransport** — собственный WebSocket-сервер без внешних зависимостей.
- 🔁 **WebRTCSignalingBridge** — готовый маршрутизатор офферов/ответов/ICE-кандидатов.
- 🤝 **PeerMeshTransport** — лёгкая P2P-сетка между backend-нодами для синхронизации событий.
- 🧰 Инструменты разработчика: управление комнатами, широковещательные рассылки, presence-стор, middleware через обработчики событий.

## Быстрый старт

```bash
# установка зависимостей
npm install

# проверка типов нового пакета
npx turbo run check-types --filter=@repo/realtime-core

# сборка
npx turbo run build --filter=@repo/realtime-core
```

## Минимальный пример

`packages/realtime-core/src/examples/basic.ts` демонстрирует запуск ядра c WebSocket-транспортом, P2P-сеткой и включённым WebRTC signaling.

Фрагмент кода:

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

После сборки можно запустить пример любым рантаймом Node (ts-node/vite-node) или собрать пакет и использовать готовый JS из `dist/`.

## Дальнейшее развитие

- Подключение внешних адаптеров (например, MQTT, WebTransport).
- Расширение P2P-протокола (подтверждения доставки, фильтрация маршрутов).
- Генерация типов сообщений для фронтенда.
