export type LocationPlace = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  placeName: string | null;
  address: string | null;
};

export type LocationDraft = {
  latitude: string;
  longitude: string;
  placeName: string;
  address: string;
};

export type LocationPatch = Pick<LocationPlace, 'latitude' | 'longitude' | 'placeName' | 'address'>;

export type LocationResult = {
  id: string;
  displayName: string;
  fullName: string;
  latitude: number;
  longitude: number;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid location data.');
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid location data.');
  return value;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid location data.');
  return value;
}

function coordinate(value: unknown, limit: number): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new Error('Invalid location data.');
  }
  return value;
}

export function parseLocationPlace(value: unknown): LocationPlace {
  const item = record(value);
  return {
    id: text(item.id, 128),
    name: text(item.name, 255),
    latitude: coordinate(item.latitude, 90),
    longitude: coordinate(item.longitude, 180),
    placeName: optionalText(item.placeName, 255),
    address: optionalText(item.address, 500),
  };
}

export function parseLocationPlaces(value: unknown): LocationPlace[] {
  const data = record(value);
  if (!Array.isArray(data.places) || data.places.length > 2000) throw new Error('Invalid place list.');
  const places = data.places.map(parseLocationPlace);
  if (new Set(places.map((place) => place.id)).size !== places.length) throw new Error('Duplicate place identifiers.');
  return places;
}

export function parseLocationResults(value: unknown): LocationResult[] {
  const data = record(value);
  if (!Array.isArray(data.results) || data.results.length > 20) throw new Error('Invalid search results.');
  const results = data.results.map((value) => {
    const item = record(value);
    const latitude = coordinate(item.latitude, 90);
    const longitude = coordinate(item.longitude, 180);
    if (latitude === null || longitude === null ||
        typeof item.placeId !== 'number' || !Number.isSafeInteger(item.placeId) || item.placeId < 0) {
      throw new Error('Invalid search results.');
    }
    return {
      id: String(item.placeId),
      displayName: text(item.displayName, 255),
      fullName: text(item.fullName, 2000),
      latitude,
      longitude,
    };
  });
  if (new Set(results.map((result) => result.id)).size !== results.length) throw new Error('Duplicate search identifiers.');
  return results;
}

export function locationDraft(place: LocationPlace): LocationDraft {
  return {
    latitude: place.latitude === null ? '' : String(place.latitude),
    longitude: place.longitude === null ? '' : String(place.longitude),
    placeName: place.placeName ?? '',
    address: place.address ?? '',
  };
}

export function validateLocationDraft(draft: LocationDraft):
  { ok: true; patch: LocationPatch } | { ok: false; error: string } {
  const latitude = draft.latitude.trim();
  const longitude = draft.longitude.trim();
  const placeName = draft.placeName.trim();
  const address = draft.address.trim();
  if (placeName.length > 255 || address.length > 500) return { ok: false, error: 'Place name or address is too long.' };
  if (Boolean(latitude) !== Boolean(longitude)) return { ok: false, error: 'Enter both coordinates, or clear both.' };
  if (!latitude && !longitude) return { ok: true, patch: { latitude: null, longitude: null, placeName: placeName || null, address: address || null } };
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  if (latitude.length > 32 || longitude.length > 32 || !decimal.test(latitude) || !decimal.test(longitude)) {
    return { ok: false, error: 'Use decimal numbers for both coordinates.' };
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, error: 'Latitude must be from -90 to 90 and longitude from -180 to 180.' };
  }
  return { ok: true, patch: { latitude: lat, longitude: lng, placeName: placeName || null, address: address || null } };
}
