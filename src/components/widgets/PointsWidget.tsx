'use client';

import { useBoardColor } from '@/components/theme/useBoardColor';
import * as React from 'react';
import { Emoji } from '@/components/ui/Emoji';
import { cn } from '@/lib/utils';
import { WidgetContainer, WidgetEmpty } from './WidgetContainer';
import { Check } from 'lucide-react';
import type { Goal, ChildProgress, GoalChild } from '@/lib/hooks/useGoals';

export interface PointsWidgetProps {
  goals: Goal[];
  progress: Record<string, Record<string, ChildProgress>>;
  goalChildren: GoalChild[];
  loading?: boolean;
  error?: string | null;
  titleHref?: string;
}

export const PointsWidget = React.memo(function PointsWidget({
  goals,
  progress,
  goalChildren,
  loading,
  error,
  titleHref = '/goals',
}: PointsWidgetProps) {
  const boardColor = useBoardColor();
  return (
    <WidgetContainer
      title="Points"
      icon={
        <span className="text-sm">
          <Emoji e="🏆" />
        </span>
      }
      loading={loading}
      error={error}
      titleHref={titleHref}
    >
      {goals.length === 0 ? (
        <WidgetEmpty message="No goals yet" />
      ) : (
        <div className="h-full space-y-3 overflow-y-auto p-2">
          {/* Per-child weekly counters */}
          {goalChildren.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {goalChildren.map((child) => (
                <div key={child.userId} className="flex items-center gap-1.5 text-xs">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: boardColor(child.color, child.name) }}
                  />
                  <span className="font-medium">{child.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {child.counters.weekly}/wk
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Goals in priority order with per-child progress */}
          {goals.map((goal) => (
            <div key={goal.id} className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm">
                {goal.fullyAchieved && <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />}
                <span>
                  <Emoji e={goal.emoji || '🎯'} />
                </span>
                <span className="truncate font-medium">{goal.name}</span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                  {goal.pointCost}pts
                </span>
              </div>

              {goalChildren.map((child) => {
                const cp = progress[child.userId]?.[goal.id];
                const allocated = cp?.allocated || 0;
                const pct = Math.min(100, (allocated / goal.pointCost) * 100);
                return (
                  <div key={child.userId} className="flex items-center gap-1.5">
                    {cp?.achieved ? (
                      <Check
                        className="h-3 w-3 shrink-0"
                        style={{ color: boardColor(child.color, child.name) }}
                      />
                    ) : (
                      <div className="h-3 w-3 shrink-0" />
                    )}
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: boardColor(child.color, child.name),
                        }}
                      />
                    </div>
                    <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">
                      {allocated}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </WidgetContainer>
  );
});
