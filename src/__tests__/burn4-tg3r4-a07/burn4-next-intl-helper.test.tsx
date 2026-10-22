import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import catalog from './burn4-catalog.json';

// The production helper imports a catalog; substitute a synthetic dependency.
jest.mock('@/i18n/messages/en.json', () => ({
  __esModule: true,
  default: jest.requireActual('./burn4-catalog.json'),
}));

import {
  NextIntlClientProvider,
  useFormatter,
  useLocale,
  useTranslations,
} from '../../test-utils/nextIntlMock';

type Translator = ReturnType<typeof useTranslations>;

function readTranslator(namespace?: string): Translator {
  let translate: Translator | undefined;
  function Probe() {
    translate = useTranslations(namespace);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (!translate) throw new Error('Translation probe did not render');
  return translate;
}

function readLocaleAndFormatter() {
  let result: { locale: string; formatter: Record<string, unknown> } | undefined;
  function Probe() {
    result = { locale: useLocale(), formatter: useFormatter() };
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (!result) throw new Error('Locale probe did not render');
  return result;
}

describe('translation helper lookup with a synthetic catalog', () => {
  test('reads root messages without a namespace', () => {
    expect(readTranslator()('rootLabel')).toBe('Shared board');
  });

  test('reads flat messages from the requested namespace', () => {
    expect(readTranslator('common')('heading')).toBe('Shared schedule');
    expect(readTranslator('other')('heading')).toBe('Other heading');
  });

  test('keeps separately created namespace translators independent', () => {
    const common = readTranslator('common');
    const other = readTranslator('other');
    expect(other('heading')).toBe('Other heading');
    expect(common('heading')).toBe('Shared schedule');
  });

  test('treats an empty namespace as root lookup', () => {
    expect(readTranslator('')('rootLabel')).toBe('Shared board');
  });

  test('preserves translated empty strings', () => {
    expect(readTranslator()('rootEmpty')).toBe('');
    expect(readTranslator('common')('empty')).toBe('');
  });

  test('returns a missing root key for useful text assertions', () => {
    expect(readTranslator()('missing')).toBe('missing');
  });

  test('qualifies missing keys with their namespace', () => {
    expect(readTranslator('common')('missing')).toBe('common.missing');
  });

  test('qualifies missing namespaces without throwing', () => {
    expect(readTranslator('absent')('heading')).toBe('absent.heading');
  });

  test('uses fallback keys for values that are not message strings', () => {
    expect(readTranslator()('rootCount')).toBe('rootCount');
    expect(readTranslator()('rootObject')).toBe('rootObject');
    expect(readTranslator('common')('number')).toBe('common.number');
    expect(readTranslator('common')('object')).toBe('common.object');
  });

  test('does not mutate the supplied catalog while translating', () => {
    const before = JSON.stringify(catalog);
    readTranslator('common')('greeting', { name: 'Fixture' });
    expect(JSON.stringify(catalog)).toBe(before);
  });

  test.failing('KNOWN GAP: dotted keys inside a namespace do not resolve nested messages', () => {
    expect(readTranslator('common')('nav.calendar')).toBe('Calendar');
  });

  test.failing('KNOWN GAP: dotted namespaces do not resolve their nested catalog object', () => {
    expect(readTranslator('common.nav')('tasks')).toBe('Tasks');
  });

  test.failing('KNOWN GAP: dotted root paths do not resolve nested messages', () => {
    expect(readTranslator()('common.nav.calendar')).toBe('Calendar');
  });
});

describe('translation helper placeholder substitution', () => {
  test('keeps placeholders when no values are supplied', () => {
    expect(readTranslator('common')('greeting')).toBe('Hello {name}');
  });

  test('substitutes a supplied string value', () => {
    expect(readTranslator('common')('greeting', { name: 'Fixture' })).toBe('Hello Fixture');
  });

  test('substitutes every occurrence of a placeholder', () => {
    expect(readTranslator('common')('repeated', { name: 'Fixture' })).toBe('Fixture meets Fixture');
  });

  test('substitutes multiple fields including zero and false', () => {
    expect(readTranslator('common')('summary', { person: 'Fixture', count: 0, active: false }))
      .toBe('Fixture: 0 items, active=false');
  });

  test('stringifies null and undefined values', () => {
    const translate = readTranslator('common');
    expect(translate('values', { value: null })).toBe('Value=null');
    expect(translate('values', { value: undefined })).toBe('Value=undefined');
  });

  test('allows an empty value and preserves surrounding message whitespace', () => {
    expect(readTranslator('common')('spacing', { value: '' })).toBe('  ');
  });

  test('leaves unspecified placeholders for later diagnosis', () => {
    expect(readTranslator('common')('leftover', { name: 'Fixture' }))
      .toBe('Hello Fixture, code {code}');
  });

  test('ignores fields with no matching placeholder', () => {
    expect(readTranslator('common')('heading', { unused: 'Fixture' })).toBe('Shared schedule');
  });

  test('keeps explicitly documented ICU strings raw', () => {
    expect(readTranslator('common')('icu')).toBe('{count, plural, one {item} other {items}}');
  });

  test.failing('KNOWN GAP: interpolation interprets dollar replacement syntax inside literal values', () => {
    expect(readTranslator('common')('greeting', { name: 'Budget $&' })).toBe('Hello Budget $&');
  });
});

describe('translation helper React exports', () => {
  test('provider preserves nested child markup', () => {
    const children = <section><h2>Fixture heading</h2><span>Fixture body</span></section>;
    expect(renderToStaticMarkup(<NextIntlClientProvider>{children}</NextIntlClientProvider>))
      .toBe(renderToStaticMarkup(children));
  });

  test('provider preserves sibling order and primitive children', () => {
    expect(renderToStaticMarkup(
      <NextIntlClientProvider><span>First</span>{0}<span>Last</span></NextIntlClientProvider>,
    )).toBe('<span>First</span>0<span>Last</span>');
  });

  test('provider accepts absent children', () => {
    expect(renderToStaticMarkup(<NextIntlClientProvider />)).toBe('');
  });

  test('locale and formatter expose the documented English stub behavior', () => {
    const { locale, formatter } = readLocaleAndFormatter();
    expect(locale).toBe('en');
    expect(formatter).toEqual({});
  });

  test('formatter state cannot leak between independent consumers', () => {
    const first = readLocaleAndFormatter();
    first.formatter.fixtureOnly = true;
    expect(readLocaleAndFormatter().formatter).toEqual({});
  });

  test('provider composes with a synthetic consumer of every helper', () => {
    function Consumer() {
      const translate = useTranslations('common');
      const locale = useLocale();
      const formatter = useFormatter();
      return <p>{locale}: {translate('greeting', { name: 'Fixture' })}; {Object.keys(formatter).length}</p>;
    }
    expect(renderToStaticMarkup(<NextIntlClientProvider><Consumer /></NextIntlClientProvider>))
      .toBe('<p>en: Hello Fixture; 0</p>');
  });
});
