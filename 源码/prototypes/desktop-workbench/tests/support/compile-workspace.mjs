import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Execute the production hook and view modules. IPC, storage, media and child
// views retain the same explicit fixtures used by the handler regressions.
export async function compileWorkspace() {
  const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
  const { outputFiles } = await build({
    entryPoints: [path.join(sourceRoot, 'sublime/SublimeWorkspace.jsx')],
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'transform',
    external: ['react', '@tabler/icons-react'],
    plugins: [{ name: 'workspace-handler-boundaries', setup(builder) {
      builder.onResolve({ filter: /^\./ }, (args) => {
        const resolved = path.resolve(args.resolveDir, args.path);
        if (resolved.endsWith('.css')) return { path: resolved, external: true };
        if (resolved.includes(`${path.sep}workspace${path.sep}`)) return;
        const original = path.relative(path.join(sourceRoot, 'sublime'), resolved).replaceAll(path.sep, '/');
        return { path: original.startsWith('.') ? original : `./${original}`, external: true };
      });
    } }],
  });
  return outputFiles[0].text;
}
