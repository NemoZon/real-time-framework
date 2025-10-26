import { createServer, type Server, type IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { BaseTransport } from './base.js';
import type { RealtimeMessage, TransportClient, OutboundMessage } from '../types/index.js';
import { safeParse, safeStringify } from '../utils/json.js';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface WebSocketTransportOptions {
  port?: number;
  host?: string;
  path?: string;
  server?: Server;
  heartbeatIntervalMs?: number;
}

interface Frame {
  opcode: number;
  payload: Buffer;
  length: number;
  bytes: number;
}

class WebSocketConnection {
  private buffer = Buffer.alloc(0);
  private readonly heartbeat?: NodeJS.Timeout;
  private alive = true;
  private closed = false;

  constructor(
    private readonly socket: Socket,
    private readonly heartbeatInterval: number,
    private readonly onMessage: (payload: string) => void,
    private readonly onClose: () => void
  ) {
    socket.on('data', (chunk) => this.handleChunk(chunk));
    socket.on('end', () => this.destroy());
    socket.on('close', () => this.destroy());
    socket.on('error', () => this.destroy());

    if (heartbeatInterval > 0) {
      this.heartbeat = setInterval(() => this.ping(), heartbeatInterval).unref();
    }
  }

  send(message: OutboundMessage) {
    const payload = Buffer.from(safeStringify(message));
    this.socket.write(encodeFrame(payload));
  }

  close() {
    this.socket.end();
    this.destroy();
  }

  private ping() {
    if (!this.alive) {
      this.close();
      return;
    }
    this.alive = false;
    this.socket.write(Buffer.from([0x89, 0x00]));
  }

  private destroy() {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
    }
    this.onClose();
  }

  private handleChunk(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      const frame = decodeFrame(this.buffer);
      if (!frame) break;
      this.buffer = this.buffer.subarray(frame.bytes);
      switch (frame.opcode) {
        case 0x1: {
          this.alive = true;
          this.onMessage(frame.payload.toString('utf8'));
          break;
        }
        case 0x8: {
          this.close();
          return;
        }
        case 0x9: {
          // respond with pong
          this.socket.write(encodeFrame(frame.payload, 0x0a));
          break;
        }
        case 0x0a: {
          this.alive = true;
          break;
        }
        default:
          break;
      }
    }
  }
}

function decodeFrame(buffer: Buffer): Frame | null {
  if (buffer.length < 2) return null;
  const firstByte = buffer[0]!;
  const opcode = firstByte & 0x0f;
  const secondByte = buffer[1]!;
  const masked = Boolean(secondByte & 0x80);
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return null;
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    payloadLength = Number(big);
    offset += 8;
  }

  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + payloadLength) return null;
  const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
  offset += maskLength;
  const payload = buffer.subarray(offset, offset + payloadLength);
  const unmasked = Buffer.alloc(payloadLength);

  if (masked && mask) {
    const actualMask = mask;
    for (let i = 0; i < payloadLength; i += 1) {
      const maskedByte = payload.readUInt8(i) ^ actualMask.readUInt8(i % 4);
      unmasked[i] = maskedByte;
    }
  } else {
    payload.copy(unmasked);
  }

  return {
    opcode,
    payload: unmasked,
    length: payloadLength,
    bytes: offset + payloadLength
  };
}

function encodeFrame(payload: Buffer, opcode = 0x01) {
  const payloadLength = payload.length;
  let headerLength = 2;
  if (payloadLength >= 126 && payloadLength < 65536) {
    headerLength += 2;
  } else if (payloadLength >= 65536) {
    headerLength += 8;
  }
  const buffer = Buffer.alloc(headerLength + payloadLength);
  buffer[0] = 0x80 | (opcode & 0x0f);
  let offset = 2;
  if (payloadLength < 126) {
    buffer[1] = payloadLength;
  } else if (payloadLength < 65536) {
    buffer[1] = 126;
    buffer.writeUInt16BE(payloadLength, offset);
    offset += 2;
  } else {
    buffer[1] = 127;
    buffer.writeBigUInt64BE(BigInt(payloadLength), offset);
    offset += 8;
  }
  payload.copy(buffer, headerLength);
  return buffer;
}

export class WebSocketTransport extends BaseTransport {
  private readonly server: Server | undefined;
  private httpServer?: Server;
  private readonly connections = new Map<string, WebSocketConnection>();
  private readonly options: Required<Pick<WebSocketTransportOptions, 'heartbeatIntervalMs'>> &
    Omit<WebSocketTransportOptions, 'heartbeatIntervalMs'>;

  constructor(options: WebSocketTransportOptions = {}) {
    super('websocket');
    this.options = { heartbeatIntervalMs: 30_000, ...options };
    this.server = options.server;
  }

  protected async onStart() {
    this.httpServer = this.server ?? createServer();
    this.httpServer.on('upgrade', (req, socket) => this.handleUpgrade(req, socket as Socket));
    if (!this.server) {
      const port = this.options.port ?? 7070;
      const host = this.options.host ?? '0.0.0.0';
      await new Promise<void>((resolve) => this.httpServer!.listen(port, host, resolve));
      this.logger.info(`WebSocket transport listening on ws://${host}:${port}${this.options.path ?? ''}`);
    }
  }

  protected async onStop() {
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    if (this.httpServer && !this.server) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
    }
  }

  private handleUpgrade(req: IncomingMessage, socket: Socket) {
    if (req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }

    if (this.options.path && req.url && !req.url.startsWith(this.options.path)) {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }

    const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n'
    ];
    socket.write(headers.join('\r\n'));

    this.createConnection(socket);
  }

  private createConnection(socket: Socket) {
    const id = randomUUID();
    const connection = new WebSocketConnection(
      socket,
      this.options.heartbeatIntervalMs,
      (payload) => this.handleRawPayload(id, payload),
      () => this.handleDisconnect(id)
    );
    this.connections.set(id, connection);
    const client: TransportClient = {
      id,
      transport: 'websocket',
      connectedAt: Date.now(),
      metadata: {},
      rooms: [],
      send: (message) => connection.send(message),
      close: () => connection.close()
    };
    this.hub.registerClient(client);
  }

  private handleRawPayload(clientId: string, payload: string) {
    const message = safeParse<RealtimeMessage>(payload);
    if (!message || !message.type) {
      this.logger.error('Received invalid payload', payload);
      return;
    }
    this.hub.receive(message, clientId);
  }

  private handleDisconnect(clientId: string) {
    this.connections.delete(clientId);
    this.hub.unregisterClient(clientId);
  }
}
