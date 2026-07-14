import { describe, expect, it } from 'vitest';
import {
  annotateInlinePronunciationMarkup,
  parseInlinePronunciationHref,
} from './speechMarkupService';

describe('speechMarkupService', () => {
  it('converts a valid pronounce tag into a playable internal link', () => {
    const rendered = annotateInlinePronunciationMarkup(
      'Repeat <pronounce lang="en-US" rate="0.8" pitch="1.1">Good morning!</pronounce>.',
    );
    const href = rendered.match(/\]\((pronounce:[^)]+)\)/)?.[1];

    expect(rendered).toContain('[Good morning\\!]');
    expect(parseInlinePronunciationHref(href)).toEqual({
      text: 'Good morning!',
      language: 'en-US',
      title: 'Pronunciation: Good morning!',
      rate: 0.8,
      pitch: 1.1,
    });
  });

  it('defaults English playback settings and supports multiple markers', () => {
    const rendered = annotateInlinePronunciationMarkup(
      '<pronounce>hello</pronounce> then <pronounce language="en-GB">goodbye</pronounce>',
    );

    expect(rendered.match(/\]\(pronounce:/g)).toHaveLength(2);
    expect(
      parseInlinePronunciationHref(rendered.match(/\]\((pronounce:[^)]+)\)/)?.[1]),
    ).toMatchObject({
      text: 'hello',
      language: 'en-US',
      rate: 0.9,
      pitch: 1,
    });
  });

  it('leaves pronunciation-like text in code and math protected', () => {
    const content =
      '`<pronounce>code</pronounce>` $<pronounce>math</pronounce>$ <pronounce>spoken</pronounce>';

    const rendered = annotateInlinePronunciationMarkup(content);

    expect(rendered).toContain('`<pronounce>code</pronounce>`');
    expect(rendered).toContain('$<pronounce>math</pronounce>$');
    expect(rendered).toContain('pronounce:');
  });

  it('does not create a control for invalid or unknown attributes', () => {
    const rendered = annotateInlinePronunciationMarkup(
      '<pronounce language="../en">unsafe</pronounce> <pronounce text="ignored">unknown</pronounce>',
    );

    expect(rendered).not.toContain('pronounce:%');
    expect(rendered).toContain('&lt;pronounce language="../en"&gt;unsafe&lt;/pronounce&gt;');
    expect(rendered).toContain('&lt;pronounce text="ignored"&gt;unknown&lt;/pronounce&gt;');
  });

  it('rejects explicit non-numeric or empty numeric attributes', () => {
    const rendered = annotateInlinePronunciationMarkup(
      '<pronounce rate="fast">fast</pronounce> <pronounce pitch="">empty</pronounce>',
    );

    expect(rendered).not.toContain('pronounce:%');
    expect(rendered).toContain('&lt;pronounce rate="fast"&gt;fast&lt;/pronounce&gt;');
    expect(rendered).toContain('&lt;pronounce pitch=""&gt;empty&lt;/pronounce&gt;');
  });

  it('rejects conflicting lang and language aliases', () => {
    const rendered = annotateInlinePronunciationMarkup(
      '<pronounce lang="en-US" language="en-GB">hello</pronounce>',
    );

    expect(rendered).not.toContain('pronounce:%');
    expect(rendered).toContain(
      '&lt;pronounce lang="en-US" language="en-GB"&gt;hello&lt;/pronounce&gt;',
    );
  });

  it('rejects attributes without whitespace separators', () => {
    const rendered = annotateInlinePronunciationMarkup(
      '<pronounce lang="en-US"rate="1">hello</pronounce>',
    );

    expect(rendered).not.toContain('pronounce:%');
    expect(rendered).toContain('&lt;pronounce lang="en-US"rate="1"&gt;hello&lt;/pronounce&gt;');
  });

  it('does not parse incomplete or nested markers', () => {
    const rendered = annotateInlinePronunciationMarkup(
      '<pronounce>unfinished <pronounce>nested</pronounce>',
    );

    expect(rendered).not.toContain('pronounce:%');
  });
});
