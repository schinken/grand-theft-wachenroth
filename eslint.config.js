/**
 * @fileoverview The parts of the Google JavaScript Style Guide a linter can
 * check: https://google.github.io/styleguide/jsguide.html. Prettier does the
 * formatting.
 */

import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';

// Slips that still run: the checks of ESLint's recommended set that say
// something about a bug, not about style.
const bugs = `
  array-callback-return for-direction getter-return no-async-promise-executor
  no-case-declarations no-compare-neg-zero no-cond-assign no-const-assign
  no-constant-binary-expression no-constant-condition no-debugger
  no-dupe-args no-dupe-else-if no-dupe-keys no-duplicate-case
  no-duplicate-imports no-empty no-empty-pattern no-ex-assign no-func-assign
  no-global-assign no-import-assign no-loop-func no-loss-of-precision
  no-prototype-builtins no-redeclare no-self-assign no-self-compare
  no-shadow-restricted-names no-sparse-arrays no-template-curly-in-string
  no-unreachable no-unreachable-loop no-unsafe-finally no-unsafe-negation
  no-unsafe-optional-chaining no-useless-assignment no-useless-catch
  use-isnan valid-typeof`;

const rules = {
  ...Object.fromEntries(
    bugs
      .split(/\s+/)
      .filter(Boolean)
      .map(n => [n, 'error'])
  ),
  // 5.1 Local variable declarations
  'no-var': 'error',
  'prefer-const': ['error', {destructuring: 'all'}],
  'one-var': ['error', 'never'],
  // 4.1 Braces are required for all control structures
  curly: ['error', 'all'],
  // 4.4 Column limit: 80; long text and URLs may run over
  'max-len': [
    'error',
    {
      code: 80,
      ignoreUrls: true,
      ignoreStrings: true,
      ignoreTemplateLiterals: true,
      ignoreRegExpLiterals: true,
    },
  ],
  // 5.2 and 5.3 Array and object literals
  'no-array-constructor': 'error',
  'no-object-constructor': 'error',
  // 5.5 Functions
  'prefer-arrow-callback': 'error',
  'prefer-rest-params': 'error',
  'prefer-spread': 'error',
  // 5.6 String literals
  'no-multi-str': 'error',
  'prefer-template': 'error',
  // 5.8 Control structures
  'guard-for-in': 'error',
  'default-case': 'error',
  'default-case-last': 'error',
  'no-fallthrough': 'error',
  'no-throw-literal': 'error',
  // 5.9 this, 5.10 equality, 5.11 disallowed features
  'no-invalid-this': 'error',
  eqeqeq: ['error', 'always', {null: 'ignore'}],
  'no-with': 'error',
  'no-eval': 'error',
  'no-new-func': 'error',
  'no-new-wrappers': 'error',
  'no-extend-native': 'error',
  // 6 Naming
  // Property names may come from outside, like OpenStreetMap's road types.
  camelcase: ['error', {properties: 'never'}],
  'new-cap': 'error',
  // 7 JSDoc on named functions, with parameter and return types
  'jsdoc/require-jsdoc': [
    'error',
    {
      require: {
        FunctionDeclaration: true,
        MethodDefinition: true,
        ClassDeclaration: true,
      },
    },
  ],
  'jsdoc/require-param': 'error',
  'jsdoc/require-param-type': 'error',
  'jsdoc/check-param-names': 'error',
  'jsdoc/require-returns': 'error',
  'jsdoc/require-returns-type': 'error',
  'jsdoc/check-tag-names': 'error',
  'jsdoc/multiline-blocks': 'error',
  'jsdoc/no-multi-asterisks': 'error',
  // General hygiene
  'no-undef': 'error',
  // UpperCamelCase names are JSDoc typedefs, which nothing reads at run time.
  'no-unused-vars': ['error', {varsIgnorePattern: '^[A-Z][a-z]'}],
};

export default [
  {
    ignores: [
      'map.js',
      'node_modules/',
      '.playwright-mcp/',
      '_site/',
      '.claude/',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
    plugins: {jsdoc},
    settings: {
      jsdoc: {
        mode: 'closure',
        tagNamePreference: {returns: 'return', file: 'fileoverview'},
      },
    },
    rules,
  },
  {
    // One function expression that Playwright calls: not a module.
    files: ['tools/playtest.js'],
    languageOptions: {sourceType: 'script'},
  },
];
