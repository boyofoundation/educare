import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'writable',
        module: 'writable',
        require: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        // Abort API (agentic harness AbortSignal / AbortController)
        AbortSignal: 'readonly',
        AbortController: 'readonly',
        // Fetch API types (used by harness provider/preview tests)
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        // Blob intentionally NOT declared here: components/assistant/__tests__/test-utils.ts
        // declares it via an inline `/* global Blob */` and a global-level entry would trigger
        // no-redeclare. Code that needs Blob uses globalThis.Blob.
        // Runtime/preview harness globals
        performance: 'readonly',
        Window: 'readonly',
        MessageEvent: 'readonly',
        HTMLIFrameElement: 'readonly',
        HTMLElement: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URLSearchParams: 'readonly',
        URL: 'readonly',
        File: 'readonly',
        // 圖片附件處理 (imageAttachmentService)
        FileReader: 'readonly',
        Image: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        MouseEvent: 'readonly',
        Node: 'readonly',
        alert: 'readonly',
        // Web Crypto API globals
        crypto: 'readonly',
        Crypto: 'readonly',
        CryptoKey: 'readonly',
        SubtleCrypto: 'readonly',
        // Text encoding/decoding
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        // Base64 encoding/decoding
        btoa: 'readonly',
        atob: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react': react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-inferrable-types': 'warn',

      // React rules
      'react/react-in-jsx-scope': 'off', // Not needed with new JSX transform
      'react/prop-types': 'off', // Using TypeScript for prop validation
      'react/jsx-uses-react': 'off',
      'react/jsx-uses-vars': 'error',
      'react/jsx-key': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-undef': 'error',
      'react/no-unescaped-entities': 'warn',

      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // React Refresh rules
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // General JavaScript rules
      'no-unused-vars': 'off', // Handled by TypeScript
      'no-console': 'off', // Allow console.log for debugging
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'curly': 'error',
      'no-multiple-empty-lines': ['error', { max: 1 }],
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'comma-dangle': ['error', 'always-multiline'],
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    files: ['**/*.test.{js,jsx,ts,tsx}', '**/*.spec.{js,jsx,ts,tsx}'],
    rules: {
      // Allow console.log in test files
      'no-console': 'off',
    },
  },
  {
    files: ['scripts/**/*.{js,jsx,ts,tsx}'],
    rules: {
      // Allow console.log in script files
      'no-console': 'off',
    },
  },
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      '.claude/worktrees/**',
      '*.config.js',
      '*.config.ts',
      'coverage/**',
      '.vite/**',
      'public/js/pdf.worker.js',
      'playwright-report/**',
      '.codex/**'
    ],
  },
]
