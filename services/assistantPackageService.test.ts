import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  ASSISTANT_PACKAGE_FORMAT,
  ASSISTANT_PACKAGE_SCHEMA_VERSION,
  buildAssistantPackageZip,
  buildImportedAssistant,
  parseAssistantPackage,
  ParsedAssistantPackage,
} from './assistantPackageService';
import { Assistant, RagChunk } from '../types';

const createAssistant = (overrides: Partial<Assistant> = {}): Assistant => ({
  id: 'assistant-1',
  name: 'Math Tutor',
  description: 'Helps students with algebra',
  systemPrompt: 'You are a patient math tutor.',
  starterPrompts: ['解釋一元二次方程式', '出三題練習題'],
  subagentDelegationEnabled: true,
  ragChunks: [],
  createdAt: 1_700_000_000_000,
  isShared: true,
  ...overrides,
});

const createManifestJson = (overrides: Record<string, unknown> = {}): Uint8Array =>
  strToU8(
    JSON.stringify({
      format: ASSISTANT_PACKAGE_FORMAT,
      schemaVersion: ASSISTANT_PACKAGE_SCHEMA_VERSION,
      exportedAt: 1_700_000_000_000,
      assistantName: 'Math Tutor',
      ...overrides,
    }),
  );

const createAssistantJson = (overrides: Record<string, unknown> = {}): Uint8Array =>
  strToU8(
    JSON.stringify({
      id: 'assistant-1',
      name: 'Math Tutor',
      description: 'Helps students with algebra',
      systemPrompt: 'You are a patient math tutor.',
      starterPrompts: [],
      subagentDelegationEnabled: false,
      mathToolsEnabled: false,
      webSpeechToolsEnabled: false,
      ...overrides,
    }),
  );

