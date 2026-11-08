import assert from 'node:assert/strict';
import {
  MATCH_MODES,
  STAMINA,
  WEAPONS,
  createPracticeSimulation,
  createSimulation,
  getEffectiveAimStats,
  setInput,
  updateSimulation,
} from '../submission/src/sim.js';

function makeDuel(characterA, characterB, options = {}) {
  const state = createSimulation(
    [
      { id: 'alpha', name: 'Alpha', characterId: characterA },
      { id: 'bravo', name: 'Bravo', characterId: characterB },
    ],
    {
      now: 1000,
      mapId: 'foundry',
      matchMode: 'long',
      ...options,
    },
  );
  const alpha = state.players[0];
  const bravo = state.players[1];
  alpha.x = 180;
  alpha.y = 300;
  alpha.angle = 0;
  bravo.x = 480;
  bravo.y = 300;
  bravo.angle = 0;
  return { state, alpha, bravo };
}

function inputFor(state, player, target, extra = {}) {
  setInput(state, player.id, {
    weapon: player.weapon,
    targetX: target.x,
    targetY: target.y,
    ...extra,
  });
}

function step(state, now, extra = {}) {
  for (const player of state.players) {
    const target = state.players.find((candidate) => candidate.id !== player.id);
    inputFor(state, player, target, extra[player.id] ?? {});
  }
  updateSimulation(state, 0.05, now);
}

{
  const quick = createPracticeSimulation('Quick', {
    matchMode: 'quick',
    now: 1000,
  });
  assert.equal(quick.matchMode, 'quick');
  assert.equal(quick.players.length, 2);
  assert.equal(quick.players.every((player) => player.characterId === null), true);

  for (const characterId of ['falcon', 'ash', 'agent46']) {
    const long = createPracticeSimulation('Long', {
      matchMode: 'long',
      characterId,
      now: 1000,
    });
    assert.equal(long.matchMode, 'long');
    assert.equal(long.timeLeft, MATCH_MODES.long.durationSeconds);
    assert.equal(long.players.length, 3);
    assert.deepEqual(
      new Set(long.players.map((player) => player.characterId)),
      new Set(['falcon', 'ash', 'agent46']),
    );
  }
}

{
  const state = createPracticeSimulation('Tester', {
    matchMode: 'long',
    characterId: 'falcon',
    difficulty: 'hard',
    now: 1000,
  });
  const human = state.players.find((player) => !player.isBot);
  human.health = 10000;
  let now = 1000;
  for (let elapsed = 0; elapsed < 4000; elapsed += 50) {
    now += 50;
    updateSimulation(state, 0.05, now);
  }
  assert.ok(
    state.players.some(
      (player) =>
        player.isBot &&
        (player.skill1ReadyAt > now ||
          player.skill2ReadyAt > now ||
          player.reconUntil > now ||
          player.burningUntil > now),
    ),
    'long-mode bots should use their active abilities',
  );
}

{
  const { state, alpha, bravo } = makeDuel('falcon', 'ash');
  const now = 1050;
  alpha.score = 15;
  bravo.score = 14;
  alpha.weapon = 'pistol';
  alpha.aimStartedAt = now - 200;
  alpha.pointerDown = true;
  inputFor(state, alpha, bravo, { pointerDown: false, weapon: 'pistol' });
  updateSimulation(state, 0.05, now);
  assert.equal(state.status, 'playing', 'long mode ignored the quick score cap');

  state.timeLeft = 0.01;
  alpha.score = 4;
  bravo.score = 4;
  alpha.kills = 4;
  bravo.kills = 4;
  alpha.deaths = 1;
  bravo.deaths = 0;
  updateSimulation(state, 0.05, 1100);
  assert.equal(state.status, 'ended');
  assert.equal(state.winner, bravo.id);
}

{
  const { state, alpha, bravo } = makeDuel('falcon', 'falcon');
  bravo.alive = false;
  bravo.health = 0;
  bravo.respawnAt = 1000;
  updateSimulation(state, 0.05, 1001);
  assert.equal(bravo.alive, true);
  assert.ok(bravo.invulnerableUntil >= 3001);
  bravo.x = 480;
  bravo.y = 300;
  bravo.angle = 0;

  alpha.weapon = 'pistol';
  alpha.pointerDown = true;
  alpha.aimStartedAt = 950;
  inputFor(state, alpha, bravo, { pointerDown: false });
  updateSimulation(state, 0.05, 1010);
  assert.equal(bravo.health, 100);
  assert.ok(state.events.some((event) => event.type === 'shield'));
}

