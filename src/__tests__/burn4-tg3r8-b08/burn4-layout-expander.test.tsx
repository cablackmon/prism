import * as React from 'react';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Burn4LayoutExpander, type Burn4ExpanderPanel } from '../../components/ui/burn4-layout-expander';

afterEach(cleanup);

const panels: readonly Burn4ExpanderPanel[] = [
  { id: 'calendar-demo', title: 'Calendar', children: <input aria-label="Calendar draft" defaultValue="Draft" /> },
  { id: 'chores-demo', title: 'Chores', children: <span>Chores body</span> },
  { id: 'meals-demo', title: 'Meals', children: <span>Meals body</span> },
];

function header(name = 'Calendar'): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

function body(name = 'Calendar'): HTMLElement {
  const id = header(name).getAttribute('aria-controls');
  const region = id && document.getElementById(id);
  if (!region) throw new Error('Missing controlled body');
  return region;
}

test('renders actual collapsed disclosures and reveals a body', () => {
  render(<Burn4LayoutExpander panels={panels} />);
  expect(body().hidden).toBe(true);
  fireEvent.click(header());
  expect(body().hidden).toBe(false);
  expect(header().getAttribute('aria-expanded')).toBe('true');
});

test('renders an empty labelled collection without phantom content', () => {
  render(<Burn4LayoutExpander panels={[]} label="Kitchen board" />);
  expect(screen.getByRole('group', { name: 'Kitchen board' }).tabIndex).toBe(-1);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryAllByRole('region', { hidden: true })).toHaveLength(0);
});

test('normalizes frozen initial IDs without mutating caller snapshots', () => {
  const initial = Object.freeze(['unknown', 'meals-demo', 'calendar-demo', 'meals-demo']);
  const frozen = Object.freeze(panels.map((panel) => Object.freeze({ ...panel })));
  const changed = jest.fn();
  render(<Burn4LayoutExpander panels={frozen} defaultOpenIds={initial} onOpenChange={changed} />);
  expect(body('Calendar').hidden).toBe(false);
  expect(body('Chores').hidden).toBe(true);
  expect(body('Meals').hidden).toBe(false);
  expect(initial).toEqual(['unknown', 'meals-demo', 'calendar-demo', 'meals-demo']);
  expect(changed).not.toHaveBeenCalled();
});

test('local requests toggle with one fresh canonical payload per activation', () => {
  const changed = jest.fn();
  render(<Burn4LayoutExpander panels={panels} onOpenChange={changed} />);
  fireEvent.click(header('Meals'));
  fireEvent.click(header());
  fireEvent.click(header('Meals'));
  expect(changed.mock.calls).toEqual([[['meals-demo']], [['calendar-demo', 'meals-demo']], [['calendar-demo']]]);
  expect(changed.mock.calls[0]?.[0]).not.toBe(changed.mock.calls[1]?.[0]);
  expect(body('Meals').hidden).toBe(true);
});

test('batched local activations use the latest requested state', () => {
  const changed = jest.fn();
  render(<Burn4LayoutExpander panels={panels} onOpenChange={changed} />);
  const calendar = header();
  act(() => { calendar.click(); calendar.click(); });
  expect(body().hidden).toBe(true);
  expect(changed.mock.calls).toEqual([[['calendar-demo']], [[]]]);
});

test('mutating callback payloads cannot corrupt local state', () => {
  render(<Burn4LayoutExpander panels={panels} onOpenChange={(ids) => {
    // A JavaScript consumer can mutate its received array despite the readonly API.
    (ids as string[]).push('chores-demo');
  }} />);
  fireEvent.click(header());
  expect(body().hidden).toBe(false);
  expect(body('Chores').hidden).toBe(true);
  fireEvent.click(header());
  expect(body().hidden).toBe(true);
});

test('multiple mode allows independent bodies and does not delegate body clicks', () => {
  render(<Burn4LayoutExpander panels={panels} />);
  fireEvent.click(header());
  fireEvent.click(header('Chores'));
  fireEvent.click(screen.getByText('Chores body'));
  expect(screen.getAllByRole('region')).toHaveLength(2);
});

test('single mode opens only one body and permits all closed', () => {
  const changed = jest.fn();
  render(<Burn4LayoutExpander panels={panels} mode="single" onOpenChange={changed} />);
  fireEvent.click(header());
  fireEvent.click(header('Chores'));
  expect(body().hidden).toBe(true);
  expect(body('Chores').hidden).toBe(false);
  fireEvent.click(header('Chores'));
  expect(screen.queryAllByRole('region')).toHaveLength(0);
  expect(changed.mock.calls).toEqual([[['calendar-demo']], [['chores-demo']], [[]]]);
});

