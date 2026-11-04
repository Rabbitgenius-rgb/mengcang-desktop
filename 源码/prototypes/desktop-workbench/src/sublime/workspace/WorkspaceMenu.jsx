import React, { useLayoutEffect, useRef } from 'react';

export function WorkspaceMenu({ anchor, onClose, children, ...props }) {
  const element = useRef(null);
  useLayoutEffect(() => {
    const trigger = anchor || document.activeElement;
    element.current?.querySelector('[role="menuitem"]:not(:disabled),button:not(:disabled),select,input')?.focus();
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, [anchor]);
  function keydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.target.matches('input,textarea,select,[contenteditable="true"]')) return;
    const controls = [...element.current.querySelectorAll('[role="menuitem"]:not(:disabled),button:not(:disabled),select,input')];
    const index = controls.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % controls.length;
    if (event.key === 'ArrowUp') next = (index - 1 + controls.length) % controls.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = controls.length - 1;
    if (next !== undefined && controls.length) {
      event.preventDefault();
      controls[next].focus();
    }
  }
  return (
    <div {...props} ref={element} onKeyDown={keydown}>
      {children}
    </div>
  );
}
