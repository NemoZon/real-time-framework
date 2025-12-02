const metrics = {
  ws: false,
  meshA: false,
  meshB: false
};

const metricEls = {
  ws: document.querySelector('[data-metric="ws-count"]'),
  mesh: document.querySelector('[data-metric="mesh-count"]'),
  lastChannel: document.querySelector('[data-metric="last-channel"]')
};

const defaultTextarea = document.querySelector('[data-field="mesh-message"]');
if (defaultTextarea) {
  defaultTextarea.value = defaultTextarea.value.trim();
}

function setStatus(key, state, text) {
  const el = document.querySelector(`[data-status="${key}"]`);
  if (!el) return;
  el.classList.remove('status--online', 'status--offline', 'status--error');
  el.classList.add(`status--${state}`);
  const label = el.querySelector('.status__text');
  if (label) {
    label.textContent = text;
  }
}

function timeLabel() {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date());
}

function appendLog(stream, { label, payload, tone = 'info', direction = 'in' }) {
  if (!stream) return;
  const entry = document.createElement('div');
  entry.className = 'log__entry';
  if (direction === 'out') entry.classList.add('log__entry--out');
  if (tone === 'ack') entry.classList.add('log__entry--ack');
  if (tone === 'error') entry.classList.add('log__entry--error');

  const meta = document.createElement('div');
  meta.className = 'log__meta';
  meta.textContent = `${timeLabel()} ${label}`;

  const content = document.createElement('div');
  content.className = 'log__payload';
  content.textContent = payload;

  entry.append(meta, content);
  stream.append(entry);
  stream.scrollTop = stream.scrollHeight;
}

function tryParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function formatPayload(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function ackId() {
  return `ui-${Math.random().toString(16).slice(2)}`;
}

function syncMetrics() {
  const wsCount = Number(metrics.ws);
  const meshCount = Number(metrics.meshA) + Number(metrics.meshB);

  if (metricEls.ws) metricEls.ws.textContent = wsCount.toString();
  if (metricEls.mesh) metricEls.mesh.textContent = meshCount.toString();
}

function setLastChannel(type) {
  if (!type) return;
  if (metricEls.lastChannel) {
    metricEls.lastChannel.textContent = type;
  }
}

function createSocketController({ name, statusKey, logKey, onConnectedChange, onMessage }) {
  let socket = null;
  let currentUrl = '';
  const stream = document.querySelector(`[data-log-stream="${logKey}"]`);

  setStatus(statusKey, 'offline', 'hors ligne');

  const disconnect = () => {
    if (socket) {
      socket.close();
      socket = null;
    }
  };

  const connect = (url) => {
    disconnect();
    currentUrl = url;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      appendLog(stream, {
        label: `${name} ✖`,
        payload: `Impossible d'ouvrir le socket : ${error.message}`,
        tone: 'error'
      });
      setStatus(statusKey, 'error', 'erreur');
      return;
    }

    socket.addEventListener('open', () => {
      setStatus(statusKey, 'online', 'en ligne');
      appendLog(stream, { label: `${name} →`, payload: `Connexion établie (${url})`, direction: 'out' });
      onConnectedChange?.(true);
    });

    socket.addEventListener('close', () => {
      setStatus(statusKey, 'offline', 'hors ligne');
      appendLog(stream, { label: `${name} ✕`, payload: 'Connexion fermée' });
      onConnectedChange?.(false);
    });

    socket.addEventListener('error', () => {
      setStatus(statusKey, 'error', 'erreur');
      appendLog(stream, { label: `${name} !`, payload: 'Erreur de socket', tone: 'error' });
    });

    socket.addEventListener('message', (event) => {
      const parsed = tryParse(event.data);
      const payload = parsed ?? event.data;
      const tone = parsed?.type === 'system:ack' ? 'ack' : parsed?.type?.startsWith?.('system:error') ? 'error' : 'info';
      const label = `${name} ← ${parsed?.type ?? 'message'}`;
      appendLog(stream, { label, payload: formatPayload(payload), tone });
      if (parsed?.type) {
        setLastChannel(parsed.type);
      }
      onMessage?.({ payload, raw: event.data, url: currentUrl, type: parsed?.type });
    });
  };

  const send = (message, label = name) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendLog(stream, {
        label: `${label} ✖`,
        payload: 'Pas de connexion active',
        tone: 'error'
      });
      return;
    }
    const serialized = typeof message === 'string' ? message : JSON.stringify(message);
    socket.send(serialized);
    appendLog(stream, { label: `${label} →`, payload: serialized, direction: 'out' });
  };

  const isConnected = () => Boolean(socket && socket.readyState === WebSocket.OPEN);

  return {
    connect,
    disconnect,
    send,
    isConnected
  };
}

