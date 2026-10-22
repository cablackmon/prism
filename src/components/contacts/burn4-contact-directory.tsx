'use client';

import { useEffect, useId, useState } from 'react';
import {
  CONTACT_DIRECTORY_LIMITS,
  createContactDirectory,
  pageContactDirectory,
  searchContactDirectory,
  type ContactDirectoryModel,
} from '../../lib/burn4-contact-directory';

export type Burn4ContactDirectoryProps = { readonly sources: unknown };

/** The host supplies authorized snapshots. This component has no I/O or contact actions. */
export function Burn4ContactDirectory({ sources }: Burn4ContactDirectoryProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [requestedPage, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  let directory: ContactDirectoryModel | null = null;
  try {
    directory = createContactDirectory(sources);
  } catch {
    // Fail closed without copying caller data into errors or retaining old details.
  }
  const invalid = directory === null;
  const sourceMissing = sourceId !== null && !directory?.sources.some((source) => source.sourceId === sourceId);
  const filtered = directory ? searchContactDirectory(directory, query, sourceMissing ? null : sourceId) : [];
  const page = pageContactDirectory(filtered, requestedPage);
  const selected = page.rows.find((row) => row.key === selectedKey);
  const selectedVisibleKey = selected?.key;

  useEffect(() => {
    if (invalid || sourceMissing) {
      setSourceId(null);
      setPage(0);
      setSelectedKey(null);
      if (invalid) setQuery('');
    }
  }, [invalid, sourceMissing]);
  useEffect(() => {
    if (selectedKey !== null && selectedVisibleKey === undefined) setSelectedKey(null);
  }, [selectedKey, selectedVisibleKey]);
  useEffect(() => {
    if (requestedPage !== page.page) setPage(page.page);
  }, [requestedPage, page.page]);

  if (!directory) {
    return <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Family contacts</h2>
      <p role="alert">Contacts are unavailable. Ask the person managing this directory to check the supplied data.</p>
    </section>;
  }

  return <section aria-labelledby={`${id}-title`} style={{ maxWidth: '60rem', padding: '1rem' }}>
    <h2 id={`${id}-title`}>Family contacts</h2>
    <p>Browse your read-only contacts.</p>
    {directory.sources.length === 0 ? <p>No contact sources are available.</p> : <>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <label htmlFor={`${id}-search`}>Search contacts
          <input id={`${id}-search`} type="search" value={query} maxLength={CONTACT_DIRECTORY_LIMITS.query}
            aria-describedby={`${id}-search-help`} onChange={(event) => {
              setQuery(event.currentTarget.value.slice(0, CONTACT_DIRECTORY_LIMITS.query));
              setPage(0);
              setSelectedKey(null);
            }} />
        </label>
        <label htmlFor={`${id}-source`}>Contact source
          <select id={`${id}-source`} value={sourceMissing ? '' : sourceId ?? ''} onChange={(event) => {
            setSourceId(event.currentTarget.value || null);
            setPage(0);
            setSelectedKey(null);
          }}>
            <option value="">All sources</option>
            {directory.sources.map((source) => <option key={source.sourceId} value={source.sourceId}>{source.label}</option>)}
          </select>
        </label>
      </div>
      <p id={`${id}-search-help`}>Search by name, email, or phone number.</p>
      {directory.sources.filter((source) => !source.complete).map((source) =>
        <p key={source.sourceId} role="note">Some contacts may be missing from {source.label}.</p>)}
      <p role="status" aria-live="polite">{page.total} {page.total === 1 ? 'contact' : 'contacts'} found. Showing {page.start} to {page.end}.</p>
      {page.total === 0 ? <p>{directory.rows.length === 0 ? 'No contacts are available.' : 'No contacts match your search.'}</p> : <>
        <ul aria-label="Contact results">
          {page.rows.map((row) => <li key={row.key} style={{ marginBottom: '0.75rem' }}>
            <button type="button" aria-pressed={selected?.key === row.key} aria-controls={`${id}-details`}
              onClick={() => setSelectedKey(row.key)}>{row.displayName.trim() ? row.displayName : 'Unnamed contact'}</button>
            {' '}<span>{row.sourceLabel}</span>
          </li>)}
        </ul>
        <nav aria-label="Contact result pages" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button type="button" disabled={page.page === 0} onClick={() => { setPage(page.page - 1); setSelectedKey(null); }}>Previous page</button>
          <span>Page {page.page + 1} of {page.pageCount}</span>
          <button type="button" disabled={page.page + 1 === page.pageCount} onClick={() => { setPage(page.page + 1); setSelectedKey(null); }}>Next page</button>
        </nav>
      </>}
      <div id={`${id}-details`} role="region" aria-label="Selected contact" style={{ marginTop: '1rem', borderTop: '1px solid', paddingTop: '1rem' }}>
        {selected ? <>
          <h3>{selected.displayName.trim() ? selected.displayName : 'Unnamed contact'}</h3>
          <p>Source: {selected.sourceLabel}</p>
          <h4>Email</h4>
          {selected.emails.length ? <ul>{selected.emails.map((email, index) => <li key={index}>{email.trim() ? email : 'No email provided'}</li>)}</ul> : <p>No email provided.</p>}
          <h4>Phone</h4>
          {selected.phones.length ? <ul>{selected.phones.map((phone, index) => <li key={index}>{phone.trim() ? phone : 'No phone provided'}</li>)}</ul> : <p>No phone provided.</p>}
          <button type="button" onClick={() => setSelectedKey(null)}>Close contact details</button>
        </> : <p>Select a contact to see their details.</p>}
      </div>
    </>}
  </section>;
}
