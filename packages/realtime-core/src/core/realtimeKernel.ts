import type {
  TransportClient,
  KernelOptions,
  RealtimeHandler,
  RealtimeMessage,
  OutboundMessage,
  ClientContext,
  HandlerToolkit,
  ClientMetadata,
  PresenceSnapshot
} from '../types/index.js';
import { RealtimeHub } from './realtimeHub.js';
import { BaseTransport } from '../transports/base.js';
import { Logger } from '../utils/logger.js';

export class RealtimeKernel {
  private readonly hub: RealtimeHub;
  private readonly transports: BaseTransport[] = [];
  private readonly handlers = new Map<string, RealtimeHandler[]>();
  private readonly wildcardHandlers: RealtimeHandler[] = [];
  private readonly logger: Logger;
  private started = false;

  constructor(options: KernelOptions = {}) {
    this.logger = new Logger('kernel', options.logLevel ?? 'info');
    this.hub = new RealtimeHub(new Logger('hub', options.logLevel ?? 'info'));
    (options.transports ?? []).forEach((transport: BaseTransport) => this.useTransport(transport));
    this.hub.on('message', (payload: { message: RealtimeMessage; client: TransportClient }) =>
      this.dispatch(payload.message, payload.client)
    );
  }

  useTransport(transport: BaseTransport) {
    this.transports.push(transport);
    if (this.started) {
      transport.start(this.hub);
    }
  }

  on(eventType: string, handler: RealtimeHandler) {
    if (eventType === '*') {
      this.wildcardHandlers.push(handler);
      return;
    }
    const bucket = this.handlers.get(eventType) ?? [];
    bucket.push(handler);
    this.handlers.set(eventType, bucket);
  }

  async start() {
    if (this.started) return;
    await Promise.all(this.transports.map((transport) => transport.start(this.hub)));
    this.started = true;
    this.logger.info('Realtime kernel started with transports:', this.transports.length);
  }

  async stop() {
    await Promise.all(this.transports.map((transport) => transport.stop()));
    this.started = false;
  }

  get presence() {
    return this.hub.presence;
  }

  get rooms() {
    return this.hub.rooms;
  }

  private async dispatch(message: RealtimeMessage, client: TransportClient) {
    const handlers = [
      ...(this.handlers.get(message.type) ?? []),
      ...this.wildcardHandlers
    ];
    if (!handlers.length) {
      this.logger.debug('No handlers for event', message.type);
      if (message.ack) {
        this.hub.send(client.id, { type: 'system:ack', payload: { ack: message.ack } });
      }
      return;
    }

    const context = this.hub.snapshot(client.id);
    if (!context) return;
    const toolkit = this.createToolkit(context);

    for (const handler of handlers) {
      try {
        await handler(message, context, toolkit);
      } catch (error) {
        this.logger.error('Handler failed', error);
        this.hub.send(client.id, {
          type: 'system:error',
          payload: { message: 'Internal handler error', details: (error as Error).message }
        });
      }
    }

    if (message.ack) {
      this.hub.send(client.id, { type: 'system:ack', payload: { ack: message.ack } });
    }
  }

  private createToolkit(context: ClientContext): HandlerToolkit {
    const { id } = context;
    const reply = (message: OutboundMessage | string, overrides?: Partial<OutboundMessage>) => {
      const normalized: OutboundMessage =
        typeof message === 'string'
          ? { type: 'system:reply', payload: { message } }
          : message;
      this.hub.send(id, { ...normalized, ...overrides });
    };

    return {
      reply,
      send: (targetId: string, message: OutboundMessage) => {
        this.hub.send(targetId, message);
      },
      broadcast: (message: OutboundMessage, filter?: (target: ClientContext) => boolean) => {
        if (!filter) {
          this.hub.broadcast(message);
          return;
        }
        this.hub.presence.list().forEach((snapshot: PresenceSnapshot) => {
          if (filter(snapshot)) {
            this.hub.send(snapshot.id, message);
          }
        });
      },
      rooms: {
        join: (room: string) => this.hub.joinRoom(room, id),
        leave: (room: string) => this.hub.leaveRoom(room, id),
        list: () => this.hub.rooms.roomsFor(id),
        broadcast: (
          message: OutboundMessage,
          roomName?: string,
          options?: { exceptSelf?: boolean; except?: string[] }
        ) => {
          const targetRoom = roomName ?? message.room;
          if (!targetRoom) return;
          const except = new Set(options?.except ?? []);
          if (options?.exceptSelf) {
            except.add(id);
          }
          this.hub.broadcast(message, { room: targetRoom, except: Array.from(except) });
        }
      },
      presence: {
        list: () => this.hub.presence.list(),
        get: (clientId: string) => this.hub.presence.get(clientId),
        update: (metadata: ClientMetadata) => this.hub.presence.update(id, metadata)
      },
      log: (...args: unknown[]) => this.logger.debug(`client:${id}`, ...args)
    };
  }
}
