import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Burn4ShoppingAttribution } from '../../components/shopping/burn4-shopping-attribution';
import type { ShoppingAttributionFilters, ShoppingAttributionSnapshot } from '../../lib/burn4-shopping-attribution';
import { allFilters, snapshot } from './burn4-fixtures';

afterEach(cleanup);

function controlled(initial: ShoppingAttributionFilters = allFilters) {
  function Host() {
    const [filters, setFilters] = useState(initial);
    return <Burn4ShoppingAttribution snapshot={snapshot()} filters={filters} onFiltersChange={setFilters} />;
  }
  return render(<Host />);
}

describe('rendered contributor browsing', () => {
  it('renders current, supplied former and absent contributor attribution without unrelated list data', () => {
    render(<Burn4ShoppingAttribution snapshot={snapshot()} filters={allFilters} onFiltersChange={jest.fn()} />);
    const list = screen.getByRole('list', { name: 'Shopping items with contributors' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(list).getAllByText('Added by Robin')).toHaveLength(2);
    expect(within(list).getByText('Added by Casey (not in current household)')).toBeTruthy();
    expect(within(list).getAllByText('No contributor recorded')).toHaveLength(2);
    expect(screen.queryByText('Hammer')).toBeNull();
    expect(screen.queryByText('Other list')).toBeNull();
  });

  it('associates unique labels and disambiguates equal display names', () => {
    render(<Burn4ShoppingAttribution snapshot={snapshot()} filters={allFilters} onFiltersChange={jest.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Added by' });
    expect(select.tagName).toBe('SELECT');
    expect(within(select).getByRole('option', { name: 'Robin (1) [member 1]' })).toBeTruthy();
    expect(within(select).getByRole('option', { name: 'Robin (1) [member 2]' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Item status' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Reset filters' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows full-list progress separately from the filtered live result', () => {
    render(<Burn4ShoppingAttribution snapshot={snapshot()} filters={{ contributor: { kind: 'unassigned' }, checked: 'checked' }} onFiltersChange={jest.fn()} />);
    expect(screen.getByText('Full list: 2 of 5 checked')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Showing 1 of 5 items. Matched: 1 of 1 checked.');
    const progress = screen.getByRole('progressbar', { name: 'Full list progress' }) as HTMLProgressElement;
    expect(progress.value).toBe(2);
    expect(progress.max).toBe(5);
    expect(screen.getByText('Soap').style.textDecoration).toBe('line-through');
  });

  it('requests an exact member identity while keeping status and waiting for host props', () => {
    const onChange = jest.fn();
    const filters: ShoppingAttributionFilters = { contributor: { kind: 'all' }, checked: 'open' };
    const host = render(<Burn4ShoppingAttribution snapshot={snapshot()} filters={filters} onFiltersChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'Added by' }) as HTMLSelectElement;
    select.focus();
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.change(select, { target: { value: 'member:1' } });
    expect(document.activeElement).toBe(select);
    expect(onChange).toHaveBeenCalledWith({ contributor: { kind: 'member', memberId: 'unassigned' }, checked: 'open' });
    expect(select.value).toBe('all');
    expect(screen.getByText('Milk')).toBeTruthy();
    host.rerender(<Burn4ShoppingAttribution snapshot={snapshot()} filters={onChange.mock.calls[0]?.[0] as ShoppingAttributionFilters} onFiltersChange={onChange} />);
    expect(select.value).toBe('member:1');
    expect(screen.getByText('No items match these filters.')).toBeTruthy();
  });

  it.each(['all', 'unassigned'])('requests the %s contributor choice without changing checked state', kind => {
    const onChange = jest.fn();
    render(<Burn4ShoppingAttribution snapshot={snapshot()} filters={{ contributor: { kind: 'member', memberId: 'all' }, checked: 'checked' }} onFiltersChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Added by' }), { target: { value: kind } });
    expect(onChange).toHaveBeenCalledWith({ contributor: { kind }, checked: 'checked' });
  });

  it.each(['all', 'open', 'checked'])('requests status %s while retaining the contributor identity', checked => {
    const onChange = jest.fn();
    render(<Burn4ShoppingAttribution snapshot={snapshot()} filters={{ contributor: { kind: 'member', memberId: 'former' }, checked: 'all' }} onFiltersChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Item status' }), { target: { value: checked } });
    expect(onChange).toHaveBeenCalledWith({ contributor: { kind: 'member', memberId: 'former' }, checked });
  });

  it('supports a real controlled filter and reset workflow', () => {
    controlled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Added by' }), { target: { value: 'unassigned' } });
    expect(screen.getByRole('status').textContent).toContain('Showing 2 of 5 items.');
    fireEvent.change(screen.getByRole('combobox', { name: 'Item status' }), { target: { value: 'open' } });
    expect(screen.getByText('Tea')).toBeTruthy();
    expect(screen.queryByText('Soap')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByRole('status').textContent).toContain('Showing 5 of 5 items.');
    expect((screen.getByRole('button', { name: 'Reset filters' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('requests reset without implying an unaccepted reset changed the view', () => {
    const onChange = jest.fn();
    render(<Burn4ShoppingAttribution snapshot={snapshot()} filters={{ contributor: { kind: 'member', memberId: 'former' }, checked: 'all' }} onFiltersChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(onChange).toHaveBeenCalledWith(allFilters);
    expect(screen.getByRole('status').textContent).toContain('Showing 1 of 5 items.');
  });

  it('distinguishes an empty list from a no-match filter and avoids zero progress maxima', () => {
    const input = snapshot();
    const onChange = jest.fn();
    const host = render(<Burn4ShoppingAttribution snapshot={{ ...input, items: [] }} filters={allFilters} onFiltersChange={onChange} />);
    expect(screen.getByText('This list has no items.')).toBeTruthy();
    const progress = screen.getByRole('progressbar') as HTMLProgressElement;
    expect(progress.max).toBe(1);
    expect(progress.value).toBe(0);
    host.rerender(<Burn4ShoppingAttribution snapshot={input} filters={{ contributor: { kind: 'member', memberId: 'zero' }, checked: 'all' }} onFiltersChange={onChange} />);
    expect(screen.getByText('No items match these filters.')).toBeTruthy();
    expect(screen.queryByText('This list has no items.')).toBeNull();
  });

  it('keeps a stale selected contributor explicit after list and roster changes', () => {
    const input = snapshot();
    const filters: ShoppingAttributionFilters = { contributor: { kind: 'member', memberId: 'former' }, checked: 'all' };
    const onChange = jest.fn();
    const host = render(<Burn4ShoppingAttribution snapshot={input} filters={filters} onFiltersChange={onChange} />);
    host.rerender(<Burn4ShoppingAttribution snapshot={{ ...input, list: { id: 'hardware', name: 'Hardware' }, members: [] }} filters={filters} onFiltersChange={onChange} />);
    expect(screen.getByRole('heading', { name: 'Hardware contributors' })).toBeTruthy();
    const select = screen.getByRole('combobox', { name: 'Added by' }) as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toContain('Unavailable member (not in current household) (0)');
    expect(screen.getByText('No items match these filters.')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('updates counts and attribution from current props without caching erased identity', () => {
    const input = snapshot();
    const onChange = jest.fn();
    const host = render(<Burn4ShoppingAttribution snapshot={input} filters={allFilters} onFiltersChange={onChange} />);
    host.rerender(<Burn4ShoppingAttribution snapshot={{ ...input, members: [], items: [
      { id: 'milk', listId: 'groceries', name: 'Milk', checked: true, addedBy: null },
    ] }} filters={allFilters} onFiltersChange={onChange} />);
    expect(screen.getByText('Full list: 1 of 1 checked')).toBeTruthy();
    expect(within(screen.getByRole('list')).getByText('No contributor recorded')).toBeTruthy();
    expect(screen.queryByText('Added by Robin')).toBeNull();
  });

  it('uses generic invalid-input feedback and recovers on corrected props', () => {
    const input = snapshot();
    const onChange = jest.fn();
    const host = render(<Burn4ShoppingAttribution snapshot={{ ...input, list: null } as unknown as ShoppingAttributionSnapshot} filters={allFilters} onFiltersChange={onChange} />);
    expect(screen.getByRole('alert').textContent).toBe('Shopping contributor data is unavailable.');
    expect(screen.queryByRole('combobox')).toBeNull();
    host.rerender(<Burn4ShoppingAttribution snapshot={input} filters={allFilters} onFiltersChange={onChange} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Milk')).toBeTruthy();
  });

  it('renders hostile names as text and omits extra metadata', () => {
    const text = '<img src=x onerror=alert(1)>';
    const input = snapshot();
    const host = render(<Burn4ShoppingAttribution snapshot={{ ...input, list: { id: 'groceries', name: text }, items: [
      { id: 'x', listId: 'groceries', name: text, checked: false, addedBy: { id: 'unknown', name: text }, privateNotes: 'private marker' },
    ] } as unknown as ShoppingAttributionSnapshot} filters={allFilters} onFiltersChange={jest.fn()} />);
    expect(host.container.querySelector('img')).toBeNull();
    expect(host.container.textContent).toContain(text);
    expect(host.container.textContent).not.toContain('private marker');
  });

  it('keeps two instances independent with unique label targets', () => {
    const first = jest.fn();
    const second = jest.fn();
    render(<>
      <Burn4ShoppingAttribution snapshot={snapshot()} filters={allFilters} onFiltersChange={first} />
      <Burn4ShoppingAttribution snapshot={snapshot()} filters={{ contributor: { kind: 'unassigned' }, checked: 'open' }} onFiltersChange={second} />
    </>);
    const selectors = screen.getAllByRole('combobox', { name: 'Added by' }) as HTMLSelectElement[];
    expect(selectors[0]?.id).not.toBe(selectors[1]?.id);
    fireEvent.change(selectors[1]!, { target: { value: 'all' } });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ contributor: { kind: 'all' }, checked: 'open' });
  });

  it('shows a supplied unavailable identity separately from an unassigned row', () => {
    const input = snapshot();
    render(<Burn4ShoppingAttribution snapshot={{ ...input, members: [], items: [
      { id: 'a', listId: 'groceries', name: 'Spice', checked: false, addedBy: { id: 'unknown' } },
      { id: 'b', listId: 'groceries', name: 'Salt', checked: false },
    ] }} filters={allFilters} onFiltersChange={jest.fn()} />);
    const list = screen.getByRole('list');
    expect(within(list).getByText('Added by Unavailable member (not in current household)')).toBeTruthy();
    expect(within(list).getByText('No contributor recorded')).toBeTruthy();
  });

  it('ignores unrecognized DOM filter values instead of emitting malformed filters', () => {
    const onChange = jest.fn();
    render(<Burn4ShoppingAttribution snapshot={snapshot()} filters={allFilters} onFiltersChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Added by' }), { target: { value: 'unknown' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Item status' }), { target: { value: 'unknown' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
