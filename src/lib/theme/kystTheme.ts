export type KystTheme = 'nox' | 'classic';

/** Read on the server at request time, never baked into NEXT_PUBLIC_* assets. */
export function resolveKystTheme(value: string | undefined): KystTheme {
  // A misspelled flag fails back to the established rendering.
  return value === undefined || value === 'nox' ? 'nox' : 'classic';
}
