import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const edgePath =
  process.env.EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173/submission/';
const expectedPlayers = Number(process.env.CLIENTS || 4);
if (expectedPlayers < 2 || expectedPlayers > 4) {
  throw new Error('CLIENTS must be between 2 and 4.');
}

class BrowserClient {
  constructor(port) {
    this.port = port;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
  }

  async start() {
    const profile = await mkdtemp(path.join(os.tmpdir(), `aftershot-${this.port}-`));
    this.process = spawn(
      edgePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-quic',
        '--disable-features=UseDnsHttpsSvcb',
        '--no-sandbox',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--user-data-dir=${profile}`,
        `--remote-debugging-port=${this.port}`,
        '--window-size=1440,900',
        baseUrl,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    const page = await this.waitForPage();
    this.socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const command = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          command.reject(new Error(message.error.message));
        } else {
          command.resolve(message.result);
        }
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.errors.push(
          message.params.exceptionDetails.exception?.description ||
            message.params.exceptionDetails.text,
        );
      }
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Page.navigate', { url: baseUrl });
    await this.waitFor(`document.readyState === 'complete'`, 30000);
    await this.waitFor(`Boolean(window.__AFTERSHOT__?.app?.scene)`, 30000);
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  async waitForPage() {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const pages = await fetch(`http://127.0.0.1:${this.port}/json/list`).then(
          (response) => response.json(),
        );
        const page =
          pages.find(
            (entry) => entry.type === 'page' && entry.url.includes('/submission/'),
          ) || pages.find((entry) => entry.type === 'page');
        if (page) {
          return page;
        }
      } catch {
        // Edge is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error(`Edge on port ${this.port} did not become ready.`);
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
          response.exceptionDetails.text,
      );
    }
    return response.result?.value;
  }

  async waitFor(expression, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  async click(selector) {
    const point = await this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      node.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (!point) {
      throw new Error(`Missing selector: ${selector}`);
    }
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1,
    });
  }

  async typeInto(selector, text) {
    await this.click(selector);
    await this.send('Input.insertText', { text });
  }

  async keyDown(key, code, keyCode) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
  }

  async keyUp(key, code, keyCode) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
  }

  async screenshot(filePath) {
    const screenshot = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    await writeFile(filePath, Buffer.from(screenshot.data, 'base64'));
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // Already closed.
    }
    this.process?.kill();
  }
}

const portSeed = 9400 + Math.floor(Math.random() * 200) * 2;
const host = new BrowserClient(portSeed);
const guest = new BrowserClient(portSeed + 1);
const guestTwo = new BrowserClient(portSeed + 2);
const guestThree = new BrowserClient(portSeed + 3);

