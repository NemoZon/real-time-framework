export class RoomManager {
  private readonly rooms = new Map<string, Set<string>>();
  private readonly memberships = new Map<string, Set<string>>();

  join(room: string, clientId: string) {
    if (!room) return;
    const lower = room.toLowerCase();
    let bucket = this.rooms.get(lower);
    if (!bucket) {
      bucket = new Set();
      this.rooms.set(lower, bucket);
    }
    bucket.add(clientId);

    let personal = this.memberships.get(clientId);
    if (!personal) {
      personal = new Set();
      this.memberships.set(clientId, personal);
    }
    personal.add(lower);
  }

  leave(room: string, clientId: string) {
    const lower = room.toLowerCase();
    const bucket = this.rooms.get(lower);
    if (bucket) {
      bucket.delete(clientId);
      if (!bucket.size) {
        this.rooms.delete(lower);
      }
    }

    const personal = this.memberships.get(clientId);
    if (personal) {
      personal.delete(lower);
      if (!personal.size) {
        this.memberships.delete(clientId);
      }
    }
  }

  leaveAll(clientId: string) {
    const personal = this.memberships.get(clientId);
    if (!personal) return;
    for (const room of personal) {
      this.leave(room, clientId);
    }
  }

  list(room: string): string[] {
    const bucket = this.rooms.get(room.toLowerCase());
    return bucket ? Array.from(bucket) : [];
  }

  roomsFor(clientId: string): string[] {
    const personal = this.memberships.get(clientId);
    return personal ? Array.from(personal) : [];
  }
}
