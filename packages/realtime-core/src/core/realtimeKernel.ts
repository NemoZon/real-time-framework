import { BaseTransport } from '../transports/base.js';
import type {
  ClientContext,
  ClientMetadata,
  EventName,
  HandlerToolkit,
  KernelEventMap,
  KernelOptions,
  OutboundMessage,
  PresenceSnapshot,
  RealtimeEventMap,
  RealtimeEventMessage,
  RealtimeHandler,
  RealtimeMessage,
  TransportClient
} from '../types/index.js';
import { Logger } from '../utils/logger.js';
import eventTypeBuilder, { EventTemplate } from './eventTypeBuilder.js';
import { RealtimeHub } from './realtimeHub.js';

export class RealtimeKernel<
  Events extends RealtimeEventMap = RealtimeEventMap,
  EventTemplates extends readonly EventTemplate[] = ['*']
> {
  private readonly hub: RealtimeHub;
  private readonly transports: BaseTransport[] = [];
  private readonly handlers = new Map<EventName<Events>, RealtimeHandler<Events>[]>();
  private readonly wildcardHandlers: RealtimeHandler<Events>[] = [];
  private readonly logger: Logger;

  private started = false;

  constructor(options: KernelOptions<EventTemplates> = {}) {
    this.logger = new Logger('kernel', options.logLevel ?? 'info');
    this.hub = new RealtimeHub(new Logger('hub', options.logLevel ?? 'info'));
    (options.transports ?? []).forEach((transport: BaseTransport) => this.useTransport(transport));
    this.hub.on('message', (payload: { message: RealtimeMessage; client: TransportClient }) =>
      this.dispatch(payload.message, payload.client),
    );
  }

  useTransport(transport: BaseTransport) {
    this.transports.push(transport);
    if (this.started) {
      transport.start(this.hub);
    }
  }

  on(eventType: '*', handler: RealtimeHandler<Events>): void;
  on(eventType: EventName<KernelEventMap<Events>>, handler: RealtimeHandler<Events>): void;
  on(
    descriptor: { eventTemplate: EventTemplates[number] | '*'; params?: (string | number | boolean)[] },
    handler: RealtimeHandler<Events>
  ): void;
  on(
    eventOrDescriptor:
      | { eventTemplate: EventTemplates[number]; params?: (string | number | boolean)[] }
      | EventName<KernelEventMap<Events>>
      | '*',
    handler: RealtimeHandler<Events>
  ) {
    const eventType =
      typeof eventOrDescriptor === 'string'
        ? eventOrDescriptor
        : eventTypeBuilder(eventOrDescriptor.eventTemplate, ...(eventOrDescriptor.params ?? []));

    if (eventType === '*') {
      this.wildcardHandlers.push(handler);
      return;
    }

    const bucket = this.handlers.get(eventType) ?? [];
    bucket.push(handler);
    this.handlers.set(eventType as EventName<Events>, bucket);
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
      ...(this.handlers.get(message.type as EventName<Events>) ?? []),
      ...this.wildcardHandlers,
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
    const typedMessage = message as RealtimeEventMessage<Events>;

    for (const handler of handlers) {
      try {
        await handler(typedMessage, context, toolkit);
      } catch (error) {
        this.logger.error('Handler failed', error);
        this.hub.send(client.id, {
          type: 'system:error',
          payload: { message: 'Internal handler error', details: (error as Error).message },
        });
      }
    }

    if (message.ack) {
      this.hub.send(client.id, { type: 'system:ack', payload: { ack: message.ack } });
    }
  }

  private createToolkit(context: ClientContext): HandlerToolkit<Events> {
    const { id } = context;
    const reply = (
      message: OutboundMessage<KernelEventMap<Events>> | string,
      overrides?: Partial<OutboundMessage<KernelEventMap<Events>>>,
    ) => {
      const normalized: OutboundMessage<KernelEventMap<Events>> =
        typeof message === 'string'
          ? ({ type: 'system:reply', payload: { message } } as OutboundMessage<
              KernelEventMap<Events>
            >)
          : message;
      this.hub.send(id, { ...normalized, ...overrides });
    };

    return {
      reply,
      send: (targetId: string, message: OutboundMessage<KernelEventMap<Events>>) => {
        this.hub.send(targetId, message);
      },
      broadcast: (
        message: OutboundMessage<KernelEventMap<Events>>,
        filter?: (target: ClientContext) => boolean,
      ) => {
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
          message: OutboundMessage<KernelEventMap<Events>>,
          roomName?: string,
          options?: { exceptSelf?: boolean; except?: string[] },
        ) => {
          const targetRoom = roomName ?? message.room;
          if (!targetRoom) return;
          const except = new Set(options?.except ?? []);
          if (options?.exceptSelf) {
            except.add(id);
          }
          this.hub.broadcast(message, { room: targetRoom, except: Array.from(except) });
        },
      },
      presence: {
        list: () => this.hub.presence.list(),
        get: (clientId: string) => this.hub.presence.get(clientId),
        update: (metadata: ClientMetadata) => this.hub.presence.update(id, metadata),
      },
      log: (...args: unknown[]) => this.logger.debug(`client:${id}`, ...args),
    };
  }
}
