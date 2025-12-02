import type { BaseTransport } from '../transports/base.js';

export type RealtimeEventMap = Record<string, unknown>;
export type EventName<Events extends RealtimeEventMap = RealtimeEventMap> = keyof Events & string;

export interface RealtimeMessage<Type extends string = string, Payload = unknown> {
  type: Type;
  payload?: Payload;
  target?: string | string[];
  room?: string;
  ack?: string;
}

export type RealtimeEventMessage<
  Events extends RealtimeEventMap = RealtimeEventMap,
  Type extends EventName<Events> = EventName<Events>
> = RealtimeMessage<Type, Events[Type]>;

export type SystemEventMap = {
  'system:ack': { ack: string };
  'system:error': { message: string; details?: string };
  'system:reply': { message: string };
};

export type KernelEventMap<Events extends RealtimeEventMap = RealtimeEventMap> = Events & SystemEventMap;

export type OutboundMessage<
  Events extends RealtimeEventMap = RealtimeEventMap,
  Type extends EventName<Events> = EventName<Events>
> = RealtimeEventMessage<Events, Type> & {
  timestamp?: number;
};

export interface ClientMetadata {
  [key: string]: unknown;
}

export interface ClientContext {
  id: string;
  transport: string;
  metadata?: ClientMetadata;
  connectedAt: number;
  rooms: string[];
}

export interface TransportClient<Events extends RealtimeEventMap = RealtimeEventMap> extends ClientContext {
  send(message: OutboundMessage<KernelEventMap<Events>>): void;
  close(reason?: string): void;
}

export interface BroadcastOptions {
  room?: string;
  except?: string[];
}

export interface PresenceSnapshot extends ClientContext {}

export interface HandlerToolkit<Events extends RealtimeEventMap = RealtimeEventMap> {
  reply(message: OutboundMessage<KernelEventMap<Events>> | string, overrides?: Partial<OutboundMessage<KernelEventMap<Events>>>): void;
  send(targetId: string, message: OutboundMessage<KernelEventMap<Events>>): void;
  broadcast(message: OutboundMessage<KernelEventMap<Events>>, filter?: (context: ClientContext) => boolean): void;
  rooms: {
    join(name: string): void;
    leave(name: string): void;
    list(): string[];
    broadcast(
      message: OutboundMessage<KernelEventMap<Events>>,
      roomName?: string,
      options?: { exceptSelf?: boolean; except?: string[] }
    ): void;
  };
  presence: {
    list(): PresenceSnapshot[];
    get(clientId: string): PresenceSnapshot | undefined;
    update(metadata: ClientMetadata): void;
  };
  log: (...args: unknown[]) => void;
}

export type RealtimeHandler<
  Events extends RealtimeEventMap = RealtimeEventMap,
  Type extends EventName<Events> = EventName<Events>
> = (
  message: RealtimeEventMessage<Events, Type>,
  context: ClientContext,
  toolkit: HandlerToolkit<Events>
) => Promise<void> | void;

export interface KernelOptions {
  transports?: BaseTransport[];
  logLevel?: 'silent' | 'error' | 'info' | 'debug';
}
