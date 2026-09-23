'use client';

import { useState, useEffect } from 'react';
import { Monitor, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLayouts } from '@/lib/hooks/useLayouts';
import Link from 'next/link';

const FONT_SCALE_OPTIONS = [75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 130, 140, 150];

export function DisplaysSection() {
  const { layouts, loading } = useLayouts();
  const [saving, setSaving] = useState<string | null>(null);
  // Optimistic local scale values — keyed by layout id
  const [localScales, setLocalScales] = useState<Record<string, number>>({});

  // Initialise local scales from loaded layouts (only once per layout)
  useEffect(() => {
    if (layouts.length === 0) return;
    setLocalScales((prev) => {
      const next = { ...prev };
      for (const l of layouts) {
        if (!(l.id in next)) next[l.id] = l.fontScale ?? 100;
      }
      return next;
    });
  }, [layouts]);

  const saveTimers = useState<Record<string, ReturnType<typeof setTimeout>>>({});

  const updateFontScale = (layoutId: string, scale: number) => {
    // Update local state immediately — slider stays responsive
    setLocalScales((prev) => ({ ...prev, [layoutId]: scale }));

    // Debounce DB write so rapid slider drags don't spam the API
    const timers = saveTimers[0];
    if (timers[layoutId]) clearTimeout(timers[layoutId]);
    timers[layoutId] = setTimeout(async () => {
      setSaving(layoutId);
      try {
        await fetch(`/api/layouts/${layoutId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fontScale: scale === 100 ? null : scale }),
        });
      } catch {
        setLocalScales((prev) => ({
          ...prev,
          [layoutId]: layouts.find((l) => l.id === layoutId)?.fontScale ?? 100,
        }));
      } finally {
        setSaving(null);
      }
    }, 400);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Displays</h2>
        <p className="text-muted-foreground">
          Configure per-display settings for each of your named dashboards. Font scale lets you tune
          text size for screens that are farther away or have unusual DPI.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : layouts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No dashboards yet. Create one from the dashboard toolbar.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {layouts.map((layout) => {
            const scale = localScales[layout.id] ?? layout.fontScale ?? 100;
            const url = layout.slug ? `/d/${layout.slug}` : '/';
            return (
              <Card key={layout.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Monitor className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base">{layout.name}</CardTitle>
                      {layout.isDefault && (
                        <Badge variant="secondary" className="text-xs">
                          Default
                        </Badge>
                      )}
                    </div>
                    <Link
                      href={url}
                      className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {layout.slug ? `/d/${layout.slug}` : '/'}
                    </Link>
                  </div>
                  {layout.slug && (
                    <CardDescription className="mt-0.5 text-xs">
                      Subpages available at{' '}
                      <code className="font-mono">/d/{layout.slug}/calendar</code>,{' '}
                      <code className="font-mono">/tasks</code>, etc.
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Font Scale</span>
                      <span
                        className={cn(
                          'text-sm tabular-nums',
                          scale !== 100 ? 'font-medium text-primary' : 'text-muted-foreground'
                        )}
                      >
                        {scale}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-6 text-xs text-muted-foreground">A</span>
                      <div className="relative flex-1">
                        <input
                          type="range"
                          min={75}
                          max={150}
                          step={5}
                          value={scale}
                          onChange={(e) => updateFontScale(layout.id, Number(e.target.value))}
                          className="w-full accent-primary"
                        />
                        {/* 100% marker — sits at 33% from left on the 75–150 range */}
                        <div
                          className="pointer-events-none absolute top-1/2 h-2 w-0.5 -translate-y-1/2 bg-muted-foreground/40"
                          style={{ left: 'calc(33.3% - 1px)' }}
                          title="100% default"
                        />
                      </div>
                      <span className="w-6 text-base text-muted-foreground">A</span>
                    </div>
                    {/* Quick-select labels — positioned proportionally on the 75–150 scale */}
                    <div className="relative mt-0.5 h-5">
                      {[75, 100, 125, 150].map((s) => {
                        const pct = ((s - 75) / 75) * 100;
                        return (
                          <button
                            key={s}
                            onClick={() => updateFontScale(layout.id, s)}
                            className={cn(
                              'absolute -translate-x-1/2 rounded px-0.5 py-0.5 text-xs transition-colors',
                              scale === s
                                ? 'font-medium text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                            )}
                            style={{ left: `${pct}%` }}
                          >
                            {s}%
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                    <span className="capitalize">{layout.orientation || 'landscape'}</span>
                    <span>·</span>
                    <span>
                      {layout.widgets.length} widget{layout.widgets.length !== 1 ? 's' : ''}
                    </span>
                    {saving === layout.id && (
                      <>
                        <span>·</span>
                        <span className="text-primary">Saving…</span>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-dashed">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            <strong>Tip:</strong> Set a dedicated device to open{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/d/your-slug</code> as
            its home page, then tune font scale here to match its viewing distance and screen size.
            Each named dashboard is independent — changes here don&apos;t affect other displays.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