test('single mode resolves conflicting initial IDs by declaration order', () => {
  render(<Burn4LayoutExpander panels={panels} mode="single"
    defaultOpenIds={['meals-demo', 'calendar-demo']} />);
  expect(body().hidden).toBe(false);
  expect(body('Meals').hidden).toBe(true);
});

test('controlled requests propose changes without taking ownership', () => {
  const changed = jest.fn();
  const owned = Object.freeze(['calendar-demo']);
  render(<Burn4LayoutExpander panels={panels} openIds={owned} onOpenChange={changed} />);
  fireEvent.click(header('Chores'));
  expect(changed).toHaveBeenCalledWith(['calendar-demo', 'chores-demo']);
  expect(body('Chores').hidden).toBe(true);
  expect(changed.mock.calls[0]?.[0]).not.toBe(owned);
});

test('controlled rerenders commit/reset canonical state without callbacks', () => {
  const changed = jest.fn();
  const view = render(<Burn4LayoutExpander panels={panels} openIds={[]} onOpenChange={changed} />);
  view.rerender(<Burn4LayoutExpander panels={panels} openIds={['chores-demo', 'unknown', 'chores-demo']}
    onOpenChange={changed} />);
  expect(body('Chores').hidden).toBe(false);
  expect(body().hidden).toBe(true);
  view.rerender(<Burn4LayoutExpander panels={panels} openIds={[]} onOpenChange={changed} />);
  expect(body('Chores').hidden).toBe(true);
  expect(changed).not.toHaveBeenCalled();
});

test('controlled read-only panels work without a change callback', () => {
  render(<Burn4LayoutExpander panels={panels} openIds={['calendar-demo']} />);
  fireEvent.click(header());
  expect(body().hidden).toBe(false);
});

test('disabled headers do not request changes and may remain owner-open', () => {
  const changed = jest.fn();
  const disabled = panels.map((panel) => ({ ...panel, disabled: panel.id === 'calendar-demo' }));
  const view = render(<Burn4LayoutExpander panels={disabled} openIds={['calendar-demo']} onOpenChange={changed} />);
  expect(header().disabled).toBe(true);
  expect(body().hidden).toBe(false);
  fireEvent.click(header());
  expect(changed).not.toHaveBeenCalled();
  view.rerender(<Burn4LayoutExpander panels={disabled} openIds={[]} onOpenChange={changed} />);
  expect(body().hidden).toBe(true);
});