const wsControls = {
  url: document.querySelector('[data-field="ws-url"]'),
  room: document.querySelector('[data-field="ws-room"]'),
  name: document.querySelector('[data-field="ws-name"]'),
  status: document.querySelector('[data-field="ws-status-text"]'),
  message: document.querySelector('[data-field="ws-message"]')
};

const wsClient = createSocketController({
  name: 'WebSocket',
  statusKey: 'ws',
  logKey: 'ws',
  onConnectedChange: (connected) => {
    metrics.ws = connected;
    syncMetrics();
  }
});

document.querySelector('[data-action="ws-connect"]')?.addEventListener('click', () => {
  wsClient.connect(wsControls.url?.value || 'ws://localhost:8080/realtime');
});

document.querySelector('[data-action="ws-disconnect"]')?.addEventListener('click', () => wsClient.disconnect());

document.querySelector('[data-action="ws-join"]')?.addEventListener('click', () => {
  wsClient.send({
    type: 'chat:join',
    room: wsControls.room?.value || 'lobby',
    ack: ackId()
  });
});

document.querySelector('[data-action="ws-presence"]')?.addEventListener('click', () => {
  wsClient.send({
    type: 'presence:update',
    payload: {
      name: wsControls.name?.value || 'UI client',
      status: wsControls.status?.value || 'online'
    },
    ack: ackId()
  });
});

document.querySelector('[data-action="ws-send"]')?.addEventListener('click', () => {
  wsClient.send({
    type: 'chat:message',
    payload: wsControls.message?.value || 'Salut, realtime !',
    room: wsControls.room?.value || 'lobby',
    ack: ackId()
  });
});

const meshControls = {
  aUrl: document.querySelector('[data-field="mesh-a-url"]'),
  bUrl: document.querySelector('[data-field="mesh-b-url"]'),
  payload: document.querySelector('[data-field="mesh-message"]')
};

const meshLog = document.querySelector('[data-log-stream="mesh"]');

const meshA = createSocketController({
  name: 'Nœud A',
  statusKey: 'mesh-a',
  logKey: 'mesh-a',
  onConnectedChange: (connected) => {
    metrics.meshA = connected;
    syncMetrics();
  },
  onMessage: ({ payload, type }) => {
    appendLog(meshLog, {
      label: 'A ← mesh',
      payload: formatPayload(payload),
      tone: type === 'system:ack' ? 'ack' : 'info'
    });
    if (type) setLastChannel(type);
  }
});

const meshB = createSocketController({
  name: 'Nœud B',
  statusKey: 'mesh-b',
  logKey: 'mesh-b',
  onConnectedChange: (connected) => {
    metrics.meshB = connected;
    syncMetrics();
  },
  onMessage: ({ payload, type }) => {
    appendLog(meshLog, {
      label: 'B ← mesh',
      payload: formatPayload(payload),
      tone: type === 'system:ack' ? 'ack' : 'info'
    });
    if (type) setLastChannel(type);
  }
});

document.querySelector('[data-action="mesh-a-connect"]')?.addEventListener('click', () => {
  meshA.connect(meshControls.aUrl?.value || 'ws://localhost:8080/realtime');
});
document.querySelector('[data-action="mesh-b-connect"]')?.addEventListener('click', () => {
  meshB.connect(meshControls.bUrl?.value || 'ws://localhost:8081/realtime');
});

document.querySelector('[data-action="mesh-a-disconnect"]')?.addEventListener('click', () => meshA.disconnect());
document.querySelector('[data-action="mesh-b-disconnect"]')?.addEventListener('click', () => meshB.disconnect());

function sendMesh(controller, label) {
  const raw = meshControls.payload?.value ?? '';
  if (!raw.trim()) {
    appendLog(meshLog, { label, payload: 'Le champ payload est vide', tone: 'error' });
    return;
  }
  const parsed = tryParse(raw.trim());
  if (!parsed) {
    appendLog(meshLog, { label, payload: 'JSON invalide', tone: 'error' });
    return;
  }
  if (!parsed.ack) {
    parsed.ack = ackId();
  }
  controller.send(parsed, label);
}

document.querySelector('[data-action="mesh-send-a"]')?.addEventListener('click', () => sendMesh(meshA, 'Mesh A'));
document.querySelector('[data-action="mesh-send-b"]')?.addEventListener('click', () => sendMesh(meshB, 'Mesh B'));

syncMetrics();
