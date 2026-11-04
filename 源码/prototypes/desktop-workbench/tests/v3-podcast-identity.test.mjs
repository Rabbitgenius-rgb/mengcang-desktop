import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { transform } from 'esbuild';
import { IDBFactory } from 'fake-indexeddb';
import * as model from '../src/sublime/workspaceModel.js';
import * as attachments from '../src/sublime/attachmentStore.js';
import * as registry from '../src/sublime/attachmentRegistry.js';
import * as transcription from '../src/sublime/podcastTranscription.js';
import * as intelligence from '../src/sublime/intelligenceDrafts.js';
import { valueOf } from '../src/desktopModel.js';
import { createWorkspaceStoreV3 } from '../src/sublime/workspaceStoreV3.js';
import { createWorkspaceSession } from '../src/sublime/workspacePersistence.js';
import { buildPodcastClip, parseTimedTranscript } from '../src/sublime/podcastClips.js';
import { fingerprintWorkspaceAttachment } from '../src/sublime/attachmentFingerprint.js';
import { localSearchThumbnail } from '../src/sublime/localMaterialSearch.js';
const compiled = (
  await transform(await readFile(new URL('../src/sublime/workspace/usePodcastJobs.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' })
).code;
const module = { exports: {} };
const dependencies = {
  react: { useRef: (value) => ({ current: value }), useCallback: (callback) => callback, useMemo: (callback) => callback() },
  '.././workspaceModel.js': model,
  '.././attachmentStore.js': attachments,
  '../attachmentRegistry.js': registry,
  '../../desktopModel.js': { valueOf },
  '.././podcastTranscription.js': transcription,
  '.././intelligenceDrafts.js': intelligence,
  './constants.js': { uid: randomUUID },
};
vm.compileFunction(compiled, ['module', 'exports', 'require'])(module, module.exports, (name) => {
  if (!Object.hasOwn(dependencies, name)) throw Error('Unexpected import ' + name);
  return dependencies[name];
});
const { usePodcastJobs } = module.exports;
const wave = (marker) => {
  const bytes = Buffer.alloc(48);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(40, 4);
  bytes.write('WAVE', 8);
  bytes[44] = marker;
  return { name: 'new.wav', type: 'audio/wav', size: bytes.length, dataUrl: `data:audio/wav;base64,${bytes.toString('base64')}` };
};
async function setup(t) {
  const indexedDB = new IDBFactory(),
    files = attachments.createAttachmentStore({ indexedDB });
  const store = createWorkspaceStoreV3('new-audio', { indexedDB, attachments: files, locks: null, createChannel: () => null, eventTarget: null });
  t.after(async () => {
    store.close();
    await files.dispose();
  });
  const session = createWorkspaceSession(store);
  const attachment = wave(1),
    hash = (await fingerprintWorkspaceAttachment(attachment)).sha256;
  const form = {
    sourceId: '',
    attachment,
    sourceAudioSha256: hash,
    start: '00:01',
    end: '00:02',
    transcript: 'WEBVTT\n\n00:01.000 --> 00:02.000\nExisting subtitle',
    transcriptName: 'manual.vtt',
    note: 'My note',
  };
  await session.commit({ type: 'draft.set', key: 'podcastClip', value: form });
  const navigation = [],
    notices = [],
    errors = [],
    requests = [];
  const stateRef = { current: session.state },
    draftRef = { current: session.drafts() };
  const jobs = usePodcastJobs({
    epoch: { current: 1 },
    commit: (actions) => session.commit(actions),
    navigate: (...args) => navigation.push(args),
    notify: (value) => notices.push(value),
    state: session.state,
    podcastVolatile: { current: new Map() },
    identityId: 'new-audio',
    setAiRevision() {},
    session,
    loadedIdentity: { current: 'new-audio' },
    stateRef,
    draftRef,
    setState(value) {
      stateRef.current = value;
    },
    podcastJobs: { current: new Set() },
    podcastRequests: { current: new Set() },
    setError: (value) => errors.push(value),
    api: {
      intelligenceRequest: async (input) => {
        requests.push(input);
        return { ok: true, data: { text: 'WEBVTT\n\n00:01.000 --> 00:02.000\nMock transcript', engine: 'mock' } };
      },
    },
  });
  return { session, store, files, attachment, form, jobs, navigation, notices, errors, requests };
}
test('new inline audio and the v3 persisted draft share content identity without treating hashing as persistence', async (t) => {
  const h = await setup(t),
    saved = h.session.drafts().podcastClip;
  assert.notEqual(saved.attachment.dataUrl, h.attachment.dataUrl);
  assert.equal(transcription.samePodcastAudio(saved, h.form), true);
  assert.equal(transcription.samePodcastDraft(saved, h.form), true);
  assert.equal(registry.attachmentRefForUrl(h.attachment.dataUrl), null);
  assert.throws(() => attachments.externalizeAttachmentUrls({ attachment: h.attachment }), { code: 'ATTACHMENT_PREPARATION_REQUIRED' });
  const other = wave(2);
  await fingerprintWorkspaceAttachment(other);
  assert.equal(transcription.samePodcastAudio(saved, { ...h.form, attachment: other }), false);
  assert.equal(transcription.samePodcastDraft(saved, { ...h.form, note: 'New input' }), false);
});
test('saving a new audio clip consumes only its equivalent v3 draft and opens the saved card', async (t) => {
  const h = await setup(t);
  const value = buildPodcastClip({
    attachment: h.attachment,
    sourceAudioSha256: h.form.sourceAudioSha256,
    start: 1,
    end: 2,
    cues: parseTimedTranscript(h.form.transcript),
    note: h.form.note,
  });
  await h.jobs.savePodcast(value, { attachment: h.attachment, formSnapshot: structuredClone(h.form) });
  assert.equal(h.session.state.cards.length, 1);
  assert.equal(h.session.drafts().podcastClip, undefined);
  assert.deepEqual(h.navigation, [['card', h.session.state.cards[0].id]]);
  assert.equal(h.requests.length, 0);
});
test('saving while the draft note changes preserves the newer input despite matching audio bytes', async (t) => {
  const h = await setup(t);
  await h.session.commit({ type: 'draft.set', key: 'podcastClip', value: { ...h.form, note: 'A newer note' } });
  const value = buildPodcastClip({
    attachment: h.attachment,
    sourceAudioSha256: h.form.sourceAudioSha256,
    start: 1,
    end: 2,
    cues: parseTimedTranscript(h.form.transcript),
    note: h.form.note,
  });
  await h.jobs.savePodcast(value, { attachment: h.attachment, formSnapshot: structuredClone(h.form) });
  assert.equal(h.session.state.cards.length, 1);
  assert.equal(h.session.drafts().podcastClip.note, 'A newer note');
  assert.equal(h.navigation.length, 0);
  assert.ok(h.notices.some((value) => value.includes('较新的播客草稿已保留')));
});
test('explicit transcription accepts the externalized equivalent draft and sends only the selected original to a mock API', async (t) => {
  const h = await setup(t);
  await h.jobs.transcribePodcast(h.attachment, { provider: 'api', formSnapshot: structuredClone(h.form) });
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].attachment.dataUrl, h.attachment.dataUrl);
  assert.equal(h.session.drafts().podcastClip.transcriptionPhase, 'complete');
  assert.ok(h.session.drafts().podcastClip.transcript.includes('Mock transcript'));
  assert.equal(h.session.drafts().podcastClip.note, h.form.note);
});
test('search thumbnails accept only registered local attachment image URLs', () => {
  const ref = { sha256: '1'.repeat(64), type: 'image/png', size: 8 };
  const native = registry.nativeAttachmentUrl(ref),
    browser = registry.registerAttachmentUrl('blob:http://127.0.0.1/synthetic-image', ref);
  assert.equal(localSearchThumbnail({ image: native }), native);
  assert.equal(localSearchThumbnail({ attachment: { dataUrl: browser } }), browser);
  assert.equal(localSearchThumbnail({ image: 'mengcang-asset://library/not-registered' }), '');
  assert.equal(localSearchThumbnail({ image: 'blob:http://127.0.0.1/unregistered' }), '');
  assert.equal(localSearchThumbnail({ image: registry.nativeAttachmentUrl({ ...ref, type: 'audio/wav' }) }), '');
});
