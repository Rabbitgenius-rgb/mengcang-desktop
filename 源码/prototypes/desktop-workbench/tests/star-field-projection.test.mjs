import test from 'node:test';
import assert from 'node:assert/strict';
import {clampStarCamera, projectStarPoint, starDragMoved, starSeed} from '../src/sublime/starFieldProjection.js';

const viewport = {width: 1200, height: 760};
test('perspective places nearer equal-sized world offsets farther from the image centre', () => {
  const near = projectStarPoint({x: 140, y: 60, z: 180}, {}, viewport);
  const far = projectStarPoint({x: 140, y: 60, z: -180}, {}, viewport);
  assert.ok(near.x > far.x && near.y > far.y && near.scale > far.scale);
  assert.ok(near.visible && far.visible);
  assert.deepEqual(projectStarPoint({x: 0, y: 0, z: 0}, {}, viewport), {x: 600, y: 380, z: 0, scale: 1200 / 850, perspective: 1, visible: true});
});
test('yaw and pitch move points by depth, and restoring the camera restores the exact projection', () => {
  const node = Object.freeze({x: 110, y: -90, z: 140});
  const original = projectStarPoint(node, {}, viewport);
  const rotated = projectStarPoint(node, {yaw: .5, pitch: .3, zoom: 1.2}, viewport);
  assert.notEqual(rotated.x, original.x); assert.notEqual(rotated.y, original.y); assert.notEqual(rotated.z, original.z);
  assert.deepEqual(projectStarPoint(node, {yaw: 0, pitch: 0, zoom: 1}, viewport), original);
});
test('camera bounds prevent invalid scale and accept zero angles without overriding them', () => {
  assert.deepEqual(clampStarCamera({yaw: 9, pitch: -9, zoom: 8}), {yaw: .7, pitch: -.4, zoom: 1.6});
  assert.deepEqual(clampStarCamera({yaw: NaN, pitch: Infinity, zoom: -.5}), {yaw: 0, pitch: 0, zoom: .75});
  for (const yaw of [-.7, .7]) for (const pitch of [-.4, .4]) for (const zoom of [.75, 1.6]) {
    const point = projectStarPoint({x: 380, y: 210, z: 180}, {yaw, pitch, zoom}, viewport);
    assert.ok([point.x, point.y, point.z, point.scale].every(Number.isFinite));
  }
});
test('empty viewport has no keyboard targets and offscreen points remain hidden', () => {
  assert.equal(projectStarPoint({}, {}, {width: 0, height: 0}).visible, false);
  assert.equal(projectStarPoint({x: 4000, y: 0, z: 0}, {}, viewport).visible, false);
});
test('drag threshold uses both axes and deterministic decoration leaves identities stable', () => {
  assert.equal(starDragMoved({x: 0, y: 0}, {x: 4, y: 5}), true);
  assert.equal(starDragMoved({x: 0, y: 0}, {x: 0, y: 7}), true);
  assert.equal(starDragMoved({x: 0, y: 0}, {x: 2, y: 2}), false);
  assert.equal(starSeed('资料-1'), starSeed('资料-1')); assert.notEqual(starSeed('资料-1'), starSeed('资料-2'));
});
