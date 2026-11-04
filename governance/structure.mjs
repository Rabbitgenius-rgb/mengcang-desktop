import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../', import.meta.url));
const relative = '源码/prototypes/desktop-workbench/src/sublime';
const targets = [path.join(relative, 'SublimeWorkspace.jsx'), path.join(relative, 'SublimeEditors.jsx')];
for (const directory of ['workspace', 'editors', 'hooks']) {
  const full = path.join(root, relative, directory);
  if (
    await fs.stat(full).then(
      (value) => value.isDirectory(),
      () => false,
    )
  )
    targets.push(path.join(relative, directory, '**/*.{js,jsx}'));
}
const componentStateLimit = {
  meta: { type: 'suggestion', schema: [], messages: { excessive: '{{name}} declares {{count}} useState calls; the limit is 8.' } },
  create(context) {
    const frames = [];
    function enter(node) {
      const name =
        node.id?.name ||
        (node.parent.type === 'VariableDeclarator' && node.parent.id.name) ||
        (node.parent.type === 'ExportDefaultDeclaration' && 'DefaultComponent');
      frames.push({ node, name, count: 0 });
    }
    function exit() {
      const frame = frames.pop();
      if (/^[A-Z]/.test(frame.name || '') && frame.count > 8)
        context.report({ node: frame.node, messageId: 'excessive', data: { name: frame.name, count: frame.count } });
    }
    return {
      ':function': enter,
      ':function:exit': exit,
      CallExpression(node) {
        const callee = node.callee;
        if (
          frames.length &&
          ((callee.type === 'Identifier' && callee.name === 'useState') ||
            (callee.type === 'MemberExpression' && callee.object.name === 'React' && callee.property.name === 'useState'))
        )
          frames.at(-1).count++;
      },
    };
  },
};
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [
    {
      files: ['**/*.{js,jsx}'],
      plugins: { governance: { rules: { 'component-state-limit': componentStateLimit } } },
      rules: { 'max-lines': ['error', 400], 'governance/component-state-limit': 'error' },
    },
  ],
});
const results = await eslint.lintFiles(targets);
const failures = results.filter((result) =>
  result.messages.some((issue) => issue.ruleId === 'max-lines' || issue.ruleId === 'governance/component-state-limit' || issue.fatal),
);
if (failures.length) {
  console.error(await (await eslint.loadFormatter('stylish')).format(failures));
  process.exitCode = 1;
} else console.log('Refactored components satisfy the 400-line / 8-state limits.');
