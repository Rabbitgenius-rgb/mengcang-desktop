import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createWorkspaceStoreV3 } from '../src/sublime/workspaceStoreV3.js';
import { workspaceReducer } from '../src/sublime/workspaceModel.js';
import { cardCapturePayload, sameCaptureRequest } from '../src/sublime/workspaceView.js';
import { inlineWorkspaceAttachment } from '../src/sublime/attachmentStore.js';

test('a retried Vault request compares original bytes across persisted v3 drafts and old inline drafts', async () => {
  const indexedDB = new IDBFactory();
  const open = () => createWorkspaceStoreV3('retry-test', { indexedDB, createChannel: () => null, eventTarget: null });
  const bytes = Buffer.from('RIFF\x00\x00\x00\x00WAVEsynthetic');
  const attachment = { name: 'sample.wav', type: 'audio/wav', size: bytes.length, dataUrl: 'data:audio/wav;base64,' + bytes.toString('base64') };
  const options = { operationId: 'retry-op', caption: '原备注', includeAttachment: true };
  const card = { id: 'sound', type: 'audio', title: '音频', body: '声音', attachment };
  const inline = cardCapturePayload(card, options);
  const store = open();
  await store.update((state) =>
    workspaceReducer(workspaceReducer(state, { type: 'card.upsert', card }), {
      type: 'draft.set',
      key: 'vault:sound',
      value: { operationId: options.operationId, payload: inline },
    }),
  );
  store.close();
  const reopened = open();
  try {
    const state = await reopened.load();
    const selected = state.cards[0];
    const prior = state.drafts['vault:sound'].payload;
    const next = cardCapturePayload({ ...selected, attachment: await inlineWorkspaceAttachment(selected.attachment) }, options);
    assert.notEqual(prior.attachment.dataUrl, next.attachment.dataUrl);
    assert.equal(sameCaptureRequest(prior, next, selected.attachment), true);
    assert.equal(sameCaptureRequest(inline, next, selected.attachment), true);
    assert.equal(sameCaptureRequest(prior, { ...next, caption: '新备注' }, selected.attachment), false);
    assert.equal(sameCaptureRequest(prior, cardCapturePayload(selected, { ...options, includeAttachment: false })), false);
    const differentBytes = Buffer.from(bytes);
    differentBytes[differentBytes.length - 1] ^= 1;
    const different = { ...attachment, dataUrl: 'data:audio/wav;base64,' + differentBytes.toString('base64') };
    assert.equal(sameCaptureRequest(prior, { ...next, attachment: different }, different), false);
  } finally {
    reopened.close();
  }
});
