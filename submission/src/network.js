const HOST_PREFIX = 'aftershot-v1-';
const MAX_PLAYERS = 4;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomRoomCode(length = 6) {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return code;
}

function sanitizeName(name) {
  const cleaned = String(name ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 12);
  return cleaned || '无名者';
}

function normalizeRoomCode(code) {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export class NetworkSession {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.peer = null;
    this.role = 'solo';
    this.roomCode = '';
    this.localPlayerId = 'local';
    this.hostConnection = null;
    this.hostConnections = new Map();
    this.roster = new Map();
    this.matchActive = false;
    this.selectedMapId = 'foundry';
    this.closed = false;
    this.pingTimer = null;
  }

  get available() {
    return typeof window.Peer === 'function';
  }

  async createRoom(name) {
    if (!this.available) {
      throw new Error('联机组件没有载入。');
    }
    this.close();
    this.closed = false;
    this.role = 'host';
    this.localPlayerId = 'host';
    this.matchActive = false;
    this.roster = new Map([
      ['host', { id: 'host', name: sanitizeName(name), isHost: true, connected: true }],
    ]);

    let attempts = 0;
    while (attempts < 4) {
      attempts += 1;
      this.roomCode = randomRoomCode();
      try {
        await this.#openHostPeer();
        this.handlers.onLobby?.(this.getRoster(), this.roomCode);
        this.handlers.onStatus?.('房间在线', 'online');
        return this.roomCode;
      } catch (error) {
        this.peer?.destroy();
        this.peer = null;
        if (error?.type !== 'unavailable-id' || attempts >= 4) {
          this.role = 'solo';
          throw error;
        }
      }
    }
    throw new Error('无法建立房间，请稍后重试。');
  }

  async joinRoom(code, name) {
    if (!this.available) {
      throw new Error('联机组件没有载入。');
    }
    this.close();
    this.closed = false;
    this.role = 'client';
    this.matchActive = false;
    this.roomCode = normalizeRoomCode(code);
    if (this.roomCode.length !== 6) {
      throw new Error('房间码应为 6 位。');
    }

    await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('连接超时，请检查房间码或网络。'));
        }
      }, 15000);

      this.peer = new window.Peer(undefined, {
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
          ],
        },
      });

      this.peer.on('open', () => {
        this.hostConnection = this.peer.connect(this.#hostPeerId(), {
          reliable: true,
          serialization: 'json',
        });

        this.hostConnection.on('open', () => {
          this.hostConnection.send({
            type: 'join',
            name: sanitizeName(name),
          });
        });

        this.hostConnection.on('data', (message) => {
          this.#handleClientMessage(message);
          if (message?.type === 'welcome' && !settled) {
            settled = true;
            window.clearTimeout(timeout);
            resolve();
          }
        });

        this.hostConnection.on('close', () => {
          if (!this.closed) {
            this.handlers.onStatus?.('房主已离线', 'offline');
            this.handlers.onDisconnect?.();
          }
        });

        this.hostConnection.on('error', (error) => {
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            reject(error);
          }
          this.handlers.onStatus?.('连接异常', 'offline');
        });
      });

      this.peer.on('error', (error) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(error);
        }
        this.handlers.onStatus?.('联机失败', 'offline');
        this.handlers.onError?.(error);
      });
    });

    this.#startPing();
  }

  getRoster() {
    return [...this.roster.values()];
  }

  canStart() {
    return this.role === 'host' && this.roster.size >= 2;
  }

  startMatch(roster, mapId = this.selectedMapId) {
    if (this.role !== 'host') {
      return;
    }
    this.matchActive = true;
    this.selectedMapId = mapId;
    this.#broadcast({ type: 'start', roster, mapId });
  }

  selectMap(mapId) {
    if (this.role !== 'host') {
      return;
    }
    this.selectedMapId = mapId;
    this.#broadcast({ type: 'map', mapId });
  }

  sendInput(input) {
    if (this.role === 'client' && this.hostConnection?.open) {
      this.hostConnection.send({ type: 'input', input });
    }
  }

  sendSnapshot(snapshot) {
    if (this.role === 'host') {
      this.#broadcast({ type: 'snapshot', snapshot });
    }
  }

  returnToLobby() {
    if (this.role === 'host') {
      this.matchActive = false;
      this.#broadcast({
        type: 'lobby',
        roster: this.getRoster(),
        mapId: this.selectedMapId,
      });
    }
  }

  close() {
    this.closed = true;
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const connection of this.hostConnections.values()) {
      try {
        connection.close();
      } catch {
        // Ignore a connection that has already dropped.
      }
    }
    try {
      this.hostConnection?.close();
    } catch {
      // Ignore a connection that has already dropped.
    }
    try {
      this.peer?.destroy();
    } catch {
      // Ignore a peer that has already been destroyed.
    }
    this.hostConnections.clear();
    this.hostConnection = null;
    this.peer = null;
    this.matchActive = false;
    this.roster.clear();
    this.role = 'solo';
  }

  #hostPeerId() {
    return `${HOST_PREFIX}${this.roomCode}`;
  }

  #openHostPeer() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('建立房间超时，请检查网络。'));
        }
      }, 12000);
      this.peer = new window.Peer(this.#hostPeerId(), {
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
          ],
        },
      });

      this.peer.on('open', () => {
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      });
      this.peer.on('connection', (connection) => {
        this.#acceptHostConnection(connection);
      });
      this.peer.on('error', (error) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(error);
        }
        this.handlers.onError?.(error);
      });
      this.peer.on('disconnected', () => {
        this.handlers.onStatus?.('信令重连中', 'pending');
        if (!this.closed) {
          this.peer?.reconnect();
        }
      });
    });
  }

  #acceptHostConnection(connection) {
    let playerId = null;
    connection.on('open', () => {
      if (this.roster.size >= MAX_PLAYERS) {
        connection.send({
          type: 'error',
          message: '房间已满，最多 4 人。',
        });
        connection.close();
        return;
      }
      this.hostConnections.set(connection.peer, connection);
    });

    connection.on('data', (message) => {
      if (!message || typeof message !== 'object') {
        return;
      }
      if (message.type === 'join' && !playerId) {
        if (this.matchActive) {
          connection.send({ type: 'error', message: '对局已经开始，请稍后加入。' });
          connection.close();
          return;
        }
        if (this.roster.size >= MAX_PLAYERS) {
          connection.send({ type: 'error', message: '房间已满，最多 4 人。' });
          connection.close();
          return;
        }
        playerId = `guest-${connection.peer.slice(-10)}`;
        this.roster.set(playerId, {
          id: playerId,
          name: sanitizeName(message.name),
          isHost: false,
          connected: true,
        });
        connection.send({
          type: 'welcome',
          playerId,
          roomCode: this.roomCode,
          roster: this.getRoster(),
          mapId: this.selectedMapId,
        });
        this.#broadcastLobby();
        this.handlers.onLobby?.(this.getRoster(), this.roomCode);
        this.handlers.onStatus?.(`${this.roster.size} 人房间`, 'online');
        return;
      }
      if (message.type === 'input' && playerId && this.matchActive) {
        this.handlers.onRemoteInput?.(playerId, message.input);
        return;
      }
      if (message.type === 'ping') {
        connection.send({ type: 'pong', sentAt: message.sentAt });
      }
    });

    connection.on('close', () => {
      this.hostConnections.delete(connection.peer);
      if (!playerId || !this.roster.has(playerId)) {
        return;
      }
      this.roster.delete(playerId);
      this.#broadcastLobby();
      this.handlers.onLobby?.(this.getRoster(), this.roomCode);
      this.handlers.onPlayerLeft?.(playerId);
      if (this.roster.size === 0) {
        this.handlers.onStatus?.('等待连接', 'pending');
      } else {
        this.handlers.onStatus?.(`${this.roster.size} 人房间`, 'online');
      }
    });
  }

  #handleClientMessage(message) {
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'welcome') {
      this.localPlayerId = message.playerId;
      this.selectedMapId = message.mapId || this.selectedMapId;
      this.roster = new Map(
        (message.roster ?? []).map((player) => [player.id, player]),
      );
      this.handlers.onLobby?.(this.getRoster(), message.roomCode);
      this.handlers.onMapChange?.(this.selectedMapId);
      this.handlers.onStatus?.('房间已连接', 'online');
      return;
    }
    if (message.type === 'lobby') {
      this.matchActive = false;
      this.selectedMapId = message.mapId || this.selectedMapId;
      this.roster = new Map(
        (message.roster ?? []).map((player) => [player.id, player]),
      );
      this.handlers.onLobby?.(this.getRoster(), this.roomCode);
      this.handlers.onMapChange?.(this.selectedMapId);
      return;
    }
    if (message.type === 'map') {
      this.selectedMapId = message.mapId || this.selectedMapId;
      this.handlers.onMapChange?.(this.selectedMapId);
      return;
    }
    if (message.type === 'start') {
      this.matchActive = true;
      this.selectedMapId = message.mapId || this.selectedMapId;
      this.handlers.onMatchStart?.(
        message.roster,
        this.localPlayerId,
        this.selectedMapId,
      );
      return;
    }
    if (message.type === 'snapshot') {
      this.handlers.onSnapshot?.(message.snapshot);
      return;
    }
    if (message.type === 'pong') {
      const latency = Math.max(1, Date.now() - Number(message.sentAt));
      this.handlers.onLatency?.(latency);
      return;
    }
    if (message.type === 'error') {
      this.handlers.onError?.(new Error(message.message || '房间连接失败。'));
    }
  }

  #broadcastLobby() {
    this.#broadcast({
      type: 'lobby',
      roster: this.getRoster(),
      mapId: this.selectedMapId,
    });
  }

  #broadcast(message) {
    for (const connection of this.hostConnections.values()) {
      if (connection.open) {
        connection.send(message);
      }
    }
  }

  #startPing() {
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
    }
    this.pingTimer = window.setInterval(() => {
      if (this.hostConnection?.open) {
        this.hostConnection.send({ type: 'ping', sentAt: Date.now() });
      }
    }, 3000);
  }
}
