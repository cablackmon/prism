import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { WeekendVisitHistory, type WeekendVisitHistoryProps, type VisitCommitRequest, type VisitCommitResponse } from '../../components/weekend/burn4-visit-history';
import { appendVisit, type Visit, type VisitJournal } from '../../lib/burn4-weekend-visit-history';

afterEach(cleanup);
const catalog = { places: [{ id: 'a', label: 'Garden' }, { id: 'b', label: 'Museum' }], participants: [{ id: 'p', label: 'Alex' }, { id: 'q', label: 'Alex' }] };
const empty: VisitJournal = { revision: 0, entries: [] };
function visit(changes: Partial<Visit> = {}): Visit {
  return { id: 'old', placeId: 'a', visitedOn: '2024-01-01', attendeeIds: [], rating: null, notes: '', ...changes };
}
function setup(changes: Partial<WeekendVisitHistoryProps> = {}) {
  const createVisitId = jest.fn(() => 'submitted');
  const onChange = jest.fn((_request: VisitCommitRequest): VisitCommitResponse => ({ status: 'accepted' }));
  const props: WeekendVisitHistoryProps = { journal: empty, catalog, placeId: 'a', createVisitId, onChange, ...changes };
  return { props, createVisitId, onChange, view: render(<WeekendVisitHistory {...props} />) };
}
function date() { return screen.getByLabelText<HTMLInputElement>('Visit date'); }
function notes() { return screen.getByLabelText<HTMLTextAreaElement>('Visit notes'); }
function fill(text = 'Original notes') {
  fireEvent.change(date(), { target: { value: '2024-02-29' } });
  fireEvent.change(notes(), { target: { value: text } });
}
async function submit() {
  await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'Record a visit' })); });
}
function request(mock: { mock: { calls: readonly (readonly [VisitCommitRequest])[] } }): VisitCommitRequest {
  const value = mock.mock.calls[0]?.[0];
  if (!value) throw new Error('Missing request');
  return value;
}
function deferred() {
  let resolve: (value: VisitCommitResponse) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<VisitCommitResponse>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('empty controlled history exposes a labeled native form and real optional absence', async () => {
  const { onChange, createVisitId } = setup();
  expect(screen.getByText('No dated visits recorded.')).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Participants' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Not rated' })).toBeTruthy();
  fireEvent.change(date(), { target: { value: '0001-01-01' } });
  await submit();
  expect(createVisitId).toHaveBeenCalledTimes(1);
  const sent = request(onChange);
  expect(sent.visit).toEqual({ id: 'submitted', placeId: 'a', visitedOn: '0001-01-01', attendeeIds: [], rating: null, notes: '' });
  expect(Object.isFrozen(sent.visit)).toBe(true);
  expect(Object.isFrozen(sent)).toBe(true);
});

