'use client';

import { useState } from 'react';

interface LayoutExportV2 {
  type: 'prism-layout';
  version: number;
  mode: 'dashboard' | 'screensaver';
  name: string;
  description: string;
  author: string;
  tags: string[];
  screenSizes: string[];
  orientation: 'landscape' | 'portrait';
  widgets: Array<{
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    backgroundColor?: string;
    backgroundOpacity?: number;
    minW?: number;
    minH?: number;
  }>;
}

function validateImport(data: unknown): LayoutExportV2 | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (obj.type !== 'prism-layout') return null;
  if (typeof obj.version !== 'number') return null;
  if (obj.mode !== 'dashboard' && obj.mode !== 'screensaver') return null;
  if (!Array.isArray(obj.widgets)) return null;
  for (const w of obj.widgets) {
    if (!w || typeof w !== 'object') return null;
    const wObj = w as Record<string, unknown>;
    if (
      typeof wObj.i !== 'string' ||
      typeof wObj.x !== 'number' ||
      typeof wObj.y !== 'number' ||
      typeof wObj.w !== 'number' ||
      typeof wObj.h !== 'number'
    )
      return null;
  }
  return obj as unknown as LayoutExportV2;
}

export function LayoutEditorImportDialog({
  open,
  onClose,
  editingScreensaver,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  editingScreensaver: boolean;
  onApply: (
    widgets: Array<{
      i: string;
      x: number;
      y: number;
      w: number;
      h: number;
      visible: boolean;
      backgroundColor?: string;
      backgroundOpacity?: number;
    }>
  ) => void;
}) {
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');

  if (!open) return null;

  const handleImportApply = () => {
    try {
      const parsed = JSON.parse(importText);
      const validated = validateImport(parsed);
      if (!validated) {
        setImportError('Invalid layout format. Expected a KYST layout export.');
        return;
      }
      const expectedMode = editingScreensaver ? 'screensaver' : 'dashboard';
      if (validated.mode !== expectedMode) {
        setImportError(
          `This is a ${validated.mode} layout, but you're editing the ${expectedMode}. Switch modes first.`
        );
        return;
      }
      const importedWidgets = validated.widgets.map((w) => ({
        i: w.i,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        visible: true as const,
        ...(w.backgroundColor && { backgroundColor: w.backgroundColor }),
        ...(w.backgroundOpacity !== undefined && { backgroundOpacity: w.backgroundOpacity }),
      }));
      onApply(importedWidgets);
      onClose();
    } catch {
      setImportError('Invalid JSON. Please paste a valid layout export.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-lg space-y-3 rounded-lg border border-border bg-popover p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium">Import Layout</div>
        <textarea
          className="h-32 w-full resize-none rounded-md border border-border bg-muted p-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Paste exported layout JSON here..."
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value);
            setImportError('');
          }}
        />
        {importError && <p className="text-xs text-destructive">{importError}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md bg-muted px-3 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleImportApply}
            disabled={!importText.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
