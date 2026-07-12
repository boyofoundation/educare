import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentBundle, Assistant } from '../types';
import {
  AGENT_BUNDLE_FORMAT,
  AGENT_BUNDLE_MAX_SIZE_BYTES,
  AGENT_BUNDLE_SCHEMA_VERSION,
  buildAgentBundle,
  buildImportedBundle,
  downloadBundleJson,
  estimateBundleSize,
  parseBundleText,
  serializeBundle,
} from './agentBundleService';

const createAssistant = (overrides: Partial<Assistant> = {}): Assistant => ({
  id: 'math-tutor',
  name: 'Math Tutor',
  description: 'Helps students learn algebra.',
  systemPrompt: 'You are a patient math tutor.',
  starterPrompts: ['Explain quadratic equations'],
  ragChunks: [{ fileName: 'algebra.md', content: 'The quadratic formula.' }],
  createdAt: 1_700_000_000_000,
  ...overrides,
});

const createBundle = (overrides: Partial<AgentBundle> = {}): AgentBundle => ({
  manifest: {
    format: AGENT_BUNDLE_FORMAT,
    schemaVersion: AGENT_BUNDLE_SCHEMA_VERSION,
    name: 'STEM Team',
    description: 'A pair of teaching assistants.',
    version: '1.0.0',
    exportedAt: 1_700_000_000_000,
    entryAgentId: 'math-tutor',
  },
  agents: [createAssistantBundleAgent()],
  routes: [],
  ...overrides,
});

