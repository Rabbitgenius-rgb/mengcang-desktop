import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceBackupSource, matchingBackupOriginals } from '../src/sublime/workspaceBackupSource.js';

test('original state requires both the same workspace identity and original content', async () => {
  const cards = [{ id: 'a.md', path: 'a.md', title: '原文', body: '第一篇文章', origin: 'vault' }];
  const source = await workspaceBackupSource('source-vault', cards);
  assert.deepEqual([...await matchingBackupOriginals(source, 'source-vault', cards)], ['a.md']);
  assert.deepEqual([...await matchingBackupOriginals(source, 'other-vault', cards)], []);
  assert.deepEqual([...await matchingBackupOriginals(source, 'source-vault', [{ ...cards[0], body: '另一篇文章' }])], []);
  assert.deepEqual([...await matchingBackupOriginals({}, 'source-vault', cards)], []);
});