{
  const { state, alpha, bravo } = makeDuel('falcon', 'ash');
  inputFor(state, alpha, bravo, { skill1: true });
  updateSimulation(state, 0.05, 1050);
  assert.equal(alpha.skill1Uses, 2);
  assert.equal(state.flashbangs.length, 1);
  inputFor(state, alpha, bravo, { skill1: false });
  updateSimulation(state, 0.05, 1100);
  for (let now = 1150; now <= 2600; now += 50) {
    step(state, now);
  }
  assert.ok(bravo.flashedUntil >= 4000);
}

{
  const { state, alpha, bravo } = makeDuel('falcon', 'falcon');
  inputFor(state, alpha, bravo, { skill2: true });
  updateSimulation(state, 0.05, 1050);
  assert.ok(alpha.jamCastUntil >= 6000);
  const lockedX = alpha.x;
  inputFor(state, alpha, bravo, { right: true, skill2: false });
  updateSimulation(state, 0.05, 1100);
  assert.equal(alpha.x, lockedX);
  alpha.jamCastUntil = 1090;
  updateSimulation(state, 0.05, 1100);
  assert.ok(bravo.jammedUntil >= 14100);
  const baseSpread = WEAPONS.pistol.spreadStart;
  const jammedSpread = getEffectiveAimStats(
    'pistol',
    0,
    false,
    0,
    bravo.characterId,
    true,
  ).spread;
  assert.ok(jammedSpread > (baseSpread * Math.PI) / 180);
}

{
  const { state, alpha, bravo } = makeDuel('ash', 'falcon');
  inputFor(state, alpha, bravo, { skill1: true });
  updateSimulation(state, 0.05, 1050);
  assert.ok(alpha.burningUntil >= 21000);
  alpha.weapon = 'mg';
  alpha.stamina = STAMINA.max;
  alpha.pointerDown = true;
  alpha.aimStartedAt = 930;
  inputFor(state, alpha, bravo, { pointerDown: true, weapon: 'mg', skill1: false });
  updateSimulation(state, 0.05, 1060);
  assert.equal(bravo.health, 82);

  inputFor(state, alpha, bravo, { skill2: true, weapon: 'mg' });
  updateSimulation(state, 0.05, 1110);
  assert.equal(alpha.focusActive, true);
  const staminaBefore = alpha.stamina;
  inputFor(state, alpha, bravo, { skill2: false, weapon: 'mg' });
  updateSimulation(state, 0.05, 1160);
  assert.ok(alpha.stamina < staminaBefore);

  const sniperAim = getEffectiveAimStats(
    'sniper',
    1350,
    true,
    0,
    alpha.characterId,
    false,
  );
  assert.equal(sniperAim.charge, 0);
  assert.equal(sniperAim.spread, (18 * Math.PI) / 180);
}

{
  const { state, alpha, bravo } = makeDuel('falcon', 'ash');
  alpha.weapon = 'pistol';
  alpha.pointerDown = true;
  alpha.aimStartedAt = 950;
  inputFor(state, alpha, bravo, { pointerDown: false });
  updateSimulation(state, 0.05, 1010);
  assert.equal(bravo.health, 79, 'ash reduced pistol damage by 20%');
}

{
  const { state, alpha, bravo } = makeDuel('agent46', 'falcon');
  inputFor(state, alpha, bravo, { skill1: true });
  updateSimulation(state, 0.05, 1050);
  assert.ok(alpha.reconUntil >= 3000);
  inputFor(state, alpha, bravo, { skill1: false });
  updateSimulation(state, 0.05, 1100);

  const { state: melee, alpha: killer, bravo: victim } = makeDuel(
    'agent46',
    'falcon',
  );
  killer.x = 440;
  killer.y = 300;
  victim.x = 480;
  victim.y = 300;
  victim.angle = 0;
  inputFor(melee, killer, victim, { assassinate: true });
  updateSimulation(melee, 0.05, 1050);
  assert.equal(victim.alive, false);
  assert.equal(killer.score, 1);
}

console.log(
  JSON.stringify(
    {
      status: 'passed',
      matchModes: Object.keys(MATCH_MODES),
      spawnProtectionMs: 2000,
      flashUses: 3,
      jamDurationMs: 13000,
      ashDamageReduction: 0.2,
      assassinationRange: 58,
    },
    null,
    2,
  ),
);
