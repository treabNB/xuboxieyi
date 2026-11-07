import assert from 'node:assert/strict';
import {
  MG_MAX_BLOOM,
  STAMINA,
  WEAPONS,
  createPracticeSimulation,
  createSimulation,
  DIFFICULTIES,
  normalizeAngle,
  setInput,
  updateSimulation,
} from '../submission/src/sim.js';
import { MAP_ORDER, MAPS } from '../submission/src/maps.js';

for (const mapId of MAP_ORDER) {
  const map = MAPS[mapId];
  assert.equal(map.spawns.length, 4);
  assert.ok(map.obstacles.length >= 10);
  for (const spawn of map.spawns) {
    for (const obstacle of map.obstacles) {
      const nearestX = Math.max(obstacle.x, Math.min(spawn.x, obstacle.x + obstacle.w));
      const nearestY = Math.max(obstacle.y, Math.min(spawn.y, obstacle.y + obstacle.h));
      const distance = Math.hypot(spawn.x - nearestX, spawn.y - nearestY);
      assert.ok(distance > 18, `${mapId} spawn overlaps ${obstacle.label}`);
    }
  }
}

for (const difficulty of ['easy', 'normal', 'hard']) {
  const practice = createPracticeSimulation('Tester', { difficulty });
  const bot = practice.players.find((player) => player.isBot);
  assert.equal(practice.difficulty, difficulty);
  assert.equal(bot.botDifficulty, difficulty);
}
assert.ok(DIFFICULTIES.easy.aimWobble > DIFFICULTIES.normal.aimWobble);
assert.ok(DIFFICULTIES.normal.aimWobble > DIFFICULTIES.hard.aimWobble);
assert.ok(
  DIFFICULTIES.easy.predictionSeconds <
    DIFFICULTIES.normal.predictionSeconds,
);
assert.ok(
  DIFFICULTIES.normal.predictionSeconds <
    DIFFICULTIES.hard.predictionSeconds,
);
assert.equal(DIFFICULTIES.hard.usesSlide, true);

function botAimError(difficulty, durationMs = 500) {
  const state = createPracticeSimulation('Tester', {
    difficulty,
    now: 1000,
  });
  const human = state.players.find((player) => !player.isBot);
  const bot = state.players.find((player) => player.isBot);
  human.health = 1000;
  let now = 1000;
  let hardSprintObserved = false;
  for (let elapsed = 0; elapsed < durationMs; elapsed += 50) {
    now += 50;
    updateSimulation(state, 0.05, now);
    if (difficulty === 'hard' && state.inputs[bot.id]?.sprint) {
      hardSprintObserved = true;
    }
  }
  const input = state.inputs[bot.id];
  const aimedAt = Math.atan2(input.targetY - bot.y, input.targetX - bot.x);
  const targetAngle = Math.atan2(human.y - bot.y, human.x - bot.x);
  return {
    error: Math.abs(normalizeAngle(aimedAt - targetAngle)),
    hardSprintObserved,
  };
}

const easyAim = botAimError('easy');
const normalAim = botAimError('normal');
const hardAim = botAimError('hard');
assert.ok(easyAim.error > normalAim.error);
assert.ok(normalAim.error > hardAim.error);
assert.equal(hardAim.hardSprintObserved, true);

{
  const state = createPracticeSimulation('Tester', {
    difficulty: 'hard',
    now: 1000,
  });
  const human = state.players.find((player) => !player.isBot);
  const bot = state.players.find((player) => player.isBot);
  human.health = 10000;
  let now = 1000;
  let usedSlide = false;
  for (let elapsed = 0; elapsed < 4200; elapsed += 50) {
    now += 50;
    updateSimulation(state, 0.05, now);
    usedSlide ||= Boolean(state.inputs[bot.id]?.slide);
  }
  assert.equal(usedSlide, true);
}

function createTestSimulation(weapon = 'pistol') {
  const state = createSimulation(
    [
      { id: 'alpha', name: 'Alpha' },
      { id: 'bravo', name: 'Bravo' },
    ],
    { now: 1000 },
  );
  const player = state.players[0];
  const target = state.players[1];
  player.x = 700;
  player.y = 650;
  player.weapon = weapon;
  target.x = 1300;
  target.y = 650;
  return { state, player, target };
}

