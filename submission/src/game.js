import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  MATCH_SECONDS,
  PLAYER_RADIUS,
  SCORE_LIMIT,
  WEAPON_ORDER,
  WEAPONS,
  WORLD,
  createPracticeSimulation,
  createSimulation,
  getAimStats,
  makeSnapshot,
  setInput,
  updateSimulation,
} from './sim.js';
import { NetworkSession } from './network.js';
import {
  DEFAULT_MAP_ID,
  MAP_ORDER,
  MAPS,
  getMapDefinition,
} from './maps.js';
import {
  buildVisibilityPolygon,
  isPointInVision,
  traceRay,
  VISION,
} from './vision.js';

const dom = {
  app: document.querySelector('#app'),
  entryPanel: document.querySelector('#entry-panel'),
  entryMapSite: document.querySelector('#entry-map-site'),
  lobbyPanel: document.querySelector('#lobby-panel'),
  endPanel: document.querySelector('#end-panel'),
  playerName: document.querySelector('#player-name'),
  difficultySelect: document.querySelector('#difficulty-select'),
  roomCode: document.querySelector('#room-code-input'),
  practice: document.querySelector('#practice-button'),
  createRoom: document.querySelector('#create-room-button'),
  joinRoom: document.querySelector('#join-room-button'),
  entryMessage: document.querySelector('#entry-message'),
  lobbyCode: document.querySelector('#lobby-room-code'),
  lobbySlots: document.querySelector('#lobby-slots'),
  lobbyMapPicker: document.querySelector('#lobby-map-picker'),
  entryMapPicker: document.querySelector('#entry-map-picker'),
  lobbyMessage: document.querySelector('#lobby-message'),
  copyRoom: document.querySelector('#copy-room-button'),
  startMatch: document.querySelector('#start-match-button'),
  leaveRoom: document.querySelector('#leave-room-button'),
  pauseButton: document.querySelector('#pause-button'),
  pausePanel: document.querySelector('#pause-panel'),
  pauseMessage: document.querySelector('#pause-message'),
  resumeButton: document.querySelector('#resume-button'),
  quitMatch: document.querySelector('#quit-match-button'),
  immersiveButton: document.querySelector('#immersive-button'),
  matchClock: document.querySelector('#match-clock'),
  mapStampName: document.querySelector('#map-stamp-name'),
  matchState: document.querySelector('#match-state'),
  roomLabel: document.querySelector('#room-label'),
  networkStatus: document.querySelector('#network-status'),
  feed: document.querySelector('#feed'),
  banner: document.querySelector('#round-banner'),
  respawn: document.querySelector('#respawn-panel'),
  respawnCount: document.querySelector('#respawn-count'),
  healthValue: document.querySelector('#health-value'),
  healthFill: document.querySelector('#health-fill'),
  staminaValue: document.querySelector('#stamina-value'),
  staminaFill: document.querySelector('#stamina-fill'),
  staminaState: document.querySelector('#stamina-state'),
  playerCallsign: document.querySelector('#player-callsign'),
  ammoValue: document.querySelector('#ammo-value'),
  ammoMax: document.querySelector('#ammo-max'),
  reloadLabel: document.querySelector('#reload-label'),
  focusLabel: document.querySelector('#focus-label'),
  spreadValue: document.querySelector('#spread-value'),
  focusFill: document.querySelector('#focus-fill'),
  scoreProgress: document.querySelector('#score-progress'),
  scoreboard: document.querySelector('#scoreboard'),
  blueScore: document.querySelector('.team-score--blue span'),
  redScore: document.querySelector('.team-score--red span'),
  endTitle: document.querySelector('#end-title'),
  endSummary: document.querySelector('#end-summary'),
  restart: document.querySelector('#restart-button'),
  returnLobby: document.querySelector('#return-lobby-button'),
  weaponButtons: [...document.querySelectorAll('.weapon-button')],
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const cssColor = (value) => `#${value.toString(16).padStart(6, '0')}`;

const app = {
  scene: null,
  mode: 'preview',
  view: 'entry',
  localPlayerId: 'local',
  gameState: null,
  snapshot: null,
  snapshotReceivedAt: 0,
  localInput: null,
  remoteInputs: new Map(),
  selectedWeapon: 'pistol',
  selectedMapId: DEFAULT_MAP_ID,
  selectedDifficulty: DEFAULT_DIFFICULTY,
  forcePointerUp: false,
  reloadRequested: false,
  slideLatchUntil: 0,
  menuOpen: false,
  keyboardLocked: false,
  net: null,
  networkSendAccumulator: 0,
  hudAccumulator: 0,
  endedShown: false,
  seenEvents: new Set(),
  latestVisualPlayers: [],
  latestLocalPlayer: null,
  scoreboardSignature: '',
  toastTimer: null,
};

function setView(view) {
  app.view = view;
  dom.app.dataset.view = view;
  dom.entryPanel.classList.toggle('is-hidden', view !== 'entry');
  dom.lobbyPanel.classList.toggle('is-hidden', view !== 'lobby');
  if (view !== 'game') {
    app.menuOpen = false;
    dom.pausePanel.classList.add('is-hidden');
  }
  if (view !== 'ended') {
    dom.endPanel.classList.add('is-hidden');
  }
}

function setEntryMessage(message = '') {
  dom.entryMessage.textContent = message;
}

function setLobbyMessage(message = '') {
  dom.lobbyMessage.textContent = message;
}

function setNetworkStatus(label, state = 'online') {
  dom.networkStatus.textContent = label;
  dom.networkStatus.style.color =
    state === 'offline'
      ? 'var(--danger)'
      : state === 'pending'
        ? 'var(--amber)'
        : 'var(--green)';
}

function resetVisualState() {
  app.seenEvents.clear();
  app.endedShown = false;
  app.scoreboardSignature = '';
  dom.feed.replaceChildren();
  dom.scoreboard.replaceChildren();
  dom.endPanel.classList.add('is-hidden');
  dom.respawn.classList.add('is-hidden');
  app.menuOpen = false;
  dom.pausePanel.classList.add('is-hidden');
  app.scene?.resetInterpolation();
}

function showBanner(text) {
  dom.banner.textContent = text;
  dom.banner.classList.remove('is-visible');
  void dom.banner.offsetWidth;
  dom.banner.classList.add('is-visible');
}

const KEYBOARD_LOCK_CODES = [
  'KeyW',
  'KeyR',
  'KeyT',
  'KeyN',
  'KeyL',
  'KeyS',
  'KeyP',
  'KeyO',
  'KeyU',
  'KeyI',
  'KeyJ',
  'KeyC',
  'F5',
  'F12',
  'Backspace',
  'AltLeft',
  'AltRight',
  'ArrowLeft',
  'ArrowRight',
];

function updateImmersiveButton() {
  dom.immersiveButton.textContent =
    document.fullscreenElement && app.keyboardLocked
      ? '退出全屏防误触'
      : '全屏防误触';
  dom.immersiveButton.disabled = false;
}

async function enterImmersiveMode() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    if (navigator.keyboard?.lock) {
      await navigator.keyboard.lock(KEYBOARD_LOCK_CODES);
      app.keyboardLocked = true;
    }
    dom.pauseMessage.textContent =
      '已进入全屏防误触模式；Ctrl+W 等浏览器快捷键由浏览器锁定。';
  } catch {
    app.keyboardLocked = false;
    dom.pauseMessage.textContent =
      '浏览器未允许全屏快捷键锁定；关闭页面前仍会弹出离开确认。';
  }
  updateImmersiveButton();
}

async function exitImmersiveMode() {
  try {
    navigator.keyboard?.unlock?.();
  } catch {
    // Keyboard Lock may already be inactive.
  }
  app.keyboardLocked = false;
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      // The browser may have already left fullscreen.
    }
  }
  updateImmersiveButton();
}

function toggleImmersiveMode() {
  if (document.fullscreenElement || app.keyboardLocked) {
    exitImmersiveMode();
  } else {
    enterImmersiveMode();
  }
}

function openPause() {
  if (app.view !== 'game') {
    return;
  }
  app.menuOpen = true;
  app.forcePointerUp = true;
  app.reloadRequested = false;
  app.scene?.resetFixedClock();
  if (app.mode === 'practice') {
    const local = app.gameState?.players.find(
      (player) => player.id === app.localPlayerId,
    );
    if (local) {
      local.pointerDown = false;
      local.aimStartedAt = 0;
      local.mgBloomClock = 0;
    }
  }
  dom.pauseMessage.textContent =
    app.mode === 'practice'
      ? app.keyboardLocked
        ? '练习已暂停，浏览器快捷键已锁定。'
        : '练习已暂停；可开启全屏防误触锁定浏览器快捷键。'
      : app.keyboardLocked
        ? '联机对局仍在继续，浏览器快捷键已锁定。'
        : '联机对局仍在继续；可开启全屏防误触锁定快捷键。';
  updateImmersiveButton();
  dom.pausePanel.classList.remove('is-hidden');
}

function closePause() {
  if (!app.menuOpen) {
    return;
  }
  app.menuOpen = false;
  app.forcePointerUp = false;
  dom.pausePanel.classList.add('is-hidden');
  app.scene?.resetFixedClock();
}

function togglePause() {
  if (app.menuOpen) {
    closePause();
  } else {
    openPause();
  }
}

function quitMatch() {
  closePause();
  returnToEntry();
}

