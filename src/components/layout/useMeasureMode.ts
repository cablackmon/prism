'use client';

import { useState, useCallback, useEffect } from 'react';

export function useMeasureMode() {
  const [measureMode, setMeasureMode] = useState(false);
  const [measureHideNav, setMeasureHideNav] = useState(true);
  const [previewZoneIndex, setPreviewZoneIndexState] = useState(0);

  const dispatchMeasure = useCallback((active: boolean, hideNav: boolean, zoneIndex: number) => {
    window.dispatchEvent(
      new CustomEvent('prism:measure-mode', {
        detail: { active, hideNav, zoneIndex },
      })
    );
  }, []);

  const toggleMeasureMode = useCallback(() => {
    setMeasureMode((prev) => {
      const next = !prev;
      dispatchMeasure(next, measureHideNav, previewZoneIndex);
      return next;
    });
  }, [dispatchMeasure, measureHideNav, previewZoneIndex]);

  const toggleMeasureNav = useCallback(() => {
    setMeasureHideNav((prev) => {
      const next = !prev;
      dispatchMeasure(true, next, previewZoneIndex);
      return next;
    });
  }, [dispatchMeasure, previewZoneIndex]);

  const setPreviewZoneIndex = useCallback(
    (idx: number) => {
      setPreviewZoneIndexState(idx);
      dispatchMeasure(true, measureHideNav, idx);
    },
    [dispatchMeasure, measureHideNav]
  );

  // Keyboard shortcut: Ctrl+Shift+M
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        toggleMeasureMode();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleMeasureMode]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      dispatchMeasure(false, false, 0);
    };
  }, [dispatchMeasure]);

  return {
    measureMode,
    measureHideNav,
    previewZoneIndex,
    toggleMeasureMode,
    toggleMeasureNav,
    setPreviewZoneIndex,
  };
}
