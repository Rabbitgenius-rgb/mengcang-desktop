import React from 'react';
export function useWorkspaceSession({ ready, epoch, setSaving, session, draftRef, stateRef, setState, setError, notify, documentJobs, documentWaiters }) {
  async function commit(actions, options) {
    if (!ready) throw Error('资料库尚未就绪，原数据保持不变。');
    if (session.migrationStatus?.()?.readOnly) throw Error('资料库当前只读，请先导出备份并核对旧版资料。');
    const run = epoch.current;
    setSaving(true);
    const job = session.commit(actions, options);
    draftRef.current = session.drafts();
    try {
      const next = await job;
      if (run === epoch.current) {
        stateRef.current = next;
        draftRef.current = session.drafts();
        setState({ ...next, drafts: session.drafts() });
        setError('');
      } else throw Error('内容已保存至原工作区，当前工作区已切换。');
      return next;
    } catch (e) {
      if (run === epoch.current) setError(e.message);
      throw e;
    } finally {
      if (run === epoch.current) setSaving(session.writing > 0);
    }
  }

  function perform(action, message) {
    const run = epoch.current;
    commit(action)
      .then(() => {
        if (run === epoch.current && message) notify(message);
      })
      .catch(() => {});
  }

  function saveDraft(key, value) {
    const safe = value == null ? null : JSON.parse(JSON.stringify(value));
    perform({ type: 'draft.set', key, value: safe });
  }

  async function settleDocumentJobs(identity, settle) {
    // Retain every outcome registered during this wait, even after a failed job
    // leaves the active map. Include tasks begun while the final snapshot waits.
    const waiter = {
      identity,
      jobs: new Set([...documentJobs.current].filter(([, owner]) => identity === undefined || owner === identity).map(([job]) => job)),
    };
    documentWaiters.current.add(waiter);
    try {
      for (;;) {
        while (waiter.jobs.size) {
          const jobs = [...waiter.jobs];
          waiter.jobs.clear();
          try {
            await Promise.all(jobs);
          } catch (issue) {
            throw Error('摘录尚未保存，请先复制选文保留，再重试保存或退出：' + (issue.message || '保存失败。'));
          }
        }
        const result = await settle();
        if (!waiter.jobs.size) return result;
      }
    } finally {
      documentWaiters.current.delete(waiter);
    }
  }
  return { commit, perform, saveDraft, settleDocumentJobs };
}
