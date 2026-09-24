'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { KystTheme } from '@/lib/theme/kystTheme';

const Configuration = createContext<KystTheme>('classic');
export function KystThemeProvider({ value, children }: { value: KystTheme; children: ReactNode }) {
  return <Configuration.Provider value={value}>{children}</Configuration.Provider>;
}
export const BoardThemeContext = createContext<KystTheme>('classic');
export const useKystTheme = () => useContext(Configuration);
export const useBoardTheme = () => useContext(BoardThemeContext);

/** Two compositor layers; no animation timer, canvas, or per-frame layout. */
export function BoardStarfield() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return (
    <div className="kyst-starfield" aria-hidden="true" data-paused={hidden}>
      <div className="kyst-stars kyst-stars-far" />
      <div className="kyst-stars kyst-stars-near" />
    </div>
  );
}

export function BoardWordmark() {
  return (
    <Link href="/" className="kyst-wordmark" aria-label="KYST family board home">
      <Image src="/kyst-emblem.svg" alt="" width={44} height={44} priority />
      <span>
        KYST<span className="kyst-wordmark-dot">.</span>
      </span>
    </Link>
  );
}