test('invalid input focuses the date and allocates neither an identity nor a host request', async () => {
  const { onChange, createVisitId } = setup();
  await submit();
  expect(createVisitId).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(date());
  expect(screen.getByRole('alert').textContent).toContain('real visit date');
  expect(date().getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
});

test('distinct participant IDs with the same name remain independently selectable', async () => {
  const { onChange } = setup();
  fill();
  const choices = screen.getAllByRole('checkbox', { name: 'Alex' });
  fireEvent.click(choices[1] ?? fail('second person missing'));
  fireEvent.click(choices[0] ?? fail('first person missing'));
  fireEvent.change(screen.getByLabelText('Visit rating'), { target: { value: '5' } });
  await submit();
  expect(request(onChange).visit.attendeeIds).toEqual(['p', 'q']);
  expect(request(onChange).visit.rating).toBe(5);
});

test('accepted callback alone preserves draft and controlled history; duplicate submits do not allocate twice', async () => {
  const { props, view, onChange, createVisitId } = setup();
  fill();
  act(() => {
    fireEvent.submit(screen.getByRole('form', { name: 'Record a visit' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Record a visit' }));
  });
  await act(async () => {});
  expect(createVisitId).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(date().value).toBe('2024-02-29');
  expect(notes().value).toBe('Original notes');
  expect(date().disabled).toBe(true);
  expect(screen.getByText('Known dated visits: 0')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('Awaiting host confirmation');
  const sent = request(onChange);
  view.rerender(<WeekendVisitHistory {...props} journal={sent.nextJournal} />);
  expect(date().value).toBe('');
  expect(notes().value).toBe('');
  expect(date().disabled).toBe(false);
  expect(screen.getByText('Known dated visits: 1')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Visit recorded.');
});

test('factory throws and blank IDs preserve the draft with no host callback', async () => {
  const factory = jest.fn((): string => { throw new Error('private factory details'); });
  const { props, view, onChange } = setup({ createVisitId: factory });
  fill();
  await submit();
  expect(onChange).not.toHaveBeenCalled();
  expect(notes().value).toBe('Original notes');
  expect(screen.getByRole('alert').textContent).not.toContain('private');
  expect(document.activeElement).toBe(screen.getByRole('alert'));
  view.rerender(<WeekendVisitHistory {...props} createVisitId={() => ''} />);
  await submit();
  expect(onChange).not.toHaveBeenCalled();
  expect(notes().value).toBe('Original notes');
});

test('reentrant factory submission is guarded before allocating a second identity', async () => {
  const factory = jest.fn(() => {
    fireEvent.submit(screen.getByRole('form', { name: 'Record a visit' }));
    return 'one';
  });
  const { onChange } = setup({ createVisitId: factory });
  fill();
  await submit();
  expect(factory).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('exact already-committed replay acknowledges at the same revision without a host callback', async () => {
  const row = visit({ id: 'submitted', visitedOn: '2024-02-29', notes: 'Original notes' });
  const { onChange } = setup({ journal: { revision: 3, entries: [row] } });
  fill();
  await submit();
  expect(onChange).not.toHaveBeenCalled();
  expect(date().value).toBe('');
  expect(screen.getByRole('status').textContent).toBe('Visit recorded.');
});

test('conflicting factory identity and conflicting controlled acknowledgement never clear the draft', async () => {
  const { props, view, onChange } = setup();
  fill();
  await submit();
  const sent = request(onChange);
  view.rerender(<WeekendVisitHistory {...props} journal={{ revision: 1, entries: [{ ...sent.visit, notes: 'different host content' }] }} />);
  expect(screen.getByRole('alert').textContent).toContain('different visit');
  expect(notes().value).toBe('Original notes');
  expect(screen.getByText('different host content')).toBeTruthy();
  expect(onChange).toHaveBeenCalledTimes(1);
  await submit();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(notes().value).toBe('Original notes');
});

test('uncertain failure retains identity and original place while retry rebases against external additions', async () => {
  const first = deferred();
  const onChange = jest.fn((_value: VisitCommitRequest) => first.promise);
  const { props, view, createVisitId } = setup({ onChange });
  fill();
  await submit();
  const sent = request(onChange);
  await act(async () => { first.reject(new Error('private failure')); });
  expect(notes().value).toBe('Original notes');
  expect(date().disabled).toBe(true);
  const external: VisitJournal = { revision: 1, entries: [visit({ id: 'external', placeId: 'b' })] };
  onChange.mockImplementation(async () => ({ status: 'accepted' }));
  view.rerender(<WeekendVisitHistory {...props} journal={external} placeId="b" />);
  expect(screen.getByText(/Pending visit for Garden/)).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry save' })); });
  expect(createVisitId).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledTimes(2);
  const retried: unknown = onChange.mock.calls[1]?.[0];
  expect(retried).toEqual({ visit: sent.visit, expectedRevision: 1, nextJournal: { revision: 2, entries: [external.entries[0], sent.visit] } });
  const committed = appendVisit(external, sent.visit, catalog);
  view.rerender(<WeekendVisitHistory {...props} journal={committed.journal} placeId="b" />);
  expect(date().value).toBe('');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Record visit' }).disabled).toBe(false);
  expect(screen.getByText('Known dated visits: 1')).toBeTruthy();
});

test('a removed historical attendee does not block exact pending acknowledgement', async () => {
  const { props, view, onChange } = setup();
  fill();
  fireEvent.click(screen.getAllByRole('checkbox')[0] ?? fail('missing participant'));
  await submit();
  const sent = request(onChange);
  view.rerender(<WeekendVisitHistory {...props} catalog={{ ...catalog, participants: [] }} journal={sent.nextJournal} />);
  expect(notes().value).toBe('');
  expect(screen.getByText('Participants: p')).toBeTruthy();
});

test('definitive rejection unlocks an unchanged draft and retains the ID for an unchanged retry', async () => {
  const onChange = jest.fn((_value: VisitCommitRequest): VisitCommitResponse => ({ status: 'rejected' }));
  const { createVisitId } = setup({ onChange });
  fill();
  await submit();
  expect(date().disabled).toBe(false);
  expect(notes().value).toBe('Original notes');
  expect(screen.getByRole('alert').textContent).toContain('declined');
  await submit();
  expect(createVisitId).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledTimes(2);
  fireEvent.change(notes(), { target: { value: 'Newly edited draft' } });
  await submit();
  expect(createVisitId).toHaveBeenCalledTimes(2);
});

test('synchronous host throw and throwing response status become uncertain safe retry states', async () => {
  const { props, view, onChange } = setup({ onChange() { throw new Error('private callback detail'); } });
  fill();
  await submit();
  expect(screen.getByRole('button', { name: 'Retry save' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).not.toContain('private');
  view.rerender(<WeekendVisitHistory {...props} onChange={() => ({ get status(): 'accepted' { throw new Error('private response detail'); } })} />);
  await submit();
  expect(screen.getByRole('button', { name: 'Retry save' })).toBeTruthy();
  expect(notes().value).toBe('Original notes');
  expect(onChange).not.toHaveBeenCalled();
});

test('late callback failure after an exact commit cannot erase a newer draft', async () => {
  const pending = deferred();
  const onChange = jest.fn((_value: VisitCommitRequest) => pending.promise);
  const { props, view } = setup({ onChange });
  fill();
  await submit();
  const sent = request(onChange);
  view.rerender(<WeekendVisitHistory {...props} journal={sent.nextJournal} />);
  fireEvent.change(notes(), { target: { value: 'New draft' } });
  await act(async () => { pending.reject(new Error('late error')); });
  expect(notes().value).toBe('New draft');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a stale revision or same-revision changed snapshot cannot acknowledge pending content', async () => {
  const initial = { revision: 5, entries: [] };
  const { props, view, onChange } = setup({ journal: initial });
  fill();
  await submit();
  const sent = request(onChange);
  view.rerender(<WeekendVisitHistory {...props} journal={{ revision: 4, entries: [sent.visit] }} />);
  expect(notes().value).toBe('Original notes');
  expect(screen.getByRole('alert').textContent).toContain('stale or conflicting');
  view.rerender(<WeekendVisitHistory {...props} journal={{ revision: 5, entries: [sent.visit] }} />);
  expect(date().value).toBe('2024-02-29');
  view.rerender(<WeekendVisitHistory {...props} journal={sent.nextJournal} />);
  expect(date().value).toBe('');
});

test('place change preserves ordinary draft until explicit cancel and never allocates identity', () => {
  const { props, view, createVisitId, onChange } = setup();
  fill();
  view.rerender(<WeekendVisitHistory {...props} placeId="b" />);
  expect(screen.getByText(/Draft for Garden/)).toBeTruthy();
  expect(notes().value).toBe('Original notes');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Record visit' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(notes().value).toBe('');
  expect(date().value).toBe('');
  expect(document.activeElement).toBe(date());
  expect(createVisitId).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

test('unmounted attempts cannot publish errors or reset a later component draft', async () => {
  const pending = deferred();
  const first = setup({ onChange: () => pending.promise });
  fill();
  await submit();
  first.view.unmount();
  setup({ placeId: 'b' });
  fill('New component draft');
  await act(async () => { pending.reject(new Error('stale unmounted error')); });
  expect(notes().value).toBe('New component draft');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('legacy overlap stays separate; dated text is escaped and removed labels use literal IDs', () => {
  const rows = [visit({ id: 'one', notes: '<script>unsafe()</script>', attendeeIds: ['removed'] }), visit({ id: 'two', visitedOn: '2024-01-02' })];
  const { view } = setup({ journal: { revision: 2, entries: rows }, legacy: { visitCount: 7, lastVisitedDate: '2024-02-01' } });
  expect(screen.getByText('Known dated visits: 2')).toBeTruthy();
  expect(screen.getByText('Legacy aggregate count: 7')).toBeTruthy();
  expect(screen.queryByText(/count: 9/)).toBeNull();
  expect(screen.getByText('Latest known dated visit: 2024-01-02')).toBeTruthy();
  expect(screen.getByText('<script>unsafe()</script>')).toBeTruthy();
  expect(screen.getByText('Participants: removed')).toBeTruthy();
  expect(view.container.querySelector('script')).toBeNull();
  expect(within(screen.getByRole('list', { name: 'Dated visits' })).getAllByRole('listitem')).toHaveLength(2);
});

test('history renders at most twenty rows and paging exposes the remaining committed entry', () => {
  const entries = Array.from({ length: 21 }, (_, index) => visit({ id: `v${String(index).padStart(2, '0')}`, notes: `record ${index}` }));
  setup({ journal: { revision: 21, entries } });
  expect(screen.getAllByRole('listitem')).toHaveLength(20);
  expect(screen.queryByText('record 20')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next visits' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByText('record 20')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Previous visits' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(20);
});

test('invalid host snapshots and over-limit rosters block submission with bounded UI', async () => {
  const { createVisitId, onChange } = setup({ journal: { revision: -1, entries: [] }, catalog: { ...catalog, participants: Array(257).fill({ id: 'too-many' }) } });
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  expect(screen.getByText('Known dated visits: Unavailable')).toBeTruthy();
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  await submit();
  expect(createVisitId).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

test('blank participant/place labels fall back to IDs and never create unnamed controls', () => {
  setup({ catalog: { places: [{ id: 'a', label: ' ' }], participants: [{ id: 'p', label: '' }] } });
  expect(screen.getByRole('checkbox', { name: 'p' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Visits to a' })).toBeTruthy();
});

test('a controlled exact commit wins even when a refusal callback settles in the same update', async () => {
  const pending = deferred();
  const onChange = jest.fn((_value: VisitCommitRequest) => pending.promise);
  const { props, view } = setup({ onChange });
  fill();
  await submit();
  const sent = request(onChange);
  await act(async () => {
    view.rerender(<WeekendVisitHistory {...props} journal={sent.nextJournal} />);
    pending.resolve({ status: 'rejected' });
  });
  expect(notes().value).toBe('');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('Visit recorded.');
});

test('uncertain retry with missing original place reports conflict without retarget or another ID', async () => {
  const onChange = jest.fn((_value: VisitCommitRequest): VisitCommitResponse => { throw new Error('uncertain'); });
  const { props, view, createVisitId } = setup({ onChange });
  fill();
  await submit();
  view.rerender(<WeekendVisitHistory {...props} placeId="b" catalog={{ ...catalog, places: [{ id: 'b', label: 'Museum' }] }} />);
  await submit();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(createVisitId).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert').textContent).toContain('original place is no longer available');
  expect(notes().value).toBe('Original notes');
  expect(screen.getByText(/Pending visit for a/)).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
  expect(date().disabled).toBe(true);
});

test('invalid supplied date and oversized place label cannot fabricate a default or unbounded title', async () => {
  const { createVisitId, onChange } = setup({ initialDate: '2023-02-29', placeId: 'x'.repeat(257) });
  expect(date().value).toBe('');
  expect(screen.getByRole('heading', { name: 'Visits to Unavailable place' })).toBeTruthy();
  fill();
  await submit();
  expect(createVisitId).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});
