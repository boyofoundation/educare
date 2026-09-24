/// <reference types="vitest" />
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { offlineBuildPlugin } from './scripts/offlineBuildPlugin';

export default defineConfig(() => {
  const useHttps = process.env.VITE_DEV_HTTPS === 'true';

  return {
    plugins: [tailwindcss(), ...(useHttps ? [basicSsl()] : []), offlineBuildPlugin()],
    test: {
      globals: true,
      deps: {
        optimizer: {
          web: {
            include: ['vitest-canvas-mock'],
          },
        },
      },
      environment: 'happy-dom',
      setupFiles: ['./src/test/setup.ts'],
      poolOptions: {
        threads: {
          singleThread: true,
        },
      },
    },
    define: {
      // 移除 Gemini API KEY - 現在由用戶在運行時提供
      'process.env.API_KEY': JSON.stringify(''),
      'process.env.GEMINI_API_KEY': JSON.stringify(''),

      // 移除寫入權限的 API KEY - 現在由用戶提供
      'process.env.TURSOAPI_KEY': JSON.stringify(''),
    },
    base: '/educare/',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      // open-jev and its Transformers.js peer are loaded only after the user opts in.
      dedupe: ['@huggingface/transformers'],
    },
    build: {
      target: 'es2020',
      minify: 'esbuild',
      cssMinify: true,
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        external: ['fsevents'],
        plugins: [
          visualizer({
            filename: 'dist/stats.html',
            open: false,
            gzipSize: true,
          }),
        ],
        output: {
          // 更細緻的 chunk 分割
          manualChunks: id => {
            // Rollup 的 commonjs helper（getDefaultExportFromCjs 等）是全域共用的虛擬模組，
            // 必須釘在 vendor；否則會落入第一個引用它的 async chunk（如 file-processing），
            // 使 vendor / react-vendor 反向靜態 import 該 chunk，把它拖回首屏載入路徑。
            if (id.includes('commonjsHelpers')) {
              return 'vendor';
            }

            // Match only core packages; broad "react" matching also captures
            // react-markdown and react-virtuoso before their deferred rules below.
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
              return 'react-vendor';
            }

            // AI 相關 - 分別處理大型庫
            if (id.includes('@google/genai')) {
              return 'ai-libs';
            }

            // The browser-local experimental router is dynamically imported after the
            // opt-in setting is enabled. Keep its sizeable runtime out of the entry bundle.
            if (
              id.includes('node_modules/open-jev') ||
              id.includes('node_modules/@huggingface/transformers') ||
              id.includes('node_modules/@huggingface/tokenizers') ||
              id.includes('node_modules/onnxruntime-web')
            ) {
              return 'open-jev';
            }

            // Math and geometry runtimes are only loaded for completed math-tool calls.
            if (id.includes('node_modules/mathjs')) {
              return 'mathjs';
            }
            if (id.includes('node_modules/jsxgraph')) {
              return 'jsxgraph';
            }

            // 靜態驗證 parser — 隔離到獨立 chunk 延遲載入
            // (見 .omc/plans/static-validation-phase1-mvp.md 驗收 8)
            if (
              id.includes('node_modules/acorn') ||
              id.includes('node_modules/css-tree') ||
              id.includes('node_modules/csstree-validator') ||
              id.includes('node_modules/parse5')
            ) {
              return 'static-validation';
            }

            // 本地 git 版控 (isomorphic-git + lightning-fs + diff)
            // htmlProjectGitService 全程動態 import,獨立 chunk 延遲載入,不進首屏 bundle (D7)
            // 注意:buffer polyfill 不能放進這個 chunk — isomorphic-git 的間接依賴
            // (safe-buffer/readable-stream/sha.js) 落在 vendor 且 require('buffer'),
            // 會造成 vendor ↔ html-git 循環 chunk 依賴,production 下初始化順序錯亂
            // (base64-js exports 尚未初始化即被存取 → "Cannot set properties of
            // undefined (setting 'byteLength')")。buffer 留在 vendor 與其消費者同 chunk。
            if (
              id.includes('node_modules/isomorphic-git') ||
              id.includes('node_modules/@isomorphic-git') ||
              id.includes('node_modules/diff/')
            ) {
              return 'html-git';
            }

            // 文件處理 - 按需分割
            if (id.includes('pdfjs-dist')) {
              return 'pdf-worker';
            }
            // mammoth 現已全程動態 import（documentParserService.parseDocx），
            // 獨立 async chunk 延遲載入；先前的 TDZ 疑慮源自靜態 import 循環，已不適用
            if (id.includes('node_modules/mammoth') || id.includes('node_modules/jszip')) {
              return 'file-processing';
            }

            // 數據庫
            if (id.includes('@libsql/client')) {
              return 'turso';
            }

            // Markdown 相關
            if (
              id.includes('react-markdown') ||
              id.includes('remark-') ||
              id.includes('rehype-') ||
              id.includes('node_modules/katex') ||
              // Keep transitive math/highlight runtime modules with markdown.
              // Leaving these in the broad vendor chunk makes vendor import
              // the deferred markdown/highlight chunks and pulls them into
              // the entry modulepreload set.
              id.includes('node_modules/micromark-extension-math') ||
              id.includes('node_modules/lowlight')
            ) {
              return 'markdown';
            }

            // The virtualized chat list is loaded with ChatContainer. Keep its runtime out of
            // the entry vendor chunk so the first route does not preload it before chat opens.
            if (id.includes('node_modules/react-virtuoso')) {
              return 'chat-runtime';
            }

            // 代碼高亮
            if (id.includes('highlight.js')) {
              return 'highlight';
            }

            // qrcode 全程動態 import（分享 Modal 生成 QR 時才載入），獨立 async chunk
            if (id.includes('node_modules/qrcode')) {
              return 'qrcode';
            }

            // 其他工具
            if (id.includes('idb')) {
              return 'utils';
            }

            // node_modules 中的其他第三方庫
            if (id.includes('node_modules')) {
              return 'vendor';
            }
          },

          // 優化輸出格式
          format: 'es',
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',

          // 壓縮選項
          compact: true,
        },
      },
    },
    optimizeDeps: {
      exclude: ['fsevents'],
      include: ['react', 'react-dom', '@google/genai', 'qrcode', 'highlight.js', 'idb'],
    },

    // 啟用 tree-shaking
    esbuild: {
      legalComments: 'none',
      treeShaking: true,
      target: 'es2020',
      // drop: ['console', 'debugger'],
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: true,
    },

    // 性能優化
    server: {
      host: 'localhost',
      hmr: {
        overlay: false,
      },
    },

    // CSS 優化
    css: {
      devSourcemap: false,
      postcss: {
        plugins: [],
      },
    },
  };
});
