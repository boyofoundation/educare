# EduCare - Educational AI Assistant

**Customized Educational Chat & HTML Project Assistant for Boyo Social Welfare Foundation**

EduCare is an AI-powered educational platform designed for Boyo Social Welfare Foundation (博幼社會福利基金會) and the rural children they serve. Beyond personalized tutoring and Retrieval-Augmented Generation (RAG) over teaching materials, EduCare now ships a **browser-based HTML project assistant** — students and teachers can describe what they want, and the agent plans, edits files, runs static validation, snapshots the result with in-browser git, and previews the page live. Powered by 7 native LLM providers (Gemini, OpenAI, Anthropic, OpenRouter, LM Studio, Ollama, Groq), backed by Turso DB cloud persistence, and sharing works through secure links, QR codes, and offline export packages.

## 🎯 Project Mission

Since 2002, Boyo Social Welfare Foundation has been dedicated to education for disadvantaged rural children, bridging urban-rural education gaps through after-school tutoring and resource sharing. EduCare uses AI to deliver:

- 📚 **Personalized Learning Support** - RAG over PDF/DOCX/MD teaching materials
- 🤖 **24/7 Tutoring Across 7 LLM Providers** - Gemini, OpenAI, Anthropic, OpenRouter, LM Studio, Ollama, Groq
- 🛠️ **HTML Project Assistant** - Describe a page; the agent writes files, validates, snapshots, and previews it
- 📄 **Multi-Format Material Support** - PDF, DOCX, MD with intelligent chunking and embeddings
- 🌐 **Cross-Device Sync** - Turso DB cloud storage with IndexedDB offline fallback
- 🔗 **Sharing & Handoff** - QR codes, secure links, offline export, assistant routing
- 📦 **Offline-First** - Works without an account; export/import assistants as portable packages

## 🚀 Quick Start

**Requirements:** Node.js 18+ and pnpm 11+

1. **Install Dependencies:**

   ```bash
   pnpm install
   ```

2. **Set Environment Variables:**
   Copy `.env.local` and configure your Turso DB credentials (and any LLM API keys you want to default):

   ```bash
   TURSO_DATABASE_URL=...
   TURSO_AUTH_TOKEN=...
   ```

   AI provider keys (Gemini, OpenAI, Anthropic, OpenRouter, LM Studio, Ollama, Groq) can also be set per-user in the app's Settings panel — no env var required.

3. **Initialize Database (Optional):**

   ```bash
   pnpm run init-turso
   ```

4. **Start Development Server:**

   ```bash
   pnpm run dev
   ```

   The app runs at http://localhost:5173. For testing browser encryption and secure-context APIs (the HTML project sandbox needs these), use a self-signed HTTPS dev server:

   ```bash
   pnpm run dev:https
   ```

   First-time visit shows a self-signed cert warning; accept once to continue.

## ✨ Core Features

### 🎓 Educational Tutoring

- **Intelligent Q&A with RAG** - Upload PDF/DOCX/MD materials; AI retrieves context and answers with expandable knowledge citations
- **Background Knowledge Gatherer** - Pre-fetches citations without blocking the streaming reply
- **Personalized System Prompts** - Tune teaching style per assistant; chat history compacts automatically
- **Streaming Responses** - Real-time token streaming with thinking indicators and abort controls
- **Session Token Tracking** - Per-session input/output/reasoning/cache token counts across providers

### 📦 Agent Bundles (local JSON sharing)

Create a portable **Agent Bundle** when a lesson needs a receptionist and several specialist assistants. A bundle contains the selected assistants' system prompts, text knowledge chunks, starter prompts, and an explicit routing map in one `.educare-bundle.json` file.

#### 60-second import guide

1. In the sidebar, choose **Import bundle** and either drop the `.json` file, select it, or paste its JSON.
2. Read the preview: it shows names, descriptions, route entry point, and knowledge size — never system prompts.
3. Choose **Activate bundle**. The imported package stays in this browser's IndexedDB and opens at a local `?bundle=` URL; that URL is not a sharing link.
4. Set your own provider key. **This session** is the default scope (kept in session storage and cleared when the tab closes); **Remember in this browser** is opt-in.
5. Chat with the receptionist. It may automatically transfer to an allowed specialist; its transition record is expandable and the specialist receives a handoff summary.

#### Authoring and safety boundaries

- From the assistant list, choose **Build bundle**; select at least two assistants, pick one receptionist, configure allowed routes/conditions, validate the metadata, then download JSON.
- Bundles are file-based and local-first: importing does not overwrite or upload existing assistants. Deleting an imported bundle also removes only that bundle's conversations.
- Knowledge data is plain `fileName` + `content` text chunks. The app uses agent-driven text search after import; it exports no vectors, embeddings, provider keys, or server credentials.
- Treat an external bundle like any untrusted prompt configuration: inspect the preview, use a provider key you control, and do not expect copied `?bundle=` URLs to work on another device.