function updateMapSelectionUI() {
  const map = getMapDefinition(app.selectedMapId);
  dom.app.dataset.map = map.id;
  dom.app.style.setProperty('--map-accent', cssColor(map.palette.accent));
  dom.mapStampName.textContent = `${map.site} / ${map.name}`;
  dom.entryMapSite.textContent = map.site;
  for (const button of document.querySelectorAll('.map-button')) {
    const selected = button.dataset.map === map.id;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  for (const button of dom.lobbyMapPicker.querySelectorAll('.map-button')) {
    button.disabled = app.net?.role !== 'host';
  }
}

function renderMapPickers() {
  for (const container of [dom.entryMapPicker, dom.lobbyMapPicker]) {
    container.replaceChildren();
    for (const mapId of MAP_ORDER) {
      const map = MAPS[mapId];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-button';
      button.dataset.map = map.id;
      button.title = map.descriptor;
      const index = document.createElement('span');
      index.textContent = map.index;
      const name = document.createElement('strong');
      name.textContent = map.shortName;
      button.append(index, name);
      button.addEventListener('click', () => selectMap(map.id));
      container.append(button);
    }
  }
  updateMapSelectionUI();
}

function selectMap(mapId, broadcast = true) {
  if (!MAPS[mapId]) {
    return;
  }
  app.selectedMapId = mapId;
  if (app.gameState) {
    app.gameState.mapId = mapId;
  }
  updateMapSelectionUI();
  app.scene?.setMap(mapId);

  if (app.mode === 'preview') {
    app.gameState = createPracticeSimulation(playerName(), {
      now: performance.now(),
      preview: true,
      mapId,
      difficulty: app.selectedDifficulty,
      reducedMotion,
    });
  } else if (app.mode === 'lobby-host' && broadcast) {
    app.net?.selectMap(mapId);
  }
}

function setDifficulty(difficultyId, persist = true) {
  const difficulty =
    DIFFICULTIES[difficultyId]?.id ?? DEFAULT_DIFFICULTY;
  app.selectedDifficulty = difficulty;
  dom.difficultySelect.value = difficulty;
  if (app.gameState) {
    app.gameState.difficulty = difficulty;
    for (const player of app.gameState.players) {
      if (player.isBot) {
        player.botDifficulty = difficulty;
      }
    }
  }
  if (persist) {
    try {
      localStorage.setItem('aftershot-difficulty', difficulty);
    } catch {
      // Storage can be unavailable in hardened browser contexts.
    }
  }
}

function playerName() {
  return dom.playerName.value.trim() || '无名者';
}

async function beginLocalPractice() {
  if (!navigator.webdriver && !document.fullscreenElement) {
    await enterImmersiveMode();
  }
  app.mode = 'practice';
  app.localPlayerId = 'local';
  app.selectedWeapon = 'pistol';
  app.gameState = createPracticeSimulation(playerName(), {
    now: performance.now(),
    reducedMotion,
    mapId: app.selectedMapId,
    difficulty: app.selectedDifficulty,
  });
  app.scene?.setMap(app.selectedMapId);
  app.snapshot = null;
  resetVisualState();
  setView('game');
  setNetworkStatus('本地演练', 'online');
  dom.roomLabel.textContent = `人机对战 · ${
    DIFFICULTIES[app.selectedDifficulty]?.label ?? '普通'
  }`;
  showBanner('校准开始');
}

async function beginHostMatch() {
  if (!navigator.webdriver && !document.fullscreenElement) {
    await enterImmersiveMode();
  }
  const roster = app.net.getRoster();
  app.mode = 'host';
  app.localPlayerId = app.net.localPlayerId;
  app.selectedWeapon = 'pistol';
  app.gameState = createSimulation(roster, {
    now: performance.now(),
    reducedMotion,
    mapId: app.selectedMapId,
  });
  app.scene?.setMap(app.selectedMapId);
  app.snapshot = null;
  app.remoteInputs.clear();
  resetVisualState();
  app.net.startMatch(roster, app.selectedMapId);
  setView('game');
  setNetworkStatus(`${roster.length} 人在线`, 'online');
  dom.roomLabel.textContent = `房间 ${app.net.roomCode}`;
  showBanner('频道锁定');
}

function beginClientMatch(roster, playerId, mapId = app.selectedMapId) {
  app.mode = 'client';
  app.localPlayerId = playerId;
  app.selectedWeapon = 'pistol';
  app.selectedMapId = getMapDefinition(mapId).id;
  app.gameState = createSimulation(roster, {
    now: performance.now(),
    reducedMotion,
    mapId: app.selectedMapId,
  });
  app.scene?.setMap(app.selectedMapId);
  app.snapshot = null;
  resetVisualState();
  setView('game');
  setNetworkStatus('同步中', 'pending');
  dom.roomLabel.textContent = `房间 ${app.net.roomCode}`;
  showBanner('频道锁定');
}

function renderLobby(roster, roomCode) {
  app.mode = app.net?.role === 'host' ? 'lobby-host' : 'lobby-client';
  setView('lobby');
  dom.lobbyCode.textContent = roomCode || app.net?.roomCode || '------';
  dom.lobbySlots.replaceChildren();
  for (let slot = 0; slot < 4; slot += 1) {
    const player = roster[slot];
    const row = document.createElement('div');
    row.className = `lobby-slot${player ? '' : ' is-empty'}${
      player?.id === app.net?.localPlayerId ? ' is-self' : ''
    }`;
    const index = document.createElement('span');
    index.textContent = String(slot + 1).padStart(2, '0');
    const name = document.createElement('strong');
    name.textContent = player?.name ?? '等待加入';
    const role = document.createElement('small');
    role.textContent = player ? (player.isHost ? 'HOST' : 'READY') : 'OPEN';
    row.append(index, name, role);
    dom.lobbySlots.append(row);
  }
  renderMapPickers();

  const canStart = app.net?.role === 'host' && roster.length >= 2;
  dom.startMatch.disabled = !canStart;
  dom.startMatch.textContent =
    app.net?.role === 'host'
      ? canStart
        ? '开始对局'
        : '等待第二名玩家'
      : '等待房主开始';
  setNetworkStatus(`${roster.length} 人在线`, 'online');
  dom.roomLabel.textContent = `房间 ${roomCode || app.net?.roomCode || ''}`;
}

function returnToEntry() {
  void exitImmersiveMode();
  app.net?.close();
  app.net = null;
  app.mode = 'preview';
  app.localPlayerId = 'local';
  app.gameState = createPracticeSimulation(playerName(), {
    now: performance.now(),
    preview: true,
    mapId: app.selectedMapId,
    difficulty: app.selectedDifficulty,
  });
  app.snapshot = null;
  app.remoteInputs.clear();
  app.selectedWeapon = 'pistol';
  resetVisualState();
  setView('entry');
  setNetworkStatus('本地', 'online');
  dom.roomLabel.textContent = '练习场';
  setEntryMessage('');
}

function configureNetwork() {
  app.net?.close();
  app.net = new NetworkSession({
    onLobby: renderLobby,
    onRemoteInput: (playerId, input) => {
      app.remoteInputs.set(playerId, input);
    },
    onSnapshot: (snapshot) => {
      if (app.mode !== 'client') {
        return;
      }
      app.snapshot = snapshot;
      app.snapshotReceivedAt = performance.now();
      app.selectedMapId = getMapDefinition(snapshot.mapId).id;
      if (app.gameState) {
        app.gameState.status = snapshot.status;
        app.gameState.winner = snapshot.winner;
        app.gameState.timeLeft = snapshot.timeLeft;
        app.gameState.mapId = app.selectedMapId;
      }
      app.scene?.setMap(app.selectedMapId);
      updateMapSelectionUI();
      setNetworkStatus('已同步', 'online');
    },
    onMatchStart: (roster, playerId, mapId) => {
      beginClientMatch(roster, playerId, mapId);
    },
    onMapChange: (mapId) => {
      selectMap(mapId, false);
    },
    onStatus: setNetworkStatus,
    onLatency: (latency) => {
      if (app.mode === 'client') {
        setNetworkStatus(`${latency} ms`, latency > 220 ? 'pending' : 'online');
      }
    },
    onError: (error) => {
      const message = error?.message || '联机发生异常，请重试。';
      if (app.view === 'entry') {
        setEntryMessage(message);
      } else {
        setLobbyMessage(message);
      }
      setNetworkStatus('连接异常', 'offline');
    },
    onPlayerLeft: (playerId) => {
      if (app.mode === 'host' && app.gameState) {
        app.gameState.players = app.gameState.players.filter(
          (player) => player.id !== playerId,
        );
        app.remoteInputs.delete(playerId);
        addFeed('连接中断', '战场', 'OFFLINE');
      }
    },
    onDisconnect: () => {
      setNetworkStatus('房主已离线', 'offline');
      showBanner('连接中断');
    },
  });
}

async function createRoom() {
  setEntryMessage('');
  dom.createRoom.disabled = true;
  try {
    configureNetwork();
    await app.net.createRoom(playerName());
    app.net.selectMap(app.selectedMapId);
    renderLobby(app.net.getRoster(), app.net.roomCode);
  } catch (error) {
    setEntryMessage(error?.message || '无法建立房间。');
    setNetworkStatus('未连接', 'offline');
    app.net?.close();
    app.net = null;
  } finally {
    dom.createRoom.disabled = false;
  }
}

async function joinRoom() {
  setEntryMessage('');
  dom.joinRoom.disabled = true;
  try {
    configureNetwork();
    await app.net.joinRoom(dom.roomCode.value, playerName());
    renderLobby(app.net.getRoster(), app.net.roomCode);
  } catch (error) {
    setEntryMessage(error?.message || '无法加入房间。');
    setNetworkStatus('未连接', 'offline');
    app.net?.close();
    app.net = null;
  } finally {
    dom.joinRoom.disabled = false;
  }
}

function addFeed(shooter, target, weaponId) {
  const entry = document.createElement('div');
  entry.className = 'feed-entry';
  const actor = document.createElement('strong');
  actor.textContent = shooter;
  const rule = document.createElement('span');
  rule.textContent = (WEAPONS[weaponId]?.name ?? weaponId ?? '—').toUpperCase();
  const victim = document.createElement('strong');
  victim.textContent = target;
  entry.append(actor, rule, victim);
  dom.feed.prepend(entry);
  while (dom.feed.children.length > 4) {
    dom.feed.lastElementChild.remove();
  }
  window.setTimeout(() => entry.remove(), 5200);
}

function consumeGameEvent(event) {
  if (!event || app.seenEvents.has(event.id)) {
    return;
  }
  app.seenEvents.add(event.id);
  if (event.type === 'kill') {
    addFeed(event.shooterName || '未知', event.targetName || '目标', event.weapon);
  }
  app.scene?.addGameEffect(event);
  if (app.seenEvents.size > 800) {
    app.seenEvents.clear();
  }
}

function syncWeaponButtons(weaponId) {
  for (const button of dom.weaponButtons) {
    const selected = button.dataset.weapon === weaponId;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

function chooseWeapon(weaponId) {
  if (!WEAPONS[weaponId]) {
    return;
  }
  app.selectedWeapon = weaponId;
  syncWeaponButtons(weaponId);
  if (app.mode === 'practice' || app.mode === 'host') {
    const local = app.gameState?.players.find(
      (player) => player.id === app.localPlayerId,
    );
    if (local) {
      local.weapon = weaponId;
      local.pointerDown = false;
      local.aimStartedAt = 0;
      local.reloadEnd = 0;
      local.reloadWeapon = null;
    }
  }
}

function requestReload() {
  app.reloadRequested = true;
}

function updateScoreboard(ranking, local) {
  const signature = ranking
    .map(
      (player) =>
        `${player.id}:${player.name}:${player.score ?? 0}:${player.kills ?? 0}:${player.deaths ?? 0}:${player.alive}`,
    )
    .join('|');
  if (signature === app.scoreboardSignature) {
    return;
  }
  app.scoreboardSignature = signature;
  dom.scoreboard.replaceChildren();
  ranking.forEach((player, index) => {
    const row = document.createElement('li');
    row.classList.toggle('is-dead', !player.alive);
    const place = document.createElement('span');
    place.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.textContent = player.name;
    const score = document.createElement('strong');
    score.textContent = String(player.score ?? 0).padStart(2, '0');
    if (player.id !== local.id) {
      score.style.color = 'var(--red)';
    }
    row.append(place, name, score);
    dom.scoreboard.append(row);
  });
}

function updateHud(players, now) {
  const local =
    players.find((player) => player.id === app.localPlayerId) ?? players[0] ?? null;
  app.latestVisualPlayers = players;
  app.latestLocalPlayer = local;

  if (!local) {
    return;
  }

  const state = app.gameState;
  const standby = app.view === 'entry' || app.view === 'lobby';
  const timeLeft = standby ? MATCH_SECONDS : state?.timeLeft ?? MATCH_SECONDS;
  const seconds = Math.max(0, Math.ceil(timeLeft));
  dom.matchClock.textContent = `${String(Math.floor(seconds / 60)).padStart(
    2,
    '0',
  )}:${String(seconds % 60).padStart(2, '0')}`;
  dom.matchState.textContent = standby
    ? '待命'
    : app.menuOpen && app.mode === 'practice'
      ? '暂停'
      : state?.status === 'ended'
        ? '对局结束'
        : '交战中';

  const standbyRoster = standby
    ? app.net?.getRoster().map((player, index) => ({
        ...player,
        health: 100,
        alive: true,
        weapon: 'pistol',
        ammo: WEAPONS.pistol.magazine,
        score: 0,
        kills: 0,
        deaths: 0,
        slot: index,
      })) ?? players.map((player) => ({ ...player, score: 0, kills: 0, deaths: 0 }))
    : players;
  const ranking = [...standbyRoster].sort(
    (a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths,
  );
  const opponentScore = Math.max(
    0,
    ...players.filter((player) => player.id !== local.id).map((player) => player.score),
  );
  dom.blueScore.textContent = standby
    ? '00'
    : String(local.score ?? 0).padStart(2, '0');
  dom.redScore.textContent = standby
    ? '00'
    : String(opponentScore).padStart(2, '0');
  dom.scoreProgress.textContent = standby
    ? `00 / ${SCORE_LIMIT}`
    : `${String(local.score ?? 0).padStart(2, '0')} / ${SCORE_LIMIT}`;
  dom.healthValue.textContent = String(Math.max(0, Math.round(local.health)));
  dom.healthFill.style.width = `${Math.max(0, local.health)}%`;
  dom.app.dataset.danger = local.health <= 30 ? 'true' : 'false';
  const stamina = Math.max(0, Math.round(local.stamina ?? 100));
  const slideCooldown = Math.max(0, local.slideCooldownRemaining ?? 0);
  const staminaCost = WEAPONS[local.weapon]?.staminaCost ?? 0;
  dom.staminaValue.textContent = String(stamina);
  dom.staminaFill.style.width = `${stamina}%`;
  dom.app.dataset.stamina = stamina <= 20 ? 'low' : 'normal';
  dom.staminaState.textContent = local.sliding
    ? '滑铲中'
    : local.sprinting
      ? '疾跑消耗'
      : slideCooldown > 0
        ? `滑铲 ${(slideCooldown / 1000).toFixed(1)}s`
        : staminaCost > 0 && stamina < staminaCost
          ? '体力不足'
          : '体力 / 滑铲就绪';
  dom.playerCallsign.textContent = standby
    ? '等待入场'
    : `${local.name} / ${
        app.mode === 'client' ? '访客' : app.mode === 'host' ? '房主' : '本地'
      }`;

  const weapon = WEAPONS[local.weapon] ?? WEAPONS.pistol;
  dom.ammoValue.textContent = String(local.ammo ?? weapon.magazine).padStart(2, '0');
  dom.ammoMax.textContent = String(weapon.magazine).padStart(2, '0');
  const reloadRemaining = local.reloadRemaining ?? 0;
  dom.reloadLabel.textContent =
    reloadRemaining > 0 ? `RELOAD ${(reloadRemaining / 1000).toFixed(1)}S` : 'READY';
  dom.reloadLabel.style.color =
    reloadRemaining > 0 ? 'var(--amber)' : 'var(--green)';

  const aimMs = local.pointerDown
    ? (local.aimMs ?? 0) + (app.mode === 'client' ? now - app.snapshotReceivedAt : 0)
    : 0;
  const bloom = local.bloom ?? local.mgBloom ?? 0;
  const aim = getAimStats(local.weapon, aimMs, local.pointerDown, bloom);
  dom.spreadValue.textContent = `${(aim.spread * (180 / Math.PI)).toFixed(1)}°`;
  dom.focusFill.style.width = `${Math.round(
    (local.weapon === 'mg' ? Math.min(1, bloom / 40) : aim.charge) * 100,
  )}%`;
  dom.focusLabel.textContent = local.pointerDown
    ? weapon.trigger === 'hold'
      ? stamina >= staminaCost
        ? '散布累积'
        : '体力不足'
      : staminaCost > 0 && stamina < staminaCost
        ? '体力不足'
        : aim.charge >= 0.98
        ? '弹道锁定'
        : '正在校准'
    : local.weapon === 'mg' && bloom > 0.05
      ? '散布回收'
      : '按住鼠标';

  if (app.mode !== 'client') {
    app.selectedWeapon = local.weapon;
  }
  syncWeaponButtons(local.weapon);

  updateScoreboard(ranking, local);

  const showRespawn = !local.alive && state?.status !== 'ended';
  dom.respawn.classList.toggle('is-hidden', !showRespawn);
  if (showRespawn) {
    dom.respawnCount.textContent = ((local.respawnRemaining ?? 0) / 1000).toFixed(1);
  }

  if (!standby && state?.status === 'ended') {
    showMatchEnd(state, players);
  }
}

function showMatchEnd(state, players) {
  if (app.endedShown) {
    return;
  }
  closePause();
  app.endedShown = true;
  const ranking = [...players].sort(
    (a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths,
  );
  const winner = players.find((player) => player.id === state.winner) ?? ranking[0];
  const localWon = winner?.id === app.localPlayerId;
  dom.endTitle.textContent = localWon ? '校准完成' : '对局结束';
  dom.endSummary.textContent = winner
    ? `${winner.name} 以 ${winner.score ?? winner.kills ?? 0} 次击杀取得领先。重新入场前可以换一把武器。`
    : '本轮没有有效记录。';
  dom.restart.disabled = app.mode === 'client';
  dom.restart.textContent = app.mode === 'client' ? '等待房主重开' : '再来一局';
  dom.returnLobby.textContent =
    app.mode === 'practice' ? '返回入口' : app.mode === 'client' ? '退出房间' : '返回房间';
  dom.endPanel.classList.remove('is-hidden');
  app.view = 'ended';
  dom.app.dataset.view = 'ended';
}

function restartMatch() {
  if (app.mode === 'practice') {
    beginLocalPractice();
    return;
  }
  if (app.mode === 'host') {
    beginHostMatch();
  }
}

function leaveAfterMatch() {
  if (app.mode === 'host') {
    app.net.returnToLobby();
    dom.endPanel.classList.add('is-hidden');
    renderLobby(app.net.getRoster(), app.net.roomCode);
    return;
  }
  returnToEntry();
}

function inputFromScene(scene) {
  const active =
    app.view === 'game' &&
    !app.menuOpen &&
    app.gameState?.status === 'playing' &&
    document.activeElement?.tagName !== 'INPUT';
  const local =
    app.scene?.currentPlayers?.find((player) => player.id === app.localPlayerId) ??
    app.gameState?.players.find((player) => player.id === app.localPlayerId);
  if (!active || !local?.alive) {
    return {
      up: false,
      down: false,
      left: false,
      right: false,
      pointerDown: false,
      cancel: app.menuOpen,
      sprint: false,
      slide: false,
      reload: false,
      targetX: local?.x ?? WORLD.width / 2,
      targetY: local?.y ?? WORLD.height / 2,
      weapon: app.selectedWeapon,
    };
  }

  const keys = scene.keys;
  if (Phaser.Input.Keyboard.JustDown(keys.one)) {
    chooseWeapon('pistol');
  }
  if (Phaser.Input.Keyboard.JustDown(keys.two)) {
    chooseWeapon('sniper');
  }
  if (Phaser.Input.Keyboard.JustDown(keys.three)) {
    chooseWeapon('mg');
  }
  if (Phaser.Input.Keyboard.JustDown(keys.reload)) {
    requestReload();
  }
  if (Phaser.Input.Keyboard.JustDown(keys.slide)) {
    app.slideLatchUntil = performance.now() + 180;
  }

  const pointer = scene.input.activePointer;
  const targetX = Phaser.Math.Clamp(pointer.worldX, 0, WORLD.width);
  const targetY = Phaser.Math.Clamp(pointer.worldY, 0, WORLD.height);
  const input = {
    up: keys.up.isDown,
    down: keys.down.isDown,
    left: keys.left.isDown,
    right: keys.right.isDown,
    pointerDown: pointer.isDown && !app.forcePointerUp,
    cancel: false,
    sprint: keys.sprint.isDown,
    slide: performance.now() < app.slideLatchUntil,
    reload: app.reloadRequested,
    targetX,
    targetY,
    weapon: app.selectedWeapon,
  };
  app.reloadRequested = false;
  return input;
}

function processNetworkedInput(scene) {
  app.localInput = inputFromScene(scene);
  if (app.mode !== 'practice' && app.mode !== 'host' && app.mode !== 'client') {
    return;
  }
  if (app.mode === 'client') {
    return;
  }
  setInput(app.gameState, app.localPlayerId, app.localInput);
  for (const [playerId, input] of app.remoteInputs) {
    setInput(app.gameState, playerId, input);
  }
}

function processNetworkSending(deltaMs) {
  app.networkSendAccumulator += deltaMs;
  if (app.networkSendAccumulator < 40) {
    return;
  }
  app.networkSendAccumulator = 0;
  if (app.mode === 'client' && app.net) {
    app.net.sendInput(app.localInput);
  }
}

class ArenaScene extends Phaser.Scene {
  constructor() {
    super('arena');
    this.fixedAccumulator = 0;
    this.snapshotAccumulator = 0;
    this.effects = [];
    this.labels = new Map();
    this.currentPlayers = [];
    this.smoothedPlayers = new Map();
  }

  create() {
    app.scene = this;
    this.staticObjects = [];
    this.currentMapId = null;
    this.setMap(app.gameState?.mapId ?? app.selectedMapId);
    this.dynamicGraphics = this.add.graphics().setDepth(8);
    this.effectGraphics = this.add.graphics().setDepth(10);
    this.reticleGraphics = this.add.graphics().setDepth(12);
    this.fogMaskGraphics = this.make.graphics({ add: false });
    this.fogMask = this.fogMaskGraphics.createGeometryMask();
    this.fogMask.invertAlpha = true;
    this.fog = this.add
      .rectangle(0, 0, WORLD.width, WORLD.height, 0x030606, 0.8)
      .setOrigin(0)
      .setDepth(16)
      .setMask(this.fogMask)
      .setVisible(false);
    this.keys = this.input.keyboard.addKeys({
      up: 'W',
      down: 'S',
      left: 'A',
      right: 'D',
      one: 'ONE',
      two: 'TWO',
      three: 'THREE',
      reload: 'R',
      sprint: Phaser.Input.Keyboard.KeyCodes.CTRL,
      slide: Phaser.Input.Keyboard.KeyCodes.SPACE,
    });

    window.addEventListener('pointerup', () => {
      app.forcePointerUp = true;
    });
    window.addEventListener('pointerdown', (event) => {
      if (event.target?.tagName === 'CANVAS') {
        app.forcePointerUp = false;
      }
    });
    this.input.on('pointerdown', () => {
      app.forcePointerUp = false;
    });
    this.game.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  update(_time, delta) {
    processNetworkedInput(this);
    processNetworkSending(delta);

    if (app.mode === 'host' && app.gameState?.status === 'playing') {
      this.fixedAccumulator += delta;
      while (this.fixedAccumulator >= 1000 / 30) {
        updateSimulation(app.gameState, 1 / 30, performance.now());
        this.fixedAccumulator -= 1000 / 30;
      }
      this.snapshotAccumulator += delta;
      if (this.snapshotAccumulator >= 50) {
        this.snapshotAccumulator = 0;
        app.net?.sendSnapshot(makeSnapshot(app.gameState, performance.now()));
      }
    } else if (
      app.mode === 'practice' &&
      !app.menuOpen &&
      app.gameState?.status === 'playing'
    ) {
      this.fixedAccumulator += delta;
      while (this.fixedAccumulator >= 1000 / 30) {
        updateSimulation(app.gameState, 1 / 30, performance.now());
        this.fixedAccumulator -= 1000 / 30;
      }
    }

    this.currentPlayers = this.buildVisualPlayers();
    if (app.gameState?.mapId && app.gameState.mapId !== this.currentMapId) {
      this.setMap(app.gameState.mapId);
    }
    if (app.view === 'game') {
      for (const event of this.eventsForCurrentState()) {
        consumeGameEvent(event);
      }
    }
    this.drawDynamicFrame(this.currentPlayers, performance.now());
    this.drawEffects(performance.now());

    app.hudAccumulator += delta;
    if (app.hudAccumulator >= 80) {
      app.hudAccumulator = 0;
      updateHud(this.currentPlayers, performance.now());
    }
  }

  resetInterpolation() {
    this.smoothedPlayers.clear();
    this.fixedAccumulator = 0;
    this.snapshotAccumulator = 0;
    this.effects.length = 0;
  }

  resetFixedClock() {
    this.fixedAccumulator = 0;
    this.snapshotAccumulator = 0;
  }

  eventsForCurrentState() {
    if (app.mode === 'client') {
      return app.snapshot?.events ?? [];
    }
    return app.gameState?.events ?? [];
  }

  buildVisualPlayers() {
    if (app.mode !== 'client') {
      return (app.gameState?.players ?? []).map((player) => ({
        ...player,
        aimMs: player.pointerDown
          ? Math.max(0, performance.now() - player.aimStartedAt)
          : 0,
        hitRemaining: Math.max(0, player.hitUntil - performance.now()),
        respawnRemaining: Math.max(0, player.respawnAt - performance.now()),
        reloadRemaining: Math.max(0, player.reloadEnd - performance.now()),
        sliding: performance.now() < player.slideUntil,
        slideCooldownRemaining: Math.max(
          0,
          player.slideCooldownEnd - performance.now(),
        ),
        ammo: player.ammo[player.weapon],
        bloom: player.mgBloom,
      }));
    }

    const source = app.snapshot?.players ?? [];
    const currentIds = new Set(source.map((player) => player.id));
    for (const id of this.smoothedPlayers.keys()) {
      if (!currentIds.has(id)) {
        this.smoothedPlayers.delete(id);
      }
    }
    return source.map((target) => {
      let display = this.smoothedPlayers.get(target.id);
      if (!display) {
        display = { ...target };
        this.smoothedPlayers.set(target.id, display);
      } else {
        const blend = target.id === app.localPlayerId ? 0.28 : 0.2;
        display.x += (target.x - display.x) * blend;
        display.y += (target.y - display.y) * blend;
        Object.assign(display, target, { x: display.x, y: display.y });
      }
      return {
        ...display,
        aimMs:
          (target.aimMs ?? 0) +
          (target.pointerDown ? performance.now() - app.snapshotReceivedAt : 0),
        hitRemaining: target.hitUntil ?? 0,
        respawnRemaining: target.respawnRemaining ?? 0,
      };
    });
  }

  isPlayerVisible(player, observer) {
    if (!player || !observer?.alive) {
      return false;
    }
    if (player.id === observer.id) {
      return true;
    }
    if (
      !isPointInVision(
        observer.x,
        observer.y,
        observer.angle,
        player.x,
        player.y,
      )
    ) {
      return false;
    }

    const map = getMapDefinition(this.currentMapId);
    const distance = Math.hypot(player.x - observer.x, player.y - observer.y);
    const angle = Math.atan2(player.y - observer.y, player.x - observer.x);
    const ray = traceRay(
      observer.x,
      observer.y,
      angle,
      distance,
      map.obstacles,
      {
        left: WORLD.padding,
        right: WORLD.width - WORLD.padding,
        top: WORLD.padding,
        bottom: WORLD.playBottom,
      },
    );
    return ray.distance + PLAYER_RADIUS >= distance;
  }

  addGameEffect(event) {
    const now = performance.now();
    if (event.type === 'shot') {
      this.effects.push({
        type: 'shot',
        shooter: event.shooter,
        x1: event.x,
        y1: event.y,
        x2: event.endX,
        y2: event.endY,
        weapon: event.weapon,
        until: now + (event.weapon === 'sniper' ? 150 : 85),
      });
    } else if (event.type === 'impact') {
      this.effects.push({
        type: 'impact',
        shooter: event.shooter,
        x: event.x,
        y: event.y,
        until: now + 180,
      });
    } else if (event.type === 'hit') {
      this.effects.push({
        type: 'damage',
        shooter: event.shooter,
        x: event.x,
        y: event.y,
        text: `-${event.damage}`,
        until: now + 560,
      });
      this.effects.push({
        type: 'impact',
        shooter: event.shooter,
        x: event.x,
        y: event.y,
        until: now + 180,
      });
    }
  }

  setMap(mapId) {
    const map = getMapDefinition(mapId);
    if (this.currentMapId === map.id && this.staticObjects?.length) {
      return;
    }

    for (const object of this.staticObjects ?? []) {
      object.destroy();
    }
    this.staticObjects = [];
    this.currentMapId = map.id;
    this.cameras.main.setBackgroundColor(map.palette.background);

    const textureKey = `arena-${map.id}`;
    if (!this.textures.exists(textureKey)) {
      const graphics = this.make.graphics({ x: 0, y: 0, add: false });
      this.drawArenaBase(graphics, map);
      for (const decoration of map.decorations) {
        this.drawMapDecoration(graphics, map, decoration);
      }
      for (const obstacle of map.obstacles) {
        this.drawMapObstacle(graphics, map, obstacle);
      }
      for (const spawn of map.spawns) {
        graphics.lineStyle(1, map.palette.rule, 0.18);
        graphics.strokeCircle(spawn.x, spawn.y, 38);
        graphics.lineBetween(spawn.x - 50, spawn.y, spawn.x + 50, spawn.y);
        graphics.lineBetween(spawn.x, spawn.y - 50, spawn.x, spawn.y + 50);
      }
      graphics.generateTexture(textureKey, WORLD.width, WORLD.height);
      graphics.destroy();
    }
    const arena = this.add.image(0, 0, textureKey).setOrigin(0).setDepth(0);
    this.staticObjects.push(arena);
    for (const obstacle of map.obstacles) {
      this.addStaticText(
        obstacle.x + 9,
        obstacle.y + 7,
        obstacle.label,
        '#d8d0b6',
        10,
      );
    }

    this.addStaticText(
      86,
      78,
      `${map.site}  /  ${map.name.toUpperCase()}`,
      '#a9a596',
      12,
      'JetBrains Mono',
    );
    this.addStaticText(
      1194,
      WORLD.playBottom - 48,
      'NORTH / 046',
      '#a9a596',
      12,
    );
    this.addStaticText(
      750,
      470,
      map.centerLabel,
      '#efe7d3',
      30,
      'Barlow Condensed',
    )
      .setOrigin(0.5)
      .setAlpha(0.18);

    this.visibilityPolygon = [];
    this.lastFogAt = 0;
    this.lastFogX = Number.NaN;
    this.lastFogY = Number.NaN;
    this.lastFogAngle = Number.NaN;
  }

  drawArenaBase(graphics, map) {
    const palette = map.palette;
    const playableWidth = WORLD.width - 92;
    const playableHeight = WORLD.playBottom - 46;

    graphics.fillStyle(palette.background, 1);
    graphics.fillRect(0, 0, WORLD.width, WORLD.height);
    graphics.fillStyle(palette.field, 1);
    graphics.fillRect(46, 46, playableWidth, playableHeight);

    graphics.fillStyle(palette.fieldAlt, 0.8);
    graphics.fillRect(46, 432, 1508, 136);
    graphics.lineStyle(3, palette.rule, 0.56);
    graphics.strokeRect(46, 46, playableWidth, playableHeight);
    graphics.lineStyle(1, palette.rule, 0.16);
    graphics.strokeRect(59, 59, WORLD.width - 118, WORLD.playBottom - 118);

    for (let x = 100; x < WORLD.width - 50; x += 80) {
      graphics.lineStyle(1, palette.grid, 0.055);
      graphics.lineBetween(x, 64, x, WORLD.playBottom - 18);
    }
    for (let y = 100; y < WORLD.playBottom - 50; y += 80) {
      graphics.lineStyle(1, palette.grid, 0.055);
      graphics.lineBetween(64, y, WORLD.width - 64, y);
    }

    if (map.id === 'harbor') {
      graphics.fillStyle(palette.wet, 0.28);
      graphics.fillRect(46, 318, 1508, 366);
    } else if (map.id === 'dunes') {
      graphics.fillStyle(palette.wet, 0.32);
      graphics.fillRect(46, 534, 1508, 136);
    }

    graphics.lineStyle(2, palette.accent, 0.24);
    graphics.strokeCircle(800, 500, 92);
    graphics.strokeCircle(800, 500, 108);
    graphics.lineBetween(658, 500, 778, 500);
    graphics.lineBetween(822, 500, 942, 500);
  }

  drawMapDecoration(graphics, map, decoration) {
    const palette = map.palette;
    if (decoration.type === 'lane') {
      graphics.lineStyle(2, palette.accent, 0.2);
      graphics.lineBetween(
        decoration.x,
        decoration.y,
        decoration.x + decoration.w,
        decoration.y,
      );
      return;
    }
    if (decoration.type === 'pipe') {
      graphics.fillStyle(palette.obstacle, 0.34);
      graphics.fillRoundedRect(
        decoration.x,
        decoration.y,
        decoration.w,
        decoration.h,
        4,
      );
      graphics.lineStyle(1, palette.accent, 0.34);
      graphics.strokeRoundedRect(
        decoration.x,
        decoration.y,
        decoration.w,
        decoration.h,
        4,
      );
      for (let x = decoration.x + 36; x < decoration.x + decoration.w; x += 112) {
        graphics.strokeCircle(x, decoration.y + decoration.h / 2, 7);
      }
      return;
    }
    if (decoration.type === 'hatch') {
      graphics.lineStyle(2, palette.marking, 0.22);
      for (let offset = -decoration.h; offset < decoration.w; offset += 16) {
        graphics.lineBetween(
          decoration.x + Math.max(0, offset),
          decoration.y + decoration.h,
          decoration.x + Math.min(decoration.w, offset + decoration.h),
          decoration.y,
        );
      }
      return;
    }
    if (decoration.type === 'vent') {
      graphics.lineStyle(2, palette.grid, 0.2);
      for (let x = decoration.x + 12; x < decoration.x + decoration.w; x += 14) {
        graphics.lineBetween(x, decoration.y + 7, x, decoration.y + decoration.h - 7);
      }
      return;
    }
    if (decoration.type === 'dock') {
      graphics.fillStyle(palette.fieldAlt, 0.62);
      graphics.fillRect(
        decoration.x,
        decoration.y,
        decoration.w,
        decoration.h,
      );
      graphics.lineStyle(1, palette.grid, 0.16);
      for (let x = decoration.x; x <= decoration.x + decoration.w; x += 54) {
        graphics.lineBetween(x, decoration.y, x, decoration.y + decoration.h);
      }
      return;
    }
    if (decoration.type === 'puddle') {
      graphics.fillStyle(palette.wet, 0.65);
      graphics.fillEllipse(
        decoration.x + decoration.w / 2,
        decoration.y + decoration.h / 2,
        decoration.w,
        decoration.h,
      );
      graphics.lineStyle(1, palette.accent, 0.18);
      graphics.strokeEllipse(
        decoration.x + decoration.w / 2,
        decoration.y + decoration.h / 2,
        decoration.w,
        decoration.h,
      );
      return;
    }
    if (decoration.type === 'mooring') {
      graphics.lineStyle(2, palette.marking, 0.3);
      graphics.strokeRoundedRect(
        decoration.x,
        decoration.y,
        decoration.w,
        decoration.h,
        12,
      );
      graphics.lineBetween(
        decoration.x + 16,
        decoration.y + decoration.h / 2,
        decoration.x + decoration.w - 16,
        decoration.y + decoration.h / 2,
      );
      return;
    }
    if (decoration.type === 'dune') {
      graphics.fillStyle(palette.fieldAlt, 0.33);
      graphics.fillEllipse(
        decoration.x + decoration.w / 2,
        decoration.y + decoration.h / 2,
        decoration.w,
        decoration.h,
      );
      graphics.lineStyle(1, palette.accent, 0.16);
      graphics.strokeEllipse(
        decoration.x + decoration.w / 2,
        decoration.y + decoration.h / 2,
        decoration.w - 20,
        decoration.h - 18,
      );
      return;
    }
    if (decoration.type === 'crack') {
      graphics.lineStyle(2, palette.obstacleEdge, 0.22);
      graphics.beginPath();
      graphics.moveTo(decoration.x, decoration.y + 14);
      graphics.lineTo(decoration.x + 54, decoration.y + 44);
      graphics.lineTo(decoration.x + 96, decoration.y + 24);
      graphics.lineTo(decoration.x + 140, decoration.y + 56);
      graphics.lineTo(decoration.x + decoration.w, decoration.y + 30);
      graphics.strokePath();
      return;
    }
    if (decoration.type === 'dish') {
      graphics.lineStyle(2, palette.accent, 0.32);
      graphics.strokeCircle(
        decoration.x + decoration.w / 2,
        decoration.y + decoration.h / 2,
        decoration.w / 2,
      );
      graphics.lineBetween(
        decoration.x + decoration.w / 2,
        decoration.y,
        decoration.x + decoration.w / 2,
        decoration.y + decoration.h,
      );
      return;
    }
    if (decoration.type === 'wind') {
      graphics.lineStyle(2, palette.accent, 0.14);
      for (let offset = 0; offset < decoration.w; offset += 46) {
        graphics.lineBetween(
          decoration.x + offset,
          decoration.y,
          decoration.x + offset + 26,
          decoration.y,
        );
      }
    }
  }

  drawMapObstacle(graphics, map, obstacle) {
    const palette = map.palette;
    graphics.fillStyle(0x050908, 0.46);
    graphics.fillRoundedRect(
      obstacle.x + 8,
      obstacle.y + 9,
      obstacle.w,
      obstacle.h,
      4,
    );
    graphics.fillStyle(palette.obstacle, 1);
    graphics.fillRoundedRect(
      obstacle.x,
      obstacle.y,
      obstacle.w,
      obstacle.h,
      obstacle.style === 'rock' || obstacle.style === 'ridge' ? 16 : 3,
    );
    graphics.lineStyle(2, palette.obstacleEdge, 0.5);
    graphics.strokeRoundedRect(
      obstacle.x,
      obstacle.y,
      obstacle.w,
      obstacle.h,
      obstacle.style === 'rock' || obstacle.style === 'ridge' ? 16 : 3,
    );
    graphics.fillStyle(palette.obstacleTop, 0.52);
    graphics.fillRect(
      obstacle.x + 6,
      obstacle.y + 6,
      Math.max(4, obstacle.w - 12),
      5,
    );

    if (obstacle.style === 'container' || obstacle.style === 'wreck') {
      graphics.lineStyle(1, palette.background, 0.52);
      for (let x = obstacle.x + 20; x < obstacle.x + obstacle.w; x += 28) {
        graphics.lineBetween(x, obstacle.y + 9, x, obstacle.y + obstacle.h - 9);
      }
      graphics.lineStyle(2, palette.marking, 0.44);
      graphics.lineBetween(
        obstacle.x + 8,
        obstacle.y + obstacle.h - 12,
        obstacle.x + obstacle.w - 8,
        obstacle.y + obstacle.h - 12,
      );
    } else if (obstacle.style === 'pipe') {
      graphics.lineStyle(2, palette.background, 0.55);
      graphics.lineBetween(
        obstacle.x + obstacle.w / 2,
        obstacle.y + 8,
        obstacle.x + obstacle.w / 2,
        obstacle.y + obstacle.h - 8,
      );
      graphics.lineStyle(1, palette.obstacleEdge, 0.45);
      graphics.strokeCircle(
        obstacle.x + obstacle.w / 2,
        obstacle.y + 18,
        13,
      );
      graphics.strokeCircle(
        obstacle.x + obstacle.w / 2,
        obstacle.y + obstacle.h - 18,
        13,
      );
    } else if (obstacle.style === 'furnace') {
      graphics.lineStyle(3, palette.accent, 0.35);
      graphics.strokeCircle(
        obstacle.x + obstacle.w / 2,
        obstacle.y + obstacle.h / 2,
        34,
      );
      graphics.lineBetween(
        obstacle.x + 18,
        obstacle.y + 20,
        obstacle.x + obstacle.w - 18,
        obstacle.y + 20,
      );
    } else if (obstacle.style === 'mast') {
      graphics.lineStyle(2, palette.accent, 0.4);
      graphics.strokeCircle(
        obstacle.x + obstacle.w / 2,
        obstacle.y + obstacle.h / 2,
        33,
      );
      graphics.lineBetween(
        obstacle.x + obstacle.w / 2,
        obstacle.y + 12,
        obstacle.x + obstacle.w / 2,
        obstacle.y + obstacle.h - 12,
      );
      graphics.lineBetween(
        obstacle.x + 12,
        obstacle.y + obstacle.h / 2,
        obstacle.x + obstacle.w - 12,
        obstacle.y + obstacle.h / 2,
      );
    } else if (obstacle.style === 'rock' || obstacle.style === 'ridge') {
      graphics.lineStyle(1, palette.background, 0.45);
      graphics.lineBetween(
        obstacle.x + 15,
        obstacle.y + 17,
        obstacle.x + obstacle.w - 18,
        obstacle.y + obstacle.h - 13,
      );
      graphics.lineBetween(
        obstacle.x + obstacle.w * 0.72,
        obstacle.y + 12,
        obstacle.x + obstacle.w * 0.42,
        obstacle.y + obstacle.h - 12,
      );
    } else if (obstacle.style === 'bollard') {
      graphics.lineStyle(2, palette.marking, 0.42);
      graphics.strokeCircle(
        obstacle.x + obstacle.w / 2,
        obstacle.y + 18,
        14,
      );
    } else {
      graphics.lineStyle(1, palette.background, 0.62);
      graphics.lineBetween(
        obstacle.x + 8,
        obstacle.y + 8,
        obstacle.x + obstacle.w - 8,
        obstacle.y + obstacle.h - 8,
      );
    }
  }

  addStaticText(x, y, text, color, size = 12, family = 'JetBrains Mono') {
    const label = this.add
      .text(x, y, text, {
        fontFamily: family,
        fontSize: `${size}px`,
        color,
      })
      .setDepth(2);
    this.staticObjects.push(label);
    return label;
  }

  drawDynamicFrame(players, now) {
    const graphics = this.dynamicGraphics;
    graphics.clear();

    const local = players.find((player) => player.id === app.localPlayerId);
    const visiblePlayers = players.filter((player) =>
      this.isPlayerVisible(player, local),
    );
    this.visiblePlayerIds = new Set(visiblePlayers.map((player) => player.id));
    const rosterIds = new Set(players.map((player) => player.id));
    for (const [id, label] of this.labels) {
      if (!rosterIds.has(id)) {
        label.destroy();
        this.labels.delete(id);
      } else if (!this.visiblePlayerIds.has(id)) {
        label.setVisible(false);
      }
    }
    for (const [id, label] of this.respawnLabels ?? []) {
      if (!rosterIds.has(id)) {
        label.destroy();
        this.respawnLabels.delete(id);
      } else if (!this.visiblePlayerIds.has(id)) {
        label.setVisible(false);
      }
    }

    for (const player of visiblePlayers) {
      if (player.alive && player.pointerDown) {
        this.drawAimCone(graphics, player, now);
      }
    }

    for (const player of visiblePlayers) {
      this.drawPlayer(graphics, player, now);
    }

    this.drawReticle(players);
    this.drawFog(players, now);
  }

  drawAimCone(graphics, player, now) {
    const aim = getAimStats(
      player.weapon,
      player.aimMs ?? 0,
      true,
      player.bloom ?? 0,
    );
    const weapon = WEAPONS[player.weapon];
    const local = player.id === app.localPlayerId;
    const color = local ? 0xf3c969 : 0xf05b3d;
    const range = aim.range;
    const halfSpread = aim.spread / 2;
    const map = getMapDefinition(this.currentMapId);
    const bounds = {
      left: WORLD.padding,
      right: WORLD.width - WORLD.padding,
      top: WORLD.padding,
      bottom: WORLD.playBottom,
    };
    const points = [{ x: player.x, y: player.y }];
    const segments = 20;
    for (let index = 0; index <= segments; index += 1) {
      const angle = player.angle - halfSpread + (aim.spread * index) / segments;
      const ray = traceRay(
        player.x,
        player.y,
        angle,
        range,
        map.obstacles,
        bounds,
      );
      points.push({ x: ray.x, y: ray.y });
    }

    graphics.fillStyle(color, local ? 0.09 : 0.055);
    graphics.fillPoints(points, true);
    graphics.lineStyle(1.5, color, local ? 0.55 : 0.3);
    graphics.strokePoints(points, true);

    const centerRay = traceRay(
      player.x,
      player.y,
      player.angle,
      range,
      map.obstacles,
      bounds,
    );
    graphics.lineStyle(2, color, 0.32);
    const dashLength = weapon.id === 'sniper' ? 24 : 18;
    for (
      let distance = 44;
      distance < centerRay.distance;
      distance += dashLength * 2
    ) {
      const x1 = player.x + Math.cos(player.angle) * distance;
      const y1 = player.y + Math.sin(player.angle) * distance;
      const x2 =
        player.x +
        Math.cos(player.angle) *
          Math.min(centerRay.distance, distance + dashLength);
      const y2 =
        player.y +
        Math.sin(player.angle) *
          Math.min(centerRay.distance, distance + dashLength);
      graphics.lineBetween(x1, y1, x2, y2);
    }

    if (weapon.id === 'sniper') {
      graphics.lineStyle(2, color, 0.9);
      graphics.beginPath();
      graphics.arc(
        player.x,
        player.y,
        29,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * aim.charge,
        false,
      );
      graphics.strokePath();
    }

    if (!reducedMotion && aim.charge >= 0.98) {
      const pulse = 2 + Math.sin(now * 0.01) * 2;
      graphics.lineStyle(1, 0xefe7d3, 0.58);
      graphics.strokeCircle(
        centerRay.x,
        centerRay.y,
        9 + pulse,
      );
    }
  }

  drawPlayer(graphics, player, now) {
    const local = player.id === app.localPlayerId;
    const color = local ? 0x4b8eff : player.isBot ? 0xf05b3d : 0xe58b4f;
    const alpha = player.alive ? 1 : 0.28;

    graphics.fillStyle(0x020606, 0.5);
    graphics.fillEllipse(player.x + 8, player.y + 10, 46, 24);

    if (!player.alive) {
      graphics.lineStyle(3, 0xefe7d3, 0.32);
      graphics.lineBetween(player.x - 15, player.y - 15, player.x + 15, player.y + 15);
      graphics.lineBetween(player.x + 15, player.y - 15, player.x - 15, player.y + 15);
    } else {
      const hit = player.hitRemaining > 0 || player.hitUntil > now;
      const directionX = Math.cos(player.angle);
      const directionY = Math.sin(player.angle);
      const perpendicularX = -directionY;
      const perpendicularY = directionX;
      const breathe =
        reducedMotion ? 0 : Math.sin(now * 0.005 + player.slot * 1.7) * 0.8;
      if (player.sliding) {
        graphics.lineStyle(9, color, 0.18);
        graphics.lineBetween(
          player.x - player.slideDirX * 34,
          player.y - player.slideDirY * 34,
          player.x,
          player.y,
        );
        graphics.lineStyle(2, color, 0.72);
        graphics.lineBetween(
          player.x - player.slideDirX * 28,
          player.y - player.slideDirY * 28,
          player.x - player.slideDirX * 7,
          player.y - player.slideDirY * 7,
        );
      } else if (player.sprinting) {
        const perpendicularX = Math.cos(player.angle + Math.PI / 2);
        const perpendicularY = Math.sin(player.angle + Math.PI / 2);
        graphics.lineStyle(1, 0xf3c969, 0.62);
        for (const offset of [-10, 0, 10]) {
          graphics.lineBetween(
            player.x - Math.cos(player.angle) * 27 + perpendicularX * offset,
            player.y - Math.sin(player.angle) * 27 + perpendicularY * offset,
            player.x - Math.cos(player.angle) * 15 + perpendicularX * offset,
            player.y - Math.sin(player.angle) * 15 + perpendicularY * offset,
          );
        }
      }

      const px = player.x;
      const py = player.y + breathe;
      const backX = px - directionX * 8;
      const backY = py - directionY * 8;
      const headX = px + directionX * 8;
      const headY = py + directionY * 8;

      graphics.fillStyle(0x07100f, 0.9);
      graphics.fillCircle(backX, backY, 12);
      graphics.lineStyle(1.5, color, 0.58);
      graphics.strokeCircle(backX, backY, 12);

      graphics.fillStyle(0x1b2524, 1);
      graphics.fillCircle(
        px + directionX * 1 + perpendicularX * 9,
        py + directionY * 1 + perpendicularY * 9,
        6,
      );
      graphics.fillCircle(
        px + directionX * 1 - perpendicularX * 9,
        py + directionY * 1 - perpendicularY * 9,
        6,
      );
      graphics.lineStyle(1, color, 0.8);
      graphics.strokeCircle(
        px + directionX * 1 + perpendicularX * 9,
        py + directionY * 1 + perpendicularY * 9,
        6,
      );
      graphics.strokeCircle(
        px + directionX * 1 - perpendicularX * 9,
        py + directionY * 1 - perpendicularY * 9,
        6,
      );

      graphics.fillStyle(hit ? 0xffffff : 0x263735, alpha);
      graphics.fillCircle(px, py, PLAYER_RADIUS);
      graphics.lineStyle(2.5, 0x06100e, 1);
      graphics.strokeCircle(px, py, PLAYER_RADIUS + 2);
      graphics.lineStyle(1, color, 0.88);
      graphics.strokeCircle(px, py, PLAYER_RADIUS + 5);

      const weaponLength =
        player.weapon === 'sniper' ? 36 : player.weapon === 'mg' ? 30 : 21;
      const muzzleX = px + directionX * weaponLength;
      const muzzleY = py + directionY * weaponLength;
      graphics.lineStyle(
        player.weapon === 'mg' ? 6 : player.weapon === 'sniper' ? 5 : 4,
        0x07100f,
        0.96,
      );
      graphics.lineBetween(
        px + directionX * 6,
        py + directionY * 6,
        muzzleX,
        muzzleY,
      );
      graphics.lineStyle(2, player.weapon === 'sniper' ? 0xf3c969 : 0xb8b29f, 0.8);
      graphics.lineBetween(
        px + directionX * 9,
        py + directionY * 9,
        muzzleX,
        muzzleY,
      );

      graphics.fillStyle(0xe8dec6, 1);
      graphics.fillCircle(headX, headY, 9);
      graphics.lineStyle(1.5, 0x07100f, 0.95);
      graphics.strokeCircle(headX, headY, 9);
      graphics.fillStyle(color, 1);
      graphics.fillTriangle(
        headX + directionX * 9,
        headY + directionY * 9,
        headX + perpendicularX * 5 - directionX * 1,
        headY + perpendicularY * 5 - directionY * 1,
        headX - perpendicularX * 5 - directionX * 1,
        headY - perpendicularY * 5 - directionY * 1,
      );

      if (player.weapon === 'sniper') {
        graphics.lineStyle(1, 0xf3c969, 0.62);
        graphics.lineBetween(
          px + perpendicularX * 8,
          py + perpendicularY * 8,
          px - perpendicularX * 8,
          py - perpendicularY * 8,
        );
      } else if (player.weapon === 'mg') {
        graphics.fillStyle(0xf3c969, 0.8);
        graphics.fillCircle(
          px - directionX * 2 + perpendicularX * 10,
          py - directionY * 2 + perpendicularY * 10,
          3,
        );
      }
    }

    const label = this.ensureLabel(player.id);
    label.setText(player.name);
    const labelAbove = player.y > WORLD.playBottom - 72;
    label.setPosition(player.x, player.y + (labelAbove ? -52 : 29));
    label.setAlpha(player.alive ? 1 : 0.45);
    label.setVisible(true);
    const healthWidth = 44;
    graphics.fillStyle(0x030706, 0.82);
    graphics.fillRect(player.x - healthWidth / 2, player.y - 31, healthWidth, 5);
    graphics.fillStyle(player.health > 30 ? color : 0xf05b3d, 1);
    graphics.fillRect(
      player.x - healthWidth / 2,
      player.y - 31,
      healthWidth * Math.max(0, player.health) / 100,
      5,
    );

    if (!player.alive && player.respawnRemaining > 0) {
      const respawnLabel = this.ensureRespawnLabel(player.id);
      respawnLabel.setText(`${(player.respawnRemaining / 1000).toFixed(1)}S`);
      respawnLabel.setPosition(player.x, player.y + (labelAbove ? -18 : 45));
      respawnLabel.setVisible(true);
    } else {
      this.respawnLabels?.get(player.id)?.setVisible(false);
    }
  }

  ensureLabel(id) {
    if (!this.labels.has(id)) {
      this.labels.set(
        id,
        this.add
          .text(0, 0, '', {
            fontFamily: 'Barlow Condensed',
            fontStyle: 'bold',
            fontSize: '16px',
            color: '#efe7d3',
            align: 'center',
          })
          .setOrigin(0.5, 0)
          .setDepth(11),
      );
    }
    return this.labels.get(id);
  }

  ensureRespawnLabel(id) {
    if (!this.respawnLabels) {
      this.respawnLabels = new Map();
    }
    if (!this.respawnLabels.has(id)) {
      this.respawnLabels.set(
        id,
        this.add
          .text(0, 0, '', {
            fontFamily: 'JetBrains Mono',
            fontSize: '11px',
            color: '#f3c969',
            align: 'center',
          })
          .setOrigin(0.5, 0)
          .setDepth(11),
      );
    }
    return this.respawnLabels.get(id);
  }

  drawReticle(players) {
    const graphics = this.reticleGraphics;
    graphics.clear();
    if (app.view !== 'game') {
      return;
    }
    const local = players.find((player) => player.id === app.localPlayerId);
    if (!local?.alive) {
      return;
    }
    const pointer = this.input.activePointer;
    const x = pointer.worldX;
    const y = pointer.worldY;
    const aim = getAimStats(
      local.weapon,
      local.aimMs ?? 0,
      local.pointerDown,
      local.bloom ?? 0,
    );
    const radius = 7 + aim.spread * 22;
    graphics.lineStyle(1, 0xf3c969, 0.9);
    graphics.strokeCircle(x, y, radius);
    graphics.lineBetween(x - radius - 7, y, x - radius + 3, y);
    graphics.lineBetween(x + radius - 3, y, x + radius + 7, y);
    graphics.lineBetween(x, y - radius - 7, x, y - radius + 3);
    graphics.lineBetween(x, y + radius - 3, x, y + radius + 7);
  }

  drawFog(players, now) {
    if (app.view !== 'game') {
      this.fog.setVisible(false);
      this.visibilityPolygon = [];
      return;
    }

    const local = players.find((player) => player.id === app.localPlayerId);
    if (!local?.alive) {
      this.fog.setVisible(false);
      this.visibilityPolygon = [];
      this.lastFogAt = 0;
      return;
    }

    const moved = Math.hypot(
      local.x - (this.lastFogX ?? Number.NaN),
      local.y - (this.lastFogY ?? Number.NaN),
    );
    const turned = Math.abs(
      Math.atan2(
        Math.sin(local.angle - (this.lastFogAngle ?? Number.NaN)),
        Math.cos(local.angle - (this.lastFogAngle ?? Number.NaN)),
      ),
    );
    const needsRebuild =
      !this.visibilityPolygon?.length ||
      moved > 0.8 ||
      turned > 0.004 ||
      now - (this.lastFogAt ?? 0) >= 33;
    if (!needsRebuild) {
      return;
    }

    const map = getMapDefinition(this.currentMapId);
    const bounds = {
      left: WORLD.padding,
      right: WORLD.width - WORLD.padding,
      top: WORLD.padding,
      bottom: WORLD.playBottom,
    };
    this.visibilityPolygon = buildVisibilityPolygon({
      originX: local.x,
      originY: local.y,
      facing: local.angle,
      obstacles: map.obstacles,
      bounds,
      rays: 64,
    });

    this.fogMaskGraphics.clear();
    this.fogMaskGraphics.fillStyle(0xffffff, 1);
    this.fogMaskGraphics.fillPoints(this.visibilityPolygon, true);
    this.fog.setVisible(true);
    this.lastFogAt = now;
    this.lastFogX = local.x;
    this.lastFogY = local.y;
    this.lastFogAngle = local.angle;
  }

  drawEffects(now) {
    const graphics = this.effectGraphics;
    graphics.clear();
    for (const effect of this.effects) {
      if (effect.until <= now) {
        effect.label?.destroy();
      }
    }
    this.effects = this.effects.filter((effect) => effect.until > now);
    const damageLabels = this.effects.filter((effect) => effect.type === 'damage');
    for (const effect of this.effects) {
      if (
        effect.shooter &&
        effect.shooter !== app.localPlayerId &&
        !this.visiblePlayerIds?.has(effect.shooter)
      ) {
        effect.label?.setVisible(false);
        continue;
      }
      const remaining = Math.max(0, effect.until - now);
      if (effect.type === 'shot') {
        const strength = Math.min(1, remaining / 80);
        graphics.lineStyle(
          effect.weapon === 'sniper' ? 3 : effect.weapon === 'mg' ? 1 : 2,
          effect.weapon === 'sniper' ? 0xf3c969 : 0xefe7d3,
          0.55 + strength * 0.35,
        );
        graphics.lineBetween(effect.x1, effect.y1, effect.x2, effect.y2);
        graphics.fillStyle(effect.weapon === 'sniper' ? 0xf3c969 : 0xefe7d3, strength);
        graphics.fillCircle(effect.x1, effect.y1, effect.weapon === 'sniper' ? 8 : 5);
      } else if (effect.type === 'impact') {
        const strength = remaining / 180;
        graphics.lineStyle(2, 0xf3c969, strength);
        graphics.lineBetween(effect.x - 9, effect.y, effect.x + 9, effect.y);
        graphics.lineBetween(effect.x, effect.y - 9, effect.x, effect.y + 9);
        graphics.strokeCircle(effect.x, effect.y, 7 + (1 - strength) * 10);
      }
    }

    this.damageTexts ??= [];
    for (const effect of damageLabels) {
      if (!effect.label) {
        effect.label = this.add
          .text(effect.x, effect.y, effect.text, {
            fontFamily: 'Barlow Condensed',
            fontStyle: 'bold',
            fontSize: '24px',
            color: '#f3c969',
          })
          .setOrigin(0.5)
          .setDepth(13);
        this.damageTexts.push(effect.label);
      }
      const progress = 1 - (effect.until - now) / 560;
      effect.label.setAlpha(1 - progress);
      effect.label.setY(effect.y - progress * 36);
    }
    while (this.damageTexts.length > 12) {
      this.damageTexts.shift().destroy();
    }
  }
}

function wireUi() {
  dom.practice.addEventListener('click', beginLocalPractice);
  dom.createRoom.addEventListener('click', createRoom);
  dom.joinRoom.addEventListener('click', joinRoom);
  dom.roomCode.addEventListener('input', () => {
    dom.roomCode.value = dom.roomCode.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  });
  dom.roomCode.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      joinRoom();
    }
  });
  dom.playerName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      beginLocalPractice();
    }
  });
  dom.difficultySelect.addEventListener('change', () => {
    setDifficulty(dom.difficultySelect.value);
  });

  for (const button of dom.weaponButtons) {
    button.addEventListener('click', () => chooseWeapon(button.dataset.weapon));
  }

  dom.startMatch.addEventListener('click', () => {
    if (app.net?.canStart()) {
      beginHostMatch();
    }
  });

  dom.copyRoom.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(app.net?.roomCode ?? '');
      setLobbyMessage('房间码已复制。');
      window.setTimeout(() => setLobbyMessage(''), 1800);
    } catch {
      setLobbyMessage(`房间码：${app.net?.roomCode ?? ''}`);
    }
  });

  dom.leaveRoom.addEventListener('click', returnToEntry);
  dom.pauseButton.addEventListener('click', togglePause);
  dom.resumeButton.addEventListener('click', closePause);
  dom.quitMatch.addEventListener('click', quitMatch);
  dom.immersiveButton.addEventListener('click', toggleImmersiveMode);
  dom.restart.addEventListener('click', restartMatch);
  dom.returnLobby.addEventListener('click', leaveAfterMatch);

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && app.view === 'game') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) {
          togglePause();
        }
        return;
      }

      if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) {
        return;
      }
      if (app.view !== 'game' && app.view !== 'ended') {
        return;
      }

      const weaponByCode = {
        Digit1: 'pistol',
        Numpad1: 'pistol',
        Digit2: 'sniper',
        Numpad2: 'sniper',
        Digit3: 'mg',
        Numpad3: 'mg',
      };
      const requestedWeapon = weaponByCode[event.code];
      if (
        requestedWeapon &&
        app.view === 'game' &&
        !app.menuOpen &&
        app.gameState?.status === 'playing'
      ) {
        event.preventDefault();
        if (!event.repeat) {
          chooseWeapon(requestedWeapon);
        }
        return;
      }

      const combatInputActive =
        app.view === 'game' &&
        !app.menuOpen &&
        app.gameState?.status === 'playing';
      if (combatInputActive && event.code === 'KeyR') {
        event.preventDefault();
        if (!event.repeat) {
          requestReload();
        }
        return;
      }
      if (combatInputActive && event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) {
          app.slideLatchUntil = performance.now() + 180;
        }
        return;
      }

      const key = event.key.toLowerCase();
      const commandKey = event.ctrlKey || event.metaKey;
      const blocked =
        event.key === 'F5' ||
        event.key === 'F12' ||
        event.key === 'Backspace' ||
        (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) ||
        (commandKey &&
          !event.altKey &&
          ['r', 'w', 't', 'n', 'l', 's', 'p', 'o', 'u'].includes(key)) ||
        (commandKey &&
          event.shiftKey &&
          ['i', 'j', 'c', 'r', 'p'].includes(key));

      if (blocked) {
        event.preventDefault();
      }
    },
    true,
  );

  dom.app.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  window.addEventListener('beforeunload', (event) => {
    if (app.view === 'game') {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      app.keyboardLocked = false;
      try {
        navigator.keyboard?.unlock?.();
      } catch {
        // Keyboard Lock may not be available.
      }
      if (app.view === 'game' && !app.menuOpen) {
        openPause();
      }
    }
    updateImmersiveButton();
  });
}

