import { DEFAULT_MAP_ID, getMapDefinition } from './maps.js';
import { traceRay } from './vision.js';
import {
  CHARACTER_ORDER,
  DEFAULT_CHARACTER_ID,
  getCharacterDefinition,
} from './characters.js';

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
export const ASH_MG_FOCUS_MAX_BLOOM = 30;
export const SPAWN_PROTECTION_MS = 2000;
export const FOOTSTEP_RANGE = 400;
export const FLASH_MAX_DISTANCE = 520;
export const FLASH_RADIUS = 240;
export const FLASH_FUSE_MS = 1500;
export const FLASH_BLIND_MS = 3000;

export const MATCH_MODES = {
  quick: {
    id: 'quick',
    label: '快局',
    durationSeconds: MATCH_SECONDS,
    scoreLimit: SCORE_LIMIT,
  },
  long: {
    id: 'long',
    label: '长局',
    durationSeconds: 480,
    scoreLimit: null,
  },
};

export const DEFAULT_MATCH_MODE = 'quick';

export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    label: '简单',
    aimWobble: 0.2,
    predictionSeconds: 0,
    cycleMs: 2600,
    aimRatio: 0.62,
    moveScale: 0.72,
    weaponSwitchMs: 3000,
    usesSprint: false,
    usesSlide: false,
  },
  normal: {
    id: 'normal',
    label: '普通',
    aimWobble: 0.075,
    predictionSeconds: 0.08,
    cycleMs: 2100,
    aimRatio: 0.74,
    moveScale: 0.9,
    weaponSwitchMs: 1200,
    usesSprint: false,
    usesSlide: false,
  },
  hard: {
    id: 'hard',
    label: '困难',
    aimWobble: 0.022,
    predictionSeconds: 0.22,
    cycleMs: 1750,
    aimRatio: 0.84,
    moveScale: 1,
    weaponSwitchMs: 720,
    usesSprint: true,
    usesSlide: true,
  },
};

export const DEFAULT_DIFFICULTY = 'normal';

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

export function isPlayerJammed(player, now) {
  return (player.jammedUntil ?? 0) > now;
}

export function getEffectiveAimStats(
  weaponId,
  aimMs,
  pointerDown,
  bloomDegrees,
  characterId,
  jammed = false,
) {
  const canFocus =
    !(characterId === 'ash' && weaponId === 'sniper');
  const stats = getAimStats(
    weaponId,
    canFocus ? aimMs : 0,
    pointerDown,
    bloomDegrees,
  );
  return {
    ...stats,
    spread: stats.spread * (jammed ? 1.5 : 1),
    canFocus,
  };
}

function PhaserMathDegToRad(degrees) {
  return (degrees * Math.PI) / 180;
}

export function findAssassinationTarget(state, player, map, now) {
  if (
    !player?.alive ||
    player.characterId !== 'agent46'
  ) {
    return null;
  }
  for (const target of state.players) {
    if (target.id === player.id || !target.alive) {
      continue;
    }
    const distance = Math.hypot(target.x - player.x, target.y - player.y);
    if (distance > 58 || (target.invulnerableUntil ?? 0) > now) {
      continue;
    }
    const angleToAttacker = Math.atan2(player.y - target.y, player.x - target.x);
    const rearDelta = Math.abs(
      normalizeAngle(angleToAttacker - target.angle - Math.PI),
    );
    if (rearDelta > Math.PI / 3) {
      continue;
    }
    const angle = Math.atan2(target.y - player.y, target.x - player.x);
    const ray = traceRay(player.x, player.y, angle, distance, map.obstacles, {
      left: WORLD.padding,
      right: WORLD.width - WORLD.padding,
      top: WORLD.padding,
      bottom: WORLD.playBottom,
    });
    if (ray.distance + PLAYER_RADIUS >= distance) {
      return target;
    }
  }
  return null;
}

export function canAssassinate(state, player, map, now) {
  return Boolean(findAssassinationTarget(state, player, map, now));
}

