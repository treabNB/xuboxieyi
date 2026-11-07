import { DEFAULT_MAP_ID, getMapDefinition } from './maps.js';
import { traceRay } from './vision.js';

export const WORLD = {
  width: 1600,
  height: 1000,
  padding: 46,
  playBottom: 840,
};

export const PLAYER_RADIUS = 18;
export const SCORE_LIMIT = 15;
export const MATCH_SECONDS = 150;
export const MG_MAX_BLOOM = 40;

export const STAMINA = {
  max: 100,
  regenPerSecond: 15,
  regenDelayMs: 900,
  sprintDrainPerSecond: 22,
  sprintMultiplier: 1.45,
  slideCost: 30,
  slideCooldownMs: 2500,
  slideDurationMs: 340,
  slideSpeed: 560,
};

export const WEAPON_ORDER = ['pistol', 'sniper', 'mg'];

export const WEAPONS = {
  pistol: {
    id: 'pistol',
    slot: 1,
    name: 'P-12',
    label: '手枪',
    kicker: '短按试探',
    description: '松开立即射击，适合快速修正。',
    damage: 26,
    range: 360,
    magazine: 12,
    reloadMs: 1150,
    fireInterval: 220,
    focusMs: 520,
    spreadStart: 4.5,
    spreadEnd: 2.2,
    moveAimScale: 0.88,
    trigger: 'release',
  },
  sniper: {
    id: 'sniper',
    slot: 2,
    name: 'K-77',
    label: '狙击枪',
    kicker: '长按校准',
    description: '瞄准越久越准，满蓄力伤害最高。',
    damage: 58,
    maxDamage: 92,
    range: 760,
    magazine: 5,
    reloadMs: 1900,
    fireInterval: 820,
    focusMs: 1350,
    spreadStart: 18,
    spreadEnd: 0.7,
    moveAimScale: 0.72,
    staminaCost: 18,
    trigger: 'release',
  },
  mg: {
    id: 'mg',
    slot: 3,
    name: 'M-48',
    label: '机枪',
    kicker: '持续压制',
    description: '按住即连射，持续开火会放大散布；停火后缓慢恢复。',
    damage: 9,
    range: 430,
    magazine: 48,
    reloadMs: 2350,
    fireInterval: 75,
    focusMs: 400,
    spreadStart: 13,
    spreadEnd: 4.5,
    moveAimScale: 1,
    moveScale: 0.75,
    staminaCost: 2,
    trigger: 'hold',
  },
};

const BOT_NAMES = ['校准靶', '回声', '噪点'];
const BOT_WEAPONS = ['pistol', 'sniper', 'mg'];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function getAimStats(
  weaponId,
  aimMs = 0,
  pointerDown = false,
  bloomDegrees = 0,
) {
  const weapon = WEAPONS[weaponId] ?? WEAPONS.pistol;
  const charge = clamp(aimMs / weapon.focusMs, 0, 1);
  const eased = easeOutCubic(charge);
  const baseSpread = pointerDown
    ? lerp(weapon.spreadStart, weapon.spreadEnd, eased)
    : weapon.spreadStart;
  const bloom = weapon.id === 'mg' ? clamp(bloomDegrees, 0, MG_MAX_BLOOM) : 0;
  const spread = PhaserMathDegToRad(baseSpread + bloom);
  return {
    charge,
    spread,
    range: weapon.range,
    damage:
      weapon.id === 'sniper'
        ? Math.round(lerp(weapon.damage, weapon.maxDamage, eased))
        : weapon.damage,
  };
}

function PhaserMathDegToRad(degrees) {
  return (degrees * Math.PI) / 180;
}

export function makePlayer(id, name, slot, options = {}) {
  const map = getMapDefinition(options.mapId);
  const spawn = map.spawns[slot % map.spawns.length];
  const weapon = WEAPONS[options.weapon] ? options.weapon : 'pistol';
  return {
    id,
    name: String(name || `玩家 ${slot + 1}`).slice(0, 12),
    slot,
    isBot: Boolean(options.isBot),
    x: options.x ?? spawn.x,
    y: options.y ?? spawn.y,
    angle: options.angle ?? spawn.angle,
    weapon,
    ammo: {
      pistol: WEAPONS.pistol.magazine,
      sniper: WEAPONS.sniper.magazine,
      mg: WEAPONS.mg.magazine,
    },
    health: 100,
    alive: true,
    respawnAt: 0,
    reloadEnd: 0,
    reloadWeapon: null,
    nextFireAt: 0,
    pointerDown: false,
    aimStartedAt: 0,
    lastInputAt: 0,
    kills: 0,
    deaths: 0,
    score: 0,
    hitUntil: 0,
    mgBloom: 0,
    lastShotAt: 0,
    mgBloomClock: 0,
    stamina: STAMINA.max,
    lastStaminaUseAt: 0,
    sprinting: false,
    slideUntil: 0,
    slideCooldownEnd: 0,
    slideDirX: 0,
    slideDirY: 0,
    botClock: 0,
    botPointerDown: false,
  };
}

