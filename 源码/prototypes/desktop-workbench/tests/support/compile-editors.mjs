import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Bundle the extracted production editors. External services keep the same
// module IDs as the prior harness, so its network/DOM boundaries stay explicit.
export async function compileEditors() {
  const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
  const { outputFiles } = await build({
    entryPoints: [path.join(sourceRoot, 'sublime/SublimeEditors.jsx')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'transform',
    external: ['react', '@tabler/icons-react'],
    plugins: [
      {
        name: 'editor-test-boundaries',
        setup(builder) {
          builder.onResolve({ filter: /^\./ }, (args) => {
            const resolved = path.resolve(args.resolveDir, args.path);
            if (resolved.endsWith('.css')) return { path: resolved, external: true };
            if (resolved.includes(`${path.sep}editors${path.sep}`)) return;
            const original = path.relative(path.join(sourceRoot, 'sublime'), resolved).replaceAll(path.sep, '/');
            return { path: original.startsWith('.') ? original : `./${original}`, external: true };
          });
        },
      },
    ],
  });
  return outputFiles[0].text;
}
