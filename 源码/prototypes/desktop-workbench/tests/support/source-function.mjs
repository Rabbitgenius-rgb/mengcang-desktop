import { parse } from 'espree';

// Extract a production function by syntax range so formatting never changes
// which implementation the isolated regression executes.
export function sourceFunction(source, name) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, ecmaFeatures: { jsx: true } });
  for (const statement of ast.body) {
    const node = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration' ? statement.declaration : statement;
    if (node?.type === 'FunctionDeclaration' && node.id?.name === name) return source.slice(...node.range);
  }
  throw Error(`Production function ${name} was not found.`);
}
