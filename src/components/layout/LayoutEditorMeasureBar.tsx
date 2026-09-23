'use client';

interface MeasureBarProps {
  measureHideNav: boolean;
  onToggleNav: () => void;
  onExit: () => void;
}

/**
 * Floating control bar shown in full-screen preview mode. The old
 * screen-safe-zone editor + per-zone selector were retired (the dashboard now
 * stretches one design to fill any screen, so there are no zones to pick), so
 * this is just: toggle the nav chrome, and exit.
 */
export function LayoutEditorMeasureBar({ measureHideNav, onToggleNav, onExit }: MeasureBarProps) {
  return (
    <div className="fixed bottom-4 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2">
      <div className="flex items-center gap-2 rounded-full border border-border bg-card/90 px-4 py-2 shadow-lg backdrop-blur-sm">
        <button
          onClick={onToggleNav}
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition-colors ${
            measureHideNav
              ? 'bg-muted text-muted-foreground hover:bg-accent'
              : 'border border-blue-500/30 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
          }`}
        >
          {measureHideNav ? 'Show Nav' : 'Hide Nav'}
        </button>
        <div className="h-4 w-px bg-border" />
        <button
          onClick={onExit}
          className="whitespace-nowrap rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Exit Preview
        </button>
        <span className="hidden text-[10px] text-muted-foreground sm:inline">Ctrl+Shift+M</span>
      </div>
    </div>
  );
}
