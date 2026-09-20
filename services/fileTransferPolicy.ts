/**
 * Shared classification and secret-scan policy for user-controlled file transfers.
 *
 * Transfer files are untrusted input.  The metadata returned here is deliberately
 * descriptive rather than an authorization decision: callers still need to validate
 * their format before importing or executing anything.
 */

export type TransferArtifactKind =
  | 'assistant-package'
  | 'agent-bundle'
  | 'project'
  | 'provider-settings'
  | 'workspace-archive';

export interface TransferClassification {
  policyVersion: 1;
  kind: TransferArtifactKind;
  trust: 'untrusted';
  includes: string[];
  excludes: string[];
  credentialsIncluded: boolean;
  personalDataIncluded: boolean;
  previewRequired: true;
}

const CLASSIFICATIONS: Record<TransferArtifactKind, Omit<TransferClassification, 'kind'>> = {
  'assistant-package': {
    policyVersion: 1,
    trust: 'untrusted',
    includes: ['assistant instructions', 'starter prompts', 'teaching materials'],
    excludes: ['chat history', 'personal data', 'provider credentials'],
    credentialsIncluded: false,
    personalDataIncluded: false,
    previewRequired: true,
  },
  'agent-bundle': {
    policyVersion: 1,
    trust: 'untrusted',
    includes: ['assistant instructions', 'starter prompts', 'teaching materials', 'routes'],
    excludes: [
      'chat history',
      'personal data',
      'provider credentials',
      'encrypted bundle credentials',
    ],
    credentialsIncluded: false,
    personalDataIncluded: false,
    previewRequired: true,
  },
  project: {
    policyVersion: 1,
    trust: 'untrusted',
    includes: ['project files', 'project metadata', 'versioned history when selected'],
    excludes: ['chat history', 'personal data', 'provider credentials'],
    credentialsIncluded: false,
    personalDataIncluded: false,
    previewRequired: true,
  },
  'provider-settings': {
    policyVersion: 1,
    trust: 'untrusted',
    includes: ['provider name', 'model and endpoint configuration'],
    excludes: ['chat history', 'personal data'],
    credentialsIncluded: true,
    personalDataIncluded: false,
    previewRequired: true,
  },
  'workspace-archive': {
    policyVersion: 1,
    trust: 'untrusted',
    includes: ['workspace records selected by the owner'],
    excludes: ['provider credentials', 'encrypted bundle credentials'],
    credentialsIncluded: false,
    personalDataIncluded: true,
    previewRequired: true,
  },
};

/** Return a fresh policy object so UI consumers cannot mutate the shared defaults. */
export function getTransferClassification(
  kind: TransferArtifactKind,
  options: { credentialsIncluded?: boolean; personalDataIncluded?: boolean } = {},
): TransferClassification {
  const classification = CLASSIFICATIONS[kind];
  const credentialsIncluded = options.credentialsIncluded ?? classification.credentialsIncluded;
  const personalDataIncluded = options.personalDataIncluded ?? classification.personalDataIncluded;
  const includes = [...classification.includes];
  if (credentialsIncluded && !includes.includes('encrypted provider credentials')) {
    includes.push('encrypted provider credentials');
  }
  const excludes = classification.excludes.filter(
    exclusion =>
      !credentialsIncluded ||
      (exclusion !== 'provider credentials' && exclusion !== 'encrypted bundle credentials'),
  );

  return {
    kind,
    ...classification,
    credentialsIncluded,
    personalDataIncluded,
    includes,
    excludes,
  };
}

const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|auth(?:entication)?[_-]?token|access[_-]?token|turso[_-]?write[_-]?api[_-]?key|private[_-]?key|authorization|credential|password|secret)/i;
const SENSITIVE_MARKER_PATTERN =
  /(?:secret[_-]?(?:marker|key|value)|test[_-]?(?:api[_-]?key|secret)|sk-[a-z0-9]|gsk_[a-z0-9]|AIzaSy[a-z0-9])/i;

/**
 * Find sensitive key names or explicit test/secret markers without returning values.
 * Paths are safe to display in validation errors and diagnostics.
 */
export function findSecretMarkers(value: unknown, path = '$'): string[] {
  const found = new Set<string>();

  const visit = (current: unknown, currentPath: string): void => {
    if (typeof current === 'string') {
      if (SENSITIVE_MARKER_PATTERN.test(current)) {
        found.add(currentPath);
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }
    if (!current || typeof current !== 'object') {
      return;
    }

    Object.entries(current as Record<string, unknown>).forEach(([key, child]) => {
      const childPath = `${currentPath}.${key}`;
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        found.add(childPath);
      }
      visit(child, childPath);
    });
  };

  visit(value, path);
  return [...found];
}

export function containsSecretMarkers(value: unknown): boolean {
  return findSecretMarkers(value).length > 0;
}

export function assertNoSecretMarkers(
  value: unknown,
  message = 'Transfer contains secret fields',
): void {
  if (containsSecretMarkers(value)) {
    throw new Error(message);
  }
}
