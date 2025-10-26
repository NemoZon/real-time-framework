import type { BaseTransport } from '../transports/base.js';

export interface RealtimeMessage {
  type: string;
  payload?: unknown;
  target?: string | string[];
  room?: string;
  ack?: string;
}

export interface OutboundMessage extends RealtimeMessage {
  timestamp?: number;
}

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

export interface TransportClient extends ClientContext {
  send(message: OutboundMessage): void;
  close(reason?: string): void;
}

export interface BroadcastOptions {
  room?: string;
  except?: string[];
}

export interface PresenceSnapshot extends ClientContext {}

export interface HandlerToolkit {
  reply(message: OutboundMessage | string, overrides?: Partial<OutboundMessage>): void;
  send(targetId: string, message: OutboundMessage): void;
  broadcast(message: OutboundMessage, filter?: (context: ClientContext) => boolean): void;
  rooms: {
    join(name: string): void;
    leave(name: string): void;
    list(): string[];
    broadcast(message: OutboundMessage, roomName?: string, options?: { exceptSelf?: boolean; except?: string[] }): void;
  };
  presence: {
    list(): PresenceSnapshot[];
    get(clientId: string): PresenceSnapshot | undefined;
    update(metadata: ClientMetadata): void;
  };
  log: (...args: unknown[]) => void;
}

export type RealtimeHandler = (
  message: RealtimeMessage,
  context: ClientContext,
  toolkit: HandlerToolkit
) => Promise<void> | void;

export interface KernelOptions {
  transports?: BaseTransport[];
  logLevel?: 'silent' | 'error' | 'info' | 'debug';
}