export function createSimulation(roster, options = {}) {
  const mapId = getMapDefinition(options.mapId).id;
  const players = roster.map((entry, index) =>
    makePlayer(entry.id, entry.name, index, {
      isBot: entry.isBot,
      weapon: entry.weapon,
      mapId,
    }),
  );
  const now = options.now ?? performance.now();
  return {
    players,
    inputs: {},
    events: [],
    eventId: 1,
    status: 'playing',
    mapId,
    winner: null,
    timeLeft: MATCH_SECONDS,
    startedAt: now,
    endedAt: 0,
    preview: Boolean(options.preview),
    reducedMotion: Boolean(options.reducedMotion),
  };
}

export function createPracticeSimulation(playerName = '训练员', options = {}) {
  const now = options.now ?? performance.now();
  const roster = [
    { id: 'local', name: playerName },
    { id: 'bot-1', name: BOT_NAMES[0], isBot: true, weapon: 'sniper' },
  ];
  if (options.preview) {
    roster.push({
      id: 'preview-2',
      name: '灰烬',
      isBot: false,
      weapon: 'mg',
      x: 760,
      y: 650,
      angle: -1.1,
    });
  }
  const state = createSimulation(roster, {
    now,
    preview: options.preview,
    mapId: options.mapId,
  });
  if (options.preview) {
    const preview = getMapDefinition(state.mapId).preview;
    const local = state.players[0];
    local.x = preview.local.x;
    local.y = preview.local.y;
    local.angle = preview.local.angle;
    local.pointerDown = true;
    local.aimStartedAt = now - 760;
    const bot = state.players[1];
    bot.x = preview.enemy.x;
    bot.y = preview.enemy.y;
    bot.angle = preview.enemy.angle;
    bot.pointerDown = true;
    bot.aimStartedAt = now - 1120;
    bot.health = 72;
    const third = state.players[2];
    third.x = preview.ally.x;
    third.y = preview.ally.y;
    third.angle = preview.ally.angle;
    third.health = 38;
    third.hitUntil = now + 1200;
    state.timeLeft = 87;
    state.players[0].score = 6;
    state.players[1].score = 4;
    state.players[2].score = 2;
    state.events.push(
      {
        id: state.eventId++,
        type: 'hit',
        at: now - 90,
        shooter: local.id,
        target: third.id,
        damage: 26,
        weapon: 'pistol',
      },
      {
        id: state.eventId++,
        type: 'kill',
        at: now - 500,
        shooter: bot.id,
        target: 'preview-old',
        shooterName: bot.name,
        targetName: '旧影',
        weapon: 'sniper',
      },
    );
  }
  return state;
}

export function setInput(state, playerId, input) {
  state.inputs[playerId] = {
    up: Boolean(input?.up),
    down: Boolean(input?.down),
    left: Boolean(input?.left),
    right: Boolean(input?.right),
    pointerDown: Boolean(input?.pointerDown),
    cancel: Boolean(input?.cancel),
    sprint: Boolean(input?.sprint),
    slide: Boolean(input?.slide),
    reload: Boolean(input?.reload),
    targetX: Number(input?.targetX) || WORLD.width / 2,
    targetY: Number(input?.targetY) || WORLD.height / 2,
    weapon: WEAPONS[input?.weapon] ? input.weapon : 'pistol',
  };
}