export function makePlayer(id, name, slot, options = {}) {
  const map = getMapDefinition(options.mapId);
  const spawn = map.spawns[slot % map.spawns.length];
  const weapon = WEAPONS[options.weapon] ? options.weapon : 'pistol';
  const characterId =
    options.matchMode === 'long'
      ? getCharacterDefinition(options.characterId)?.id ?? DEFAULT_CHARACTER_ID
      : null;
  const character = getCharacterDefinition(characterId);
  return {
    id,
    name: String(name || `玩家 ${slot + 1}`).slice(0, 12),
    slot,
    isBot: Boolean(options.isBot),
    characterId,
    botDifficulty: DIFFICULTIES[options.difficulty]?.id ?? DEFAULT_DIFFICULTY,
    vx: 0,
    vy: 0,
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
    damageDealt: 0,
    hitUntil: 0,
    invulnerableUntil: 0,
    flashedUntil: 0,
    burningUntil: 0,
    focusActive: false,
    jamCastUntil: 0,
    jammedUntil: 0,
    reconUntil: 0,
    skill1ReadyAt: 0,
    skill2ReadyAt: 0,
    skill1Uses: character?.skill1?.uses ?? null,
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
    botWeaponStep: Math.max(0, BOT_WEAPONS.indexOf(weapon)),
    botWeaponDecisionAt: 0,
    lastPressed: {
      skill1: false,
      skill2: false,
      assassinate: false,
    },
  };
}

export function createSimulation(roster, options = {}) {
  const mapId = getMapDefinition(options.mapId).id;
  const matchMode =
    MATCH_MODES[options.matchMode]?.id ?? DEFAULT_MATCH_MODE;
  const players = roster.map((entry, index) =>
    makePlayer(entry.id, entry.name, index, {
      isBot: entry.isBot,
      weapon: entry.weapon,
      difficulty: entry.difficulty,
      mapId,
      matchMode,
      characterId: entry.characterId,
    }),
  );
  const now = options.now ?? performance.now();
  const mode = MATCH_MODES[matchMode];
  return {
    players,
    inputs: {},
    flashbangs: [],
    nextFlashbangId: 1,
    events: [],
    eventId: 1,
    status: 'playing',
    mapId,
    matchMode,
    difficulty:
      DIFFICULTIES[options.difficulty]?.id ?? DEFAULT_DIFFICULTY,
    winner: null,
    timeLeft: mode.durationSeconds,
    startedAt: now,
    endedAt: 0,
    preview: Boolean(options.preview),
    reducedMotion: Boolean(options.reducedMotion),
  };
}

