import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const edgePath =
  process.env.EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const debugPort = Number(
  process.env.DEBUG_PORT || 9600 + Math.floor(Math.random() * 200),
);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173/submission/';
const profile = await mkdtemp(path.join(os.tmpdir(), 'aftershot-smoke-'));

const edge = spawn(
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
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1440,900',
    baseUrl,
  ],
  { stdio: 'ignore', windowsHide: true },
);

let browserSocket;
let commandId = 0;
const pending = new Map();
const consoleErrors = [];

async function waitForPage() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) =>
        response.json(),
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
  throw new Error('Edge DevTools endpoint did not become ready.');
}

function send(method, params = {}) {
  commandId += 1;
  const id = commandId;
  browserSocket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP command timed out: ${method}`));
    }, 15000);
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        'Evaluation failed.',
    );
  }
  return result.result?.value;
}

async function waitFor(expression, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function clickSelector(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) {
    throw new Error(`Selector not found: ${selector}`);
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

async function pressKey(key, code, keyCode) {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  });
}

async function holdCanvasAt(x, y, durationMs, screenshotPath) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  if (screenshotPath) {
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
}

async function captureScreenshot(filePath) {
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(filePath, Buffer.from(screenshot.data, 'base64'));
}

async function main() {
  const page = await waitForPage();
  browserSocket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    browserSocket.addEventListener('open', resolve, { once: true });
    browserSocket.addEventListener('error', reject, { once: true });
  });
  browserSocket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const command = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        command.reject(new Error(message.error.message));
      } else {
        command.resolve(message.result);
      }
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(
        message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text,
      );
    }
    if (
      message.method === 'Log.entryAdded' &&
      message.params.entry.level === 'error'
    ) {
      consoleErrors.push(message.params.entry.text);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  if (process.env.CAPTURE_SCALE === '2') {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
  }
  await send('Page.navigate', { url: baseUrl });
  await waitFor(`document.readyState === 'complete'`, 30000);
  await waitFor('Boolean(window.__AFTERSHOT__?.app?.scene)', 30000);
  await new Promise((resolve) => setTimeout(resolve, 800));

  const initial = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    return {
      view: app.view,
      playerCount: app.gameState.players.length,
      canvas: Boolean(document.querySelector('#game-canvas canvas')),
      title: document.querySelector('#entry-title')?.textContent,
    };
  })()`);
  if (!initial.canvas || initial.view !== 'entry' || initial.playerCount !== 3) {
    throw new Error(`Initial state invalid: ${JSON.stringify(initial)}`);
  }
  await captureScreenshot(path.join('proof', 'final-entry.png'));
  const difficultyStates = [];
  for (const difficulty of ['easy', 'normal', 'hard']) {
    await evaluate(`(() => {
      const select = document.querySelector('#difficulty-select');
      select.value = ${JSON.stringify(difficulty)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const selected = await evaluate(
      `window.__AFTERSHOT__.app.selectedDifficulty`,
    );
    if (selected !== difficulty) {
      throw new Error(`Difficulty switch failed: ${difficulty} -> ${selected}`);
    }
    difficultyStates.push(selected);
  }
  await evaluate(`(() => {
    const select = document.querySelector('#difficulty-select');
    select.value = 'normal';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  if (process.env.CAPTURE_SCALE === '2') {
    await captureScreenshot(
      path.join('proof', process.env.CAPTURE_NAME || 'live-final-2x.png'),
    );
  }
  const mapStates = [];
  for (const mapId of ['foundry', 'harbor', 'dunes']) {
    await clickSelector(`#entry-map-picker [data-map="${mapId}"]`);
    await new Promise((resolve) => setTimeout(resolve, 220));
    const state = await evaluate(`(() => ({
      selectedMapId: window.__AFTERSHOT__.app.selectedMapId,
      sceneMapId: window.__AFTERSHOT__.app.scene.currentMapId,
      stamp: document.querySelector('#map-stamp-name').textContent,
    }))()`);
    if (state.selectedMapId !== mapId || state.sceneMapId !== mapId) {
      throw new Error(`Map switch failed: ${JSON.stringify({ mapId, state })}`);
    }
    mapStates.push(state);
    await captureScreenshot(path.join('proof', `map-${mapId}.png`));
  }
  await clickSelector('#entry-map-picker [data-map="foundry"]');
  await waitFor(
    `window.__AFTERSHOT__.app.selectedMapId === 'foundry' && window.__AFTERSHOT__.app.scene.currentMapId === 'foundry'`,
  );
  await new Promise((resolve) => setTimeout(resolve, 160));
  await clickSelector('#entry-mode-picker [data-match-mode="long"]');
  await waitFor(
    `window.__AFTERSHOT__.app.selectedMatchMode === 'long' &&
      !document.querySelector('#entry-character-select').classList.contains('is-hidden') &&
      window.__AFTERSHOT__.app.gameState.players.length === 3`,
  );
  const characterStates = [];
  for (const characterId of ['falcon', 'ash', 'agent46']) {
    await clickSelector(
      `#entry-character-picker [data-character="${characterId}"]`,
    );
    await waitFor(
      `window.__AFTERSHOT__.app.selectedCharacterId === ${JSON.stringify(characterId)} &&
        window.__AFTERSHOT__.app.gameState.players[0].characterId === ${JSON.stringify(characterId)}`,
    );
    characterStates.push(characterId);
  }
  await captureScreenshot(path.join('proof', 'long-mode-entry.png'));
  await clickSelector('#entry-mode-picker [data-match-mode="quick"]');
  await waitFor(
    `window.__AFTERSHOT__.app.selectedMatchMode === 'quick' &&
      document.querySelector('#entry-character-select').classList.contains('is-hidden')`,
  );
  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const fourth = structuredClone(app.gameState.players[1]);
    fourth.id = 'layout-check-4';
    fourth.name = '访客-余烬';
    fourth.slot = 3;
    app.gameState.players.push(fourth);
  })()`);
  await waitFor(`document.querySelectorAll('#scoreboard li').length === 4`, 2000);
  const fourRowLayout = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('#scoreboard li')];
    const lastRect = rows.at(-1)?.getBoundingClientRect();
    return {
      rows: rows.length,
      lastBottom: lastRect?.bottom ?? 0,
      viewportHeight: innerHeight,
    };
  })()`);
  if (
    fourRowLayout.rows !== 4 ||
    fourRowLayout.lastBottom > fourRowLayout.viewportHeight
  ) {
    throw new Error(`Four-player HUD overflow: ${JSON.stringify(fourRowLayout)}`);
  }

  const performanceVariant = process.env.PERF_VARIANT || 'baseline';
  if (process.env.PERF_AUTO_FULLSCREEN === '1') {
    await evaluate(`(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', {
          value: false,
          configurable: true,
        });
      } catch {
        // Keep the automated browser default when the property is locked.
      }
    })()`);
  }
  if (process.env.PERF_PROFILE === '1') {
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 1000 });
    await send('Profiler.start');
  }
  await evaluate(`(() => {
    const scene = window.__AFTERSHOT__.app.scene;
    const variant = ${JSON.stringify(performanceVariant)};
    window.__PERF_VARIANT__ = variant;
    if (variant.includes('no-fog')) {
      scene.drawFog = () => {};
    }
    if (variant.includes('no-aim')) {
      scene.drawAimCone = () => {};
    }
    if (variant.includes('no-effects')) {
      scene.drawEffects = () => {};
    }
  })()`);
  await evaluate(`(() => {
    const frames = [];
    const longTasks = [];
    let previous = performance.now();
    const startedAt = previous;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push(entry.duration);
      }
    });
    try {
      observer.observe({ type: 'longtask' });
    } catch {
      // Long Task API is not available in every browser.
    }
    const sample = (now) => {
      frames.push(now - previous);
      previous = now;
      if (now - startedAt < 3000) {
        requestAnimationFrame(sample);
      } else {
        observer.disconnect();
        const sorted = [...frames].sort((a, b) => a - b);
        const percentile = (value) =>
          sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? 0;
        window.__BATTLE_PERF__ = {
          frameCount: frames.length,
          p50FrameMs: percentile(0.5),
          p95FrameMs: percentile(0.95),
          maxFrameMs: Math.max(0, ...frames),
          over25ms: frames.filter((value) => value > 25).length,
          over50ms: frames.filter((value) => value > 50).length,
          longTaskCount: longTasks.length,
          maxLongTaskMs: Math.max(0, ...longTasks),
          renderer: window.__AFTERSHOT__.app.scene?.game?.renderer?.type,
          canvasWidth: window.__AFTERSHOT__.app.scene?.game?.canvas?.width,
          canvasHeight: window.__AFTERSHOT__.app.scene?.game?.canvas?.height,
        };
      }
    };
    requestAnimationFrame(sample);
  })()`);
  await clickSelector('#practice-button');
  await waitFor(`window.__AFTERSHOT__.app.view === 'game'`);
  await waitFor(`Boolean(window.__BATTLE_PERF__)`, 5000);
  const battlePerformance = await evaluate(`window.__BATTLE_PERF__`);
  if (
    battlePerformance.p95FrameMs > 90 ||
    battlePerformance.maxFrameMs > 150 ||
    battlePerformance.maxLongTaskMs > 100
  ) {
    throw new Error(
      `Battle entry performance regressed: ${JSON.stringify(battlePerformance)}`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
  const fogVisibilityPixels = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    const canvas = document.querySelector('#game-canvas canvas');
    const context = canvas.getContext('2d');
    const sample = (worldX, worldY) => {
      const scaleX = canvas.width / 1600;
      const scaleY = canvas.height / 1000;
      const pixels = context.getImageData(
        Math.round(worldX * scaleX) - 2,
        Math.round(worldY * scaleY) - 2,
        5,
        5,
      ).data;
      let total = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        total += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
      }
      return total / (pixels.length / 4);
    };
    const forward = 110;
    return {
      inside: sample(
        local.x + Math.cos(local.angle) * forward,
        local.y + Math.sin(local.angle) * forward,
      ),
      outside: sample(
        local.x - Math.cos(local.angle) * forward,
        local.y - Math.sin(local.angle) * forward,
      ),
    };
  })()`);
  if (fogVisibilityPixels.inside <= fogVisibilityPixels.outside + 8) {
    throw new Error(
      `Fog is inverted: ${JSON.stringify(fogVisibilityPixels)}`,
    );
  }
  await captureScreenshot(path.join('proof', 'fog-orientation.png'));
  if (process.env.PERF_ONLY === '1') {
    let hottestFunctions = [];
    if (process.env.PERF_PROFILE === '1') {
      const { profile } = await send('Profiler.stop');
      const samples = new Map();
      for (const node of profile.nodes) {
        samples.set(node.id, node);
      }
      const hitCounts = new Map();
      for (const id of profile.samples || []) {
        hitCounts.set(id, (hitCounts.get(id) || 0) + 1);
      }
      hottestFunctions = [...hitCounts.entries()]
        .map(([id, hits]) => {
          const node = samples.get(id);
          return {
            fn: node?.callFrame?.functionName || '(anonymous)',
            url: node?.callFrame?.url || '',
            line: node?.callFrame?.lineNumber || 0,
            hits,
          };
        })
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 20);
    }
    const performanceResult = {
      variant: performanceVariant,
      battlePerformance,
      fogVisibilityPixels,
      hottestFunctions,
      consoleErrors,
    };
    await writeFile(
      path.join('proof', 'performance-smoke-results.json'),
      `${JSON.stringify(performanceResult, null, 2)}\n`,
    );
    console.log(JSON.stringify(performanceResult, null, 2));
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
  const practiceDifficulty = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const bot = app.gameState.players.find((player) => player.isBot);
    return { state: app.gameState.difficulty, bot: bot?.botDifficulty };
  })()`);
  if (practiceDifficulty.state !== 'normal' || practiceDifficulty.bot !== 'normal') {
    throw new Error(`Practice difficulty invalid: ${JSON.stringify(practiceDifficulty)}`);
  }
  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    for (const player of app.gameState.players) {
      if (player.isBot) {
        player.alive = false;
        player.health = 0;
        player.respawnAt = performance.now() + 60000;
      }
    }
  })()`);
  const immersiveState = await evaluate(`(() => ({
    fullscreen: Boolean(document.fullscreenElement),
    keyboardLocked: window.__AFTERSHOT__.app.keyboardLocked,
    keyboardLockApi: Boolean(navigator.keyboard?.lock),
  }))()`);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Control',
    code: 'ControlLeft',
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
    modifiers: 2,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'w',
    code: 'KeyW',
    windowsVirtualKeyCode: 87,
    nativeVirtualKeyCode: 87,
    modifiers: 2,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'w',
    code: 'KeyW',
    windowsVirtualKeyCode: 87,
    nativeVirtualKeyCode: 87,
    modifiers: 2,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Control',
    code: 'ControlLeft',
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
  });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const ctrlWBlocked = await evaluate(
    `window.__AFTERSHOT__?.app?.view === 'game'`,
  );
  if (!ctrlWBlocked) {
    throw new Error('Ctrl+W closed or navigated away from the game.');
  }

  const timeBeforePause = await evaluate(
    `window.__AFTERSHOT__.app.gameState.timeLeft`,
  );
  await pressKey('Escape', 'Escape', 27);
  await waitFor(`window.__AFTERSHOT__.app.menuOpen === true`, 3000);
  const pauseStartedAt = await evaluate(
    `window.__AFTERSHOT__.app.gameState.timeLeft`,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const paused = await evaluate(`(() => ({
    menuOpen: window.__AFTERSHOT__.app.menuOpen,
    panelVisible: !document.querySelector('#pause-panel').classList.contains('is-hidden'),
    timeLeft: window.__AFTERSHOT__.app.gameState.timeLeft,
  }))()`);
  if (
    !paused.menuOpen ||
    !paused.panelVisible ||
    Math.abs(paused.timeLeft - pauseStartedAt) > 0.08
  ) {
    throw new Error(
      `Escape pause failed: ${JSON.stringify({ timeBeforePause, pauseStartedAt, paused })}`,
    );
  }

  const blockedShortcut = await evaluate(`(() => {
    const event = new KeyboardEvent('keydown', {
      key: 'r',
      code: 'KeyR',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    return !window.dispatchEvent(event);
  })()`);
  if (!blockedShortcut) {
    throw new Error('Ctrl+R was not intercepted during gameplay.');
  }

  await pressKey('Escape', 'Escape', 27);
  await new Promise((resolve) => setTimeout(resolve, 320));
  const resumed = await evaluate(`(() => ({
    menuOpen: window.__AFTERSHOT__.app.menuOpen,
    timeLeft: window.__AFTERSHOT__.app.gameState.timeLeft,
  }))()`);
  if (resumed.menuOpen || resumed.timeLeft >= paused.timeLeft) {
    throw new Error(`Escape resume failed: ${JSON.stringify(resumed)}`);
  }

  const beforeMove = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return { x: local.x, y: local.y };
  })()`);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'w',
    code: 'KeyW',
    windowsVirtualKeyCode: 87,
    nativeVirtualKeyCode: 87,
  });
  await new Promise((resolve) => setTimeout(resolve, 320));
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'w',
    code: 'KeyW',
    windowsVirtualKeyCode: 87,
    nativeVirtualKeyCode: 87,
  });
  const afterMove = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return { x: local.x, y: local.y };
  })()`);
  if (Math.hypot(afterMove.x - beforeMove.x, afterMove.y - beforeMove.y) < 8) {
    throw new Error('WASD movement did not change the local player position.');
  }

  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    for (const player of app.gameState.players) {
      if (player.isBot) {
        player.alive = false;
        player.health = 0;
        player.respawnAt = performance.now() + 60000;
      }
    }
  })()`);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 's',
    code: 'KeyS',
    windowsVirtualKeyCode: 83,
    nativeVirtualKeyCode: 83,
  });
  await new Promise((resolve) => setTimeout(resolve, 7000));
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 's',
    code: 'KeyS',
    windowsVirtualKeyCode: 83,
    nativeVirtualKeyCode: 83,
  });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const bottomEdge = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return { x: local.x, y: local.y };
  })()`);
  if (bottomEdge.y < 815) {
    throw new Error(`Player cannot reach the lower boundary: ${JSON.stringify(bottomEdge)}`);
  }

  await holdCanvasAt(1080, 520, 100, null);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const pistolAmmo = await evaluate(
    `window.__AFTERSHOT__.app.gameState.players.find((player) => player.id === window.__AFTERSHOT__.app.localPlayerId).ammo.pistol`,
  );
  if (pistolAmmo >= 12) {
    throw new Error('Pistol did not fire on release.');
  }

  await pressKey('2', 'Digit2', 50);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const baseVision = await evaluate(
    `window.__AFTERSHOT__.app.scene.activeVisionProfile`,
  );
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 1080,
    y: 520,
    button: 'none',
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 1080,
    y: 520,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const earlySniperSpread = await evaluate(
    `parseFloat(document.querySelector('#spread-value').textContent)`,
  );
  const earlySniperVision = await evaluate(`(() => ({
    ...window.__AFTERSHOT__.app.scene.activeVisionProfile,
    hud: document.querySelector('#vision-readout').textContent,
  }))()`);
  await new Promise((resolve) => setTimeout(resolve, 1250));
  const lateSniperSpread = await evaluate(
    `parseFloat(document.querySelector('#spread-value').textContent)`,
  );
  const lateSniperVision = await evaluate(`(() => ({
    ...window.__AFTERSHOT__.app.scene.activeVisionProfile,
    hud: document.querySelector('#vision-readout').textContent,
  }))()`);
  await captureScreenshot(path.join('proof', 'sniper-aim.png'));
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 1080,
    y: 520,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 180));

  const sniper = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return {
      weapon: local.weapon,
      ammo: local.ammo.sniper,
      pointerDown: local.pointerDown,
      shotEvents: app.gameState.events.filter((event) => event.type === 'shot').length,
    };
  })()`);
  if (sniper.weapon !== 'sniper' || sniper.ammo >= 5 || sniper.pointerDown) {
    throw new Error(`Sniper hold/release failed: ${JSON.stringify(sniper)}`);
  }
  if (!(earlySniperSpread > 8 && lateSniperSpread < 2)) {
    throw new Error(
      `Sniper bloom did not tighten: ${earlySniperSpread} -> ${lateSniperSpread}`,
    );
  }
  if (
    !baseVision ||
    !(earlySniperVision.halfAngle < baseVision.halfAngle) ||
    !(lateSniperVision.halfAngle < earlySniperVision.halfAngle) ||
    !(earlySniperVision.range > baseVision.range) ||
    !(lateSniperVision.range > earlySniperVision.range)
  ) {
    throw new Error(
      `Sniper vision did not scope correctly: ${JSON.stringify({
        baseVision,
        earlySniperVision,
        lateSniperVision,
      })}`,
    );
  }

  await pressKey('3', 'Digit3', 51);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 1080,
    y: 520,
    button: 'none',
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 1080,
    y: 520,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const mgDuringFire = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return {
      bloom: local.mgBloom,
      spread: parseFloat(document.querySelector('#spread-value').textContent),
    };
  })()`);
  await captureScreenshot(path.join('proof', 'mg-suppression.png'));
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 1080,
    y: 520,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const mg = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return {
      weapon: local.weapon,
      ammo: local.ammo.mg,
      bloom: local.mgBloom,
      pointerDown: local.pointerDown,
      shotEvents: app.gameState.events.filter((event) => event.type === 'shot').length,
    };
  })()`);
  if (mg.weapon !== 'mg' || mg.ammo > 45 || mg.pointerDown) {
    throw new Error(`MG automatic fire failed: ${JSON.stringify(mg)}`);
  }
  if (!(mgDuringFire.bloom > 8 && mgDuringFire.spread > 10)) {
    throw new Error(`MG spread did not increase: ${JSON.stringify(mgDuringFire)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 3200));
  const mgRecovered = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return { bloom: local.mgBloom };
  })()`);
  if (mgRecovered.bloom >= mg.bloom - 2) {
    throw new Error(
      `MG bloom did not recover: ${JSON.stringify({ mgDuringFire, mgRecovered })}`,
    );
  }

  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    local.x = 700;
    local.y = 650;
  })()`);
  await pressKey('1', 'Digit1', 49);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'd',
    code: 'KeyD',
    windowsVirtualKeyCode: 68,
    nativeVirtualKeyCode: 68,
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'd',
    code: 'KeyD',
    windowsVirtualKeyCode: 68,
    nativeVirtualKeyCode: 68,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const pistolDistance = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return local.x - 700;
  })()`);

  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    local.x = 700;
    local.y = 650;
  })()`);
  await pressKey('3', 'Digit3', 51);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'd',
    code: 'KeyD',
    windowsVirtualKeyCode: 68,
    nativeVirtualKeyCode: 68,
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'd',
    code: 'KeyD',
    windowsVirtualKeyCode: 68,
    nativeVirtualKeyCode: 68,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const mgDistance = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return local.x - 700;
  })()`);
  const speedRatio = mgDistance / pistolDistance;
  if (!(speedRatio >= 0.64 && speedRatio <= 0.82)) {
    throw new Error(
      `MG movement penalty invalid: ${JSON.stringify({ pistolDistance, mgDistance, speedRatio })}`,
    );
  }

  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    local.x = 700;
    local.y = 650;
    local.stamina = 100;
    local.slideCooldownEnd = 0;
  })()`);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'd',
    code: 'KeyD',
    windowsVirtualKeyCode: 68,
    nativeVirtualKeyCode: 68,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: ' ',
    code: 'Space',
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32,
  });
  await new Promise((resolve) => setTimeout(resolve, 90));
  const slideKeyDuring = await evaluate(`(() => ({
    keyExists: Boolean(window.__AFTERSHOT__.app.scene?.keys?.slide),
    isDown: Boolean(window.__AFTERSHOT__.app.scene?.keys?.slide?.isDown),
    latch: window.__AFTERSHOT__.app.slideLatchUntil,
    activeElement: document.activeElement?.tagName,
  }))()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: ' ',
    code: 'Space',
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32,
  });
  await new Promise((resolve) => setTimeout(resolve, 420));
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'd',
    code: 'KeyD',
    windowsVirtualKeyCode: 68,
    nativeVirtualKeyCode: 68,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const slideState = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return {
      stamina: local.stamina,
      slideCooldownRemaining: Math.max(0, local.slideCooldownEnd - performance.now()),
      staminaLabel: document.querySelector('#stamina-state').textContent,
    };
  })()`);
  if (
    slideState.stamina > 75 ||
    slideState.slideCooldownRemaining <= 0 ||
    slideState.staminaLabel.length === 0
  ) {
    throw new Error(
      `Slide behavior invalid: ${JSON.stringify({ slideKeyDuring, slideState })}`,
    );
  }

  await evaluate(`window.__AFTERSHOT__.requestReload()`);
  await waitFor(
    `(() => {
      const app = window.__AFTERSHOT__.app;
      const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
      return local.reloadEnd > 0;
    })()`,
    2000,
  );

  const ui = await evaluate(`(() => ({
    health: document.querySelector('#health-value')?.textContent,
    ammo: document.querySelector('#ammo-value')?.textContent,
    stamina: document.querySelector('#stamina-value')?.textContent,
    staminaState: document.querySelector('#stamina-state')?.textContent,
    activeWeapon: document.querySelector('.weapon-button.is-active')?.dataset.weapon,
    scoreboardRows: document.querySelectorAll('#scoreboard li').length,
    respawnHidden: document.querySelector('#respawn-panel')?.classList.contains('is-hidden'),
  }))()`);
  if (
    ui.activeWeapon !== 'mg' ||
    ui.scoreboardRows !== 2 ||
    ui.respawnHidden !== true ||
    Number(ui.stamina) > 100
  ) {
    throw new Error(`HUD state invalid: ${JSON.stringify(ui)}`);
  }

  await clickSelector('.weapon-button[data-weapon="sniper"]');
  await waitFor(
    `document.querySelectorAll('.weapon-button.is-active').length === 1 &&
      document.querySelector('.weapon-button.is-active')?.dataset.weapon === 'sniper'`,
  );
  await pressKey('1', 'Digit1', 51);
  await waitFor(
    `document.querySelectorAll('.weapon-button.is-active').length === 1 &&
      document.querySelector('.weapon-button.is-active')?.dataset.weapon === 'pistol'`,
  );
  const weaponSelection = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    const active = [...document.querySelectorAll('.weapon-button.is-active')];
    return {
      appWeapon: app.selectedWeapon,
      playerWeapon: local.weapon,
      activeWeapons: active.map((button) => button.dataset.weapon),
    };
  })()`);
  if (
    weaponSelection.appWeapon !== 'pistol' ||
    weaponSelection.playerWeapon !== 'pistol' ||
    weaponSelection.activeWeapons.length !== 1 ||
    weaponSelection.activeWeapons[0] !== 'pistol'
  ) {
    throw new Error(
      `Weapon selection frame desynchronized: ${JSON.stringify(weaponSelection)}`,
    );
  }

  const wheelPoint = await evaluate(`(() => {
    const rect = document.querySelector('#game-canvas canvas').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  const wheelWeapons = [];
  for (const deltaY of [120, 120, -120, -120]) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: wheelPoint.x,
      y: wheelPoint.y,
      deltaX: 0,
      deltaY,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    wheelWeapons.push(
      await evaluate(
        `document.querySelector('.weapon-button.is-active')?.dataset.weapon`,
      ),
    );
  }
  if (wheelWeapons.join(',') !== 'sniper,mg,sniper,pistol') {
    throw new Error(`Mouse wheel weapon cycle failed: ${JSON.stringify(wheelWeapons)}`);
  }

  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const bot = app.gameState.players.find((player) => player.isBot);
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    bot.alive = true;
    bot.health = 100;
    bot.respawnAt = 0;
    bot.x = 380;
    bot.y = 500;
    bot.weapon = 'mg';
    bot.stamina = 100;
    bot.botWeaponDecisionAt = 0;
    local.x = 1120;
    local.y = 500;
    app.__weaponSwitchStart = bot.weapon;
  })()`);
  await waitFor(
    `window.__AFTERSHOT__.app.gameState.players.find((player) => player.isBot).weapon !==
      window.__AFTERSHOT__.app.__weaponSwitchStart`,
    2500,
  );
  const botWeaponSwitch = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const bot = app.gameState.players.find((player) => player.isBot);
    const active = document.querySelector('.weapon-button.is-active');
    return {
      from: app.__weaponSwitchStart,
      to: bot.weapon,
      playerFrame: active?.dataset.weapon,
    };
  })()`);
  if (botWeaponSwitch.playerFrame !== 'pistol') {
    throw new Error(
      `Bot switch moved the player's weapon frame: ${JSON.stringify(botWeaponSwitch)}`,
    );
  }
  await evaluate(`(() => {
    const bot = window.__AFTERSHOT__.app.gameState.players.find(
      (player) => player.isBot,
    );
    bot.alive = false;
    bot.health = 0;
    bot.respawnAt = performance.now() + 60000;
  })()`);

  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    local.x = 560;
    local.y = 500;
    local.angle = 0;
    local.pointerDown = false;
    local.stamina = 100;
  })()`);
  await pressKey('2', 'Digit2', 50);
  const targetPoint = await evaluate(`(() => {
    const rect = document.querySelector('#game-canvas canvas').getBoundingClientRect();
    return {
      x: rect.left + rect.width * 0.78,
      y: rect.top + rect.height * 0.5,
    };
  })()`);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: targetPoint.x,
    y: targetPoint.y,
    button: 'none',
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: targetPoint.x,
    y: targetPoint.y,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 1250));
  await captureScreenshot(path.join('proof', 'visibility-occlusion.png'));
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: targetPoint.x,
    y: targetPoint.y,
    button: 'left',
    clickCount: 1,
  });

  await evaluate(`window.__AFTERSHOT__.returnToEntry()`);
  await waitFor(`window.__AFTERSHOT__.app.view === 'entry'`);
  await evaluate(`(() => {
    window.__AFTERSHOT__.selectMatchMode('long');
    window.__AFTERSHOT__.selectCharacter('falcon');
  })()`);
  await clickSelector('#practice-button');
  await waitFor(
    `window.__AFTERSHOT__.app.view === 'game' &&
      window.__AFTERSHOT__.app.gameState.matchMode === 'long' &&
      window.__AFTERSHOT__.app.gameState.players.length === 3`,
  );
  await waitFor(
    `!document.querySelector('#ability-hud').classList.contains('is-hidden')`,
  );
  const longFalcon = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return {
      matchMode: app.gameState.matchMode,
      timeLeft: app.gameState.timeLeft,
      characterId: local.characterId,
      skill1: document.querySelector('#skill1-name').textContent,
      skill2: document.querySelector('#skill2-name').textContent,
      roles: app.gameState.players.map((player) => player.characterId),
    };
  })()`);
  if (
    longFalcon.matchMode !== 'long' ||
    longFalcon.timeLeft < 478 ||
    longFalcon.characterId !== 'falcon' ||
    longFalcon.skill1 !== '战术闪光弹' ||
    longFalcon.skill2 !== '战术干扰波'
  ) {
    throw new Error(`Long Falcon setup invalid: ${JSON.stringify(longFalcon)}`);
  }

  const footstepFeedback = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const scene = app.scene;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    const source = {
      ...local,
      id: 'sound-source',
      characterId: 'ash',
      x: local.x + 180,
      y: local.y,
      vx: 120,
      vy: 0,
      alive: true,
      sprinting: false,
    };
    scene.drawFootsteps([source], local, performance.now());
    const walking = { ...scene.footstepSources[0] };
    source.sprinting = true;
    scene.drawFootsteps([source], local, performance.now());
    const sprinting = { ...scene.footstepSources[0] };
    source.characterId = 'agent46';
    source.sprinting = false;
    scene.drawFootsteps([source], local, performance.now());
    return {
      walking,
      sprinting,
      stealthSources: scene.footstepSources.length,
    };
  })()`);
  if (
    footstepFeedback.walking.color !== 'amber' ||
    footstepFeedback.sprinting.color !== 'red' ||
    footstepFeedback.sprinting.size <= 0 ||
    footstepFeedback.stealthSources !== 0
  ) {
    throw new Error(
      `Footstep feedback invalid: ${JSON.stringify(footstepFeedback)}`,
    );
  }
  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    const bot = app.gameState.players.find((player) => player.isBot);
    bot.isBot = false;
    bot.alive = true;
    bot.health = 100;
    bot.x = local.x + 180;
    bot.y = local.y;
    app.__testTargetId = bot.id;
    app.gameState.inputs[bot.id] = {
      up: true,
      down: false,
      left: false,
      right: false,
      pointerDown: false,
      cancel: false,
      sprint: false,
      slide: false,
      reload: false,
      skill1: false,
      skill2: false,
      assassinate: false,
      targetX: bot.x,
      targetY: bot.y - 100,
      weapon: bot.weapon,
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 260));
  await captureScreenshot(path.join('proof', 'footstep-directions.png'));
  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const input = app.gameState.inputs[app.__testTargetId];
    if (input) {
      input.up = false;
      input.targetX = app.gameState.players.find((player) => player.id === app.__testTargetId).x;
      input.targetY = app.gameState.players.find((player) => player.id === app.__testTargetId).y;
    }
  })()`);

  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    const bot = app.gameState.players.find((player) => player.id === app.__testTargetId);
    local.angle = 0;
    bot.isBot = false;
    bot.alive = true;
    bot.health = 100;
    bot.respawnAt = 0;
    bot.x = local.x + 100;
    bot.y = local.y;
    bot.angle = Math.PI;
  })()`);
  await pressKey('q', 'KeyQ', 81);
  await waitFor(
    `window.__AFTERSHOT__.app.gameState.players.find((player) => player.id === window.__AFTERSHOT__.app.localPlayerId).skill1Uses === 2`,
  );
  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const bot = app.gameState.players.find((player) => player.id === app.__testTargetId);
    app.gameState.flashbangs[0].x = bot.x;
    app.gameState.flashbangs[0].y = bot.y;
    app.gameState.flashbangs[0].stopped = true;
    app.gameState.flashbangs[0].explodeAt = performance.now() + 20;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const flashState = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const bot = app.gameState.players.find((player) => player.id === app.__testTargetId);
    return {
      flashed: bot.flashedUntil > performance.now(),
      remainingUses: app.gameState.players.find((player) => player.id === app.localPlayerId).skill1Uses,
    };
  })()`);
  if (!flashState.flashed || flashState.remainingUses !== 2) {
    throw new Error(`Flash grenade invalid: ${JSON.stringify(flashState)}`);
  }
  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    local.flashedUntil = performance.now() + 2200;
  })()`);
  await waitFor(
    `!document.querySelector('#flash-overlay').classList.contains('is-hidden')`,
  );
  const flashOverlayOpacity = await evaluate(
    `Number(document.querySelector('#flash-overlay').style.opacity)`,
  );
  if (flashOverlayOpacity < 0.9) {
    throw new Error(`Flash overlay too weak: ${flashOverlayOpacity}`);
  }
  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    local.flashedUntil = 0;
  })()`);

  await pressKey('e', 'KeyE', 69);
  await waitFor(
    `window.__AFTERSHOT__.app.gameState.players.find((player) => player.id === window.__AFTERSHOT__.app.localPlayerId).jamCastUntil > performance.now()`,
  );
  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    local.jamCastUntil = performance.now() + 10;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const jamState = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const bot = app.gameState.players.find((player) => player.id === app.__testTargetId);
    return {
      jammed: bot.jammedUntil > performance.now(),
      cooldown: app.gameState.players.find((player) => player.id === app.localPlayerId).skill2ReadyAt > performance.now(),
    };
  })()`);
  if (!jamState.jammed || !jamState.cooldown) {
    throw new Error(`Jam wave invalid: ${JSON.stringify(jamState)}`);
  }
  await captureScreenshot(path.join('proof', 'long-falcon-abilities.png'));

  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    local.alive = false;
    local.health = 0;
    local.respawnAt = performance.now();
  })()`);
  await waitFor(
    `window.__AFTERSHOT__.app.gameState.players.find((player) => player.id === window.__AFTERSHOT__.app.localPlayerId).invulnerableUntil > performance.now() + 1700`,
  );
  const respawnProtection = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return local.invulnerableUntil - performance.now();
  })()`);

  await evaluate(`window.__AFTERSHOT__.returnToEntry()`);
  await waitFor(`window.__AFTERSHOT__.app.view === 'entry'`);
  await evaluate(`(() => {
    window.__AFTERSHOT__.selectMatchMode('long');
    window.__AFTERSHOT__.selectCharacter('ash');
  })()`);
  await clickSelector('#practice-button');
  await waitFor(
    `window.__AFTERSHOT__.app.view === 'game' &&
      window.__AFTERSHOT__.app.gameState.matchMode === 'long' &&
      window.__AFTERSHOT__.app.gameState.players.find((player) => player.id === window.__AFTERSHOT__.app.localPlayerId)?.characterId === 'ash'`,
  );
  await waitFor(
    `!document.querySelector('#ability-hud').classList.contains('is-hidden')`,
  );
  await pressKey('q', 'KeyQ', 81);
  await waitFor(
    `!document.querySelector('#burn-overlay').classList.contains('is-hidden')`,
  );
  await pressKey('e', 'KeyE', 69);
  await waitFor(
    `window.__AFTERSHOT__.app.gameState.players.find((player) => player.id === window.__AFTERSHOT__.app.localPlayerId).focusActive === true`,
  );
  const ashState = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return {
      burning: local.burningUntil > performance.now(),
      focus: local.focusActive,
      burnOverlay: !document.querySelector('#burn-overlay').classList.contains('is-hidden'),
    };
  })()`);
  if (!ashState.burning || !ashState.focus || !ashState.burnOverlay) {
    throw new Error(`Ash abilities invalid: ${JSON.stringify(ashState)}`);
  }
  await captureScreenshot(path.join('proof', 'long-ash-abilities.png'));

  await evaluate(`window.__AFTERSHOT__.returnToEntry()`);
  await waitFor(`window.__AFTERSHOT__.app.view === 'entry'`);
  await evaluate(`(() => {
    window.__AFTERSHOT__.selectMatchMode('long');
    window.__AFTERSHOT__.selectCharacter('agent46');
  })()`);
  await clickSelector('#practice-button');
  await waitFor(
    `window.__AFTERSHOT__.app.view === 'game' &&
      window.__AFTERSHOT__.app.gameState.matchMode === 'long' &&
      window.__AFTERSHOT__.app.gameState.players.find((player) => player.id === window.__AFTERSHOT__.app.localPlayerId)?.characterId === 'agent46'`,
  );
  await waitFor(
    `!document.querySelector('#ability-hud').classList.contains('is-hidden') &&
      document.querySelector('#skill2-key').textContent === 'X'`,
  );
  await pressKey('q', 'KeyQ', 81);
  await waitFor(
    `window.__AFTERSHOT__.app.gameState.players.find((player) => player.id === window.__AFTERSHOT__.app.localPlayerId).reconUntil > performance.now()`,
  );
  const reconState = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    const bot = app.gameState.players.find((player) => player.isBot);
    bot.isBot = false;
    bot.alive = true;
    bot.health = 100;
    bot.x = local.x - 100;
    bot.y = local.y;
    bot.angle = 0;
    app.__testTargetId = bot.id;
    local.reconRemaining = local.reconUntil - performance.now();
    app.scene.visiblePlayerIds = new Set(
      [...(app.scene.visiblePlayerIds ?? [])].filter((id) => id !== bot.id),
    );
    app.scene.drawReconOutline(app.gameState.players, local);
    return {
      reconIds: [...(app.scene.reconIds ?? [])],
      reconRemaining: local.reconUntil - performance.now(),
      skill2Key: document.querySelector('#skill2-key').textContent,
    };
  })()`);
  if (
    !reconState.reconIds.includes(
      await evaluate(`window.__AFTERSHOT__.app.__testTargetId`),
    ) ||
    reconState.reconRemaining <= 0 ||
    reconState.skill2Key !== 'X'
  ) {
    throw new Error(`Agent recon invalid: ${JSON.stringify(reconState)}`);
  }
  await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    const bot = app.gameState.players.find((player) => player.id === app.__testTargetId);
    bot.x = local.x - 40;
    bot.y = local.y;
    bot.angle = Math.PI;
    bot.invulnerableUntil = 0;
    local.angle = Math.PI;
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'x',
      code: 'KeyX',
      bubbles: true,
      cancelable: true,
    }));
  })()`);
  await waitFor(
    `window.__AFTERSHOT__.app.gameState.players.find((player) => player.id === window.__AFTERSHOT__.app.__testTargetId).alive === false`,
  );
  const agentState = await evaluate(`(() => {
    const app = window.__AFTERSHOT__.app;
    const local = app.gameState.players.find((player) => player.id === app.localPlayerId);
    return {
      score: local.score,
      assassinationEvent: app.gameState.events.some((event) => event.type === 'assassinate'),
    };
  })()`);
  if (!agentState.assassinationEvent || agentState.score < 1) {
    throw new Error(`Agent assassination invalid: ${JSON.stringify(agentState)}`);
  }
  await captureScreenshot(path.join('proof', 'long-agent46-abilities.png'));

  if (consoleErrors.length) {
    throw new Error(`Browser errors: ${consoleErrors.join(' | ')}`);
  }

  const results = {
    initial,
    fourRowLayout,
        difficultyStates,
        practiceDifficulty,
    battlePerformance,
    fogVisibilityPixels,
        mapStates,
    characterStates,
        immersiveState,
        ctrlWBlocked,
        pauseState: {
          timeBeforePause,
          pauseStartedAt,
          paused,
          resumed,
          blockedShortcut,
        },
    movement: { before: beforeMove, after: afterMove },
        bottomEdge,
    pistolAmmo,
    sniperSpread: { early: earlySniperSpread, late: lateSniperSpread },
    sniperVision: {
      base: baseVision,
      early: earlySniperVision,
      late: lateSniperVision,
    },
    sniper,
    mg,
        mgDuringFire,
        mgRecovered,
        movementPenalty: { pistolDistance, mgDistance, speedRatio },
        slideState,
        slideKeyDuring,
    weaponSelection,
    wheelWeapons,
    botWeaponSwitch,
    longMode: {
      falcon: longFalcon,
      footstepFeedback,
      flashState,
      jamState,
      respawnProtection,
      ashState,
      reconState,
      agentState,
    },
        visibilityScreenshot: 'proof/visibility-occlusion.png',
    ui,
    consoleErrors,
  };
  await writeFile(
    path.join('proof', 'browser-smoke-results.json'),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  console.log(JSON.stringify(results, null, 2));
}

try {
  await main();
} catch (error) {
  try {
    const diagnostics = await evaluate(`(() => ({
      url: location.href,
      readyState: document.readyState,
      hasAftershot: Boolean(window.__AFTERSHOT__),
      bodyText: document.body?.innerText?.slice(0, 300),
      scripts: [...document.scripts].map((script) => script.src),
    }))()`);
    console.error(JSON.stringify({ diagnostics, consoleErrors }, null, 2));
  } catch {
    // Preserve the original failure.
  }
  throw error;
} finally {
  try {
    browserSocket?.close();
  } catch {
    // Browser already closed.
  }
  edge.kill();
}