function circleIntersectsRect(x, y, radius, rect) {
  const nearestX = clamp(x, rect.x, rect.x + rect.w);
  const nearestY = clamp(y, rect.y, rect.y + rect.h);
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

function moveWithCollision(player, dx, dy, obstacles) {
  const minX = WORLD.padding + PLAYER_RADIUS;
  const maxX = WORLD.width - WORLD.padding - PLAYER_RADIUS;
  const minY = WORLD.padding + PLAYER_RADIUS;
  const maxY = WORLD.playBottom - PLAYER_RADIUS;

  const nextX = clamp(player.x + dx, minX, maxX);
  if (!obstacles.some((rect) => circleIntersectsRect(nextX, player.y, PLAYER_RADIUS, rect))) {
    player.x = nextX;
  }

  const nextY = clamp(player.y + dy, minY, maxY);
  if (!obstacles.some((rect) => circleIntersectsRect(player.x, nextY, PLAYER_RADIUS, rect))) {
    player.y = nextY;
  }
}

function startReload(player, now) {
  const weapon = WEAPONS[player.weapon];
  if (player.ammo[player.weapon] >= weapon.magazine || player.reloadEnd > now) {
    return;
  }
  player.reloadEnd = now + weapon.reloadMs;
  player.reloadWeapon = player.weapon;
}

function finishReload(player, now) {
  if (!player.reloadWeapon || player.reloadEnd === 0 || now < player.reloadEnd) {
    return;
  }
  player.ammo[player.reloadWeapon] = WEAPONS[player.reloadWeapon].magazine;
  player.reloadWeapon = null;
  player.reloadEnd = 0;
}

function rayCircleDistance(originX, originY, dirX, dirY, targetX, targetY, radius) {
  const offsetX = targetX - originX;
  const offsetY = targetY - originY;
  const projection = offsetX * dirX + offsetY * dirY;
  if (projection < 0) {
    return null;
  }
  const perpendicularSq =
    offsetX * offsetX + offsetY * offsetY - projection * projection;
  if (perpendicularSq > radius * radius) {
    return null;
  }
  const halfChord = Math.sqrt(Math.max(0, radius * radius - perpendicularSq));
  return Math.max(0, projection - halfChord);
}

function findShotTarget(state, shooter, angle, range) {
  const map = getMapDefinition(state.mapId);
  const ray = traceRay(shooter.x, shooter.y, angle, range, map.obstacles, {
    left: WORLD.padding,
    right: WORLD.width - WORLD.padding,
    top: WORLD.padding,
    bottom: WORLD.playBottom,
  });
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  let nearestDistance = ray.distance;
  let hitPlayer = null;
  let surface = ray.blocker;

  for (const player of state.players) {
    if (player.id === shooter.id || !player.alive) {
      continue;
    }
    const distance = rayCircleDistance(
      shooter.x,
      shooter.y,
      dirX,
      dirY,
      player.x,
      player.y,
      PLAYER_RADIUS + 2,
    );
    if (distance !== null && distance < nearestDistance) {
      nearestDistance = distance;
      hitPlayer = player;
      surface = 'player';
    }
  }

  return {
    x: shooter.x + dirX * nearestDistance,
    y: shooter.y + dirY * nearestDistance,
    hitPlayer,
    surface,
    distance: nearestDistance,
  };
}

function pushEvent(state, event, now) {
  state.events.push({ id: state.eventId++, at: now, ...event });
  if (state.events.length > 80) {
    state.events.splice(0, state.events.length - 80);
  }
}

function awardKill(state, shooter, target, now) {
  target.alive = false;
  target.health = 0;
  target.respawnAt = now + 3000;
  target.deaths += 1;
  target.pointerDown = false;
  target.aimStartedAt = 0;
  shooter.kills += 1;
  shooter.score += 1;
  pushEvent(
    state,
    {
      type: 'kill',
      shooter: shooter.id,
      shooterName: shooter.name,
      target: target.id,
      targetName: target.name,
      weapon: shooter.weapon,
    },
    now,
  );
  if (shooter.score >= SCORE_LIMIT) {
    state.status = 'ended';
    state.winner = shooter.id;
    state.endedAt = now;
  }
}

function fireWeapon(state, player, now) {
  const weapon = WEAPONS[player.weapon];
  const staminaCost = weapon.staminaCost ?? 0;
  if (
    !player.alive ||
    player.reloadEnd > now ||
    player.nextFireAt > now ||
    player.ammo[player.weapon] <= 0 ||
    player.stamina < staminaCost
  ) {
    if (player.alive && player.ammo[player.weapon] <= 0) {
      startReload(player, now);
    }
    return;
  }

  const aim = getAimStats(
    player.weapon,
    now - player.aimStartedAt,
    player.pointerDown,
    player.mgBloom,
  );
  const spreadAngle = (Math.random() - 0.5) * aim.spread;
  const shotAngle = normalizeAngle(player.angle + spreadAngle);
  const target = findShotTarget(state, player, shotAngle, aim.range);

  player.ammo[player.weapon] -= 1;
  player.nextFireAt = now + weapon.fireInterval;
  player.lastShotAt = now;
  if (staminaCost > 0) {
    player.stamina = Math.max(0, player.stamina - staminaCost);
    player.lastStaminaUseAt = now;
  }

  pushEvent(
    state,
    {
      type: 'shot',
      shooter: player.id,
      weapon: player.weapon,
      x: player.x,
      y: player.y,
      angle: shotAngle,
      endX: target.x,
      endY: target.y,
      surface: target.surface,
    },
    now,
  );

  if (target.hitPlayer) {
    target.hitPlayer.health = Math.max(0, target.hitPlayer.health - aim.damage);
    target.hitPlayer.hitUntil = now + 130;
    pushEvent(
      state,
      {
        type: 'hit',
        shooter: player.id,
        target: target.hitPlayer.id,
        damage: aim.damage,
        weapon: player.weapon,
        x: target.x,
        y: target.y,
      },
      now,
    );
    if (target.hitPlayer.health <= 0) {
      awardKill(state, player, target.hitPlayer, now);
    }
  } else {
    pushEvent(
      state,
      {
        type: 'impact',
        shooter: player.id,
        x: target.x,
        y: target.y,
        surface: target.surface,
        weapon: player.weapon,
      },
      now,
    );
  }

  if (player.ammo[player.weapon] <= 0) {
    startReload(player, now);
  }
}

function respawnPlayer(player, map) {
  const spawn = map.spawns[player.slot % map.spawns.length];
  player.x = spawn.x;
  player.y = spawn.y;
  player.angle = spawn.angle;
  player.health = 100;
  player.alive = true;
  player.respawnAt = 0;
  player.reloadEnd = 0;
  player.reloadWeapon = null;
  player.pointerDown = false;
  player.aimStartedAt = 0;
  player.mgBloom = 0;
  player.lastShotAt = 0;
  player.mgBloomClock = 0;
  player.stamina = STAMINA.max;
  player.lastStaminaUseAt = 0;
  player.sprinting = false;
  player.slideUntil = 0;
  player.slideCooldownEnd = 0;
  player.slideDirX = 0;
  player.slideDirY = 0;
  player.ammo = {
    pistol: WEAPONS.pistol.magazine,
    sniper: WEAPONS.sniper.magazine,
    mg: WEAPONS.mg.magazine,
  };
}

function driveBot(state, player, dt, now) {
  const targets = state.players.filter(
    (candidate) => candidate.id !== player.id && candidate.alive,
  );
  if (!targets.length) {
    return;
  }
  const target = targets.reduce((nearest, candidate) => {
    const distance = Math.hypot(candidate.x - player.x, candidate.y - player.y);
    return !nearest || distance < nearest.distance ? { candidate, distance } : nearest;
  }, null);
  if (!target) {
    return;
  }

  player.botClock += dt;
  const angleToTarget = Math.atan2(
    target.candidate.y - player.y,
    target.candidate.x - player.x,
  );
  const orbitDirection =
    Math.sin(player.slot * 3.7 + player.botClock * 0.00055) > 0 ? 1 : -1;
  const approach =
    target.distance > WEAPONS[player.weapon].range * 0.82 ? 1 : -0.35;
  const moveAngle = angleToTarget + orbitDirection * Math.PI * 0.58;
  const keys = {
    right: Math.cos(moveAngle) > 0.18,
    left: Math.cos(moveAngle) < -0.18,
    down: Math.sin(moveAngle) > 0.18,
    up: Math.sin(moveAngle) < -0.18,
  };
  if (approach < 0) {
    keys.right = !keys.left;
    keys.down = !keys.up;
  }

  const cycleLength =
    player.weapon === 'sniper' ? 2750 : player.weapon === 'mg' ? 1500 : 1250;
  const releaseAt = player.weapon === 'sniper' ? 0.84 : 0.67;
  const cycle = (player.botClock + player.slot * 610) % cycleLength;
  const pointerDown = cycle < cycleLength * releaseAt;
  const wobble =
    Math.sin(player.botClock * 0.0022 + player.slot) *
    (player.weapon === 'sniper' ? 0.045 : 0.12);

  setInput(state, player.id, {
    ...keys,
    pointerDown,
    targetX: target.candidate.x + Math.cos(angleToTarget + Math.PI / 2) * wobble * 500,
    targetY: target.candidate.y + Math.sin(angleToTarget + Math.PI / 2) * wobble * 500,
    weapon: player.weapon,
  });
}

function updatePlayer(state, player, dt, now) {
  const map = getMapDefinition(state.mapId);
  if (!player.alive) {
    if (player.respawnAt > 0 && now >= player.respawnAt) {
      respawnPlayer(player, map);
    }
    return;
  }

  finishReload(player, now);
  if (player.reloadEnd > 0 && now >= player.reloadEnd) {
    finishReload(player, now);
  }
  if (!player.pointerDown && now - player.lastShotAt > 180) {
    player.mgBloom = Math.max(0, player.mgBloom - dt * 3.4);
  }

  if (player.isBot) {
    driveBot(state, player, dt, now);
  }

  const input = state.inputs[player.id] ?? {
    up: false,
    down: false,
    left: false,
    right: false,
    pointerDown: false,
    sprint: false,
    slide: false,
    reload: false,
    targetX: player.x + Math.cos(player.angle) * 100,
    targetY: player.y + Math.sin(player.angle) * 100,
    weapon: player.weapon,
  };

  player.lastInputAt = now;
  if (input.reload && player.ammo[player.weapon] < WEAPONS[player.weapon].magazine) {
    startReload(player, now);
  }
  if (WEAPONS[input.weapon] && input.weapon !== player.weapon) {
    player.weapon = input.weapon;
    player.pointerDown = false;
    player.aimStartedAt = 0;
    player.reloadEnd = 0;
    player.reloadWeapon = null;
    pushEvent(
      state,
      { type: 'switch', shooter: player.id, weapon: player.weapon },
      now,
    );
  }

  player.angle = normalizeAngle(
    Math.atan2(input.targetY - player.y, input.targetX - player.x),
  );

  const weapon = WEAPONS[player.weapon];
  const aimHeld = Boolean(input.pointerDown);
  const aimMs = player.aimStartedAt ? now - player.aimStartedAt : 0;
  const aimCharge = clamp(aimMs / weapon.focusMs, 0, 1);

  let moveX = Number(input.right) - Number(input.left);
  let moveY = Number(input.down) - Number(input.up);
  const moveLength = Math.hypot(moveX, moveY);
  if (moveLength > 1) {
    moveX /= moveLength;
    moveY /= moveLength;
  }
  const wasSliding = now < player.slideUntil;
  if (
    input.slide &&
    !wasSliding &&
    player.slideCooldownEnd <= now &&
    player.stamina >= STAMINA.slideCost
  ) {
    const hasMoveDirection = moveLength > 0;
    player.slideDirX = hasMoveDirection ? moveX : Math.cos(player.angle);
    player.slideDirY = hasMoveDirection ? moveY : Math.sin(player.angle);
    player.slideUntil = now + STAMINA.slideDurationMs;
    player.slideCooldownEnd = now + STAMINA.slideCooldownMs;
    player.stamina -= STAMINA.slideCost;
    player.lastStaminaUseAt = now;
    pushEvent(
      state,
      {
        type: 'slide',
        shooter: player.id,
        x: player.x,
        y: player.y,
      },
      now,
    );
  }

  const sliding = now < player.slideUntil;
  const moving = moveLength > 0;
  player.sprinting =
    !sliding && Boolean(input.sprint) && moving && player.stamina > 0;
  const aimScale =
    aimHeld && player.weapon === 'sniper'
      ? lerp(1, weapon.moveAimScale, aimCharge)
      : 1;
  const carryScale = weapon.moveScale ?? 1;
  if (sliding) {
    player.sprinting = false;
    moveWithCollision(
      player,
      player.slideDirX * STAMINA.slideSpeed * dt,
      player.slideDirY * STAMINA.slideSpeed * dt,
      map.obstacles,
    );
  } else {
    const sprintScale = player.sprinting ? STAMINA.sprintMultiplier : 1;
    const speed = 220 * aimScale * carryScale * sprintScale;
    if (player.sprinting) {
      player.stamina = Math.max(
        0,
        player.stamina - STAMINA.sprintDrainPerSecond * dt,
      );
      player.lastStaminaUseAt = now;
    }
    moveWithCollision(player, moveX * speed * dt, moveY * speed * dt, map.obstacles);
  }

  if (input.cancel) {
    player.pointerDown = false;
    player.aimStartedAt = 0;
    player.mgBloomClock = 0;
  } else if (aimHeld && !player.pointerDown) {
    player.pointerDown = true;
    player.aimStartedAt = now;
    pushEvent(state, { type: 'aim-start', shooter: player.id }, now);
  } else if (!aimHeld && player.pointerDown) {
    if (weapon.trigger === 'release') {
      fireWeapon(state, player, now);
    }
    player.pointerDown = false;
    player.aimStartedAt = 0;
    pushEvent(state, { type: 'aim-stop', shooter: player.id }, now);
  }

  if (
    weapon.trigger === 'hold' &&
    player.pointerDown &&
    aimMs >= 120 &&
    player.nextFireAt <= now
  ) {
    fireWeapon(state, player, now);
  }

  if (
    player.weapon === 'mg' &&
    player.pointerDown &&
    aimMs >= 120 &&
    player.reloadEnd === 0 &&
    player.ammo.mg > 0 &&
    player.stamina > 0
  ) {
    player.mgBloomClock += dt * 1000;
    while (player.mgBloomClock >= 100) {
      player.mgBloom = Math.min(MG_MAX_BLOOM, player.mgBloom + 1);
      player.mgBloomClock -= 100;
    }
  } else {
    player.mgBloomClock = 0;
  }

  if (
    !player.sprinting &&
    !sliding &&
    now - player.lastStaminaUseAt > STAMINA.regenDelayMs
  ) {
    player.stamina = Math.min(
      STAMINA.max,
      player.stamina + STAMINA.regenPerSecond * dt,
    );
  }
}

export function updateSimulation(state, dt, now) {
  if (state.status !== 'playing') {
    return state;
  }
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    state.status = 'ended';
    state.endedAt = now;
    const ranking = [...state.players].sort(
      (a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths,
    );
    state.winner = ranking[0]?.id ?? null;
    pushEvent(state, { type: 'match-end', winner: state.winner }, now);
    return state;
  }

  state.timeLeft = Math.max(0, state.timeLeft - dt);
  const step = Math.min(dt, 0.05);
  for (const player of state.players) {
    updatePlayer(state, player, step, now);
  }
  state.events = state.events.filter((event) => now - event.at < 3500);
  return state;
}

export function getPlayerAim(player, now) {
  const weapon = WEAPONS[player.weapon];
  const aimMs = player.pointerDown ? Math.max(0, now - player.aimStartedAt) : 0;
  const stats = getAimStats(
    player.weapon,
    aimMs,
    player.pointerDown,
    player.mgBloom,
  );
  return {
    ...stats,
    aimMs,
    weapon,
    reloadRemaining: Math.max(0, player.reloadEnd - now),
  };
}

export function makeSnapshot(state, now) {
  return {
    at: Date.now(),
    status: state.status,
    mapId: state.mapId,
    winner: state.winner,
    timeLeft: state.timeLeft,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      slot: player.slot,
      isBot: player.isBot,
      x: Math.round(player.x * 10) / 10,
      y: Math.round(player.y * 10) / 10,
      angle: player.angle,
      weapon: player.weapon,
      ammo: player.ammo[player.weapon],
      health: player.health,
      alive: player.alive,
      kills: player.kills,
      deaths: player.deaths,
      score: player.score,
      stamina: Math.round(player.stamina * 10) / 10,
      sprinting: player.sprinting,
      sliding: now < player.slideUntil,
      slideDirX: player.slideDirX,
      slideDirY: player.slideDirY,
      slideCooldownRemaining: Math.max(0, player.slideCooldownEnd - now),
      hitUntil: Math.max(0, player.hitUntil - now),
      respawnRemaining: Math.max(0, player.respawnAt - now),
      aimMs:
        player.pointerDown && player.aimStartedAt
          ? Math.max(0, now - player.aimStartedAt)
          : 0,
      pointerDown: player.pointerDown,
      bloom: Math.round((player.mgBloom ?? 0) * 100) / 100,
      reloadRemaining: Math.max(0, player.reloadEnd - now),
      reloadTotal: player.reloadWeapon
        ? WEAPONS[player.reloadWeapon].reloadMs
        : 0,
    })),
    events: state.events
      .filter((event) => now - event.at < 300)
      .map((event) => ({ ...event })),
  };
}
