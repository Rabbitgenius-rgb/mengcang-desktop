import reactHooks from 'eslint-plugin-react-hooks';

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
];
