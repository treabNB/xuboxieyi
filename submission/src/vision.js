export const VISION = {
  range: 620,
  halfAngle: (58 * Math.PI) / 180,
  rays: 96,
};

export function rayRectDistance(originX, originY, dirX, dirY, rect) {
  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;
  const axes = [
    [originX, dirX, rect.x, rect.x + rect.w],
    [originY, dirY, rect.y, rect.y + rect.h],
  ];

  for (const [origin, direction, min, max] of axes) {
    if (Math.abs(direction) < 0.00001) {
      if (origin < min || origin > max) {
        return null;
      }
      continue;
    }
    const inverse = 1 / direction;
    let near = (min - origin) * inverse;
    let far = (max - origin) * inverse;
    if (near > far) {
      [near, far] = [far, near];
    }
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMin > tMax) {
      return null;
    }
  }

  return tMin >= 0 ? tMin : null;
}

export function traceRay(
  originX,
  originY,
  angle,
  maxDistance,
  obstacles,
  bounds,
) {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  let distance = maxDistance;
  let blocker = 'range';

  for (const obstacle of obstacles) {
    const hitDistance = rayRectDistance(
      originX,
      originY,
      dirX,
      dirY,
      obstacle,
    );
    if (hitDistance !== null && hitDistance < distance) {
      distance = Math.max(0, hitDistance);
      blocker = 'cover';
    }
  }

  if (bounds) {
    const candidates = [];
    if (dirX > 0) {
      candidates.push((bounds.right - originX) / dirX);
    } else if (dirX < 0) {
      candidates.push((bounds.left - originX) / dirX);
    }
    if (dirY > 0) {
      candidates.push((bounds.bottom - originY) / dirY);
    } else if (dirY < 0) {
      candidates.push((bounds.top - originY) / dirY);
    }
    const boundaryDistance = Math.min(
      ...candidates.filter((candidate) => candidate >= 0),
    );
    if (Number.isFinite(boundaryDistance) && boundaryDistance < distance) {
      distance = boundaryDistance;
      blocker = 'boundary';
    }
  }

  return {
    angle,
    distance,
    blocker,
    x: originX + dirX * distance,
    y: originY + dirY * distance,
  };
}

export function buildVisibilityPolygon({
  originX,
  originY,
  facing,
  halfAngle = VISION.halfAngle,
  range = VISION.range,
  obstacles,
  bounds,
  rays = VISION.rays,
}) {
  const points = [{ x: originX, y: originY }];
  for (let index = 0; index <= rays; index += 1) {
    const angle = facing - halfAngle + (halfAngle * 2 * index) / rays;
    const hit = traceRay(originX, originY, angle, range, obstacles, bounds);
    points.push({ x: hit.x, y: hit.y });
  }
  return points;
}

export function isPointInVision(
  originX,
  originY,
  facing,
  pointX,
  pointY,
  halfAngle = VISION.halfAngle,
  range = VISION.range,
) {
  const dx = pointX - originX;
  const dy = pointY - originY;
  const distance = Math.hypot(dx, dy);
  if (distance > range) {
    return false;
  }
  const delta = Math.atan2(
    Math.sin(Math.atan2(dy, dx) - facing),
    Math.cos(Math.atan2(dy, dx) - facing),
  );
  return Math.abs(delta) <= halfAngle;
}
