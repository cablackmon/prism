import { scanExamples } from './burn4-scanner-fixtures';

function expectReviewExit(result: ReturnType<typeof scanExamples>) {
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
}

describe('example audit scanner on disposable tracked synthetic files', () => {
  test('empty repository prints both headings, two empty sections and a zero summary', () => {
    const result = scanExamples();
    expectReviewExit(result);
    expect(result.stdout).toContain('PLACEHOLDER ATTRIBUTES (placeholder="...")');
    expect(result.stdout).toContain('EXAMPLE PATTERNS (e.g. / for example)');
    expect(result.stdout.split('\n').filter(line => line === '(none)')).toHaveLength(2);
    expect(result.placeholders).toEqual([]);
    expect(result.examples).toEqual([]);
    expect(result.summary).toBe('SUMMARY: 0 placeholder(s), 0 example pattern(s)');
  });

  test('nonmatches, empty placeholders and unsupported placeholder syntax produce no findings', () => {
    const result = scanExamples([{
      name: 'burn4-empty.tsx',
      content: [
        'const label = "Neutral sample";',
        '<input placeholder="" />',
        "<input placeholder='Sample input' />",
        '<input placeholder={label} />',
        '<input PLACEHOLDER="Sample uppercase" />',
      ].join('\n'),
    }]);
    expectReviewExit(result);
    expect(result.placeholders).toEqual([]);
    expect(result.examples).toEqual([]);
    expect(result.summary).toBe('SUMMARY: 0 placeholder(s), 0 example pattern(s)');
  });

  test.each(['tsx', 'jsx', 'ts', 'html'])('finds a nonempty placeholder in tracked .%s files', extension => {
    const result = scanExamples([{
      name: `burn4-sample.${extension}`,
      content: 'neutral first line\n<input placeholder="Sample input" />\n',
    }]);
    expectReviewExit(result);
    expect(result.placeholders).toEqual(['2:<input placeholder="Sample input" />']);
    expect(result.examples).toEqual([]);
  });

  test.each(['tsx', 'jsx', 'ts', 'html', 'md'])('finds example text in tracked .%s files', extension => {
    const result = scanExamples([{
      name: `burn4-sample.${extension}`,
      content: 'neutral first line\nFor example, choose the sample option.\n',
    }]);
    expectReviewExit(result);
    expect(result.examples).toEqual(['2:For example, choose the sample option.']);
    expect(result.placeholders).toEqual([]);
  });

  test('Markdown is scanned for example prose while placeholder syntax there is excluded', () => {
    const result = scanExamples([{
      name: 'burn4-guide.md',
      content: '<input placeholder="Sample input" />\ne.g. choose a sample option.\n',
    }]);
    expectReviewExit(result);
    expect(result.placeholders).toEqual([]);
    expect(result.examples).toEqual(['2:e.g. choose a sample option.']);
  });

  test.each(['js', 'json', 'css', 'txt', 'TSX', 'MD'])(
    'unsupported or uppercase .%s extension is ignored by both sections', extension => {
      const result = scanExamples([{
        name: `burn4-ignored.${extension}`,
        content: '<input placeholder="Sample input" />\nFor example, sample text.\n',
      }]);
      expectReviewExit(result);
      expect(result.placeholders).toEqual([]);
      expect(result.examples).toEqual([]);
      expect(result.summary).toBe('SUMMARY: 0 placeholder(s), 0 example pattern(s)');
    },
  );

  test('untracked matching files are excluded while a tracked neutral file is scanned', () => {
    const result = scanExamples([
      { name: 'burn4-tracked.tsx', content: 'neutral sample' },
      { name: 'burn4-untracked.tsx', content: '<input placeholder="Sample" />\ne.g. sample\n', tracked: false },
      { name: 'burn4-untracked.md', content: 'for example, sample\n', tracked: false },
    ]);
    expectReviewExit(result);
    expect(result.placeholders).toEqual([]);
    expect(result.examples).toEqual([]);
    expect(result.summary).toBe('SUMMARY: 0 placeholder(s), 0 example pattern(s)');
  });

  test('reads current worktree text for a staged file without requiring a commit', () => {
    const result = scanExamples([{
      name: 'burn4-staged.tsx',
      content: '<input placeholder="Old sample" />\n',
      workingCopy: 'for example, current sample\n',
    }]);
    expectReviewExit(result);
    expect(result.placeholders).toEqual([]);
    expect(result.examples).toEqual(['1:for example, current sample']);
  });

  test('placeholder names are case sensitive and both example patterns are case insensitive', () => {
    const result = scanExamples([{
      name: 'burn4-case.tsx',
      content: '<input PLACEHOLDER="Ignored sample" />\nE.G. sample choice\nFoR ExAmPlE, another sample\n',
    }]);
    expectReviewExit(result);
    expect(result.placeholders).toEqual([]);
    expect(result.examples).toEqual(['2:E.G. sample choice', '3:FoR ExAmPlE, another sample']);
  });

  test('paths with spaces preserve filename, line number and matching text in each section', () => {
    const result = scanExamples([
      { name: 'src/burn4-field with spaces.tsx', content: 'neutral\n<input placeholder="Sample value" />\ne.g. sample option\n' },
      { name: 'src/burn4-other.tsx', content: 'neutral' },
    ]);
    expectReviewExit(result);
    expect(result.placeholders).toEqual(['src/burn4-field with spaces.tsx:2:<input placeholder="Sample value" />']);
    expect(result.examples).toEqual(['src/burn4-field with spaces.tsx:3:e.g. sample option']);
  });

  test('emits every matching line across multiple tracked files in independent sections', () => {
    const result = scanExamples([
      { name: 'src/burn4-a.tsx', content: '<input placeholder="Sample A" />\nneutral\ne.g. sample A\n' },
      { name: 'src/burn4-b.tsx', content: 'for example, sample B\n<input placeholder="Sample B" />\n<input placeholder="Sample C" />\n' },
    ]);
    expectReviewExit(result);
    expect(result.placeholders).toEqual([
      'src/burn4-a.tsx:1:<input placeholder="Sample A" />',
      'src/burn4-b.tsx:2:<input placeholder="Sample B" />',
      'src/burn4-b.tsx:3:<input placeholder="Sample C" />',
    ]);
    expect(result.examples).toEqual([
      'src/burn4-a.tsx:3:e.g. sample A', 'src/burn4-b.tsx:1:for example, sample B',
    ]);
  });

  test('multiple pattern occurrences on one line emit that line once per section', () => {
    const line = '<input placeholder="Sample A" /><input placeholder="Sample B" /> e.g. sample A; for example, sample B';
    const result = scanExamples([{ name: 'burn4-oneline.tsx', content: line }]);
    expectReviewExit(result);
    expect(result.placeholders).toEqual([`1:${line}`]);
    expect(result.examples).toEqual([`1:${line}`]);
  });
});

const countCases = [
  { label: 'one placeholder line and no examples', content: '<input placeholder="Sample" />\n', placeholders: 1, examples: 0 },
  { label: 'one example line and no placeholders', content: 'e.g. sample\n', placeholders: 0, examples: 1 },
  { label: 'different independent nonempty section totals', content: '<input placeholder="A" />\n<input placeholder="B" />\ne.g. A\nfor example, B\ne.g. C\n', placeholders: 2, examples: 3 },
  { label: 'multiple occurrences on one line in each section', content: '<input placeholder="A" /><input placeholder="B" /> e.g. A; for example, B\n', placeholders: 1, examples: 1 },
];

describe('KNOWN GAP: each nonempty result section undercounts matching lines by one', () => {
  test.failing.each(countCases)('$label', ({ content, placeholders, examples }) => {
    const result = scanExamples([{ name: 'burn4-counts.tsx', content }]);
    expectReviewExit(result);
    expect(result.placeholders).toHaveLength(placeholders);
    expect(result.examples).toHaveLength(examples);
    expect(result.summary).toBe(`SUMMARY: ${placeholders} placeholder(s), ${examples} example pattern(s)`);
  });
});
