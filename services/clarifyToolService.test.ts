import { describe, expect, it } from 'vitest';
import { buildCustomClarifyAnswer, normalizeClarifyRequest } from './clarifyToolService';

describe('normalizeClarifyRequest', () => {
  it('normalizes a valid askUser call into a ClarifyRequest', () => {
    const result = normalizeClarifyRequest({
      question: '  要使用哪種版面配置？  ',
      options: [{ label: '單欄', description: '適合手機閱讀' }, { label: '雙欄' }],
      header: '版面配置',
    });

    expect(result).toEqual({
      ok: true,
      request: {
        question: '要使用哪種版面配置？',
        options: [{ label: '單欄', description: '適合手機閱讀' }, { label: '雙欄' }],
        allowCustomAnswer: true,
        header: '版面配置',
      },
    });
  });

  it('defaults allowCustomAnswer to true and honors explicit false', () => {
    const base = {
      question: 'Q?',
      options: [{ label: 'A' }, { label: 'B' }],
    };
    const defaultResult = normalizeClarifyRequest(base);
    const disabledResult = normalizeClarifyRequest({ ...base, allowCustomAnswer: false });
    expect(defaultResult.ok).toBe(true);
    expect(disabledResult.ok).toBe(true);
    if (defaultResult.ok && disabledResult.ok) {
      expect(defaultResult.request.allowCustomAnswer).toBe(true);
      expect(disabledResult.request.allowCustomAnswer).toBe(false);
    }
  });

  it('rejects a missing or blank question with a recoverable error', () => {
    const result = normalizeClarifyRequest({
      question: '   ',
      options: [{ label: 'A' }, { label: 'B' }],
    });
    expect(result).toMatchObject({
      ok: false,
      recoverable: true,
      code: 'clarify-question-missing',
    });
  });

  it('rejects non-array options', () => {
    const result = normalizeClarifyRequest({ question: 'Q?', options: 'A|B' });
    expect(result).toMatchObject({ ok: false, code: 'clarify-options-missing' });
  });

  it('rejects options without labels', () => {
    const result = normalizeClarifyRequest({
      question: 'Q?',
      options: [{ description: 'no label' }, { label: 'B' }],
    });
    expect(result).toMatchObject({ ok: false, code: 'clarify-option-label-missing' });
  });

  it('deduplicates case-insensitive labels and fails when fewer than 2 remain', () => {
    const result = normalizeClarifyRequest({
      question: 'Q?',
      options: [{ label: 'Yes' }, { label: 'yes' }, { label: ' YES ' }],
    });
    expect(result).toMatchObject({ ok: false, code: 'clarify-options-too-few' });
  });

  it('keeps at most 6 options and truncates overlong text', () => {
    const longLabel = (index: number) => `opt-${index}-${'x'.repeat(300)}`;
    const result = normalizeClarifyRequest({
      question: 'Q?',
      options: Array.from({ length: 9 }, (_, index) => ({ label: longLabel(index) })),
      header: 'h'.repeat(100),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.request.options).toHaveLength(6);
    expect(result.request.options[0].label.length).toBeLessThanOrEqual(120);
    expect((result.request.header ?? '').length).toBeLessThanOrEqual(40);
  });
});

describe('buildCustomClarifyAnswer', () => {
  it('trims and clamps the custom answer text', () => {
    const answer = buildCustomClarifyAnswer(`  ${'y'.repeat(1500)}  `);
    expect(answer.kind).toBe('custom');
    if (answer.kind === 'custom') {
      expect(answer.text.length).toBe(1000);
      expect(answer.text.startsWith('y')).toBe(true);
    }
  });
});
