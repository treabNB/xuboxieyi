import assert from 'node:assert/strict';
import {
  buildVisibilityPolygon,
  getVisionProfile,
  isPointInVision,
  traceRay,
  VISION,
} from '../submission/src/vision.js';

const bounds = { left: 46, right: 1554, top: 46, bottom: 840 };
const wall = { x: 300, y: 180, w: 80, h: 240 };

const blocked = traceRay(200, 300, 0, 700, [wall], bounds);
assert.equal(blocked.blocker, 'cover');
assert.ok(Math.abs(blocked.distance - 100) < 0.01);
assert.ok(Math.abs(blocked.x - 300) < 0.01);

const clear = traceRay(200, 300, Math.PI, 200, [wall], bounds);
assert.equal(clear.blocker, 'boundary');
assert.ok(clear.distance < 200);

const polygon = buildVisibilityPolygon({
  originX: 200,
  originY: 300,
  facing: 0,
  obstacles: [wall],
  bounds,
  rays: 64,
});
assert.equal(polygon.length, 66);
assert.ok(polygon.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));

assert.equal(isPointInVision(200, 300, 0, 450, 300), true);
assert.equal(isPointInVision(200, 300, 0, 100, 300), false);
assert.equal(isPointInVision(200, 300, 0, 900, 300), false);

const baseVision = getVisionProfile(false, 1);
const partialVision = getVisionProfile(true, 0.5);
const scopedVision = getVisionProfile(true, 1);
assert.equal(baseVision.halfAngle, VISION.halfAngle);
assert.equal(baseVision.range, VISION.range);
assert.ok(scopedVision.halfAngle < partialVision.halfAngle);
assert.ok(partialVision.halfAngle < baseVision.halfAngle);
assert.ok(scopedVision.range > partialVision.range);
assert.ok(partialVision.range > baseVision.range);

console.log(
  JSON.stringify(
    {
      status: 'passed',
      blockedDistance: blocked.distance,
      boundaryDistance: clear.distance,
      polygonPoints: polygon.length,
      visionRange: VISION.range,
      fieldOfViewDegrees: Math.round((VISION.halfAngle * 2 * 180) / Math.PI),
      sniperAimVision: {
        fieldOfViewDegrees: Math.round(
          (scopedVision.halfAngle * 2 * 180) / Math.PI,
        ),
        range: scopedVision.range,
      },
    },
    null,
    2,
  ),
);
