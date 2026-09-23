'use client';

import * as React from 'react';
import { LayoutPreview } from './LayoutPreview';
import { DevicePreviewGallery } from './DevicePreviewGallery';
import type { WidgetConfig } from '@/lib/hooks/useLayouts';
import type { ScreenSafeZones } from '@/lib/hooks/useScreenSafeZones';

interface LayoutEditorPreviewPanelProps {
  visibleWidgets: WidgetConfig[];
  focusedWidget?: string;
  gridScrollY: number;
  gridVisibleRows: number;
  gridScrollX: number;
  gridVisibleCols: number;
  scrollToGridRef?: React.MutableRefObject<((row: number, col?: number) => void) | null>;
  // Retained for compatibility with the toolbar caller; the multi-screen
  // safe-zone toggles/borders were retired in favor of the device gallery, so
  // these are no longer used here.
  screenGuideOrientation?: 'landscape' | 'portrait';
  effectiveEnabledSizes?: string[];
  onToggleSize?: (size: string) => void;
  allSizeNames?: string[];
  zones?: ScreenSafeZones;
  validation: { errors: string[]; warnings: string[] };
}

export function LayoutEditorPreviewPanel({
  visibleWidgets,
  focusedWidget,
  gridScrollY,
  gridVisibleRows,
  gridScrollX,
  gridVisibleCols,
  scrollToGridRef,
  validation,
}: LayoutEditorPreviewPanelProps) {
  const previewWidgets = visibleWidgets.map((w) => ({ i: w.i, x: w.x, y: w.y, w: w.w, h: w.h }));

  return (
    <div className="space-y-3 p-3">
      {/* INTERACTIVE canvas mini-map — the one real, scrollable canvas. */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Canvas
          </p>
          <span className="text-[9px] text-muted-foreground/70">click to scroll</span>
        </div>
        <LayoutPreview
          widgets={previewWidgets}
          width={280}
          height={180}
          highlightWidget={focusedWidget}
          showLabels={true}
          showGrid={true}
          visibleRows={gridVisibleRows}
          scrollY={gridScrollY}
          visibleCols={gridVisibleCols}
          scrollX={gridScrollX}
          onScrollTo={(row, col) => scrollToGridRef?.current?.(row, col)}
        />
      </div>

      {/* REFERENCE — how the one design looks on each screen. Not editable;
          delineated (bordered, muted background) so it reads as a preview. */}
      <div className="rounded-md border border-border/60 bg-muted/40 p-2">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Preview — each screen{' '}
          <span className="font-normal normal-case opacity-60">(reference)</span>
        </p>
        <DevicePreviewGallery widgets={previewWidgets} highlightWidget={focusedWidget} />
      </div>

      {validation.errors.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2">
          <p className="mb-0.5 text-xs font-medium text-destructive">
            {validation.errors.length} issue{validation.errors.length > 1 ? 's' : ''}
          </p>
          {validation.errors.map((err, i) => (
            <p key={i} className="text-xs leading-tight text-destructive/80">
              {err}
            </p>
          ))}
        </div>
      )}
      {validation.warnings.length > 0 && validation.errors.length === 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2">
          {validation.warnings.map((w, i) => (
            <p key={i} className="text-xs leading-tight text-amber-600">
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