### 🛠️ HTML Project Assistant _(new)_

A full in-browser IDE-like workflow powered by **LightningFS + isomorphic-git**:

- **Browser-native git** - Real git history in IndexedDB-backed virtual filesystem; commits, branches, diffs
- **File tree + live preview** - Edit `html`/`css`/`js`/`json`/`svg`/`asset` files; preview the running page in a sandboxed iframe
- **Agent tool packs** - bootstrap (`createProject`), inspect (`listFiles`/`readFile`), edit (`writeFiles`/`replaceInFile`/`modifyLinesInFile`/`copyFile`/`renameFile`), todo (`addTodo`/`updateTodo`/etc.), git (`gitStatus`/`gitLog`/`gitDiff`/`gitCommit`/...), and harness-resident (`reportTurnOutcome`/`getPreviewRuntimeErrors`/`listSnapshots`/`revertToSnapshot`/`lintProject`)
- **Static validation** - Parses HTML/CSS/JS/JSON on write via acorn + css-tree + parse5 + csstree-validator; reports line/column/snippet back to the agent in the same turn
- **VFS sandbox preview** - Manifest-embedded modules, single-pipeline `buildArtifact`, runtime error capture (50-entry ring buffer), ready-ack handshake
- **Snapshot & revert** - Up to 20 snapshots per project; revert restores files and increments `previewVersion`
- **ZIP export** - `pnpm run create-test-data` and the sidebar project manager export full ZIPs
- **Opt-in per assistant** - Toggle HTML project mode on assistant templates that need it (e.g. the new HTML Dev Agent template)

### 🤖 Agentic Harness _(new)_

Multi-turn agent orchestration with checkpointing and recovery:

- **AgentRunController** - Plans first, finalizes at the end, recovers from recoverable tool errors, auto-continues when more work is needed
- **Checkpoint & resume** - Persists run state to IndexedDB; resumes across page reloads and failed turns
- **Loop detection (G12)** - Tightened to truly-consecutive turns to avoid false positives
- **Subagent delegation** - Spawn batched subagent runs for parallel tasks; activities surface in `AgentActivityTimeline`
- **Intent-based tool policy** - Dynamically generates prompts and tool sets based on `new_build`/`resume_project`/`inspect_only`/`targeted_edit`/`finalize` intents
- **Abort signals** - Forwarded from UI → controller → LLM adapter → upstream provider

### 💬 Chat UI Overhaul _(5 phases)_

- **P1 Correctness** - Stable layout, fixed chat width after canvas collapse
- **P2 Accessibility** - Keyboard nav, touch states, ARIA, color-contrast fixes
- **P3 Visual language** - Unified spacing, typography, dark-mode polish
- **P4 Virtualization** - `react-virtuoso` for long conversation histories
- **P5 Starter prompts** - Pre-baked prompts surfaced in the empty state and committed to Turso on save

### 👩‍🏫 Teacher Tools

- **Assistant Management** - Create/edit assistants with name, description, system prompt, RAG chunks, starter prompts, and optional subagent delegation flag
- **Material Integration** - `RAGFileUpload` processes files into chunks with vector embeddings and stores them in Turso
- **Sharing & Collaboration** - `ShareModal` generates QR codes and links; supports public/private modes
- **Encrypted Provider Settings Share** - Share full LLM provider configs (keys included, encrypted) with other teachers
- **Offline Export/Import** - `assistantPackageService` produces a portable `.json` package — bring it to another device without Turso
- **Routing & Handoff** - One assistant can propose a handoff to another assistant when the topic shifts; the user accepts, and the conversation moves with a summary

### 🛡️ Security & Performance

- **Encrypted Storage** - API keys and provider settings encrypted via `cryptoService` before Turso write
- **Secure RNG** - All randomness via `crypto.getRandomValues()` (no `Math.random()` for security-sensitive paths)
- **Turso Credentials** - Injected via `import.meta.env`, never baked into the bundle
- **HTML Project Isolation** - Path traversal rejected at the tool layer; tool inputs validated before handler dispatch
- **Performance** - Preloaded embedding models in the background, lazy `html-git` chunk to keep main bundle small, virtualized chat list

## 🏗️ Technical Architecture