const createParsedPackage = (
  overrides: Partial<ParsedAssistantPackage> = {},
): ParsedAssistantPackage => ({
  manifest: {
    format: ASSISTANT_PACKAGE_FORMAT,
    schemaVersion: ASSISTANT_PACKAGE_SCHEMA_VERSION,
    exportedAt: 1_700_000_000_000,
    assistantName: 'Math Tutor',
  },
  assistant: {
    id: 'assistant-1',
    name: 'Math Tutor',
    description: 'Helps students with algebra',
    systemPrompt: 'You are a patient math tutor.',
    starterPrompts: ['解釋一元二次方程式'],
    subagentDelegationEnabled: true,
    mathToolsEnabled: false,
    webSpeechToolsEnabled: false,
  },
  ragChunks: [],
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('assistantPackageService', () => {
  describe('buildAssistantPackageZip + parseAssistantPackage round-trip', () => {
    it('preserves assistant config and rag chunks with vectors through export and import', () => {
      const ragChunks: RagChunk[] = [
        {
          fileName: 'algebra.md',
          content: '一元二次方程式的公式解…',
          vector: [0.1, -0.25, 0.75],
        },
        {
          fileName: 'geometry.md',
          content: '畢氏定理…',
        },
      ];
      const assistant = createAssistant({ ragChunks });

      const zipBytes = buildAssistantPackageZip(assistant);
      const parsed = parseAssistantPackage(zipBytes);

      expect(parsed.manifest.format).toBe(ASSISTANT_PACKAGE_FORMAT);
      expect(parsed.manifest.schemaVersion).toBe(ASSISTANT_PACKAGE_SCHEMA_VERSION);
      expect(parsed.manifest.assistantName).toBe('Math Tutor');
      expect(parsed.assistant).toEqual({
        id: 'assistant-1',
        name: 'Math Tutor',
        description: 'Helps students with algebra',
        systemPrompt: 'You are a patient math tutor.',
        starterPrompts: ['解釋一元二次方程式', '出三題練習題'],
        subagentDelegationEnabled: true,
        mathToolsEnabled: false,
        webSpeechToolsEnabled: false,
      });
      expect(parsed.ragChunks).toEqual([
        {
          fileName: 'algebra.md',
          content: '一元二次方程式的公式解…',
          vector: [0.1, -0.25, 0.75],
        },
        {
          fileName: 'geometry.md',
          content: '畢氏定理…',
        },
      ]);
    });

    it('strips relevanceScore from rag chunks during export', () => {
      const assistant = createAssistant({
        ragChunks: [
          {
            fileName: 'notes.md',
            content: '章節重點',
            vector: [0.5, 0.5],
            relevanceScore: 0.92,
          },
        ],
      });

      const parsed = parseAssistantPackage(buildAssistantPackageZip(assistant));

      expect(parsed.ragChunks).toEqual([
        { fileName: 'notes.md', content: '章節重點', vector: [0.5, 0.5] },
      ]);
      expect(parsed.ragChunks[0]).not.toHaveProperty('relevanceScore');
    });

    it('defaults missing optional fields sensibly', () => {
      const assistant = {
        id: 'assistant-min',
        name: 'Bare Assistant',
        systemPrompt: 'Be helpful.',
        createdAt: 1_700_000_000_000,
      } as Assistant;

      const parsed = parseAssistantPackage(buildAssistantPackageZip(assistant));

      expect(parsed.assistant.description).toBe('');
      expect(parsed.assistant.starterPrompts).toEqual([]);
      expect(parsed.assistant.subagentDelegationEnabled).toBe(false);
      expect(parsed.assistant.mathToolsEnabled).toBe(false);
      expect(parsed.assistant.webSpeechToolsEnabled).toBe(false);
      expect(parsed.ragChunks).toEqual([]);
    });

    it('preserves assistant tool-mode flags through export and import', () => {
      const assistant = createAssistant({
        mathToolsEnabled: true,
        webSpeechToolsEnabled: true,
      });

      const parsed = parseAssistantPackage(buildAssistantPackageZip(assistant));
      const imported = buildImportedAssistant(parsed, []);

      expect(parsed.assistant).toMatchObject({
        mathToolsEnabled: true,
        webSpeechToolsEnabled: true,
      });
      expect(imported).toMatchObject({
        mathToolsEnabled: true,
        webSpeechToolsEnabled: true,
      });
    });
  });

  describe('parseAssistantPackage error cases', () => {
    it('rejects bytes that are not a zip archive', () => {
      const notAZip = strToU8('這不是壓縮檔');

      expect(() => parseAssistantPackage(notAZip)).toThrow(
        '無法解壓縮檔案，請確認選擇的是助理設定壓縮檔 (.zip)。',
      );
    });

    it('rejects a zip that is missing manifest.json', () => {
      const zipBytes = zipSync({
        'assistant.json': createAssistantJson(),
      });

      expect(() => parseAssistantPackage(zipBytes)).toThrow(
        '壓縮檔缺少 manifest.json，不是有效的助理設定檔。',
      );
    });

    it('rejects a manifest with the wrong format identifier', () => {
      const zipBytes = zipSync({
        'manifest.json': createManifestJson({ format: 'some-other-format' }),
        'assistant.json': createAssistantJson(),
      });

      expect(() => parseAssistantPackage(zipBytes)).toThrow('這不是 EduCare 助理設定壓縮檔。');
    });

    it('rejects a manifest with a schemaVersion newer than supported', () => {
      const zipBytes = zipSync({
        'manifest.json': createManifestJson({
          schemaVersion: ASSISTANT_PACKAGE_SCHEMA_VERSION + 1,
        }),
        'assistant.json': createAssistantJson(),
      });

      expect(() => parseAssistantPackage(zipBytes)).toThrow(
        '此助理設定檔版本較新，請先更新 EduCare 後再匯入。',
      );
    });

    it('rejects an assistant.json without a name', () => {
      const zipBytes = zipSync({
        'manifest.json': createManifestJson(),
        'assistant.json': createAssistantJson({ name: '   ' }),
      });

      expect(() => parseAssistantPackage(zipBytes)).toThrow('助理設定檔缺少名稱。');
    });

    it('rejects a rag-chunks.json that is not an array', () => {
      const zipBytes = zipSync({
        'manifest.json': createManifestJson(),
        'assistant.json': createAssistantJson(),
        'rag-chunks.json': strToU8(JSON.stringify({ chunks: [] })),
      });

      expect(() => parseAssistantPackage(zipBytes)).toThrow('rag-chunks.json 格式錯誤。');
    });

    it('rejects a rag chunk without a fileName', () => {
      const zipBytes = zipSync({
        'manifest.json': createManifestJson(),
        'assistant.json': createAssistantJson(),
        'rag-chunks.json': strToU8(JSON.stringify([{ content: '缺少檔名' }])),
      });

      expect(() => parseAssistantPackage(zipBytes)).toThrow('知識庫片段 #1 格式錯誤。');
    });
  });

  describe('parseAssistantPackage without rag-chunks.json', () => {
    it('returns an empty ragChunks array when the entry is absent', () => {
      const zipBytes = zipSync({
        'manifest.json': createManifestJson(),
        'assistant.json': createAssistantJson(),
      });

      const parsed = parseAssistantPackage(zipBytes);

      expect(parsed.ragChunks).toEqual([]);
      expect(parsed.assistant.name).toBe('Math Tutor');
    });
  });

  describe('buildImportedAssistant', () => {
    it('keeps the original id when it does not collide with existing ids', () => {
      const parsed = createParsedPackage();

      const imported = buildImportedAssistant(parsed, ['assistant-2', 'assistant-3']);

      expect(imported.id).toBe('assistant-1');
    });

    it('generates a new id via crypto.randomUUID when the original id collides', () => {
      const generatedId = '11111111-2222-4333-8444-555555555555';
      const randomUUIDSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue(generatedId);
      const parsed = createParsedPackage();

      const imported = buildImportedAssistant(parsed, ['assistant-1']);

      expect(randomUUIDSpy).toHaveBeenCalledTimes(1);
      expect(imported.id).toBe(generatedId);
    });

    it('generates a new id when the packaged id is empty', () => {
      const generatedId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(generatedId);
      const parsed = createParsedPackage({
        assistant: {
          ...createParsedPackage().assistant,
          id: '',
        },
      });

      const imported = buildImportedAssistant(parsed, []);

      expect(imported.id).toBe(generatedId);
    });

    it('marks the imported assistant unshared with a fresh createdAt', () => {
      const now = 1_760_000_000_000;
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const parsed = createParsedPackage();

      const imported = buildImportedAssistant(parsed, []);

      expect(imported.isShared).toBe(false);
      expect(imported.createdAt).toBe(now);
    });

    it('preserves rag chunks including vectors and copies config fields', () => {
      const ragChunks: RagChunk[] = [
        { fileName: 'algebra.md', content: '公式解', vector: [0.9, -0.1] },
        { fileName: 'geometry.md', content: '畢氏定理' },
      ];
      const parsed = createParsedPackage({ ragChunks });

      const imported = buildImportedAssistant(parsed, []);

      expect(imported.ragChunks).toEqual(ragChunks);
      expect(imported.name).toBe('Math Tutor');
      expect(imported.description).toBe('Helps students with algebra');
      expect(imported.systemPrompt).toBe('You are a patient math tutor.');
      expect(imported.starterPrompts).toEqual(['解釋一元二次方程式']);
      expect(imported.subagentDelegationEnabled).toBe(true);
    });
  });
});