let storedDifficulty = 'normal';
try {
  storedDifficulty = localStorage.getItem('aftershot-difficulty') || 'normal';
} catch {
  storedDifficulty = 'normal';
}
setDifficulty(storedDifficulty, false);

app.gameState = createPracticeSimulation(playerName(), {
  now: performance.now(),
  preview: true,
  reducedMotion,
  mapId: app.selectedMapId,
  difficulty: app.selectedDifficulty,
});
setView('entry');
setNetworkStatus('本地', 'online');
wireUi();
renderMapPickers();
chooseWeapon('pistol');
updateHud(
  app.gameState.players.map((player) => ({
    ...player,
    ammo: player.ammo[player.weapon],
    aimMs: player.pointerDown ? 760 : 0,
  })),
  performance.now(),
);

new Phaser.Game({
  type: Phaser.CANVAS,
  parent: 'game-canvas',
  width: WORLD.width,
  height: WORLD.height,
  backgroundColor: '#14201e',
  scene: ArenaScene,
  render: {
    antialias: true,
    pixelArt: false,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 1,
  },
});

window.__AFTERSHOT__ = {
  app,
  beginLocalPractice,
  chooseWeapon,
  returnToEntry,
  beginHostMatch,
  beginClientMatch,
  createRoom,
  joinRoom,
};