function run(state, startNow, durationMs, input, stepMs = 50) {
  const steps = Math.round(durationMs / stepMs);
  let now = startNow;
  for (let index = 0; index < steps; index += 1) {
    setInput(state, 'alpha', {
      weapon: state.players[0].weapon,
      targetX: 1300,
      targetY: 650,
      ...input,
    });
    now += stepMs;
    updateSimulation(state, stepMs / 1000, now);
  }
  return now;
}

{
  const walk = createTestSimulation('pistol');
  const walkEnd = run(walk.state, 1000, 500, { right: true });
  const walkDistance = walk.player.x - 700;

  const mg = createTestSimulation('mg');
  const mgEnd = run(mg.state, 1000, 500, { right: true });
  const mgDistance = mg.player.x - 700;
  assert.ok(walkEnd > 1000 && mgEnd > 1000);
  assert.ok(Math.abs(walkDistance - 110) < 0.01);
  assert.ok(Math.abs(mgDistance / walkDistance - 0.75) < 0.01);
}

{
  const sprint = createTestSimulation('pistol');
  const sprintEnd = run(sprint.state, 1000, 500, {
    right: true,
    sprint: true,
  });
  const distance = sprint.player.x - 700;
  assert.ok(distance > 150);
  assert.ok(
    Math.abs(distance / (220 * 0.5) - STAMINA.sprintMultiplier) < 0.01,
  );
  assert.ok(sprint.player.stamina < 92);

  const staminaAfterSprint = sprint.player.stamina;
  const regenEnd = run(sprint.state, sprintEnd, 1600, {});
  assert.ok(regenEnd > sprintEnd);
  assert.ok(sprint.player.stamina > staminaAfterSprint + 8);
}

{
  const slide = createTestSimulation('pistol');
  let now = run(slide.state, 1000, 50, { right: true, slide: true });
  const slideStartedAt = slide.player.x;
  now = run(slide.state, now, 350, { right: true });
  assert.ok(slide.player.x - slideStartedAt > 80);
  assert.ok(slide.player.stamina <= STAMINA.max - STAMINA.slideCost);
  assert.ok(slide.player.slideCooldownEnd > now);

  const beforeSecondAttempt = slide.player.x;
  now = run(slide.state, now, 100, { right: true, slide: true });
  assert.ok(slide.player.x > beforeSecondAttempt);
  assert.ok(slide.player.slideCooldownEnd > now);
}

{
  const sniper = createTestSimulation('sniper');
  let now = run(sniper.state, 1000, 300, { pointerDown: true });
  now = run(sniper.state, now, 50, { pointerDown: false });
  assert.equal(sniper.player.ammo.sniper, 4);
  assert.ok(
    Math.abs(sniper.player.stamina - (STAMINA.max - WEAPONS.sniper.staminaCost)) <
      0.01,
  );
  assert.ok(now > 1000);
}

{
  const mg = createTestSimulation('mg');
  let now = run(mg.state, 1000, 1000, { pointerDown: true });
  assert.ok(mg.player.mgBloom >= 7 && mg.player.mgBloom <= 10);
  assert.ok(mg.player.stamina < STAMINA.max);
  const peakBloom = mg.player.mgBloom;
  const peakStamina = mg.player.stamina;
  now = run(mg.state, now, 1200, { pointerDown: false });
  assert.ok(mg.player.mgBloom < peakBloom);
  assert.ok(mg.player.stamina > peakStamina);
  assert.ok(mg.player.mgBloom <= MG_MAX_BLOOM);
  assert.ok(now > 2000);
}

console.log(
  JSON.stringify(
    {
      status: 'passed',
      sprintMultiplier: STAMINA.sprintMultiplier,
      slideCost: STAMINA.slideCost,
      slideCooldownMs: STAMINA.slideCooldownMs,
      sniperStaminaCost: WEAPONS.sniper.staminaCost,
      mgStaminaCost: WEAPONS.mg.staminaCost,
      mgMaxBloom: MG_MAX_BLOOM,
      maps: MAP_ORDER,
      difficulties: Object.keys(DIFFICULTIES),
      aimError: {
        easy: easyAim.error,
        normal: normalAim.error,
        hard: hardAim.error,
      },
    },
    null,
    2,
  ),
);
