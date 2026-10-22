import test from 'node:test';
import assert from 'node:assert/strict';
import {IntlMessageFormat} from 'intl-messageformat';
import {pair, expectCodes} from './burn4-test-helpers.mjs';

for (const message of [
  'Literal text and \'apostrophes\'',
  "This '{is literal}' and '' is an apostrophe.",
  '{n, plural, =0 {Today} one {# day} other {# days}}',
  '{position, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
  '{audience, select, family {{count, plural, one {<b>{name}</b>} other {# for {name}}}} other {Welcome {name}}}',
  '{price, number, ::currency/USD} on {when, date, ::yyyyMMdd} at {when, time, short}',
  '<b>Hello <i>{name}</i></b>',
]) {
  test(`ICU accepts valid message ${message.slice(0, 45)}`, () => {
    expectCodes(pair({message}, {message}), []);
  });
}

for (const message of [
  'Hello {name',
  '{n, plural, one {One}}',
  '{choice, select, family {Welcome}}',
  '{n, plural, other {Fine} one {{broken}}',
  '<b>unclosed',
  '<b>mismatched</i>',
  '{n, number, ::currency/}',
]) {
  test(`ICU rejects malformed message ${message.slice(0, 45)}`, () => {
    expectCodes(pair({message: 'Valid'}, {message}), ['invalid_icu']);
  });
}

test('ICU diagnostics never echo full message values or parser exception text', () => {
  const marker = 'SYNTHETIC_CONTENT_NOT_FOR_DIAGNOSTICS';
  const result = pair({message: 'Valid'}, {message: `${marker} {unfinished`});
  expectCodes(result, ['invalid_icu']);
  assert.equal(JSON.stringify(result).includes(marker), false);
});

test('a source may intentionally format one numeric timestamp as both number and date', () => {
  const message = '{same, number} {same, date}';
  expectCodes(pair({message}, {message}), []);
});

test('select accepts the existing numeric value without creating an input type conflict', () => {
  const message = '{n, number} {n, select, other {items}}';
  assert.equal(new IntlMessageFormat(message, 'en').format({n: 3}), '3 items');
  expectCodes(pair({message}, {message}), []);
});

test('select also accepts an existing date value', () => {
  const message = '{when, date, fixed} {when, select, other {days}}';
  const formatter = new IntlMessageFormat(message, 'en', {date: {fixed: {timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric'}}});
  assert.equal(formatter.format({when: new Date('2026-01-02T00:00:00Z')}), '1/2/2026 days');
  expectCodes(pair({message}, {message}), []);
});

test('a rich tag and scalar argument cannot require the same supplied name', () => {
  const message = '<name>Hello</name> {name}';
  const result = pair({message}, {message});
  expectCodes(result, ['conflicting_argument_use', 'conflicting_argument_use']);
});

test('generic use alongside a compatible numeric use is supported', () => {
  const message = '{count}: {count, plural, one {# item} other {# items}}';
  expectCodes(pair({message}, {message}), []);
});
