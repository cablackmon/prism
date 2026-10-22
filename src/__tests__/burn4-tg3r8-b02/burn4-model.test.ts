import { clipSpeechInterim, isSpeechSessionId, normalizeSpeechLanguages, positionSpeechPanel } from '../../components/input/burn4SpeechInputPanelModel';

describe('explicit speech language configuration', () => {
  test('canonicalizes explicit tags without guessing a locale or mutating frozen options', () => {
    const options = Object.freeze([Object.freeze({ tag: 'en-us', label: ' English ' }), Object.freeze({ tag: 'es-MX', label: 'Español' })]);
    expect(normalizeSpeechLanguages('en-US', options)).toEqual({ ok: true, language: 'en-US', languages: [{ tag: 'en-US', label: 'English' }, { tag: 'es-MX', label: 'Español' }] });
  });
  test.each([
    ['missing options', 'en-US', null],
    ['empty options', 'en-US', []],
    ['non-record option', 'en-US', ['en-US']],
    ['null option', 'en-US', [null]],
    ['wrong tag type', 'en-US', [{ tag: 4, label: 'English' }]],
    ['invalid tag', 'en-US', [{ tag: 'not a tag', label: 'English' }]],
    ['overlong tag', 'en-US', [{ tag: 'a'.repeat(65), label: 'English' }]],
    ['blank label', 'en-US', [{ tag: 'en-US', label: ' ' }]],
    ['wrong label type', 'en-US', [{ tag: 'en-US', label: false }]],
    ['control label', 'en-US', [{ tag: 'en-US', label: 'English\u0000' }]],
    ['overlong label', 'en-US', [{ tag: 'en-US', label: '🙂'.repeat(81) }]],
    ['missing selected choice', 'fr-FR', [{ tag: 'en-US', label: 'English' }]],
    ['wrong selected type', 42, [{ tag: 'en-US', label: 'English' }]],
    ['invalid selected tag', 'en_US', [{ tag: 'en-US', label: 'English' }]],
    ['canonical duplicates', 'en-US', [{ tag: 'en-US', label: 'English' }, { tag: 'en-us', label: 'Other' }]],
    ['too many options', 'en-US', Array.from({ length: 101 }, () => ({ tag: 'en-US', label: 'English' }))],
  ])('%s is a value-free configuration error', (_name, language, options) => {
    expect(normalizeSpeechLanguages(language, options)).toEqual({ ok: false, message: 'Speech languages are not configured correctly.' });
  });
  test('accepts the exact Unicode label boundary', () => {
    expect(normalizeSpeechLanguages('ja-JP', [{ tag: 'ja-JP', label: '🙂'.repeat(80) }]).ok).toBe(true);
  });
});

test('interim clipping preserves Unicode and strips unsafe controls', () => {
  expect(clipSpeechInterim('hello\u0000\nworld')).toBe('hello\nworld');
  expect(clipSpeechInterim('🙂'.repeat(2001))).toBe(`${'🙂'.repeat(2000)}…`);
  expect(clipSpeechInterim(null)).toBe('');
  expect(clipSpeechInterim('x'.repeat(2000))).toBe('x'.repeat(2000));
  expect(clipSpeechInterim('one\ttwo\nthree')).toBe('one\ttwo\nthree');
});

test('session identities are bounded and nonblank', () => {
  expect(isSpeechSessionId('session-1')).toBe(true);
  expect(isSpeechSessionId(' ')).toBe(false);
  expect(isSpeechSessionId('a'.repeat(129))).toBe(false);
  expect(isSpeechSessionId('a'.repeat(128))).toBe(true);
  expect(isSpeechSessionId(null)).toBe(false);
});

describe('independent viewport geometry expectations', () => {
  test.each([
    ['top edge uses below', { left: 10, top: 10, width: 100, height: 40 }, { width: 360, height: 120 }, { width: 1000, height: 800 }, { left: 10, top: 58, width: 360, maxHeight: 734, placement: 'below' }],
    ['right edge clamps horizontally', { left: 900, top: 300, width: 80, height: 40 }, { width: 360, height: 120 }, { width: 1000, height: 800 }, { left: 632, top: 172, width: 360, maxHeight: 284, placement: 'above' }],
    ['small viewport bounds width and scroll height', { left: 180, top: 80, width: 50, height: 40 }, { width: 360, height: 120 }, { width: 200, height: 180 }, { left: 8, top: 8, width: 184, maxHeight: 64, placement: 'above' }],
    ['tall panel picks larger lower side', { left: 100, top: 300, width: 200, height: 40 }, { width: 360, height: 1000 }, { width: 1000, height: 800 }, { left: 100, top: 348, width: 360, maxHeight: 444, placement: 'below' }],
    ['partly clipped target remains anchored', { left: -20, top: -10, width: 100, height: 40 }, { width: 200, height: 120 }, { width: 1000, height: 800 }, { left: 8, top: 38, width: 200, maxHeight: 754, placement: 'below' }],
    ['bottom edge uses above', { left: 10, top: 760, width: 100, height: 30 }, { width: 200, height: 120 }, { width: 1000, height: 800 }, { left: 10, top: 632, width: 200, maxHeight: 744, placement: 'above' }],
  ])('%s', (_name, anchor, panel, viewport, expected) => {
    expect(positionSpeechPanel(anchor, panel, viewport)).toEqual(expected);
  });
  test.each([
    ['NaN coordinate', { left: NaN, top: 300, width: 100, height: 40 }],
    ['infinite coordinate', { left: Infinity, top: 300, width: 100, height: 40 }],
    ['overflowed edge', { left: 1e308, top: 300, width: 1e308, height: 40 }],
    ['zero width', { left: 10, top: 300, width: 0, height: 40 }],
    ['negative height', { left: 10, top: 300, width: 100, height: -1 }],
    ['offscreen left', { left: -100, top: 300, width: 100, height: 40 }],
    ['offscreen right', { left: 1000, top: 300, width: 100, height: 40 }],
    ['offscreen top', { left: 10, top: -40, width: 100, height: 40 }],
    ['offscreen bottom', { left: 10, top: 800, width: 100, height: 40 }],
    ['fills all vertical space', { left: 10, top: 0, width: 100, height: 800 }],
  ])('%s hides the overlay', (_name, anchor) => {
    expect(positionSpeechPanel(anchor, { width: 360, height: 120 }, { width: 1000, height: 800 })).toBeNull();
  });
  test.each([
    [{ width: 16, height: 800 }, { width: 360, height: 120 }],
    [{ width: 1000, height: 16 }, { width: 360, height: 120 }],
    [{ width: 1000, height: 800 }, { width: -1, height: 120 }],
    [{ width: 1000, height: 800 }, { width: 360, height: Infinity }],
  ])('invalid viewport/panel geometry is hidden', (viewport, panel) => {
    expect(positionSpeechPanel({ left: 100, top: 300, width: 100, height: 40 }, panel, viewport)).toBeNull();
  });
});

test('positions a real chip above the target with explicit viewport geometry', () => {
  expect(positionSpeechPanel({ left: 100, top: 300, width: 200, height: 40 }, { width: 360, height: 120 }, { width: 1000, height: 800 }))
    .toEqual({ left: 100, top: 172, width: 360, maxHeight: 284, placement: 'above' });
});
