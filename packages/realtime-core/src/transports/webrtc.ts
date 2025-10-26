import type { RealtimeKernel } from '../core/realtimeKernel.js';
import type { ClientContext, HandlerToolkit, RealtimeMessage } from '../types/index.js';
import { Logger } from '../utils/logger.js';

export interface WebRTCSignalingOptions {
  namespace?: string;
  autoJoinRooms?: boolean;
}

interface SignalPayload {
  target?: string;
  room?: string;
  description?: unknown;
  candidate?: unknown;
  metadata?: Record<string, unknown>;
}

export class WebRTCSignalingBridge {
  private readonly logger: Logger;
  private namespace: string;

  constructor(private readonly options: WebRTCSignalingOptions = {}) {
    this.namespace = options.namespace ?? 'webrtc';
    this.logger = new Logger(`signaling:${this.namespace}`);
  }

  attach(kernel: RealtimeKernel) {
    const offerChannel = `${this.namespace}:offer`;
    const answerChannel = `${this.namespace}:answer`;
    const candidateChannel = `${this.namespace}:candidate`;
    const byeChannel = `${this.namespace}:bye`;

    kernel.on(offerChannel, (message, context, toolkit) => {
      const payload = normalizePayload(message);
      if (!payload?.description) {
        toolkit.reply({ type: `${this.namespace}:error`, payload: { reason: 'INVALID_OFFER' } });
        return;
      }
      if (this.options.autoJoinRooms && payload.room) {
        toolkit.rooms.join(payload.room);
      }
      this.forward(payload, context, toolkit, offerChannel);
    });

    kernel.on(answerChannel, (message, context, toolkit) => {
      const payload = normalizePayload(message);
      if (!payload?.description) {
        toolkit.reply({ type: `${this.namespace}:error`, payload: { reason: 'INVALID_ANSWER' } });
        return;
      }
      this.forward(payload, context, toolkit, answerChannel);
    });

    kernel.on(candidateChannel, (message, context, toolkit) => {
      const payload = normalizePayload(message);
      if (!payload?.candidate) {
        toolkit.reply({ type: `${this.namespace}:error`, payload: { reason: 'INVALID_CANDIDATE' } });
        return;
      }
      this.forward(payload, context, toolkit, candidateChannel);
    });

    kernel.on(byeChannel, (message, context, toolkit) => {
      const payload = normalizePayload(message) ?? {};
      this.forward(payload, context, toolkit, byeChannel);
    });
  }

  private forward(payload: SignalPayload, context: ClientContext, toolkit: HandlerToolkit, channel: string) {
    const envelope = {
      type: channel,
      payload: {
        from: context.id,
        room: payload.room,
        target: payload.target,
        description: payload.description,
        candidate: payload.candidate,
        metadata: payload.metadata
      }
    };

    if (payload.target) {
      toolkit.send(payload.target, envelope);
      return;
    }

    if (payload.room) {
      toolkit.rooms.broadcast(envelope, payload.room, { exceptSelf: true });
      return;
    }

    toolkit.reply({
      type: `${this.namespace}:error`,
      payload: { reason: 'TARGET_OR_ROOM_REQUIRED' }
    });
    this.logger.error('Signal requires target or room');
  }
}

function normalizePayload(message: RealtimeMessage): SignalPayload | null {
  const data = message.payload;
  if (!data || typeof data !== 'object') {
    return null;
  }
  const candidate = (data as Record<string, unknown>).candidate;
  const description = (data as Record<string, unknown>).description ?? (data as Record<string, unknown>).offer;
  const target = (data as Record<string, unknown>).target;
  const room = (data as Record<string, unknown>).room;
  const metadata = (data as Record<string, unknown>).metadata as Record<string, unknown> | undefined;

  return {
    candidate,
    description,
    target: typeof target === 'string' ? target : undefined,
    room: typeof room === 'string' ? room : undefined,
    metadata
  };
}
