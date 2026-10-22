'use client';

import { useEffect, useRef, useState } from 'react';
import {
  locationDraft, parseLocationPlace, parseLocationPlaces, parseLocationResults, validateLocationDraft,
  type LocationDraft, type LocationPlace, type LocationResult,
} from './burn4-location-model';

function requestError(status: number, action: string): string {
  if (status === 401 || status === 403) return `Sign in with permission to ${action}. Your edits are still here.`;
  if (status === 404) return 'This place is no longer available. Your edits are still here.';
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  return `Could not ${action}. Try again.`;
}

const control = 'rounded border border-border bg-background p-2 disabled:opacity-50';

export function Burn4LocationEditor() {
  const [places, setPlaces] = useState<LocationPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<LocationDraft | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [searchError, setSearchError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const mounted = useRef(false);
  const savingNow = useRef(false);
  const searchRequest = useRef<AbortController | null>(null);
  const saveRequest = useRef<AbortController | null>(null);
  const selected = places.find((place) => place.id === selectedId);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      searchRequest.current?.abort();
      saveRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void (async () => {
      try {
        const response = await fetch('/api/weekend/places', { signal: controller.signal, credentials: 'same-origin' });
        if (!response.ok) throw new Error(requestError(response.status, 'load places'));
        const next = parseLocationPlaces(await response.json());
        if (!controller.signal.aborted && mounted.current) setPlaces(next);
      } catch (error) {
        if (!controller.signal.aborted && mounted.current) setLoadError(error instanceof Error ? error.message : 'Could not load places. Try again.');
      } finally {
        if (!controller.signal.aborted && mounted.current) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [loadAttempt]);

  const cancelSearch = () => {
    searchRequest.current?.abort();
    searchRequest.current = null;
    setSearching(false);
    setResults([]);
    setSearchMessage('');
    setSearchError('');
  };

  const choosePlace = (id: string) => {
    if (savingNow.current) return;
    cancelSearch();
    setQuery('');
    setSelectedId(id);
    const place = places.find((item) => item.id === id);
    setDraft(place ? locationDraft(place) : null);
    setSaveError('');
    setSaveMessage('');
  };

  const edit = (field: keyof LocationDraft, value: string) => {
    if (savingNow.current) return;
    setDraft((previous) => previous ? { ...previous, [field]: value } : previous);
    setSaveError('');
    setSaveMessage('');
  };

  const search = async () => {
    if (savingNow.current || !selectedId) return;
    cancelSearch();
    const term = query.trim();
    if (term.length < 2 || term.length > 200) {
      setSearchError('Enter a place name from 2 to 200 characters.');
      return;
    }
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    try {
      const response = await fetch(`/api/travel/geocode?q=${encodeURIComponent(term)}`, { signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error(requestError(response.status, 'search locations'));
      const next = parseLocationResults(await response.json());
      if (!controller.signal.aborted && searchRequest.current === controller && mounted.current) {
        setResults(next);
        setSearchMessage(next.length ? 'Choose a result to fill the location fields, then save.' : 'No locations found. Try a more specific name or enter coordinates.');
      }
    } catch (error) {
      if (!controller.signal.aborted && searchRequest.current === controller && mounted.current) {
        setSearchError(error instanceof Error ? error.message : 'Could not search locations. Try again.');
      }
    } finally {
      if (!controller.signal.aborted && searchRequest.current === controller && mounted.current) setSearching(false);
    }
  };

  const fillResult = (result: LocationResult) => {
    if (savingNow.current) return;
    setDraft({ latitude: String(result.latitude), longitude: String(result.longitude), placeName: result.displayName, address: result.fullName.slice(0, 500) });
    setSaveMessage(result.fullName.length > 500
      ? 'Location filled. The address was shortened to 500 characters. Review the fields and save to apply it.'
      : 'Location filled. Review the fields and save to apply it.');
    setSaveError('');
  };

  const save = async () => {
    if (savingNow.current || !draft || !selected) return;
    const validation = validateLocationDraft(draft);
    setSaveMessage('');
    if (!validation.ok) {
      setSaveError(validation.error);
      return;
    }
    const place = selected;
    savingNow.current = true;
    setSaving(true);
    setSaveError('');
    cancelSearch();
    const controller = new AbortController();
    saveRequest.current = controller;
    try {
      const response = await fetch(`/api/weekend/places/${encodeURIComponent(place.id)}`, {
        method: 'PATCH', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validation.patch),
      });
      if (!response.ok) throw new Error(requestError(response.status, 'save this location'));
      const saved = parseLocationPlace(await response.json());
      if (saved.id !== place.id) throw new Error('Could not confirm the saved place. Your edits are still here.');
      if (saved.latitude !== validation.patch.latitude || saved.longitude !== validation.patch.longitude ||
          saved.placeName !== validation.patch.placeName || saved.address !== validation.patch.address) {
        throw new Error('The server returned a different location. Your edits are still here. Review and save again.');
      }
      if (!controller.signal.aborted && mounted.current && saveRequest.current === controller) {
        setPlaces((previous) => previous.map((item) => item.id === place.id ? saved : item));
        setDraft(locationDraft(saved));
        setSaveMessage(`Location saved for ${saved.name}.`);
      }
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && saveRequest.current === controller) {
        setSaveError(error instanceof Error ? error.message : 'Could not save this location. Your edits are still here.');
      }
    } finally {
      if (mounted.current && saveRequest.current === controller) {
        savingNow.current = false;
        setSaving(false);
      }
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4">
      <a href="/weekend" className="underline">Back to Weekend Ideas</a>
      <h1 className="text-2xl font-semibold">Weekend place locations</h1>
      <p>Choose a saved place, review its location and save your changes. Choosing another place resets unsaved edits.</p>
      {loading && <p role="status">Loading places...</p>}
      {loadError && <div role="alert"><p>{loadError}</p><button className={control} onClick={() => setLoadAttempt((value) => value + 1)}>Retry loading places</button></div>}
      {!loading && !loadError && places.length === 0 && <p>No saved places yet. Add a place in Weekend Ideas first.</p>}
      {!loading && !loadError && places.length > 0 && <>
        <label className="flex flex-col gap-1">Saved place
          <select className={control} value={selectedId} disabled={saving} onChange={(event) => choosePlace(event.target.value)}>
            <option value="">Choose a place</option>
            {places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
          </select>
        </label>
        {draft && selected && <section aria-label={`Location for ${selected.name}`} className="space-y-4">
          <form onSubmit={(event) => { event.preventDefault(); void search(); }} className="space-y-2">
            <label className="flex flex-col gap-1">Search by place name
              <input className={control} value={query} maxLength={200} disabled={saving} onChange={(event) => { if (!savingNow.current) { cancelSearch(); setQuery(event.target.value); } }} />
            </label>
            <p className="text-sm">Searching sends the place name to the existing location service. You can enter coordinates instead.</p>
            <button className={control} disabled={saving || searching} type="submit">Search locations</button>
            {searching && <p role="status">Searching locations...</p>}
            {searchMessage && <p role="status">{searchMessage}</p>}
            {searchError && <p role="alert">{searchError}</p>}
            {results.length > 0 && <ul aria-label="Location search results">{results.map((result) => <li key={result.id}>
              <button className={control} type="button" disabled={saving} onClick={() => fillResult(result)}>
                <span className="block">{result.displayName} ({result.latitude}, {result.longitude})</span>
                <span className="block text-sm">{result.fullName}</span>
              </button>
            </li>)}</ul>}
          </form>
          <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-3" aria-busy={saving}>
            <fieldset disabled={saving} className="space-y-3">
              <legend className="font-semibold">Location fields</legend>
              <p className="text-sm" id="burn4-coordinate-help">Enter both coordinates in decimal degrees, or clear both to remove them. Latitude: -90 to 90. Longitude: -180 to 180.</p>
              <label className="flex flex-col gap-1">Latitude<input className={control} inputMode="decimal" aria-describedby="burn4-coordinate-help" value={draft.latitude} maxLength={32} onChange={(event) => edit('latitude', event.target.value)} /></label>
              <label className="flex flex-col gap-1">Longitude<input className={control} inputMode="decimal" aria-describedby="burn4-coordinate-help" value={draft.longitude} maxLength={32} onChange={(event) => edit('longitude', event.target.value)} /></label>
              <label className="flex flex-col gap-1">Place name<input className={control} value={draft.placeName} maxLength={255} onChange={(event) => edit('placeName', event.target.value)} /></label>
              <label className="flex flex-col gap-1">Address<textarea className={control} value={draft.address} maxLength={500} onChange={(event) => edit('address', event.target.value)} /></label>
              <button className={control} type="button" onClick={() => { if (!savingNow.current) { setDraft(locationDraft(selected)); setSaveError(''); setSaveMessage(''); } }}>Reset unsaved changes</button>
              <button className={control} type="submit">Save location</button>
            </fieldset>
            {saving && <p role="status">Saving location for {selected.name}...</p>}
            {saveError && <p role="alert">{saveError}</p>}
            {saveMessage && <p role="status">{saveMessage}</p>}
          </form>
        </section>}
      </>}
    </main>
  );
}
