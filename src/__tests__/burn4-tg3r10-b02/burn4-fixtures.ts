import type { LocationPlace } from '../../app/weekend/locations/burn4-location-model';

export const first: LocationPlace = {
  id: 'place-a', name: 'River Trail', latitude: 40, longitude: -90,
  placeName: 'Old trail entrance', address: 'Old address',
};
export const second: LocationPlace = {
  id: 'place-b', name: 'Local Museum', latitude: null, longitude: null,
  placeName: null, address: null,
};
export const suggestion = {
  placeId: 17, displayName: 'River Trail East', fullName: 'East entrance, Testville',
  latitude: 0, longitude: -12.5,
};

export function response(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
