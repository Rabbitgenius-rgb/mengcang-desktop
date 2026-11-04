const maintenanceLock = 'mengcang-attachment-maintenance';
let pending = Promise.resolve();

// Restoration owns provisional originals until its entity transaction and
// rollback finish. Cleanup must inspect originals only after that ownership ends.
export function withAttachmentMaintenance(task, { locks = globalThis.navigator?.locks } = {}) {
  if (locks?.request) return locks.request(maintenanceLock, task);
  const result = pending.catch(() => {}).then(task);
  pending = result.catch(() => {});
  return result;
}
