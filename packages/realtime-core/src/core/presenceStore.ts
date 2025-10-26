import type { ClientMetadata, PresenceSnapshot } from '../types/index.js';

export class PresenceStore {
  private readonly clients = new Map<string, PresenceSnapshot>();

  connect(snapshot: PresenceSnapshot) {
    this.clients.set(snapshot.id, snapshot);
  }

  disconnect(clientId: string) {
    this.clients.delete(clientId);
  }

  get(clientId: string) {
    return this.clients.get(clientId);
  }

  list() {
    return Array.from(this.clients.values());
  }

  update(clientId: string, metadata: ClientMetadata) {
    const current = this.clients.get(clientId);
    if (!current) return;
    this.clients.set(clientId, { ...current, metadata: { ...current.metadata, ...metadata } });
  }

  syncRooms(clientId: string, rooms: string[]) {
    const current = this.clients.get(clientId);
    if (!current) return;
    this.clients.set(clientId, { ...current, rooms });
  }
}
