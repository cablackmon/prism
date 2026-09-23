'use client';

import { PopoverButton } from './LayoutEditorPopover';
import { ChevronIcon } from './LayoutEditorIcons';
import type { ActivePopover, DashboardInfo } from './LayoutEditorTypes';

interface ToolbarRightProps {
  editingScreensaver: boolean;
  activePopover: ActivePopover;
  onTogglePopover: (name: ActivePopover) => void;
  saveLabel: string;
  saveFeedback: string;
  exportFeedback: string;
  allDashboards: DashboardInfo[];
  currentDashboardId?: string;
  onToggleMeasureMode: () => void;
  onToggleScreensaverEdit?: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onReset: () => void;
  onScreensaverReset?: () => void;
  onCancel: () => void;
  onExport: () => void;
  onImportOpen: () => void;
  onShareOpen: () => void;
  onDeleteDashboard?: () => void;
  onHandleDelete: () => void;
}

const btnClass = 'px-2 py-1.5 text-xs rounded-md whitespace-nowrap transition-colors';
const moreItemClass = 'w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors';

export function LayoutEditorToolbarRight({
  editingScreensaver,
  activePopover,
  onTogglePopover,
  saveLabel,
  saveFeedback,
  exportFeedback,
  allDashboards,
  currentDashboardId,
  onToggleMeasureMode,
  onToggleScreensaverEdit,
  onSave,
  onSaveAs,
  onReset,
  onScreensaverReset,
  onCancel,
  onExport,
  onImportOpen,
  onShareOpen,
  onDeleteDashboard,
  onHandleDelete,
}: ToolbarRightProps) {
  return (
    <div className="flex items-center gap-2">
      {/* Screen Preview */}
      <button
        onClick={onToggleMeasureMode}
        className={`${btnClass} bg-muted hover:bg-accent`}
        title="Preview layout as it appears on a specific screen (Ctrl+Shift+M)"
      >
        Preview
      </button>

      {/* Screensaver toggle */}
      {onToggleScreensaverEdit && (
        <button
          onClick={onToggleScreensaverEdit}
          className={`${btnClass} ${
            editingScreensaver
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted hover:bg-accent'
          }`}
        >
          {editingScreensaver ? '\u2190 Dashboard' : 'Screensaver'}
        </button>
      )}

      {/* Save split button */}
      {editingScreensaver ? (
        <button
          onClick={onSave}
          className="whitespace-nowrap rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {saveLabel}
        </button>
      ) : (
        <div className="relative flex">
          <button
            onClick={onSave}
            className="whitespace-nowrap rounded-l-md bg-primary px-2 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {saveFeedback || saveLabel}
          </button>
          <button
            onClick={() => onTogglePopover('save')}
            className="rounded-r-md border-l border-primary-foreground/20 bg-primary px-1.5 py-1.5 text-primary-foreground transition-colors hover:bg-primary/90"
            aria-label="Save options"
          >
            <ChevronIcon open={activePopover === 'save'} />
          </button>
          {activePopover === 'save' && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-md border border-border bg-popover py-1 shadow-md">
              <button
                onClick={() => {
                  onSaveAs();
                  onTogglePopover('save');
                }}
                className={moreItemClass}
              >
                Save As...
              </button>
            </div>
          )}
        </div>
      )}

      {/* More dropdown */}
      <PopoverButton
        label="More"
        isActive={activePopover === 'more'}
        onToggle={() => onTogglePopover('more')}
        width={200}
        align="right"
      >
        <div className="py-1">
          {!editingScreensaver &&
            currentDashboardId &&
            (() => {
              const current = allDashboards.find((d) => d.id === currentDashboardId);
              const alreadyDefault = current?.isDefault === true;
              return (
                <button
                  onClick={async () => {
                    if (alreadyDefault) return;
                    try {
                      const res = await fetch(`/api/layouts/${currentDashboardId}/default`, {
                        method: 'POST',
                      });
                      if (res.ok) window.location.reload();
                    } catch {
                      /* ignore — UI stays put on failure */
                    }
                    onTogglePopover('more');
                  }}
                  className={`${moreItemClass} ${alreadyDefault ? 'cursor-not-allowed text-muted-foreground' : ''}`}
                  disabled={alreadyDefault}
                  title={
                    alreadyDefault
                      ? 'Already the default dashboard'
                      : 'Make this the dashboard shown at /'
                  }
                >
                  {alreadyDefault ? 'Default Dashboard ✓' : 'Set as Default'}
                </button>
              );
            })()}
          {!editingScreensaver && currentDashboardId && (
            <div className="my-1 border-t border-border" />
          )}
          {!editingScreensaver && onDeleteDashboard && (
            <button
              onClick={onHandleDelete}
              className={`${moreItemClass} ${
                allDashboards.length <= 1
                  ? 'cursor-not-allowed text-muted-foreground'
                  : 'text-destructive'
              }`}
              disabled={allDashboards.length <= 1}
            >
              Delete Dashboard
            </button>
          )}
          {!editingScreensaver && onDeleteDashboard && (
            <div className="my-1 border-t border-border" />
          )}
          <button
            onClick={() => {
              if (editingScreensaver) onScreensaverReset?.();
              else onReset();
              onTogglePopover('more');
            }}
            className={moreItemClass}
          >
            Reset
          </button>
          <button onClick={onExport} className={moreItemClass}>
            {exportFeedback || 'Export'}
          </button>
          <button onClick={onImportOpen} className={moreItemClass}>
            Import
          </button>
          <button onClick={onShareOpen} className={moreItemClass}>
            Share
          </button>
        </div>
      </PopoverButton>

      {/* Cancel */}
      <button
        onClick={onCancel}
        className="rounded-md bg-destructive px-2 py-1.5 text-xs text-destructive-foreground transition-colors hover:bg-destructive/90"
      >
        Cancel
      </button>
    </div>
  );
}
