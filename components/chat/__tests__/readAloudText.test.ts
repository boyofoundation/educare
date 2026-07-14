import { describe, expect, it } from 'vitest';
import { getReadAloudText } from '../readAloudText';

describe('getReadAloudText', () => {
  it('keeps labels from reference-style Markdown links and removes their definitions', () => {
    // Arrange
    const content = [
      '閱讀 [課程指南][guide] 與 [延伸練習][]。',
      '',
      '[guide]: https://school.example/guide',
      '[延伸練習]: ftp://files.example/activities.pdf',
    ].join('\n');

    // Act
    const result = getReadAloudText(content);

    // Assert
    expect(result).toBe('閱讀 課程指南 與 延伸練習。');
  });

  it('keeps labels from Markdown shortcut reference links and removes their definitions', () => {
    // Arrange
    const content = 'Read [guide].\n\n[guide]: https://school.example/guide';

    // Act
    const result = getReadAloudText(content);

    // Assert
    expect(result).toBe('Read guide.');
  });

  it('removes bare www URLs while preserving the surrounding prose', () => {
    // Arrange
    const content = 'Read www.school.example/lesson/42 before answering the visible question.';

    // Act
    const result = getReadAloudText(content);

    // Assert
    expect(result).toBe('Read before answering the visible question.');
  });

  it.each([
    [
      'protocol-relative URL',
      'Before //school.example/path after the lesson.',
      'Before after the lesson.',
    ],
    ['tel URI', 'Call tel:+1-555-0100 before class.', 'Call before class.'],
    ['sms URI', 'Text sms:+1-555-0100?body=Ready after class.', 'Text after class.'],
    [
      'data URI',
      'Review data:text/plain;base64,SGVsbG8= before answering.',
      'Review before answering.',
    ],
  ])('removes a %s destination while preserving nearby prose', (_kind, content, expected) => {
    // Arrange

    // Act
    const result = getReadAloudText(content);

    // Assert
    expect(result).toBe(expected);
  });

  it('removes ftp, mailto, and generic URI URLs', () => {
    // Arrange
    const content = [
      'Email mailto:teacher@school.example',
      'fetch ftp://files.school.example/guide.pdf',
      'open edu+lesson://course/42',
      'and keep this visible prose.',
    ].join(' ');

    // Act
    const result = getReadAloudText(content);

    // Assert
    expect(result).toBe('Email fetch open and keep this visible prose.');
  });

  it('removes inline and reference-style citation forms', () => {
    // Arrange
    const content = [
      'Evidence [1] [2, 4] [5–7] 【8】 [9][source] supports the visible conclusion.',
      '',
      '[source]: https://school.example/source',
    ].join('\n');

    // Act
    const result = getReadAloudText(content);

    // Assert
    expect(result).toBe('Evidence supports the visible conclusion.');
  });

  it.each([
    ['bold Answer label', '**Answer:** 42.', 'Answer: 42.'],
    ['bold Example label', '**Example:** word', 'Example: word'],
    ['time value', 'Time:10:30', 'Time:10:30'],
  ])('preserves ordinary prose containing a colon: %s', (_kind, content, expected) => {
    // Arrange

    // Act
    const result = getReadAloudText(content);

    // Assert
    expect(result).toBe(expected);
  });

  it('preserves visible prose from links while removing destinations', () => {
    // Arrange
    const content = [
      'Keep [this visible label](https://school.example/inline)',
      'and [that label][reference], plus ordinary prose.',
      '',
      '[reference]: mailto:librarian@school.example',
    ].join('\n');

    // Act
    const result = getReadAloudText(content);

    // Assert
    expect(result).toBe('Keep this visible label and that label, plus ordinary prose.');
  });
});
