# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is EduCare - an Educational AI Assistant application - a React-based web app designed for Lumina Foundation to create, manage, and chat with AI assistants for educational support. AI access is BYOK (bring-your-own-key) across multiple providers (Gemini, OpenAI, Anthropic, OpenRouter, Groq, plus local LLMs via Ollama / LM Studio). The app features agent-driven RAG over PDF, DOCX, and MD files (the model retrieves knowledge by calling a text-search tool — no embeddings), local-first persistence in IndexedDB with Turso DB backing assistant sharing (QR-code links), assistant-to-assistant routing/handoff, and an HTML project workspace (Canvas) with an agentic tool harness.

## Development Commands

- **Start development server**: `pnpm run dev` (runs on Vite)
- **Build for production**: `pnpm run build`
- **Preview production build**: `pnpm run preview`
- **Install dependencies**: `pnpm install`

### Linting & Formatting

- **Lint code**: `pnpm run lint`
- **Auto-fix linting issues**: `pnpm run lint:fix`
- **Format code**: `pnpm run format`
- **Check formatting**: `pnpm run format:check`
- **Type checking**: `pnpm run typecheck`
- **Run all quality checks**: `pnpm run quality`

### Testing

- **Run tests**: `pnpm run test`
- **Run tests in watch mode**: `pnpm run test:watch`
- **Run tests with UI**: `pnpm run test:ui`
- **Generate coverage report**: `pnpm run test:coverage`

**IMPORTANT**: For all testing-related tasks including writing tests, test automation, TDD workflow, and test coverage analysis, always delegate to the `test-automator` agent using the Task tool. This agent is specialized for comprehensive test suite creation with Vitest and React Testing Library following TDD methodology.

## Architecture

### Core Components

