import { useWorkspaceState } from './workspace/useWorkspaceState.js';
import { useWorkspaceRuntime } from './workspace/useWorkspaceRuntime.jsx';
import { useWorkspaceModels } from './workspace/useWorkspaceModels.jsx';
import { useWorkspaceActions } from './workspace/useWorkspaceActions.jsx';
import { useWorkspaceLifecycle } from './workspace/useWorkspaceLifecycle.jsx';
import { renderWorkspaceView } from './workspace/WorkspaceView.jsx';
import './sublimeWorkspace.css';
import './cardIdentity.css';

export default function SublimeWorkspace({
  items = [],
  api,
  identity,
  demo = false,
  connected = false,
  onExit,
  onRefresh,
  onOpen,
  standalone = false,
  onReady,
}) {
  const props = { items, api, identity, demo, connected, onExit, onRefresh, onOpen, standalone, onReady };
  const ui = useWorkspaceState({ demo });
  const runtime = useWorkspaceRuntime({ ...props, ...ui });
  const models = useWorkspaceModels({ ...props, ...ui, ...runtime, navigate: (...args) => actions.navigate(...args) });
  const actions = useWorkspaceActions({ ...props, ...ui, ...runtime, ...models });
  const view = { ...props, ...ui, ...runtime, ...models, ...actions };
  useWorkspaceLifecycle(view);
  return renderWorkspaceView(view);
}
