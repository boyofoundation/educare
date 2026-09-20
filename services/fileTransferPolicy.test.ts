import { describe, expect, it } from 'vitest';
import {
  assertNoSecretMarkers,
  containsSecretMarkers,
  findSecretMarkers,
  getTransferClassification,
} from './fileTransferPolicy';

describe('fileTransferPolicy', () => {
  it('classifies public teaching packages as untrusted and credential-free', () => {
    const classification = getTransferClassification('assistant-package');

    expect(classification).toMatchObject({
      policyVersion: 1,
      kind: 'assistant-package',
      trust: 'untrusted',
      credentialsIncluded: false,
      personalDataIncluded: false,
      previewRequired: true,
    });
    expect(classification.excludes).toEqual(
      expect.arrayContaining(['chat history', 'personal data', 'provider credentials']),
    );
  });

  it('keeps project and workspace scopes explicit about files, history, and credentials', () => {
    const project = getTransferClassification('project');
    const workspace = getTransferClassification('workspace-archive');
    const publicBundle = getTransferClassification('agent-bundle');

    expect(project.includes).toEqual(
      expect.arrayContaining(['project files', 'versioned history when selected']),
    );
    expect(project.excludes).toContain('provider credentials');
    expect(workspace.excludes).toEqual(
      expect.arrayContaining(['provider credentials', 'encrypted bundle credentials']),
    );
    expect(publicBundle.credentialsIncluded).toBe(false);
    expect(publicBundle.excludes).toContain('encrypted bundle credentials');
  });

  it('returns fresh classifications and explicitly marks protected credentials', () => {
    const first = getTransferClassification('agent-bundle', { credentialsIncluded: true });
    first.includes.push('mutated');
    const second = getTransferClassification('agent-bundle', { credentialsIncluded: true });

    expect(second.includes).not.toContain('mutated');
    expect(second.credentialsIncluded).toBe(true);
    expect(second.includes).toContain('encrypted provider credentials');
    expect(second.excludes).not.toContain('encrypted bundle credentials');
  });

  it('finds secret field names and explicit marker values without exposing values', () => {
    const value = {
      provider: 'openai',
      config: {
        apiKey: 'sk-test-api-key',
        nested: [{ marker: 'test-secret-marker' }],
      },
    };

    const paths = findSecretMarkers(value);

    expect(paths).toEqual(expect.arrayContaining(['$.config.apiKey', '$.config.nested[0].marker']));
    expect(paths.join(' ')).not.toContain('sk-test-api-key');
    expect(containsSecretMarkers(value)).toBe(true);
    expect(() => assertNoSecretMarkers({ title: 'public teaching package' })).not.toThrow();
    expect(() => assertNoSecretMarkers(value)).toThrow('Transfer contains secret fields');
  });
});
