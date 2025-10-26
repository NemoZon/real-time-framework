import { EventEmitter } from 'node:events';
import type {
  BroadcastOptions,
  ClientContext,
  OutboundMessage,
  RealtimeMessage,
  TransportClient
} from '../types/index.js';
import { RoomManager } from './roomManager.js';
import { PresenceStore } from './presenceStore.js';
import { Logger } from '../utils/logger.js';

export interface HubEvents {
  'client:connected': (client: TransportClient) => void;
  'client:disconnected': (clientId: string, reason?: string) => void;
  message: (payload: { message: RealtimeMessage; client: TransportClient }) => void;
}

export class RealtimeHub extends EventEmitter {
  readonly rooms = new RoomManager();
  readonly presence = new PresenceStore();
  private readonly clients = new Map<string, TransportClient>();

  constructor(private readonly logger = new Logger('hub')) {
    super();
  }

  registerClient(client: TransportClient) {
    this.clients.set(client.id, client);
    this.presence.connect(this.toSnapshot(client));
    this.emit('client:connected', client);
    this.logger.debug('Client connected', client.id, client.transport);
  }

  unregisterClient(clientId: string, reason?: string) {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.rooms.leaveAll(clientId);
    this.clients.delete(clientId);
    this.presence.disconnect(clientId);
    this.emit('client:disconnected', clientId, reason);
    this.logger.debug('Client disconnected', clientId, reason);
  }

  receive(message: RealtimeMessage, clientId: string) {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.emit('message', { message, client });
  }

  getClient(clientId: string) {
    return this.clients.get(clientId);
  }

  snapshot(clientId: string): ClientContext | undefined {
    const client = this.clients.get(clientId);
    return client ? this.toSnapshot(client) : undefined;
  }

  joinRoom(room: string, clientId: string) {
    this.rooms.join(room, clientId);
    const client = this.clients.get(clientId);
    const rooms = this.rooms.roomsFor(clientId);
    if (client) {
      client.rooms = rooms;
    }
    this.presence.syncRooms(clientId, rooms);
  }

  leaveRoom(room: string, clientId: string) {
    this.rooms.leave(room, clientId);
    const client = this.clients.get(clientId);
    const rooms = this.rooms.roomsFor(clientId);
    if (client) {
      client.rooms = rooms;
    }
    this.presence.syncRooms(clientId, rooms);
  }

  broadcast(message: OutboundMessage, options?: BroadcastOptions) {
    const payload = { ...message, timestamp: Date.now() };
    const except = new Set(options?.except ?? []);
    const targetRoom = options?.room?.toLowerCase();
    const ids: string[] = targetRoom ? this.rooms.list(targetRoom) : Array.from(this.clients.keys());
    ids.forEach((id: string) => {
      if (except.has(id)) return;
      this.clients.get(id)?.send(payload);
    });
  }

  send(clientId: string, message: OutboundMessage) {
    const client = this.clients.get(clientId);
    if (!client) return false;
    client.send({ ...message, timestamp: Date.now() });
    return true;
  }

  private toSnapshot(client: TransportClient): ClientContext {
    return {
      id: client.id,
      transport: client.transport,
      metadata: client.metadata,
      connectedAt: client.connectedAt,
      rooms: this.rooms.roomsFor(client.id)
    };
  }
}