try {
  await host.start();
  await guest.start();

  await host.evaluate(`document.querySelector('#player-name').value = '房主-游隼'`);
  await host.evaluate(`(() => {
    window.__AFTERSHOT__.selectMatchMode('long');
    window.__AFTERSHOT__.selectCharacter('falcon');
  })()`);
  await host.click('#create-room-button');
  await host.waitFor(
    `!document.querySelector('#lobby-panel').classList.contains('is-hidden')`,
  );
  const roomCode = await host.evaluate(
    `document.querySelector('#lobby-room-code').textContent.trim()`,
  );
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
    throw new Error(`Invalid room code: ${roomCode}`);
  }

  await guest.evaluate(`document.querySelector('#player-name').value = '访客-灰烬'`);
  await guest.evaluate(`(() => {
    window.__AFTERSHOT__.selectMatchMode('long');
    window.__AFTERSHOT__.selectCharacter('ash');
  })()`);
  await guest.typeInto('#room-code-input', roomCode);
  await guest.click('#join-room-button');
  await guest.waitFor(
    `!document.querySelector('#lobby-panel').classList.contains('is-hidden')`,
    20000,
  );
  if (expectedPlayers >= 3) {
    await guestTwo.start();
    await guestTwo.evaluate(`document.querySelector('#player-name').value = '访客-噪点'`);
    await guestTwo.evaluate(`(() => {
      window.__AFTERSHOT__.selectMatchMode('long');
      window.__AFTERSHOT__.selectCharacter('agent46');
    })()`);
    await guestTwo.typeInto('#room-code-input', roomCode);
    await guestTwo.click('#join-room-button');
    await guestTwo.waitFor(
      `!document.querySelector('#lobby-panel').classList.contains('is-hidden')`,
      20000,
    );
  }
  if (expectedPlayers >= 4) {
    await guestThree.start();
    await guestThree.evaluate(`document.querySelector('#player-name').value = '访客-余烬'`);
    await guestThree.evaluate(`(() => {
      window.__AFTERSHOT__.selectMatchMode('long');
      window.__AFTERSHOT__.selectCharacter('falcon');
    })()`);
    await guestThree.typeInto('#room-code-input', roomCode);
    await guestThree.click('#join-room-button');
    await guestThree.waitFor(
      `!document.querySelector('#lobby-panel').classList.contains('is-hidden')`,
      20000,
    );
  }
  await host.waitFor(
    `window.__AFTERSHOT__.app.net.getRoster().length === ${expectedPlayers}`,
    20000,
  );
  await host.click('#lobby-map-picker [data-map="harbor"]');
  await host.waitFor(`window.__AFTERSHOT__.app.selectedMapId === 'harbor'`);
  await host.waitFor(`window.__AFTERSHOT__.app.scene.currentMapId === 'harbor'`);
  await guest.waitFor(`window.__AFTERSHOT__.app.selectedMapId === 'harbor'`, 8000);
  await guest.waitFor(`window.__AFTERSHOT__.app.scene.currentMapId === 'harbor'`, 8000);
  await guest.waitFor(`window.__AFTERSHOT__.app.selectedMatchMode === 'long'`);

  const roleSync = await host.evaluate(`(() => ({
    matchMode: window.__AFTERSHOT__.app.selectedMatchMode,
    roles: window.__AFTERSHOT__.app.net
      .getRoster()
      .map((player) => ({ name: player.name, characterId: player.characterId })),
  }))()`);
  if (
    roleSync.matchMode !== 'long' ||
    roleSync.roles.find((player) => player.name === '房主-游隼')?.characterId !==
      'falcon' ||
    roleSync.roles.find((player) => player.name === '访客-灰烬')?.characterId !==
      'ash'
  ) {
    throw new Error(`Role synchronization failed: ${JSON.stringify(roleSync)}`);
  }

  await host.screenshot(path.join('proof', 'lobby-host.png'));
  await guest.screenshot(path.join('proof', 'lobby-guest.png'));
  await host.click('#copy-room-button');
  await host.waitFor(
    `document.querySelector('#lobby-message').textContent.trim().length > 0`,
    3000,
  );
  await host.click('#start-match-button');
  await host.waitFor(`window.__AFTERSHOT__.app.mode === 'host'`, 8000);
  await guest.waitFor(`window.__AFTERSHOT__.app.mode === 'client'`, 12000);
  await guest.waitFor(`Boolean(window.__AFTERSHOT__.app.snapshot)`, 12000);
  await host.waitFor(`window.__AFTERSHOT__.app.gameState.mapId === 'harbor'`);
  await guest.waitFor(`window.__AFTERSHOT__.app.gameState.mapId === 'harbor'`);
  await new Promise((resolve) => setTimeout(resolve, 700));

  const guestId = await guest.evaluate(
    `window.__AFTERSHOT__.app.localPlayerId`,
  );
  await guest.keyDown('q', 'KeyQ', 81);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await guest.keyUp('q', 'KeyQ', 81);
  await host.waitFor(
    `window.__AFTERSHOT__.app.gameState.players.find((player) => player.id === ${JSON.stringify(guestId)}).burningUntil > performance.now()`,
    4000,
  );
  const before = await host.evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const guest = app.gameState.players.find((player) => player.id === ${JSON.stringify(guestId)});
    return { id: guest.id, x: guest.x, y: guest.y, players: app.gameState.players.length };
  })()`);

  await guest.keyDown('d', 'KeyD', 68);
  await new Promise((resolve) => setTimeout(resolve, 650));
  await guest.keyUp('d', 'KeyD', 68);
  await new Promise((resolve) => setTimeout(resolve, 450));

  const after = await host.evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const guest = app.gameState.players.find((player) => player.id === ${JSON.stringify(guestId)});
    return {
      x: guest?.x,
      y: guest?.y,
      snapshotPlayers: app.net.getRoster().length,
    };
  })()`);
  if (!after || Math.abs(after.x - before.x) < 10) {
    throw new Error(`Guest movement was not received by host: ${JSON.stringify({ before, after })}`);
  }

  await guest.keyDown('2', 'Digit2', 50);
  await guest.keyUp('2', 'Digit2', 50);
  const canvasRect = await guest.evaluate(`(() => {
    const rect = document.querySelector('#game-canvas canvas').getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  })()`);
  const aimX = canvasRect.left + canvasRect.width * 0.72;
  const aimY = canvasRect.top + canvasRect.height * 0.58;
  await guest.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: aimX,
    y: aimY,
    button: 'none',
  });
  await guest.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: aimX,
    y: aimY,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 1450));
  await guest.screenshot(path.join('proof', 'multiplayer-guest-aim.png'));
  await guest.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: aimX,
    y: aimY,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 550));

  const networkResult = await host.evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const rows = [...document.querySelectorAll('#scoreboard li')];
    const lastRect = rows.at(-1)?.getBoundingClientRect();
    return {
      players: app.gameState.players.length,
      roster: app.net.getRoster().length,
      shots: app.gameState.events.filter((event) => event.type === 'shot').length,
      status: app.net ? 'connected' : 'missing',
      matchMode: app.gameState.matchMode,
      characters: app.gameState.players.map((player) => player.characterId),
      scoreboardRows: rows.length,
      lastRowBottom: lastRect?.bottom ?? 0,
      viewportHeight: innerHeight,
    };
  })()`);
  if (
    networkResult.players !== expectedPlayers ||
    networkResult.roster !== expectedPlayers ||
    networkResult.shots < 1 ||
    networkResult.matchMode !== 'long' ||
    !networkResult.characters.includes('ash') ||
    networkResult.scoreboardRows !== expectedPlayers ||
    networkResult.lastRowBottom > networkResult.viewportHeight
  ) {
    throw new Error(`Network result invalid: ${JSON.stringify(networkResult)}`);
  }

  await host.screenshot(path.join('proof', 'multiplayer-host.png'));
  await guest.screenshot(path.join('proof', 'multiplayer-guest.png'));

  await host.evaluate(`window.__AFTERSHOT__.app.gameState.timeLeft = 0.01`);
  await host.waitFor(
    `window.__AFTERSHOT__.app.gameState.status === 'ended'`,
    5000,
  );
  await guest.waitFor(
    `window.__AFTERSHOT__.app.gameState.status === 'ended'`,
    5000,
  );
  await host.waitFor(
    `!document.querySelector('#end-panel').classList.contains('is-hidden')`,
  );
  await guest.waitFor(
    `!document.querySelector('#end-panel').classList.contains('is-hidden')`,
  );
  await guest.screenshot(path.join('proof', 'match-end-guest.png'));

  await host.click('#return-lobby-button');
  await host.waitFor(`window.__AFTERSHOT__.app.view === 'lobby'`);
  await guest.waitFor(`window.__AFTERSHOT__.app.view === 'lobby'`, 8000);
  const returnState = await host.evaluate(`(() => ({
    hostView: window.__AFTERSHOT__.app.view,
    hostRoster: window.__AFTERSHOT__.app.net.getRoster().length,
  }))()`);
  const guestReturnState = await guest.evaluate(`(() => ({
    guestView: window.__AFTERSHOT__.app.view,
    guestRoster: window.__AFTERSHOT__.app.net.getRoster().length,
  }))()`);
  await host.click('#leave-room-button');
  await host.waitFor(`window.__AFTERSHOT__.app.view === 'entry'`);
  await guest.waitFor(
    `document.querySelector('#network-status').textContent.includes('离线')`,
    5000,
  );

  if (host.errors.length || guest.errors.length) {
    throw new Error(
      `Browser errors: host=${host.errors.join(' | ')} guest=${guest.errors.join(' | ')}`,
    );
  }

  const results = {
    clients: expectedPlayers,
    roomCode,
        mapId: 'harbor',
    roleSync,
    before,
    after,
    networkResult,
    returnState,
    guestReturnState,
    hostErrors: host.errors,
    guestErrors: guest.errors,
  };
  await writeFile(
    path.join('proof', `multiplayer-${expectedPlayers}-results.json`),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  host.close();
  guest.close();
  guestTwo.close();
  guestThree.close();
}