export function createPracticeSimulation(playerName = '训练员', options = {}) {
  const now = options.now ?? performance.now();
  const difficulty =
    DIFFICULTIES[options.difficulty]?.id ?? DEFAULT_DIFFICULTY;
  const matchMode =
    MATCH_MODES[options.matchMode]?.id ?? DEFAULT_MATCH_MODE;
  const characterId =
    matchMode === 'long'
      ? getCharacterDefinition(options.characterId)?.id ?? DEFAULT_CHARACTER_ID
      : null;
  const botCharacters =
    matchMode === 'long'
      ? CHARACTER_ORDER.filter((id) => id !== characterId).slice(0, 2)
      : [null];
  const roster = [
    { id: 'local', name: playerName, characterId },
    ...botCharacters.map((botCharacterId, index) => ({
      id: `bot-${index + 1}`,
      name: BOT_NAMES[index],
      isBot: true,
      weapon: index === 0 ? 'sniper' : 'mg',
      difficulty,
      characterId: botCharacterId,
    })),
  ];
  if (options.preview && matchMode !== 'long') {
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
    difficulty,
    matchMode,
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
    if (third) {
      third.x = preview.ally.x;
      third.y = preview.ally.y;
      third.angle = preview.ally.angle;
      third.health = 38;
      third.hitUntil = now + 1200;
    }
    state.timeLeft = matchMode === 'long' ? 384 : 87;
    state.players[0].score = 6;
    state.players[1].score = 4;
    if (third) third.score = 2;
    state.events.push(
      {
        id: state.eventId++,
        type: 'hit',
        at: now - 90,
        shooter: local.id,
        target: third?.id ?? 'preview-old-2',
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
    skill1: Boolean(input?.skill1),
    skill2: Boolean(input?.skill2),
    assassinate: Boolean(input?.assassinate),
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

function awardKill(state, shooter, target, now, weapon = shooter.weapon) {
  target.alive = false;
  target.health = 0;
  target.respawnAt = now + 3000;
  target.deaths += 1;
  target.pointerDown = false;
  target.aimStartedAt = 0;
  target.focusActive = false;
  target.jamCastUntil = 0;
  target.burningUntil = 0;
  target.flashedUntil = 0;
  target.jammedUntil = 0;
  target.reconUntil = 0;
  target.invulnerableUntil = 0;
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
      weapon,
    },
    now,
  );
  const scoreLimit = MATCH_MODES[state.matchMode]?.scoreLimit;
  if (scoreLimit && shooter.score >= scoreLimit) {
    state.status = 'ended';
    state.winner = shooter.id;
    state.endedAt = now;
  }
}

function fireWeapon(state, player, now) {
  const weapon = WEAPONS[player.weapon];
  const staminaCost =
    player.weapon === 'mg' && player.focusActive
      ? 0
      : weapon.staminaCost ?? 0;
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

  player.invulnerableUntil = 0;
  const aim = getEffectiveAimStats(
    player.weapon,
    now - player.aimStartedAt,
    player.pointerDown,
    player.mgBloom,
    player.characterId,
    isPlayerJammed(player, now),
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
    if ((target.hitPlayer.invulnerableUntil ?? 0) > now) {
      pushEvent(
        state,
        {
          type: 'shield',
          shooter: player.id,
          target: target.hitPlayer.id,
          x: target.x,
          y: target.y,
        },
        now,
      );
      return;
    }
    const burning =
      player.characterId === 'ash' &&
      player.weapon === 'mg' &&
      player.burningUntil > now;
    let damage = aim.damage * (burning ? 2 : 1);
    if (target.hitPlayer.characterId === 'ash') {
      damage = Math.max(1, Math.round(damage * 0.8));
    }
    const previousHealth = target.hitPlayer.health;
    target.hitPlayer.health = Math.max(0, target.hitPlayer.health - damage);
    target.hitPlayer.hitUntil = now + 130;
    player.damageDealt += previousHealth - target.hitPlayer.health;
    pushEvent(
      state,
      {
        type: 'hit',
        shooter: player.id,
        target: target.hitPlayer.id,
        damage,
        weapon: player.weapon,
        boosted: burning,
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

function respawnPlayer(player, map, now) {
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
  player.invulnerableUntil = now + SPAWN_PROTECTION_MS;
  player.flashedUntil = 0;
  player.burningUntil = 0;
  player.focusActive = false;
  player.jamCastUntil = 0;
  player.jammedUntil = 0;
  player.reconUntil = 0;
  player.lastPressed.skill1 = false;
  player.lastPressed.skill2 = false;
  player.lastPressed.assassinate = false;
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
  player.botWeaponDecisionAt = 0;
  player.ammo = {
    pistol: WEAPONS.pistol.magazine,
    sniper: WEAPONS.sniper.magazine,
    mg: WEAPONS.mg.magazine,
  };
}

function chooseBotWeapon(player, tuning, distance) {
  const canUse = (weaponId) =>
    player.ammo[weaponId] > 0 &&
    player.stamina >= (WEAPONS[weaponId].staminaCost ?? 0);
  let preferred;

  if (tuning.id === 'easy') {
    player.botWeaponStep = (player.botWeaponStep + 1) % BOT_WEAPONS.length;
    preferred = BOT_WEAPONS[player.botWeaponStep];
  } else if (tuning.id === 'hard') {
    preferred =
      distance > 500
        ? 'sniper'
        : distance < 210
          ? 'pistol'
          : distance < 430
            ? 'mg'
            : 'sniper';
  } else {
    preferred =
      distance > 610 ? 'sniper' : distance < 250 ? 'pistol' : 'mg';
  }
  if (player.characterId === 'ash' && preferred === 'sniper') {
    preferred = distance > 430 ? 'pistol' : 'mg';
  }

  if (canUse(preferred)) {
    return preferred;
  }

  const fallbackOrder =
    distance > 480
      ? ['sniper', 'mg', 'pistol']
      : distance < 230
        ? ['pistol', 'mg', 'sniper']
        : ['mg', 'pistol', 'sniper'];
  return fallbackOrder.find(canUse) ?? player.weapon;
}

function startFlashbang(state, player, now) {
  if (
    player.characterId !== 'falcon' ||
    player.skill1Uses <= 0 ||
    player.jamCastUntil > now
  ) {
    return false;
  }
  player.invulnerableUntil = 0;
  player.skill1Uses -= 1;
  const map = getMapDefinition(state.mapId);
  const bounds = {
    left: WORLD.padding,
    right: WORLD.width - WORLD.padding,
    top: WORLD.padding,
    bottom: WORLD.playBottom,
  };
  const ray = traceRay(
    player.x,
    player.y,
    player.angle,
    FLASH_MAX_DISTANCE,
    map.obstacles,
    bounds,
  );
  state.flashbangs.push({
    id: `flash-${state.nextFlashbangId++}`,
    owner: player.id,
    x: player.x,
    y: player.y,
    angle: player.angle,
    remainingDistance: Math.max(0, ray.distance),
    explodeAt: now + FLASH_FUSE_MS,
    stopped: false,
  });
  pushEvent(
    state,
    {
      type: 'flash-throw',
      shooter: player.id,
      shooterName: player.name,
    },
    now,
  );
  return true;
}

function detonateFlashbang(state, flashbang, now) {
  const map = getMapDefinition(state.mapId);
  const bounds = {
    left: WORLD.padding,
    right: WORLD.width - WORLD.padding,
    top: WORLD.padding,
    bottom: WORLD.playBottom,
  };
  pushEvent(
    state,
    {
      type: 'flash-burst',
      shooter: flashbang.owner,
      x: flashbang.x,
      y: flashbang.y,
    },
    now,
  );
  for (const target of state.players) {
    if (target.id === flashbang.owner || !target.alive) {
      continue;
    }
    const distance = Math.hypot(target.x - flashbang.x, target.y - flashbang.y);
    if (distance > FLASH_RADIUS) {
      continue;
    }
    const angle = Math.atan2(target.y - flashbang.y, target.x - flashbang.x);
    const ray = traceRay(
      flashbang.x,
      flashbang.y,
      angle,
      distance,
      map.obstacles,
      bounds,
    );
    if (ray.distance + PLAYER_RADIUS < distance) {
      continue;
    }
    target.flashedUntil = Math.max(
      target.flashedUntil,
      now + FLASH_BLIND_MS,
    );
    pushEvent(
      state,
      {
        type: 'flashed',
        shooter: flashbang.owner,
        target: target.id,
      },
      now,
    );
  }
}

function updateFlashbangs(state, dt, now) {
  for (const flashbang of state.flashbangs) {
    if (now >= flashbang.explodeAt) {
      detonateFlashbang(state, flashbang, now);
      continue;
    }
    if (flashbang.stopped || flashbang.remainingDistance <= 0) {
      continue;
    }
    const map = getMapDefinition(state.mapId);
    const step = Math.min(
      flashbang.remainingDistance,
      640 * Math.min(dt, 0.05),
    );
    const ray = traceRay(
      flashbang.x,
      flashbang.y,
      flashbang.angle,
      step,
      map.obstacles,
      {
        left: WORLD.padding,
        right: WORLD.width - WORLD.padding,
        top: WORLD.padding,
        bottom: WORLD.playBottom,
      },
    );
    flashbang.x = ray.x;
    flashbang.y = ray.y;
    flashbang.remainingDistance -= ray.distance;
    if (ray.blocker !== 'range' || flashbang.remainingDistance <= 0.01) {
      flashbang.stopped = true;
      flashbang.remainingDistance = 0;
    }
  }
  state.flashbangs = state.flashbangs.filter(
    (flashbang) => now < flashbang.explodeAt,
  );
}

function startJamCast(state, player, now) {
  const character = getCharacterDefinition(player.characterId);
  if (
    player.characterId !== 'falcon' ||
    player.skill2ReadyAt > now ||
    player.jamCastUntil > now
  ) {
    return false;
  }
  player.invulnerableUntil = 0;
  player.jamCastUntil = now + character.skill2.castMs;
  player.skill2ReadyAt = now + character.skill2.cooldownMs;
  pushEvent(
    state,
    {
      type: 'jam-cast',
      shooter: player.id,
      duration: character.skill2.castMs,
    },
    now,
  );
  return true;
}

function releaseJamWave(state, player, now) {
  const character = getCharacterDefinition(player.characterId);
  for (const target of state.players) {
    if (target.id === player.id || !target.alive) {
      continue;
    }
    if (Math.hypot(target.x - player.x, target.y - player.y) <= 480) {
      target.jammedUntil = Math.max(
        target.jammedUntil,
        now + character.skill2.durationMs,
      );
    }
  }
  pushEvent(
    state,
    {
      type: 'jam-release',
      shooter: player.id,
      x: player.x,
      y: player.y,
    },
    now,
  );
}

function activateAshBurn(state, player, now) {
  const character = getCharacterDefinition(player.characterId);
  if (
    player.characterId !== 'ash' ||
    player.skill1ReadyAt > now ||
    player.burningUntil > now
  ) {
    return false;
  }
  player.invulnerableUntil = 0;
  player.burningUntil = now + character.skill1.durationMs;
  player.skill1ReadyAt = now + character.skill1.cooldownMs;
  pushEvent(
    state,
    { type: 'burn', shooter: player.id, duration: character.skill1.durationMs },
    now,
  );
  return true;
}

function toggleAshFocus(state, player, now) {
  if (player.characterId !== 'ash') {
    return false;
  }
  if (!player.focusActive) {
    if (player.stamina < 10) {
      return false;
    }
    player.invulnerableUntil = 0;
    player.focusActive = true;
    pushEvent(state, { type: 'focus-on', shooter: player.id }, now);
  } else {
    player.focusActive = false;
    pushEvent(state, { type: 'focus-off', shooter: player.id }, now);
  }
  return true;
}

function activateRecon(state, player, now) {
  const character = getCharacterDefinition(player.characterId);
  if (
    player.characterId !== 'agent46' ||
    player.skill1ReadyAt > now
  ) {
    return false;
  }
  player.invulnerableUntil = 0;
  player.reconUntil = now + character.skill1.durationMs;
  player.skill1ReadyAt = now + character.skill1.cooldownMs;
  pushEvent(
    state,
    {
      type: 'recon',
      shooter: player.id,
      shooterName: player.name,
      duration: character.skill1.durationMs,
    },
    now,
  );
  return true;
}

function attemptAssassination(state, player, now) {
  if (player.characterId !== 'agent46') {
    return false;
  }
  const map = getMapDefinition(state.mapId);
  const target = findAssassinationTarget(state, player, map, now);
  if (!target) {
    return false;
  }
  player.invulnerableUntil = 0;
  pushEvent(
    state,
    {
      type: 'assassinate',
      shooter: player.id,
      shooterName: player.name,
      target: target.id,
      targetName: target.name,
      x: target.x,
      y: target.y,
      weapon: 'assassinate',
    },
    now,
  );
  awardKill(state, player, target, now, 'assassinate');
  return true;
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

  const tuning =
    DIFFICULTIES[player.botDifficulty] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
  player.botClock += dt * 1000;
  const decisionDue =
    player.botWeaponDecisionAt <= now ||
    player.ammo[player.weapon] <= 0;
  if (decisionDue) {
    player.botWeaponDecisionAt =
      now + tuning.weaponSwitchMs + ((player.slot * 137 + Math.floor(now / 1000) * 53) % 180);
  }
  const nextWeapon = decisionDue
    ? chooseBotWeapon(player, tuning, target.distance)
    : player.weapon;
  const angleToTarget = Math.atan2(
    target.candidate.y - player.y,
    target.candidate.x - player.x,
  );
  const orbitDirection =
    Math.sin(player.slot * 3.7 + player.botClock * 0.00055) > 0 ? 1 : -1;
  const approach =
    target.distance > WEAPONS[nextWeapon].range * 0.82 ? 1 : -0.35;
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

  const cycleLength = tuning.cycleMs;
  const releaseAt = tuning.aimRatio;
  const cycle = (player.botClock + player.slot * 610) % cycleLength;
  const pointerDown = cycle < cycleLength * releaseAt;
  const wobble =
    Math.sin(player.botClock * 0.0022 + player.slot) *
    tuning.aimWobble;
  const predictedX = clamp(
    target.candidate.x + target.candidate.vx * tuning.predictionSeconds,
    70,
    WORLD.width - 70,
  );
  const predictedY = clamp(
    target.candidate.y + target.candidate.vy * tuning.predictionSeconds,
    70,
    WORLD.playBottom - 20,
  );
  const slide =
    tuning.usesSlide &&
    player.stamina >= STAMINA.slideCost &&
    player.botClock % 4200 < 120;
  const sprint =
    tuning.usesSprint &&
    target.distance > 350 &&
    player.stamina > 25 &&
    !slide;
  const abilityInterval =
    tuning.id === 'hard' ? 1800 : tuning.id === 'normal' ? 2500 : 3400;
  const abilityPulse = player.botClock % abilityInterval < 90;
  const map = getMapDefinition(state.mapId);
  const assassinationTarget =
    player.characterId === 'agent46'
      ? findAssassinationTarget(state, player, map, now, false)
      : null;
  let skill1 = false;
  let skill2 = false;
  if (abilityPulse) {
    if (player.characterId === 'falcon') {
      skill1 =
        player.skill1Uses > 0 &&
        target.distance <= FLASH_MAX_DISTANCE &&
        target.distance >= 100;
      skill2 =
        target.distance <= 480 &&
        target.distance >= 180 &&
        player.skill2ReadyAt <= now;
    } else if (player.characterId === 'ash') {
      skill1 =
        target.distance <= WEAPONS.mg.range &&
        player.skill1ReadyAt <= now;
      skill2 =
        player.weapon === 'mg' &&
        !player.focusActive &&
        player.stamina > 20;
    } else if (player.characterId === 'agent46') {
      skill1 = player.skill1ReadyAt <= now;
    }
  }

  setInput(state, player.id, {
    ...keys,
    pointerDown,
    sprint,
    slide,
    targetX: predictedX + Math.cos(angleToTarget + Math.PI / 2) * wobble * 500,
    targetY: predictedY + Math.sin(angleToTarget + Math.PI / 2) * wobble * 500,
    weapon: nextWeapon,
    skill1,
    skill2,
    assassinate: Boolean(assassinationTarget),
  });
}

function updatePlayer(state, player, dt, now) {
  const map = getMapDefinition(state.mapId);
  if (!player.alive) {
    player.vx = 0;
    player.vy = 0;
    if (player.respawnAt > 0 && now >= player.respawnAt) {
      respawnPlayer(player, map, now);
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
  const previousX = player.x;
  const previousY = player.y;

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
    skill1: false,
    skill2: false,
    assassinate: false,
    targetX: player.x + Math.cos(player.angle) * 100,
    targetY: player.y + Math.sin(player.angle) * 100,
    weapon: player.weapon,
  };

  player.lastInputAt = now;
  const skill1Pressed = Boolean(input.skill1) && !player.lastPressed.skill1;
  const skill2Pressed = Boolean(input.skill2) && !player.lastPressed.skill2;
  const assassinatePressed =
    Boolean(input.assassinate) && !player.lastPressed.assassinate;
  player.lastPressed.skill1 = Boolean(input.skill1);
  player.lastPressed.skill2 = Boolean(input.skill2);
  player.lastPressed.assassinate = Boolean(input.assassinate);
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

  if (player.jamCastUntil > 0 && now >= player.jamCastUntil) {
    releaseJamWave(state, player, now);
    player.jamCastUntil = 0;
  }
  if (skill1Pressed) {
    if (player.characterId === 'falcon') {
      startFlashbang(state, player, now);
    } else if (player.characterId === 'ash') {
      activateAshBurn(state, player, now);
    } else if (player.characterId === 'agent46') {
      activateRecon(state, player, now);
    }
  }
  if (skill2Pressed) {
    if (player.characterId === 'falcon') {
      startJamCast(state, player, now);
    } else if (player.characterId === 'ash') {
      toggleAshFocus(state, player, now);
    }
  }
  if (assassinatePressed) {
    attemptAssassination(state, player, now);
  }
  if (player.jamCastUntil > now) {
    player.pointerDown = false;
    player.aimStartedAt = 0;
    player.vx = 0;
    player.vy = 0;
    player.sprinting = false;
    return;
  }

  const weapon = WEAPONS[player.weapon];
  const aimHeld = Boolean(input.pointerDown);
  const aimMs = player.aimStartedAt ? now - player.aimStartedAt : 0;
  const effectiveAim = getEffectiveAimStats(
    player.weapon,
    aimMs,
    player.pointerDown,
    player.mgBloom,
    player.characterId,
    isPlayerJammed(player, now),
  );
  const aimCharge = effectiveAim.charge;

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
  const agentScale = player.isBot
    ? (DIFFICULTIES[player.botDifficulty] ?? DIFFICULTIES[DEFAULT_DIFFICULTY])
        .moveScale
    : 1;
  if (sliding) {
    player.sprinting = false;
    moveWithCollision(
      player,
      player.slideDirX *
        STAMINA.slideSpeed *
        (player.characterId === 'falcon' ? 1.35 : 1) *
        dt,
      player.slideDirY *
        STAMINA.slideSpeed *
        (player.characterId === 'falcon' ? 1.35 : 1) *
        dt,
      map.obstacles,
    );
  } else {
    const sprintScale = player.sprinting ? STAMINA.sprintMultiplier : 1;
    const stealthSlow =
      player.characterId === 'agent46' && !player.sprinting ? 0.75 : 1;
    const speed =
      220 * aimScale * carryScale * agentScale * sprintScale * stealthSlow;
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
      const maxBloom = player.focusActive
        ? ASH_MG_FOCUS_MAX_BLOOM
        : MG_MAX_BLOOM;
      const growth = player.focusActive ? 0.75 : 1;
      player.mgBloom = Math.min(maxBloom, player.mgBloom + growth);
      player.mgBloomClock -= 100;
    }
  } else {
    player.mgBloomClock = 0;
  }

  if (player.focusActive) {
    player.stamina = Math.max(0, player.stamina - 10 * dt);
    player.lastStaminaUseAt = now;
    if (player.stamina <= 0) {
      player.focusActive = false;
    }
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
  player.vx = (player.x - previousX) / Math.max(dt, 0.001);
  player.vy = (player.y - previousY) / Math.max(dt, 0.001);
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
      (a, b) =>
        b.score - a.score ||
        b.kills - a.kills ||
        a.deaths - b.deaths ||
        b.damageDealt - a.damageDealt,
    );
    state.winner = ranking[0]?.id ?? null;
    pushEvent(state, { type: 'match-end', winner: state.winner }, now);
    return state;
  }

  state.timeLeft = Math.max(0, state.timeLeft - dt);
  if (state.timeLeft <= 0) {
    state.status = 'ended';
    state.endedAt = now;
    const ranking = [...state.players].sort(
      (a, b) =>
        b.score - a.score ||
        b.kills - a.kills ||
        a.deaths - b.deaths ||
        b.damageDealt - a.damageDealt,
    );
    state.winner = ranking[0]?.id ?? null;
    pushEvent(state, { type: 'match-end', winner: state.winner }, now);
    return state;
  }
  const step = Math.min(dt, 0.05);
  for (const player of state.players) {
    updatePlayer(state, player, step, now);
  }
  updateFlashbangs(state, step, now);
  state.events = state.events.filter((event) => now - event.at < 3500);
  return state;
}

export function getPlayerAim(player, now) {
  const weapon = WEAPONS[player.weapon];
  const aimMs = player.pointerDown ? Math.max(0, now - player.aimStartedAt) : 0;
  const stats = getEffectiveAimStats(
    player.weapon,
    aimMs,
    player.pointerDown,
    player.mgBloom,
    player.characterId,
    isPlayerJammed(player, now),
  );
  return {
    ...stats,
    aimMs,
    weapon,
    reloadRemaining: Math.max(0, player.reloadEnd - now),
  };
}

export function makeSnapshot(state, now) {
  const map = getMapDefinition(state.mapId);
  return {
    at: Date.now(),
    status: state.status,
    mapId: state.mapId,
    matchMode: state.matchMode,
    winner: state.winner,
    timeLeft: state.timeLeft,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      slot: player.slot,
      isBot: player.isBot,
      characterId: player.characterId,
      x: Math.round(player.x * 10) / 10,
      y: Math.round(player.y * 10) / 10,
      vx: Math.round(player.vx),
      vy: Math.round(player.vy),
      angle: player.angle,
      weapon: player.weapon,
      ammo: player.ammo[player.weapon],
      health: player.health,
      alive: player.alive,
      kills: player.kills,
      deaths: player.deaths,
      score: player.score,
      damageDealt: Math.round(player.damageDealt * 10) / 10,
      stamina: Math.round(player.stamina * 10) / 10,
      sprinting: player.sprinting,
      sliding: now < player.slideUntil,
      slideDirX: player.slideDirX,
      slideDirY: player.slideDirY,
      slideCooldownRemaining: Math.max(0, player.slideCooldownEnd - now),
      hitUntil: Math.max(0, player.hitUntil - now),
      respawnRemaining: Math.max(0, player.respawnAt - now),
      invulnerableRemaining: Math.max(0, player.invulnerableUntil - now),
      flashedRemaining: Math.max(0, player.flashedUntil - now),
      burningRemaining: Math.max(0, player.burningUntil - now),
      focusActive: Boolean(player.focusActive),
      jamCastRemaining: Math.max(0, player.jamCastUntil - now),
      jammedRemaining: Math.max(0, player.jammedUntil - now),
      reconRemaining: Math.max(0, player.reconUntil - now),
      skill1ReadyRemaining: Math.max(0, player.skill1ReadyAt - now),
      skill2ReadyRemaining: Math.max(0, player.skill2ReadyAt - now),
      skill1Uses: player.skill1Uses,
      assassinationReady: canAssassinate(state, player, map, now),
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
    flashbangs: state.flashbangs.map((flashbang) => ({
      id: flashbang.id,
      owner: flashbang.owner,
      x: Math.round(flashbang.x * 10) / 10,
      y: Math.round(flashbang.y * 10) / 10,
      explodeRemaining: Math.max(0, flashbang.explodeAt - now),
    })),
    events: state.events
      .filter((event) => now - event.at < 300)
      .map((event) => ({ ...event })),
  };
}
