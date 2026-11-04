import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {transform} from 'esbuild';

const source = await readFile(new URL('../src/sublime/ZoomableImage.jsx', import.meta.url), 'utf8');
const compiled = await transform(source, {loader:'jsx', format:'cjs'});
const require = createRequire(import.meta.url);
const component = {exports:{}};
vm.runInNewContext(compiled.code, {module:component, exports:component.exports, require:id => id.endsWith('.css') ? {} : require(id)});
const {displayedImageSize, viewerImageWidth} = component.exports;

function detailSize(naturalWidth, naturalHeight, width, height) {
  return displayedImageSize({naturalWidth, naturalHeight, getBoundingClientRect:() => ({left:0, top:0, width, height})});
}

test('W3 concept image opens larger than the 800px detail even when its source is only 512px wide', () => {
  const detail = detailSize(512, 468, 800, 731.25);
  const viewport = {clientWidth:1400, clientHeight:780};
  assert.equal(viewerImageWidth(detail, viewport, false), 1600);
  assert.equal(viewerImageWidth(detail, viewport, true), 800);
});

test('whole image fits a shorter resized window, while detail inspection still allows scrolling', () => {
  const detail = detailSize(512, 468, 560, 511.875);
  const viewport = {clientWidth:600, clientHeight:300};
  const fit = viewerImageWidth(detail, viewport, true);
  assert.ok(fit <= viewport.clientWidth);
  assert.ok(Math.abs(fit / detail.ratio - viewport.clientHeight) < 0.001);
  assert.equal(viewerImageWidth(detail, viewport, false), 1120);
});

test('a height-limited preview measures the contained pixels and excludes its letterboxing', () => {
  const detail = detailSize(400, 800, 800, 280);
  assert.equal(detail.width, 140);
  assert.equal(detail.height, 280);
  assert.equal(detail.left, 330);
  assert.equal(detail.top, 0);
  assert.equal(viewerImageWidth(detail, {clientWidth:900, clientHeight:700}, false), 280);
  assert.equal(detailSize(0, 0, 800, 280), null);
});
