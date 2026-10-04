import {useLayoutEffect, useRef} from 'react';

// Keep the registered controller stable while reading the latest page state.
export function useWorkspaceNavigation(desktop, viewId, handlers) {
  const current = useRef(handlers);
  current.current = handlers;
  const controller = useRef(null);
  if (!controller.current) {
    controller.current = {
      capture: () => current.current.capture(),
      restore: state => current.current.restore(state),
      open: path => current.current.open(path),
    };
  }
  const register = desktop?.registerNavigation;
  useLayoutEffect(() => {
    if (typeof register !== 'function') return;
    return register(viewId, controller.current);
  }, [register, viewId]);
  return typeof register === 'function';
}