- **Frontend** - React 19.1 + TypeScript + Vite 6
- **State** - React Context (`AppContext`) + hooks; no external state library
- **Database** - Turso DB (cloud SQLite) with IndexedDB fallback
- **AI** - Native adapters for 7 providers; tool-calling & multi-round conversation loops supported by all
- **HTML Project Storage** - IndexedDB (`htmlProjectStore`) backed by LightningFS + isomorphic-git
- **Static Validation** - acorn (JS) + css-tree + csstree-validator (CSS) + parse5 (HTML) — separate chunk to keep main bundle small
- **Agentic Loop** - `AgentRunController` → `llmService` → provider adapter → tool executor → `htmlProjectStore`
- **RAG Pipeline** - `documentParserService` → `textChunkingService` → `embeddingService` (HuggingFace) → `tursoService` (vectors) → `knowledgeSearchService` (LLM-tool retrieval)
- **Preview** - VFS sandbox bridge, `PreviewFrame` iframe with `postMessage` runtime error capture
- **Path Alias** - `@/*` → project root

### Data Models (excerpt from `types.ts`)

- **Assistant** — id, name, description, systemPrompt, ragChunks, starterPrompts, subagentDelegationEnabled?, routableAssistantIds?
- **ChatSession** — id, assistantId, messages, tokenUsage, activeProjectId?, compactContext?, handoffContext?
- **ChatMessage** — role, content, timestamp?, isError?, agentTurnLog?, toolCallLog?, subagentRuns?, citations?, routeProposal?
- **HtmlProject** — id, assistantId, sessionId?, name, entryFile, status, previewVersion, files, todos, snapshots, runtimeDiagnostics
- **AgentRunCheckpoint** — Persisted across reloads; schemaVersion 1
- **RouteProposal** — Pending/accepted/declined/failed assistant handoff
- **TokenUsageTotals** — input/output/cache-creation/cache-read/reasoning/tool tokens

## 🛠️ Development Commands

| Command                          | Description                                             |
| -------------------------------- | ------------------------------------------------------- |
| `pnpm run dev`                   | Start HTTP dev server                                   |
| `pnpm run dev:https`             | Start self-signed HTTPS dev server (needed for sandbox) |
| `pnpm run build`                 | Build production version                                |
| `pnpm run build:analyze`         | Build + open bundle visualizer                          |
| `pnpm run preview`               | Preview production build                                |
| `pnpm run typecheck`             | TypeScript strict type check                            |
| `pnpm run lint`                  | ESLint                                                  |
| `pnpm run lint:fix`              | Auto-fix lint issues                                    |
| `pnpm run format`                | Prettier write                                          |
| `pnpm run format:check`          | Prettier check (no write)                               |
| `pnpm run test`                  | Vitest unit + integration tests                         |
| `pnpm run test:watch`            | Vitest watch mode                                       |
| `pnpm run test:ui`               | Vitest UI                                               |
| `pnpm run test:coverage`         | Vitest coverage report                                  |
| `pnpm run test:e2e`              | Playwright E2E (JSON reporter)                          |
| `pnpm run test:e2e:ui`           | Playwright UI                                           |
| `pnpm run test:model-comparison` | Model-comparison Playwright spec                        |
| `pnpm run quality`               | typecheck + lint + format:check + test                  |
| `pnpm run init-turso`            | Initialize Turso DB                                     |
| `pnpm run migrate-to-turso`      | Migrate data to Turso                                   |
| `pnpm run update-turso-schema`   | Update Turso schema                                     |
| `pnpm run cleanup-turso-schema`  | Clean up old Turso schema columns                       |
| `pnpm run create-test-data`      | Seed test data                                          |
| `pnpm run test-vector-search`    | Manually test vector search                             |
| `pnpm run test-sharing`          | Manually test sharing                                   |
| `pnpm run deploy`                | Build + push to GitHub Pages (boyofoundation/educare)   |

## 📁 Project Structure

