import type { Assistant, ChatMessage, ChatSession, HtmlProject } from '../types';

/** Searchable local navigation entities. Shared/bundle data is intentionally excluded by callers. */
export type LocalSearchResultKind = 'assistant' | 'session' | 'message' | 'material' | 'project';

export interface LocalSearchResult {
  id: string;
  kind: LocalSearchResultKind;
  title: string;
  subtitle: string;
  snippet: string;
  assistantId: string;
  sessionId?: string;
  messageIndex?: number;
  /** Zero-based RAG chunk index for material results. */
  chunkIndex?: number;
  projectId?: string;
  score: number;
  updatedAt: number;
}

export interface LocalSearchInput {
  query: string;
  assistants: Assistant[];
  sessions: ChatSession[];
  projects?: HtmlProject[];
  limit?: number;
}

const DEFAULT_LIMIT = 24;
const MAX_SNIPPET_LENGTH = 180;

const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase();

const compact = (value: string, maxLength = MAX_SNIPPET_LENGTH): string => {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const scoreText = (query: string, text: string, title = false): number => {
  const normalizedText = normalize(text);
  if (!normalizedText || !query) {
    return 0;
  }
  if (normalizedText === query) {
    return title ? 100 : 80;
  }
  if (normalizedText.startsWith(query)) {
    return title ? 70 : 55;
  }
  if (normalizedText.includes(query)) {
    return title ? 50 : 35;
  }

  // Match all query terms independently so a search such as "physics exam" remains
  // useful without introducing a fuzzy-search dependency or nondeterministic ranking.
  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length > 1 && terms.every(term => normalizedText.includes(term))) {
    return title ? 30 : 20;
  }
  return 0;
};

const scoreFields = (query: string, fields: Array<{ value: string; weight: number }>): number =>
  fields.reduce((best, field) => Math.max(best, scoreText(query, field.value) * field.weight), 0);

const messageLabel = (message: ChatMessage): string => (message.role === 'user' ? '你' : '助理');

const sortResults = (results: LocalSearchResult[]): LocalSearchResult[] =>
  results.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.id.localeCompare(right.id);
  });

const addAssistantResults = (
  query: string,
  assistants: Assistant[],
  results: LocalSearchResult[],
): void => {
  for (const assistant of assistants) {
    const score = scoreFields(query, [
      { value: assistant.name, weight: 1.4 },
      { value: assistant.description, weight: 0.8 },
      ...(assistant.category ? [{ value: assistant.category, weight: 0.7 }] : []),
    ]);
    if (score) {
      results.push({
        id: assistant.id,
        kind: 'assistant',
        title: assistant.name,
        subtitle: assistant.category ? `助理 · ${assistant.category}` : '助理',
        snippet: compact(assistant.description),
        assistantId: assistant.id,
        score,
        updatedAt: assistant.lastOpenedAt ?? assistant.createdAt,
      });
    }

    for (const [chunkIndex, chunk] of (assistant.ragChunks ?? []).entries()) {
      const chunkScore = scoreFields(query, [
        { value: chunk.fileName, weight: 1.1 },
        { value: chunk.content, weight: 0.65 },
      ]);
      if (!chunkScore) {
        continue;
      }
      results.push({
        // File names are user-controlled and may repeat; include the source
        // chunk index so every result remains a stable, clickable target.
        id: `${assistant.id}:material:${chunk.fileName}:${chunkIndex}`,
        kind: 'material',
        title: chunk.fileName,
        subtitle: `${assistant.name} · 素材`,
        snippet: compact(chunk.content),
        assistantId: assistant.id,
        chunkIndex,
        score: chunkScore,
        updatedAt: assistant.lastOpenedAt ?? assistant.createdAt,
      });
    }
  }
};

const addSessionResults = (
  query: string,
  assistantsById: Map<string, Assistant>,
  sessions: ChatSession[],
  results: LocalSearchResult[],
): void => {
  for (const session of sessions) {
    const assistantName = assistantsById.get(session.assistantId)?.name ?? '助理';
    const sessionScore = scoreFields(query, [
      { value: session.title, weight: 1.3 },
      ...(session.category ? [{ value: session.category, weight: 0.8 }] : []),
    ]);
    if (sessionScore) {
      results.push({
        id: session.id,
        kind: 'session',
        title: session.title,
        subtitle: `${assistantName} · 聊天`,
        snippet: compact(session.messages.at(-1)?.content ?? '尚無訊息'),
        assistantId: session.assistantId,
        sessionId: session.id,
        score: sessionScore,
        updatedAt: session.lastOpenedAt ?? session.updatedAt ?? session.createdAt,
      });
    }

    session.messages.forEach((message, messageIndex) => {
      const messageScore = scoreFields(query, [{ value: message.content, weight: 1 }]);
      if (!messageScore) {
        return;
      }
      results.push({
        id: `${session.id}:message:${messageIndex}`,
        kind: 'message',
        title: session.title,
        subtitle: `${assistantName} · ${messageLabel(message)}`,
        snippet: compact(message.content),
        assistantId: session.assistantId,
        sessionId: session.id,
        messageIndex,
        score: messageScore,
        updatedAt: message.timestamp ?? session.updatedAt ?? session.createdAt,
      });
    });
  }
};

const addProjectResults = (
  query: string,
  assistantsById: Map<string, Assistant>,
  projects: HtmlProject[],
  results: LocalSearchResult[],
): void => {
  for (const project of projects) {
    const assistantName = assistantsById.get(project.assistantId)?.name ?? '助理';
    const score = scoreFields(query, [
      { value: project.name, weight: 1.35 },
      ...(project.description ? [{ value: project.description, weight: 0.8 }] : []),
      ...(project.tags ?? []).map(tag => ({ value: tag, weight: 0.7 })),
    ]);
    if (!score) {
      continue;
    }
    results.push({
      id: project.id,
      kind: 'project',
      title: project.name,
      subtitle: `${assistantName} · 專案`,
      snippet: compact(project.description ?? project.entryFile),
      assistantId: project.assistantId,
      sessionId: project.sessionId ?? undefined,
      projectId: project.id,
      score,
      updatedAt: project.lastOpenedAt ?? project.updatedAt,
    });
  }
};

/**
 * Deterministic, local-only search for navigation. Empty queries return no results so the
 * sidebar can remain quiet until the user starts searching.
 */
export function searchLocalWorkspace(input: LocalSearchInput): LocalSearchResult[] {
  const query = normalize(input.query.trim());
  if (!query) {
    return [];
  }

  const results: LocalSearchResult[] = [];
  const assistantsById = new Map(input.assistants.map(assistant => [assistant.id, assistant]));
  addAssistantResults(query, input.assistants, results);
  addSessionResults(query, assistantsById, input.sessions, results);
  addProjectResults(query, assistantsById, input.projects ?? [], results);

  return sortResults(results).slice(0, Math.max(1, input.limit ?? DEFAULT_LIMIT));
}

export function getLocalSearchResultKindLabel(kind: LocalSearchResultKind): string {
  switch (kind) {
    case 'assistant':
      return '助理';
    case 'session':
      return '聊天';
    case 'message':
      return '訊息';
    case 'material':
      return '素材';
    case 'project':
      return '專案';
    default:
      return '結果';
  }
}
