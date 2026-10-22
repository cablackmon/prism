export class Burn4MediaQuery extends EventTarget {
  readonly listeners = new Set<EventListenerOrEventListenerObject>();

  constructor(readonly media: string, public matches = false) {
    super();
  }

  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    if (type === 'change' && callback) this.listeners.add(callback);
    super.addEventListener(type, callback, options);
  }

  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    if (type === 'change' && callback) this.listeners.delete(callback);
    super.removeEventListener(type, callback, options);
  }

  change(matches: boolean) {
    this.matches = matches;
    const event = new Event('change');
    Object.defineProperties(event, { matches: { value: matches }, media: { value: this.media } });
    this.dispatchEvent(event);
  }
}

export function burn4MediaQueries() {
  const queries = new Map<string, Burn4MediaQuery>();
  function get(query: string) {
    let result = queries.get(query);
    if (!result) {
      result = new Burn4MediaQuery(query);
      queries.set(query, result);
    }
    return result;
  }
  const matchMedia = jest.fn((query: string) => get(query) as unknown as MediaQueryList);
  return { get, matchMedia };
}