```
educare/
├── App.tsx                       # Main app shell
├── index.tsx                     # Entry point
├── types.ts                      # Core TS contracts
├── components/
│   ├── assistant/                # AssistantCard / Editor / List / ShareModal / TemplateSelector / RAGFileUpload
│   ├── canvas/                   # HtmlProjectWorkspace / FileTree / PreviewFrame / AgentRunPanel / ProjectPicker
│   ├── chat/                     # ChatContainer / ChatInput / MessageBubble / StreamingResponse / AgentActivityTimeline / MarkdownContent / WelcomeMessage
│   ├── core/                     # AppShell / AppContext / Layout / ErrorBoundary / ModelLoadingOverlay
│   ├── settings/                 # ProviderSettings / ProviderSettingsShareModal / ApiKeySetup / CacheManagement / RagSettingsModal
│   ├── ui/                       # Button / Modal / Sidebar / CustomSelect / Icons
│   └── features/                 # SharedAssistant (public sharing landing)
├── services/
│   ├── agentRunController.ts     # Multi-turn agent orchestration + checkpoint
│   ├── agentRunCheckpointService.ts  # IndexedDB checkpoint persistence
│   ├── llmService.ts             # Provider-agnostic chat + tool-loop + subagent dispatch
│   ├── llmAdapter.ts             # Provider interface
│   ├── providers/                # Native adapters: gemini / openai / anthropic / openrouter / lmstudio / ollama / groq
│   ├── providerRegistry.ts       # Singleton registry + lazy init
│   ├── htmlProjectStore.ts       # IndexedDB + LightningFS + git snapshots
│   ├── htmlProjectGitService.ts  # isomorphic-git wrapper
│   ├── htmlProjectToolService.ts # All HTML project tool implementations
│   ├── htmlProjectPrompting.ts   # Tool packs + intent classification + sandbox prompts
│   ├── staticValidationService.ts# acorn/css-tree/parse5 validator
│   ├── htmlPreviewService.ts     # VFS sandbox build + manifest
│   ├── previewRuntimeDiagnostics.ts  # iframe postMessage capture
│   ├── embeddingService.ts       # HuggingFace transformers
│   ├── knowledgeSearchService.ts # LLM-tool-based knowledge search
│   ├── knowledgeGatherService.ts # Background citation pre-fetch
│   ├── assistantRoutingService.ts# Route proposals + handoff context
│   ├── assistantPackageService.ts# Offline export/import
│   ├── tursoService.ts           # Cloud SQLite
│   ├── queryCacheService.ts      # RAG query cache
│   ├── cryptoService.ts          # AES encryption for keys & shared payloads
│   ├── chatCompactorService.ts   # Conversation compaction
│   └── ... (60+ services total)
├── scripts/                      # Turso setup, migration, model comparison, validation
├── tests/e2e/                    # Playwright (chat, model-comparison, vfs-preview)
├── public/                       # Static assets
├── docs/                         # Internal documentation
├── hooks/                        # Custom React hooks
├── CLAUDE.md                     # Claude Code dev guide (project conventions)
├── AGENTS.md                     # Agent instructions
└── package.json
```

## 🔧 Quality Assurance

- **ESLint + Prettier** - Flat config, react-hooks rules, prettier integration
- **TypeScript** - Strict mode
- **Vitest + React Testing Library** - 1100+ unit & integration tests; `tests/e2e/` for Playwright
- **Husky + lint-staged** - Pre-commit format + lint
- **Quality Gate** - `pnpm run quality` runs typecheck + lint + format:check + test before merging

## 🌟 Recent Updates (since 2025-09-12)

### HTML Project Assistant

- In-browser git (LightningFS + isomorphic-git) with branches, diffs, snapshots
- 6 git agent tools, 5 harness-resident tools, plus bootstrap/inspect/edit/todo/preview_recheck packs
- VFS sandbox preview with runtime error capture (50-entry ring buffer)
- Static validation via acorn + css-tree + parse5 + csstree-validator
- Per-project ZIP export
- HTML Dev Agent template added to starter templates

### Agentic Harness

- AgentRunController with plan-first / finalize-gate / intent resilience
- Checkpoint & resume via IndexedDB (survives reloads and failed turns)
- Subagent delegation with `AgentActivityTimeline` UI replacing the old `SubagentActivityCard` / `ToolCallCard`
- Loop detection tightened to truly-consecutive turns
- Abort signals plumbed through to LLM providers
- Telemetry ring buffer (200 events) for success-rate analysis

### Chat UI

- Five-phase overhaul: correctness, accessibility, visual, virtualization (react-virtuoso), starter prompts
- Canvas ↔ chat layout stabilization
- Markdown rendering with syntax highlighting + line numbers (rehype-highlight)

### RAG

- Background knowledge gatherer (no UI block while citations are fetched)
- Expandable knowledge citations with chunk ID fingerprints
- LLM-tool-based knowledge search replaces direct vector retrieval
- Query caching service
- Citation caching with abort-signal forwarding

### Routing & Sharing

- Route proposal service with assistant-to-assistant handoff
- Encrypted provider settings share (share your LLM config with another teacher)
- Offline assistant export/import package format
- Sharing callback dependency tracking

### Multi-Provider Support

- Native adapters for 7 providers, all supporting tool-calling and multi-round
- Configurable tool-round caps per session
- Cross-chunk SSE buffering fixes

### Platform

- Self-signed HTTPS dev mode (`pnpm run dev:https`)
- Tailwind CSS build-time integration (no more CDN)
- GitHub Actions deploys to `boyofoundation/educare` GitHub Pages on Node 24

### Security

- `crypto.getRandomValues()` for all security-sensitive randomness
- Turso credentials via `import.meta.env` only
- Path-traversal rejection at HTML project tool layer
- Tool-input validation before handler dispatch

## 🤝 Contribution Guide

See [CLAUDE.md](./CLAUDE.md) for project conventions. Before opening a PR:

```bash
pnpm run quality
```

## 📄 License

MIT License - see [LICENSE](LICENSE).

---

**Boyo Social Welfare Foundation × EdTech Innovation**  
Equal learning opportunities for every child 🌟