- **App.tsx**: Thin entry that mounts `components/core/AppShell.tsx`
- **components/core/AppShell.tsx + AppContext.tsx**: Main orchestration — assistants, sessions, view modes, shared mode, conversation compression
- **types.ts**: Core TypeScript interfaces (Assistant, ChatSession, ChatMessage, RagChunk, RouteProposal, HtmlProject, agent-run contracts)
- **components/**: Feature-organized React components (`assistant/`, `chat/`, `canvas/`, `core/`, `features/`, `settings/`, `ui/`)
- **services/**: Business logic and provider integrations

### Data Layer

- **services/db.ts**: IndexedDB (idb) local persistence for assistants and chat sessions — the primary data store
- **services/tursoService.ts**: Turso DB integration for assistant sharing (`?share=<id>` links and shared-mode loading)
- **services/llmService.ts + llmAdapter.ts + providerRegistry.ts + providers/**: Multi-provider streaming chat with a tool-call loop (knowledge search, routing, HTML project tools)
- **services/agentRunController.ts**: Multi-turn agent runs (auto-continue, checkpoint/resume, abort)
- **services/knowledgeSearchService.ts**: `searchKnowledgeBase` text-search tool over knowledge chunks (normalization + CJK bigram tokenization + scoring)
- **services/knowledgeGatherService.ts**: Hidden first-turn background gatherer that uses the same search tool to produce ragContext + citations
- **services/documentParserService.ts + textChunkingService.ts**: PDF/DOCX/MD parsing and text chunking (pure text chunks, no vectorization)
- **LEGACY — not in the chat path, do not use for new features**: `embeddingService.ts`, `ragQueryService.ts`, `ragCacheManagerV2.ts`, `queryCacheService.ts` (embedding-era chain; only referenced by the cache-management settings UI)

### Key Architecture Patterns

- **State Management**: React hooks with context state (`components/core/AppContext.tsx`), no external state library
- **Data Flow**: IndexedDB (local-first) → React context state → UI components; Turso is only consulted for shared assistants
- **AI Integration**: Provider-agnostic streaming with tool-call rounds; long conversations are compressed via `ChatCompactorService` summary compaction rather than hard truncation
- **RAG Implementation (agentic, no embeddings)**: Knowledge base = pure text chunks (`fileName` + `content`); the model calls the `searchKnowledgeBase` tool on demand, and a first-turn background gather pass (`gatherKnowledge`) injects context + citations
- **Routing/Handoff**: Assistants propose handoffs to other assistants via the `routeToAssistant` tool (user-confirmed, with handoff summary carried into the new session)
- **Sharing System**: Secure assistant sharing with QR codes and short links (`?share=`, `?s=`)
- **Performance**: Optimized UI rendering with mobile-responsive layout

### Environment Configuration

- **API keys are BYOK**: configured per provider in the UI and stored in the browser (localStorage); `GEMINI_API_KEY` in `.env.local` is optional for development convenience
- **TURSO_DATABASE_URL**: Turso database connection URL
- **TURSO_AUTH_TOKEN**: Turso database authentication token
- **Vite Configuration**: Exposes environment variables for both development and production

### Data Models

- **Assistant**: Has id, name, description, systemPrompt, ragChunks, starterPrompts, routableAssistantIds (handoff whitelist), subagentDelegationEnabled, isShared and timestamps
- **ChatSession**: Belongs to assistant; contains message history, token usage, optional compactContext (compressed summary) and handoffContext
- **RagChunk**: Pure text chunk `{ fileName, content }` — the optional `vector` field is legacy and no longer produced on upload
- **RouteProposal / handoffContext**: Assistant-to-assistant handoff contract (reason + summary, user-confirmed)
- **RAG Integration**: Multi-format file processing, intelligent chunking, and agent-driven text-search retrieval with citations (`MessageCitation`)

### Build System

- **TypeScript + React**: Modern React 19.1.1 with TypeScript, using Vite for bundling
- **Dependencies**: Core libraries include @google/genai, @huggingface/transformers, @libsql/client, mammoth, pdfjs-dist, qrcode
- **Development Tools**: ESLint, Prettier, Vitest, Husky, lint-staged for quality assurance
- **Database Scripts**: Custom Turso DB management and migration scripts
- **Path Aliases**: `@/*` maps to project root for imports

## Testing Structure

### Test Files Location

- Service tests: `services/*.test.ts`
- Component tests: `components/*.test.tsx`
- Test utilities: `src/test/`

### Test Conventions

- Use Vitest for unit and integration testing
- Use @testing-library/react for component testing
- Mock external APIs and IndexedDB in tests
- Follow AAA pattern: Arrange, Act, Assert
- Test file naming: `*.test.{ts,tsx}` or `*.spec.{ts,tsx}`

### Quality Gates

- All code must pass ESLint checks
- All code must be formatted with Prettier
- TypeScript compilation must succeed
- All tests must pass
- Pre-commit hooks enforce these standards

**IMPORTANT**: For all linting, syntax checking, type checking, and code quality issues, always delegate to the `linting-specialist` agent using the Task tool. This agent is specialized for automated detection and resolution of ESLint violations, TypeScript errors, formatting issues, and code quality problems.

## Important Notes

- The app requires at least one configured AI provider key to function (BYOK, configurable in UI)
- Data persists locally in IndexedDB; Turso DB backs assistant sharing (`?share=` links) across devices
- Assistant sharing uses secure public links with QR codes
- RAG supports PDF, DOCX, and MD file processing with intelligent chunking; retrieval is agent-driven text search (no embeddings, no model download)
- Chat sessions have token usage tracking and summary-based conversation compression
- This project uses pnpm as the package manager
- Pre-commit hooks automatically lint and format code before commits
- Mobile-responsive design optimized for all device sizes

### Recent Architectural Changes

- **RAG Evolution (2026)**: Replaced embedding/vector similarity search with agent-driven text search — `searchKnowledgeBase` tool + `gatherKnowledge` background gatherer. The embedding chain (`embeddingService` → `ragQueryService` → `ragCacheManagerV2` → `queryCacheService`) is legacy and off the chat path; new features must not depend on it
- **Multi-Provider LLM Adapter**: Replaced the single Gemini service with a provider registry (7 providers incl. local LLMs via Ollama / LM Studio)
- **Local-First Storage**: Assistants/sessions live in IndexedDB (`services/db.ts`); Turso serves shared assistants and short links
- **Agentic Harness**: Multi-turn agent runs with checkpoint/resume, HTML project workspace (Canvas) with tool packs and local git (isomorphic-git), assistant routing/handoff, subagent delegation
- **Enhanced File Processing**: Added support for PDF and DOCX documents alongside markdown
- **UI/UX Overhaul**: Complete redesign with mobile responsiveness and custom styling
- **Development Infrastructure**: Added comprehensive linting, testing, and formatting pipeline
