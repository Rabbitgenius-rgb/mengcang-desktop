export const STAR_CAMERA_LIMITS = Object.freeze({yaw: .7, pitch: .4, minZoom: .75, maxZoom: 1.6});

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bound = (value, min, max) => Math.max(min, Math.min(max, value));

export function clampStarCamera(camera = {}) {
  return {
    yaw: bound(finite(camera?.yaw, 0), -STAR_CAMERA_LIMITS.yaw, STAR_CAMERA_LIMITS.yaw),
    pitch: bound(finite(camera?.pitch, 0), -STAR_CAMERA_LIMITS.pitch, STAR_CAMERA_LIMITS.pitch),
    zoom: bound(finite(camera?.zoom, 1), STAR_CAMERA_LIMITS.minZoom, STAR_CAMERA_LIMITS.maxZoom),
  };
}

/** A perspective camera looking toward the origin. Positive z is nearer the viewer. */
export function projectStarPoint(point, camera, viewport) {
  const {yaw, pitch, zoom} = clampStarCamera(camera);
  const width = Math.max(0, finite(viewport?.width, 0));
  const height = Math.max(0, finite(viewport?.height, 0));
  const x = finite(point?.x, 0), y = finite(point?.y, 0), z = finite(point?.z, 0);
  const yawX = x * Math.cos(yaw) + z * Math.sin(yaw);
  const yawZ = -x * Math.sin(yaw) + z * Math.cos(yaw);
  const rotatedY = y * Math.cos(pitch) - yawZ * Math.sin(pitch);
  const rotatedZ = y * Math.sin(pitch) + yawZ * Math.cos(pitch);
  const distance = 900 - rotatedZ;
  const perspective = 900 / Math.max(80, distance);
  const scale = Math.min(width / 850, height / 360) * zoom * perspective;
  const screenX = width / 2 + yawX * scale;
  const screenY = height / 2 + rotatedY * scale;
  return {
    x: screenX, y: screenY, z: rotatedZ, scale, perspective,
    visible: width > 0 && height > 0 && distance > 80 && screenX >= 12 && screenX <= width - 12 && screenY >= 12 && screenY <= height - 12,
  };
}

/** Stable decoration seeds never affect layout, record identity, or search results. */
export function starSeed(id) {
  let value = 2166136261;
  for (const character of String(id)) value = Math.imul(value ^ character.codePointAt(0), 16777619);
  return (value >>> 0) / 4294967296;
}

export function starDragMoved(start, current, threshold = 6) {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}