test('arrow navigation wraps around enabled headers without toggling', () => {
  const disabled = panels.map((panel) => ({ ...panel, disabled: panel.id === 'chores-demo' }));
  const changed = jest.fn();
  render(<Burn4LayoutExpander panels={disabled} onOpenChange={changed} />);
  header().focus();
  expect(fireEvent.keyDown(header(), { key: 'ArrowDown' })).toBe(false);
  expect(document.activeElement).toBe(header('Meals'));
  fireEvent.keyDown(header('Meals'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(header());
  fireEvent.keyDown(header(), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(header('Meals'));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryAllByRole('region')).toHaveLength(0);
});

test('Home and End navigate to the first and last enabled header', () => {
  render(<Burn4LayoutExpander panels={panels} />);
  header('Chores').focus();
  fireEvent.keyDown(header('Chores'), { key: 'End' });
  expect(document.activeElement).toBe(header('Meals'));
  fireEvent.keyDown(header('Meals'), { key: 'Home' });
  expect(document.activeElement).toBe(header());
});

test('one enabled header navigates to itself', () => {
  render(<Burn4LayoutExpander panels={panels.map((panel) => ({ ...panel, disabled: panel.id !== 'chores-demo' }))} />);
  header('Chores').focus();
  fireEvent.keyDown(header('Chores'), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(header('Chores'));
  expect(header('Chores').getAttribute('aria-expanded')).toBe('false');
});

test('all-disabled collections tolerate synthetic navigation without focus changes', () => {
  render(<Burn4LayoutExpander panels={panels.map((panel) => ({ ...panel, disabled: true }))} />);
  const group = screen.getByRole('group');
  group.focus();
  fireEvent.keyDown(header(), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(group);
});

test.each(['Tab', 'a', 'Enter', ' '])('native key %p is not intercepted or manually toggled', (key) => {
  render(<Burn4LayoutExpander panels={panels} />);
  header().focus();
  expect(fireEvent.keyDown(header(), { key })).toBe(true);
  expect(document.activeElement).toBe(header());
  expect(body().hidden).toBe(true);
  expect(header().type).toBe('button');
});

test.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey'])('navigation with %s preserves native shortcut behavior', (modifier) => {
  render(<Burn4LayoutExpander panels={panels} />);
  header().focus();
  expect(fireEvent.keyDown(header(), { key: 'ArrowDown', [modifier]: true })).toBe(true);
  expect(document.activeElement).toBe(header());
});

test('an already prevented navigation event is respected', () => {
  render(<div onKeyDownCapture={(event) => event.preventDefault()}><Burn4LayoutExpander panels={panels} /></div>);
  header().focus();
  fireEvent.keyDown(header(), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(header());
});

test('ARIA relationships are unique within and across instances', () => {
  render(<><Burn4LayoutExpander panels={panels} /><Burn4LayoutExpander panels={panels} /></>);
  const buttons = screen.getAllByRole('button');
  const ids = buttons.flatMap((button) => [button.id, button.getAttribute('aria-controls')]);
  expect(new Set(ids).size).toBe(12);
  for (const button of buttons) {
    const target = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(target?.getAttribute('aria-labelledby')).toBe(button.id);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  }
});

test('supports caller heading levels and the default level', () => {
  const view = render(<Burn4LayoutExpander panels={panels} />);
  expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  view.rerender(<Burn4LayoutExpander panels={panels} headingLevel={2} />);
  expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3);
});

test('collapsed bodies retain mounted child state and hide their accessible content', () => {
  let mounts = 0;
  function Draft(): React.ReactElement {
    React.useEffect(() => { mounts += 1; }, []);
    const [draft, setDraft] = React.useState('Original');
    return <input aria-label="Retained draft" value={draft} onChange={(event) => setDraft(event.target.value)} />;
  }
  render(<Burn4LayoutExpander panels={[{ id: 'draft', title: 'Draft', children: <Draft /> }]} />);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(mounts).toBe(1);
  fireEvent.click(header('Draft'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Saved locally' } });
  fireEvent.click(header('Draft'));
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(header('Draft'));
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Saved locally');
  expect(mounts).toBe(1);
});

test('local collapse recovers body-owned focus to its header', () => {
  render(<Burn4LayoutExpander panels={panels} defaultOpenIds={['calendar-demo']} />);
  screen.getByRole('textbox').focus();
  fireEvent.click(header());
  expect(document.activeElement).toBe(header());
});

test('controlled collapse recovers body-owned focus without requesting a change', () => {
  const changed = jest.fn();
  const view = render(<Burn4LayoutExpander panels={panels} openIds={['calendar-demo']} onOpenChange={changed} />);
  screen.getByRole('textbox').focus();
  view.rerender(<Burn4LayoutExpander panels={panels} openIds={[]} onOpenChange={changed} />);
  expect(document.activeElement).toBe(header());
  expect(changed).not.toHaveBeenCalled();
});

test('single-mode replacement recovers focus from the body it closes', () => {
  render(<Burn4LayoutExpander panels={panels} mode="single" defaultOpenIds={['calendar-demo']} />);
  screen.getByRole('textbox').focus();
  fireEvent.click(header('Chores'));
  expect(document.activeElement).toBe(header());
  expect(body('Chores').hidden).toBe(false);
});

test('controlled close preserves unrelated outside focus', () => {
  const element = (openIds: readonly string[]): React.ReactElement => <>
    <button>Outside</button><Burn4LayoutExpander panels={panels} openIds={openIds} />
  </>;
  const view = render(element(['calendar-demo']));
  header('Outside').focus();
  view.rerender(element([]));
  expect(document.activeElement).toBe(header('Outside'));
});

test('disabled closed owner chooses next nearest enabled header', () => {
  const disabled = panels.map((panel) => ({ ...panel, disabled: panel.id === 'calendar-demo' }));
  const view = render(<Burn4LayoutExpander panels={disabled} openIds={['calendar-demo']} />);
  screen.getByRole('textbox').focus();
  view.rerender(<Burn4LayoutExpander panels={disabled} openIds={[]} />);
  expect(document.activeElement).toBe(header('Chores'));
});

test('disabled closed owner searches backwards when following headers are disabled', () => {
  const items: readonly Burn4ExpanderPanel[] = [panels[1]!, panels[0]!, panels[2]!].map((panel) => ({
    ...panel, disabled: panel.id !== 'chores-demo',
  }));
  const view = render(<Burn4LayoutExpander panels={items} openIds={['calendar-demo']} />);
  screen.getByRole('textbox').focus();
  view.rerender(<Burn4LayoutExpander panels={items} openIds={[]} />);
  expect(document.activeElement).toBe(header('Chores'));
});

test('all-disabled close focuses the labelled programmatic collection fallback', () => {
  const disabled = panels.map((panel) => ({ ...panel, disabled: true }));
  const view = render(<Burn4LayoutExpander panels={disabled} openIds={['calendar-demo']} label="Kitchen widgets" />);
  screen.getByRole('textbox').focus();
  view.rerender(<Burn4LayoutExpander panels={disabled} openIds={[]} label="Kitchen widgets" />);
  const group = screen.getByRole('group', { name: 'Kitchen widgets' });
  expect(group.tabIndex).toBe(-1);
  expect(document.activeElement).toBe(group);
});

test('a newly disabled focused header recovers to the nearest enabled header', () => {
  const view = render(<Burn4LayoutExpander panels={panels} />);
  header().focus();
  view.rerender(<Burn4LayoutExpander panels={panels.map((panel) => ({ ...panel, disabled: panel.id === 'calendar-demo' }))} />);
  expect(document.activeElement).toBe(header('Chores'));
});

test('replacing a focused heading preserves focus on the corresponding new header', () => {
  const view = render(<Burn4LayoutExpander panels={panels} />);
  header().focus();
  const previous = header();
  view.rerender(<Burn4LayoutExpander panels={panels} headingLevel={2} />);
  expect(header()).not.toBe(previous);
  expect(document.activeElement).toBe(header());
});

test('a request callback can deliberately move focus outside while closing', () => {
  render(<><button>Outside</button><Burn4LayoutExpander panels={panels}
    defaultOpenIds={['calendar-demo']} onOpenChange={() => header('Outside').focus()} /></>);
  screen.getByRole('textbox').focus();
  fireEvent.click(header());
  expect(document.activeElement).toBe(header('Outside'));
});

test('StrictMode activation does not duplicate request callbacks', () => {
  const changed = jest.fn();
  render(<React.StrictMode><Burn4LayoutExpander panels={panels} onOpenChange={changed} /></React.StrictMode>);
  fireEvent.click(header());
  expect(changed.mock.calls).toEqual([[['calendar-demo']]]);
  expect(body().hidden).toBe(false);
});

test('same-ID reorder retains body nodes, state and ARIA IDs', () => {
  const view = render(<Burn4LayoutExpander panels={panels} defaultOpenIds={['calendar-demo']} />);
  const previousBody = body();
  const previousHeader = header();
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'Before reorder' } });
  view.rerender(<Burn4LayoutExpander panels={[...panels].reverse()} defaultOpenIds={[]} />);
  expect(body()).toBe(previousBody);
  expect(header()).toBe(previousHeader);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Before reorder');
  expect(body().getAttribute('aria-labelledby')).toBe(previousHeader.id);
});

test('removal prunes stale local IDs without synthesizing request callbacks', () => {
  const changed = jest.fn();
  const view = render(<Burn4LayoutExpander panels={panels} defaultOpenIds={['calendar-demo']} onOpenChange={changed} />);
  view.rerender(<Burn4LayoutExpander panels={panels.slice(1)} onOpenChange={changed} />);
  expect(screen.queryByRole('button', { name: 'Calendar' })).toBeNull();
  view.rerender(<Burn4LayoutExpander panels={panels} onOpenChange={changed} />);
  expect(body().hidden).toBe(true);
  expect(changed).not.toHaveBeenCalled();
});

test('removing a focused body recovers to the first remaining enabled header', () => {
  const view = render(<Burn4LayoutExpander panels={panels} defaultOpenIds={['calendar-demo']} />);
  screen.getByRole('textbox').focus();
  view.rerender(<Burn4LayoutExpander panels={panels.slice(1)} />);
  expect(document.activeElement).toBe(header('Chores'));
});

test('removing a focused header also recovers to the first remaining header', () => {
  const view = render(<Burn4LayoutExpander panels={panels} />);
  header().focus();
  view.rerender(<Burn4LayoutExpander panels={panels.slice(1)} />);
  expect(document.activeElement).toBe(header('Chores'));
});

test('removing the only focused panel uses the empty collection fallback', () => {
  const view = render(<Burn4LayoutExpander panels={[panels[0]!]} defaultOpenIds={['calendar-demo']} />);
  screen.getByRole('textbox').focus();
  view.rerender(<Burn4LayoutExpander panels={[]} />);
  expect(document.activeElement).toBe(screen.getByRole('group'));
});

test('unfocused panel removal does not steal external focus', () => {
  const element = (items: readonly Burn4ExpanderPanel[]): React.ReactElement => <>
    <button>Outside</button><Burn4LayoutExpander panels={items} />
  </>;
  const view = render(element(panels));
  header('Outside').focus();
  view.rerender(element(panels.slice(1)));
  expect(document.activeElement).toBe(header('Outside'));
});

test('local mode changes reconcile existing open IDs without callbacks or resurrection', () => {
  const changed = jest.fn();
  const view = render(<Burn4LayoutExpander panels={panels} defaultOpenIds={['calendar-demo', 'chores-demo']}
    onOpenChange={changed} />);
  view.rerender(<Burn4LayoutExpander panels={panels} mode="single" onOpenChange={changed} />);
  expect(body().hidden).toBe(false);
  expect(body('Chores').hidden).toBe(true);
  view.rerender(<Burn4LayoutExpander panels={panels} mode="multiple" onOpenChange={changed} />);
  expect(body('Chores').hidden).toBe(true);
  expect(changed).not.toHaveBeenCalled();
});

test('controlled single mode normalizes caller data while retaining caller ownership', () => {
  const view = render(<Burn4LayoutExpander panels={panels} openIds={['chores-demo', 'calendar-demo']} mode="single" />);
  expect(body().hidden).toBe(false);
  expect(body('Chores').hidden).toBe(true);
  view.rerender(<Burn4LayoutExpander panels={panels} openIds={['chores-demo', 'calendar-demo']} mode="multiple" />);
  expect(body('Chores').hidden).toBe(false);
});

test('embedding in a form never submits from disclosure activation', () => {
  const submit = jest.fn((event: React.FormEvent) => event.preventDefault());
  render(<form onSubmit={submit}><Burn4LayoutExpander panels={panels} /></form>);
  fireEvent.click(header());
  expect(submit).not.toHaveBeenCalled();
  expect(body().hidden).toBe(false);
});

test('SSR emits named header/body links without focus or browser-global access', () => {
  const markup = renderToStaticMarkup(<Burn4LayoutExpander panels={panels} openIds={['calendar-demo']} />);
  const holder = document.createElement('div');
  holder.innerHTML = markup;
  const button = holder.querySelector('button');
  const target = Array.from(holder.querySelectorAll('[role="region"]')).find((region) =>
    region.id === button?.getAttribute('aria-controls'));
  expect(button?.getAttribute('aria-expanded')).toBe('true');
  expect(target?.getAttribute('aria-labelledby')).toBe(button?.id);
  expect(target?.hasAttribute('hidden')).toBe(false);
});

test.each([
  { items: [{ ...panels[0]!, id: '' }] },
  { items: [{ ...panels[0]!, id: '   ' }] },
  { items: [panels[0]!, { ...panels[1]!, id: 'calendar-demo' }] },
])('rejects empty or duplicate IDs before emitting ambiguous markup', ({ items }) => {
  expect(() => renderToStaticMarkup(<Burn4LayoutExpander panels={items} />)).toThrow('IDs must be nonempty and unique');
});

test.each(['', '   '])('rejects blank title %p to preserve accessible names', (title) => {
  expect(() => renderToStaticMarkup(<Burn4LayoutExpander panels={[{ ...panels[0]!, title }]} />))
    .toThrow('titles must be nonempty');
});

test('rejects an explicitly blank collection label', () => {
  expect(() => renderToStaticMarkup(<Burn4LayoutExpander panels={panels} label="   " />))
    .toThrow('collection label must be nonempty');
});

test.each([false, true])('rejects changing mounted ownership from controlled=%p', (controlled) => {
  const messages = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const view = render(<Burn4LayoutExpander panels={panels} openIds={controlled ? [] : undefined} />);
    expect(() => view.rerender(<Burn4LayoutExpander panels={panels} openIds={controlled ? undefined : []} />))
      .toThrow('ownership must stay controlled or local');
  } finally { messages.mockRestore(); }
});
