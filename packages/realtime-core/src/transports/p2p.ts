import { createServer, Socket, type Server } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { OutboundMessage, RealtimeMessage, TransportClient } from '../types/index.js';
import { BaseTransport } from './base.js';
import { safeParse } from '../utils/json.js';

interface MeshEnvelope {
  kind: 'hello' | 'message';
  nodeId?: string;
  message?: RealtimeMessage;
}

export interface PeerMeshOptions {
  nodeId?: string;
  host?: string;
  port?: number;
  peers?: Array<string | { host: string; port: number }>;
  reconnectIntervalMs?: number;
}

interface PeerAddress {
  host: string;
  port: number;
}

const addressKey = (address: PeerAddress) => `${address.host}:${address.port}`;

class MeshConnection {
  private buffer = '';
  private handshakeSent = false;
  private remoteId?: string;
  private closed = false;

  constructor(
    private readonly socket: Socket,
    private readonly nodeId: string,
    private readonly onReady: (remoteId: string) => void,
    private readonly onMessage: (message: RealtimeMessage, remoteId: string) => void,
    private readonly onClose: (remoteId?: string) => void,
    autoHello: boolean
  ) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: Buffer | string) =>
      this.handleChunk(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    );
    socket.on('close', () => this.destroy());
    socket.on('error', () => this.destroy());
    if (autoHello) {
      this.sendHello();
    }
  }

  getRemoteId() {
    return this.remoteId;
  }

  send(message: OutboundMessage) {
    if (!this.remoteId || this.closed) return;
    const envelope: MeshEnvelope = { kind: 'message', message };
    this.socket.write(`${JSON.stringify(envelope)}\n`);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.onClose(this.remoteId);
  }

  private destroy() {
    if (this.closed) return;
    this.closed = true;
    this.onClose(this.remoteId);
  }

  private handleChunk(chunk: string) {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const raw = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (raw.trim()) {
        this.processRaw(raw);
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private processRaw(raw: string) {
    const envelope = safeParse<MeshEnvelope>(raw);
    if (!envelope) return;
    if (envelope.kind === 'hello') {
      if (!this.handshakeSent) {
        this.sendHello();
      }
      if (envelope.nodeId) {
        this.remoteId = envelope.nodeId;
        this.onReady(envelope.nodeId);
      }
      return;
    }

    if (envelope.kind === 'message' && this.remoteId && envelope.message) {
      this.onMessage(envelope.message, this.remoteId);
    }
  }

  private sendHello() {
    this.handshakeSent = true;
    const envelope: MeshEnvelope = { kind: 'hello', nodeId: this.nodeId };
    this.socket.write(`${JSON.stringify(envelope)}\n`);
  }
}

export class PeerMeshTransport extends BaseTransport {
  private readonly nodeId: string;
  private readonly options: Required<Pick<PeerMeshOptions, 'reconnectIntervalMs'>> & PeerMeshOptions;
  private readonly peers = new Map<string, PeerAddress>();
  private readonly pendingDials = new Set<string>();
  private readonly connections = new Map<string, MeshConnection>();
  private readonly connectionAddresses = new Map<string, string>();
  private server?: Server;

  constructor(options: PeerMeshOptions = {}) {
    super('mesh');
    this.nodeId = options.nodeId ?? randomUUID();
    this.options = { reconnectIntervalMs: 5000, ...options };
    (options.peers ?? []).map(normalizePeerAddress).forEach((peer) => {
      this.peers.set(addressKey(peer), peer);
    });
  }

  protected async onStart() {
    this.server = createServer((socket) => this.createConnection(socket, false));
    const host = this.options.host ?? '0.0.0.0';
    const port = this.options.port ?? 9090;
    await new Promise<void>((resolve) => this.server!.listen(port, host, resolve));
    this.logger.info(`PeerMesh node ${this.nodeId} listening on ${host}:${port}`);
    this.ensurePeerDials();
  }

  protected async onStop() {
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
  }

  broadcast(message: OutboundMessage) {
    for (const connection of this.connections.values()) {
      connection.send(message);
    }
  }

  private ensurePeerDials() {
    for (const peer of this.peers.values()) {
      this.dial(peer);
    }
  }

  private dial(address: PeerAddress) {
    const key = addressKey(address);
    if (this.pendingDials.has(key)) return;
    if (this.connectionAddressInUse(key)) return;
    this.pendingDials.add(key);
    const socket = new Socket();
    socket.once('connect', () => {
      this.pendingDials.delete(key);
      this.createConnection(socket, true, address);
    });
    socket.once('error', () => {
      this.pendingDials.delete(key);
      socket.destroy();
      this.scheduleReconnect(address);
    });
    socket.connect(address.port, address.host);
  }

  private createConnection(socket: Socket, autoHello: boolean, address?: PeerAddress) {
    const key = address ? addressKey(address) : undefined;
    const connection = new MeshConnection(
      socket,
      this.nodeId,
      (remoteId) => this.registerPeer(remoteId, connection, key),
      (message, remoteId) => this.handleRemoteMessage(remoteId, message),
      (remoteId) => this.handlePeerClose(remoteId, key),
      autoHello
    );
  }

  private registerPeer(remoteId: string, connection: MeshConnection, addressKeyValue?: string) {
    const existing = this.connections.get(remoteId);
    if (existing && existing !== connection) {
      connection.close();
      return;
    }
    this.connections.set(remoteId, connection);
    if (addressKeyValue) {
      this.connectionAddresses.set(remoteId, addressKeyValue);
    }
    const clientId = this.peerClientId(remoteId);
    const client: TransportClient = {
      id: clientId,
      transport: 'mesh',
      connectedAt: Date.now(),
      metadata: { nodeId: remoteId },
      rooms: [],
      send: (message) => connection.send(message),
      close: () => connection.close()
    };
    this.hub.registerClient(client);
    this.logger.info('Mesh peer ready', remoteId);
  }

  private handleRemoteMessage(remoteId: string, message: RealtimeMessage) {
    const clientId = this.peerClientId(remoteId);
    this.hub.receive(message, clientId);
  }

  private handlePeerClose(remoteId?: string, addressKeyValue?: string) {
    if (remoteId) {
      const clientId = this.peerClientId(remoteId);
      this.connections.delete(remoteId);
      this.connectionAddresses.delete(remoteId);
      this.hub.unregisterClient(clientId, 'mesh_disconnected');
    }

    if (addressKeyValue) {
      const address = this.peers.get(addressKeyValue);
      if (address) {
        this.scheduleReconnect(address);
      }
    }
  }

  private scheduleReconnect(address: PeerAddress) {
    const key = addressKey(address);
    if (this.pendingDials.has(key)) return;
    setTimeout(() => this.dial(address), this.options.reconnectIntervalMs).unref();
  }

  private connectionAddressInUse(key: string) {
    for (const stored of this.connectionAddresses.values()) {
      if (stored === key) {
        return true;
      }
    }
    return false;
  }

  private peerClientId(remoteId: string) {
    return `mesh:${remoteId}`;
  }
}

function normalizePeerAddress(value: string | { host: string; port: number }): PeerAddress {
  if (typeof value === 'string') {
    const [host, portString] = value.split(':');
    return { host: host ?? '127.0.0.1', port: Number(portString ?? 0) };
  }
  return value;
}