const createAssistantBundleAgent = (overrides: Record<string, unknown> = {}) => ({
  id: 'math-tutor',
  name: 'Math Tutor',
  description: 'Helps students learn algebra.',
  systemPrompt: 'You are a patient math tutor.',
  starterPrompts: ['Explain quadratic equations'],
  ragChunks: [{ fileName: 'algebra.md', content: 'The quadratic formula.' }],
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agentBundleService', () => {
  describe('buildAgentBundle + parseBundleText', () => {
    it('round-trips exported assistants and routes while stripping legacy chunk data', () => {
      const assistants = [
        createAssistant({
          ragChunks: [
            {
              fileName: 'algebra.md',
              content: 'The quadratic formula.',
              vector: [0.1, -0.2],
              relevanceScore: 0.91,
            },
          ],
        }),
        createAssistant({
          id: 'science-tutor',
          name: 'Science Tutor',
          ragChunks: [],
        }),
      ];

      const bundle = buildAgentBundle(
        assistants,
        'math-tutor',
        [{ fromAgentId: 'math-tutor', toAgentId: 'science-tutor', condition: 'science question' }],
        {
          name: 'STEM Team',
          description: 'A pair of teaching assistants.',
          version: '1.0.0',
        },
      );
      const parsed = parseBundleText(serializeBundle(bundle));

      expect(parsed.errors).toEqual([]);
      expect(parsed.bundle).toMatchObject({
        manifest: expect.objectContaining({
          format: AGENT_BUNDLE_FORMAT,
          schemaVersion: AGENT_BUNDLE_SCHEMA_VERSION,
          entryAgentId: 'math-tutor',
        }),
        routes: [
          { fromAgentId: 'math-tutor', toAgentId: 'science-tutor', condition: 'science question' },
        ],
      });
      expect(parsed.bundle?.agents[0].ragChunks).toEqual([
        { fileName: 'algebra.md', content: 'The quadratic formula.' },
      ]);
      expect(parsed.bundle?.agents[0].ragChunks[0]).not.toHaveProperty('vector');
      expect(parsed.bundle?.agents[0].ragChunks[0]).not.toHaveProperty('relevanceScore');
      expect(estimateBundleSize(bundle)).toBe(
        new TextEncoder().encode(JSON.stringify(bundle)).length,
      );
    });
  });

  describe('parseBundleText validation', () => {
    it('returns a typed corrupted-json issue for malformed JSON', () => {
      const result = parseBundleText('{ invalid json');

      expect(result).toMatchObject({
        bundle: null,
        errors: [{ code: 'corrupted-json' }],
        warnings: [],
      });
    });

    it('rejects a non-bundle format', () => {
      const result = parseBundleText(
        JSON.stringify(
          createBundle({
            manifest: { ...createBundle().manifest, format: 'other-format' } as never,
          }),
        ),
      );

      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'not-a-bundle' })]),
      );
      expect(result.bundle).toBeNull();
    });

    it('rejects an unsupported newer schema version', () => {
      const result = parseBundleText(
        JSON.stringify(
          createBundle({
            manifest: {
              ...createBundle().manifest,
              schemaVersion: AGENT_BUNDLE_SCHEMA_VERSION + 1,
            } as never,
          }),
        ),
      );

      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'schema-too-new' })]),
      );
      expect(result.bundle).toBeNull();
    });

    it('returns typed missing-field errors for required fields', () => {
      const incomplete = createBundle();
      delete (incomplete.agents[0] as Partial<AgentBundle['agents'][number]>).name;

      const result = parseBundleText(JSON.stringify(incomplete));

      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'missing-field' })]),
      );
      expect(result.bundle).toBeNull();
    });

    it('rejects entry agents and routes that do not resolve to bundled agents', () => {
      const result = parseBundleText(
        JSON.stringify(
          createBundle({
            manifest: { ...createBundle().manifest, entryAgentId: 'missing-agent' },
            routes: [{ fromAgentId: 'math-tutor', toAgentId: 'missing-agent' }],
          }),
        ),
      );

      expect(result.errors.filter(issue => issue.code === 'dangling-route')).toHaveLength(2);
      expect(result.bundle).toBeNull();
    });

    it('excludes unknown fields from a successfully parsed bundle', () => {
      const raw = createBundle() as AgentBundle & { unknownRoot: string };
      raw.unknownRoot = 'discard me';
      (raw.manifest as AgentBundle['manifest'] & { unknownManifest: boolean }).unknownManifest =
        true;
      (raw.agents[0] as AgentBundle['agents'][number] & { secret: string }).secret = 'discard me';
      (
        raw.agents[0].ragChunks[0] as AgentBundle['agents'][number]['ragChunks'][number] & {
          vector: number[];
        }
      ).vector = [1, 2];

      const result = parseBundleText(JSON.stringify(raw));

      expect(result.bundle).toEqual(createBundle());
      expect(result.bundle).not.toHaveProperty('unknownRoot');
      expect(result.bundle?.agents[0]).not.toHaveProperty('secret');
      expect(result.bundle?.agents[0].ragChunks[0]).not.toHaveProperty('vector');
    });

    it('rejects oversized individual values before accepting the bundle', () => {
      const result = parseBundleText(
        JSON.stringify(
          createBundle({ agents: [createAssistantBundleAgent({ name: 'n'.repeat(201) })] }),
        ),
      );

      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'oversize' })]),
      );
      expect(result.bundle).toBeNull();
    });

    it('rejects text that exceeds the total bundle byte limit', () => {
      const result = parseBundleText(' '.repeat(AGENT_BUNDLE_MAX_SIZE_BYTES + 1));

      expect(result).toMatchObject({ bundle: null, errors: [{ code: 'oversize' }], warnings: [] });
    });

    it('warns about empty prompts and isolated agents without rejecting valid data', () => {
      const result = parseBundleText(
        JSON.stringify(
          createBundle({
            agents: [
              createAssistantBundleAgent({ systemPrompt: '' }),
              createAssistantBundleAgent({ id: 'science-tutor', name: 'Science Tutor' }),
            ],
          }),
        ),
      );

      expect(result.errors).toEqual([]);
      expect(result.bundle).not.toBeNull();
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'empty-prompt' }),
          expect.objectContaining({ code: 'dangling-route' }),
        ]),
      );
    });
  });

  describe('buildImportedBundle', () => {
    it('namespaces every agent, entry reference, and route reference with a fresh bundle id', () => {
      vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
      const bundle = createBundle({
        agents: [createAssistantBundleAgent(), createAssistantBundleAgent({ id: 'science-tutor' })],
        routes: [
          { fromAgentId: 'math-tutor', toAgentId: 'science-tutor', condition: 'science question' },
        ],
      });

      const imported = buildImportedBundle(bundle);

      expect(imported).toMatchObject({
        id: '00000000-0000-4000-8000-000000000001',
        bundle: {
          manifest: { entryAgentId: '00000000-0000-4000-8000-000000000001:math-tutor' },
          agents: [
            { id: '00000000-0000-4000-8000-000000000001:math-tutor' },
            { id: '00000000-0000-4000-8000-000000000001:science-tutor' },
          ],
          routes: [
            {
              fromAgentId: '00000000-0000-4000-8000-000000000001:math-tutor',
              toAgentId: '00000000-0000-4000-8000-000000000001:science-tutor',
              condition: 'science question',
            },
          ],
        },
      });
      expect(imported.sizeBytes).toBe(estimateBundleSize(imported.bundle));
    });
  });

  describe('downloadBundleJson', () => {
    it('sanitizes the generated filename and revokes the download URL', () => {
      const createObjectURL = vi.fn(() => 'blob:bundle');
      const revokeObjectURL = vi.fn();
      vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
      const click = vi
        .spyOn(window.HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      const appendChild = vi.spyOn(document.body, 'appendChild');

      const fileName = downloadBundleJson(
        createBundle({ manifest: { ...createBundle().manifest, name: ' STEM: Team / 2026 ' } }),
      );

      expect(fileName).toBe('STEM-Team-2026.educare-bundle.json');
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(appendChild).toHaveBeenCalledWith(
        expect.objectContaining({
          download: 'STEM-Team-2026.educare-bundle.json',
          href: 'blob:bundle',
          rel: 'noopener',
        }),
      );
      expect(click).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:bundle');
    });
  });
});
