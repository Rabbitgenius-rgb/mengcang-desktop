import React from 'react';
import { IconLoader2, IconX } from '@tabler/icons-react';
export function ErrorMessage({ error }) {
  return error ? (
    <p className="se-error" role="alert">
      {error}
    </p>
  ) : null;
}
export function EditorHeader({ title, onCancel, busy = false, saveLabel = '保存', onSave }) {
  return (
    <header className="se-heading">
      <h1>{title}</h1>
      <div>
        <button type="button" className="se-icon-button" aria-label="关闭编辑器" disabled={busy} onClick={onCancel}>
          <IconX size={22} />
        </button>
        {onSave && (
          <button type="button" className="se-save" disabled={busy} onClick={onSave}>
            {busy ? <IconLoader2 className="se-spin" size={18} /> : null}
            {busy ? '正在保存…' : saveLabel}
          </button>
        )}
      </div>
    </header>
  );
}

export function FlagButton({ label, icon: Icon, checked, onChange, disabled }) {
  return (
    <button
      type="button"
      className={`se-flag-toggle ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <Icon size={17} />
      <span>{label}</span>
      <i aria-hidden="true" />
    </button>
  );
}
