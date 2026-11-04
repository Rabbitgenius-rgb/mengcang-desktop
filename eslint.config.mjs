import reactHooks from 'eslint-plugin-react-hooks';

// Extracted views must receive every binding explicitly from the workspace.
export const workspaceBrowserGlobals = Object.fromEntries(
  [
    'window',
    'document',
    'navigator',
    'location',
    'history',
    'localStorage',
    'sessionStorage',
    'fetch',
    'FileReader',
    'FormData',
    'Blob',
    'URL',
    'URLSearchParams',
    'AbortController',
    'TextEncoder',
    'TextDecoder',
    'crypto',
    'structuredClone',
    'setTimeout',
    'clearTimeout',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'innerWidth',
    'innerHeight',
    'console',
    'atob',
    'btoa',
  ].map((name) => [name, 'readonly']),
);

export default [
  {
    files: ['源码/prototypes/desktop-workbench/src/**/*.{js,jsx}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['源码/prototypes/desktop-workbench/src/sublime/workspace/**/*.{js,jsx}'],
    languageOptions: { globals: workspaceBrowserGlobals },
    rules: { 'no-undef': 'error' },
  },
];
