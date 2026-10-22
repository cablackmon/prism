import { fireEvent, render, screen, within } from '@testing-library/react';
import { Burn4ContactDirectory } from '../../components/contacts/burn4-contact-directory';
import { CONTACT_DIRECTORY_LIMITS as limits, type ContactDirectoryInputContact, type ContactDirectoryInputSource } from '../../lib/burn4-contact-directory';

function contact(overrides: Partial<ContactDirectoryInputContact> = {}): ContactDirectoryInputContact {
  return { identity: 'person-1', displayName: 'Alex Example', emails: ['Alex@example.invalid'], phones: ['+1 (555) 010-1234'], ...overrides };
}
function source(overrides: Partial<ContactDirectoryInputSource> = {}): ContactDirectoryInputSource {
  return { schemaVersion: 1, sourceId: 'book-a', label: 'Household', complete: true, contacts: [contact()], ...overrides };
}
function details() { return screen.getByRole('region', { name: 'Selected contact' }); }
function choose(name = 'Alex Example') { fireEvent.click(screen.getByRole('button', { name })); }
function search(value: string) { fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value } }); }

describe('searchable read-only family contacts directory', () => {
  test('renders labeled native controls and does not expose channels before selection', () => {
    render(<Burn4ContactDirectory sources={[source()]} />);
    expect(screen.getByRole('region', { name: 'Family contacts' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search contacts' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Contact source' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('1 contact found. Showing 1 to 1.');
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
    expect(screen.getByText('Select a contact to see their details.')).toBeTruthy();
  });

  test('selected details preserve all original channels and have a close action', () => {
    render(<Burn4ContactDirectory sources={[source({ contacts: [contact({ emails: ['one@example.invalid', 'two@example.invalid'], phones: ['555-0101', '555-0102'] })] })]} />);
    choose();
    expect(within(details()).getByRole('heading', { name: 'Alex Example' })).toBeTruthy();
    expect(within(details()).getByText('Source: Household')).toBeTruthy();
    for (const value of ['one@example.invalid', 'two@example.invalid', '555-0101', '555-0102']) expect(within(details()).getByText(value)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alex Example' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Close contact details' }));
    expect(screen.queryByText('one@example.invalid')).toBeNull();
    expect(screen.getByRole('button', { name: 'Alex Example' }).getAttribute('aria-pressed')).toBe('false');
  });

  test('same identity/name across different sources stays separately selectable', () => {
    render(<Burn4ContactDirectory sources={[source(), source({ sourceId: 'book-b', label: 'Other book', contacts: [contact({ emails: ['other@example.invalid'] })] })]} />);
    const buttons = within(screen.getByRole('list', { name: 'Contact results' })).getAllByRole('button', { name: 'Alex Example' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    expect(within(details()).getByText('Source: Other book')).toBeTruthy();
    expect(within(details()).getByText('other@example.invalid')).toBeTruthy();
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
    fireEvent.click(buttons[0]!);
    expect(within(details()).getByText('Alex@example.invalid')).toBeTruthy();
    expect(screen.queryByText('other@example.invalid')).toBeNull();
  });

  test('delimiter-like source and opaque identity pairs select different current details', () => {
    render(<Burn4ContactDirectory sources={[
      source({ sourceId: 'a:b', contacts: [contact({ identity: 'c', displayName: 'First', emails: ['first@example.invalid'] })] }),
      source({ sourceId: 'a', contacts: [contact({ identity: 'b:c', displayName: 'Second', emails: ['second@example.invalid'] })] }),
    ]} />);
    choose('First');
    expect(within(details()).getByText('first@example.invalid')).toBeTruthy();
    choose('Second');
    expect(within(details()).getByText('second@example.invalid')).toBeTruthy();
    expect(screen.queryByText('first@example.invalid')).toBeNull();
  });

  test.each(['alex', 'ALEX@EXAMPLE.INVALID', '5550101234'])('searches the visible directory using %s', (query) => {
    render(<Burn4ContactDirectory sources={[source({ contacts: [contact(), contact({ identity: 'other', displayName: 'Taylor Test', emails: [], phones: [] })] })]} />);
    search(query);
    expect(within(screen.getByRole('list', { name: 'Contact results' })).getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Taylor Test' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('1 contact found');
  });

  test('query changes clear selected details and clearing the query restores the list without reopening them', () => {
    render(<Burn4ContactDirectory sources={[source()]} />);
    choose();
    search('none');
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
    expect(screen.getByText('No contacts match your search.')).toBeTruthy();
    search('');
    expect(screen.getByRole('button', { name: 'Alex Example' })).toBeTruthy();
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
  });

  test('source filter scopes matches and clears prior selection', () => {
    render(<Burn4ContactDirectory sources={[source(), source({ sourceId: 'book-b', label: 'Work book', contacts: [contact({ identity: 'taylor', displayName: 'Taylor Test', emails: [], phones: [] })] })]} />);
    choose();
    fireEvent.change(screen.getByLabelText('Contact source'), { target: { value: 'book-b' } });
    expect(screen.queryByRole('button', { name: 'Alex Example' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Taylor Test' })).toBeTruthy();
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
    search('alex');
    expect(screen.getByText('No contacts match your search.')).toBeTruthy();
  });

  test('labels each incomplete source even when that source is currently filtered out', () => {
    render(<Burn4ContactDirectory sources={[source({ complete: false }), source({ sourceId: 'b', label: 'Other', complete: false, contacts: [] })]} />);
    fireEvent.change(screen.getByLabelText('Contact source'), { target: { value: 'book-a' } });
    expect(screen.getAllByRole('note').map((note) => note.textContent)).toEqual(['Some contacts may be missing from Household.', 'Some contacts may be missing from Other.']);
  });

  test('distinguishes absent sources, empty sources and unmatched filters', () => {
    const view = render(<Burn4ContactDirectory sources={[]} />);
    expect(screen.getByText('No contact sources are available.')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    view.rerender(<Burn4ContactDirectory sources={[source({ contacts: [] })]} />);
    expect(screen.getByText('No contacts are available.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('0 contacts found. Showing 0 to 0.');
    view.rerender(<Burn4ContactDirectory sources={[source()]} />);
    search('missing');
    expect(screen.getByText('No contacts match your search.')).toBeTruthy();
  });

  test('unnamed contacts and missing/empty channels have understandable display fallbacks', () => {
    render(<Burn4ContactDirectory sources={[source({ contacts: [{ identity: 'unnamed', displayName: ' ', emails: [''], phones: [] }] })]} />);
    choose('Unnamed contact');
    expect(within(details()).getByRole('heading', { name: 'Unnamed contact' })).toBeTruthy();
    expect(within(details()).getByText('No email provided')).toBeTruthy();
    expect(within(details()).getByText('No phone provided.')).toBeTruthy();
  });

  test('untrusted names, labels and channels render inert text with no link/image/script', () => {
    const text = '<img src=x onerror=alert(1)>';
    const { container } = render(<Burn4ContactDirectory sources={[source({ label: '<script>bad()</script>', contacts: [contact({ displayName: text, emails: ['javascript:bad()'], phones: ['<a href=x>bad</a>'] })] })]} />);
    choose(text);
    expect(within(details()).getByText('javascript:bad()')).toBeTruthy();
    expect(within(details()).getByText('<a href=x>bad</a>')).toBeTruthy();
    expect(container.querySelector('a, img, script, iframe')).toBeNull();
  });

  test('removed selected contact disappears immediately and does not reopen if later restored', () => {
    const view = render(<Burn4ContactDirectory sources={[source()]} />);
    choose();
    view.rerender(<Burn4ContactDirectory sources={[source({ contacts: [] })]} />);
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
    view.rerender(<Burn4ContactDirectory sources={[source()]} />);
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
  });

  test('a replaced selected row and label use current authoritative values', () => {
    const view = render(<Burn4ContactDirectory sources={[source()]} />);
    choose();
    view.rerender(<Burn4ContactDirectory sources={[source({ label: 'Updated book', contacts: [contact({ displayName: 'Alex Updated', emails: ['new@example.invalid'], phones: [] })] })]} />);
    expect(within(details()).getByRole('heading', { name: 'Alex Updated' })).toBeTruthy();
    expect(within(details()).getByText('Source: Updated book')).toBeTruthy();
    expect(within(details()).getByText('new@example.invalid')).toBeTruthy();
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
  });

  test('rereads supplied rows after a parent rerender even when the input array reference is unchanged', () => {
    const contacts = [contact()];
    const supplied = [{ ...source(), contacts }];
    const view = render(<Burn4ContactDirectory sources={supplied} />);
    choose();
    contacts[0] = contact({ emails: ['replaced@example.invalid'] });
    view.rerender(<Burn4ContactDirectory sources={supplied} />);
    expect(within(details()).getByText('replaced@example.invalid')).toBeTruthy();
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
  });

  test('removing the filtered source resets the filter and removes its selected details', () => {
    const a = source();
    const b = source({ sourceId: 'book-b', label: 'Other', contacts: [contact({ displayName: 'Taylor Test' })] });
    const view = render(<Burn4ContactDirectory sources={[a, b]} />);
    fireEvent.change(screen.getByLabelText('Contact source'), { target: { value: 'book-a' } });
    choose();
    view.rerender(<Burn4ContactDirectory sources={[b]} />);
    expect((screen.getByLabelText('Contact source') as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Taylor Test' })).toBeTruthy();
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
  });

  test.each([null, [{ ...source(), complete: undefined }], [source(), source()]])('invalid replacement %j clears all previous displayed contacts and local selection', (invalid) => {
    const view = render(<Burn4ContactDirectory sources={[source()]} />);
    choose();
    search('alex');
    choose();
    view.rerender(<Burn4ContactDirectory sources={invalid} />);
    expect(screen.getByRole('alert').textContent).toContain('Contacts are unavailable.');
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    view.rerender(<Burn4ContactDirectory sources={[source()]} />);
    expect((screen.getByLabelText('Search contacts') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
  });

  test('paginates a larger list with accurate bounds and disabled edge controls', () => {
    const contacts = Array.from({ length: 41 }, (_, i) => contact({ identity: String(i), displayName: `Person ${String(i).padStart(2, '0')}` }));
    render(<Burn4ContactDirectory sources={[source({ contacts })]} />);
    const resultButtons = () => within(screen.getByRole('list', { name: 'Contact results' })).getAllByRole('button');
    expect(resultButtons()).toHaveLength(20);
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
    choose('Person 00');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(resultButtons()).toHaveLength(20);
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('41 contacts found. Showing 21 to 40.');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(resultButtons()).toHaveLength(1);
    expect(screen.getByText('Page 3 of 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  });

  test('query and source changes reset pagination to the first page', () => {
    const contacts = Array.from({ length: 25 }, (_, i) => contact({ identity: String(i), displayName: `Person ${String(i).padStart(2, '0')}` }));
    render(<Burn4ContactDirectory sources={[source({ contacts }), source({ sourceId: 'b', contacts: [] })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    search('Person');
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.change(screen.getByLabelText('Contact source'), { target: { value: 'book-a' } });
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
  });

  test('snapshot shrink clamps the current page and clears now-hidden selection', () => {
    const contacts = Array.from({ length: 25 }, (_, i) => contact({ identity: String(i), displayName: `Person ${String(i).padStart(2, '0')}` }));
    const view = render(<Burn4ContactDirectory sources={[source({ contacts })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    choose('Person 24');
    view.rerender(<Burn4ContactDirectory sources={[source({ contacts: contacts.slice(0, 2) })]} />);
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
    expect(screen.queryByText('Alex@example.invalid')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('2 contacts found. Showing 1 to 2.');
  });

  test('controls and result selection are focusable with correctly linked unique labels and regions', () => {
    render(<Burn4ContactDirectory sources={[source()]} />);
    for (const control of [screen.getByLabelText('Search contacts'), screen.getByLabelText('Contact source'), screen.getByRole('button', { name: 'Alex Example' })]) {
      control.focus();
      expect(document.activeElement).toBe(control);
    }
    const button = screen.getByRole('button', { name: 'Alex Example' });
    expect(button.getAttribute('aria-controls')).toBe(details().id);
    expect(screen.getByLabelText('Search contacts').getAttribute('aria-describedby')).toBe(screen.getByText('Search by name, email, or phone number.').id);
  });

  test('independent instances retain separate searches, selections and DOM IDs', () => {
    render(<><Burn4ContactDirectory sources={[source()]} /><Burn4ContactDirectory sources={[source({ contacts: [contact({ displayName: 'Taylor Test' })] })]} /></>);
    const directories = screen.getAllByRole('region', { name: 'Family contacts' });
    const first = within(directories[0]!);
    const second = within(directories[1]!);
    expect(first.getByLabelText('Search contacts').id).not.toBe(second.getByLabelText('Search contacts').id);
    fireEvent.change(first.getByLabelText('Search contacts'), { target: { value: 'missing' } });
    expect(first.getByText('No contacts match your search.')).toBeTruthy();
    expect(second.getByRole('button', { name: 'Taylor Test' })).toBeTruthy();
    fireEvent.click(second.getByRole('button', { name: 'Taylor Test' }));
    expect(within(second.getByRole('region', { name: 'Selected contact' })).getByText('Alex@example.invalid')).toBeTruthy();
    expect(first.queryByText('Alex@example.invalid')).toBeNull();
  });

  test('direct overlong input stays within the query limit and never crashes the view', () => {
    render(<Burn4ContactDirectory sources={[source()]} />);
    search('x'.repeat(limits.query + 1));
    expect((screen.getByLabelText('Search contacts') as HTMLInputElement).value).toHaveLength(limits.query);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
