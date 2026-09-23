import { isLightColor } from '@/lib/utils/color';
import type { WidgetConfig } from '@/lib/hooks/useLayouts';

function getTextClass(widget: WidgetConfig, fallback: string) {
  if (!widget.backgroundColor) return fallback;
  return isLightColor(widget.backgroundColor) ? 'text-black' : 'text-white';
}

export function renderScreensaverPreview(widget: WidgetConfig) {
  const textClass = getTextClass(widget, 'text-white');
  // Add a subtle background to make previews visible in the dark editor
  const bgClass = widget.backgroundColor ? '' : 'bg-white/10';

  switch (widget.i) {
    case 'clock':
      return (
        <div
          className={`flex h-full flex-col justify-end rounded-lg p-3 text-right ${textClass} ${bgClass}`}
        >
          <div className="text-4xl font-light tabular-nums">
            12:00 <span className="text-lg opacity-70">PM</span>
          </div>
          <div className="mt-1 text-sm opacity-60">Saturday, February 1</div>
        </div>
      );
    case 'weather':
      return (
        <div
          className={`flex h-full items-center justify-end rounded-lg p-3 ${textClass} ${bgClass}`}
        >
          <div className="text-2xl font-light">72°F</div>
          <div className="ml-2 text-sm opacity-60">Sunny</div>
        </div>
      );
    case 'messages':
      return (
        <div
          className={`flex h-full flex-col justify-end rounded-lg p-3 text-right ${textClass} ${bgClass}`}
        >
          <div className="mb-1 text-[10px] uppercase tracking-wider opacity-60">
            Family Messages
          </div>
          <p className="text-sm opacity-90">Sample message text...</p>
          <p className="mt-0.5 text-xs opacity-50">&mdash; Family</p>
        </div>
      );
    case 'calendar':
      return (
        <div
          className={`flex h-full flex-col justify-end rounded-lg p-3 text-right ${textClass} ${bgClass}`}
        >
          <div className="mb-1 text-[10px] uppercase tracking-wider opacity-60">Upcoming</div>
          <p className="text-sm opacity-90">Doctor appt @ 2pm</p>
          <p className="mt-0.5 text-xs opacity-50">Tomorrow</p>
        </div>
      );
    case 'birthdays':
      return (
        <div
          className={`flex h-full flex-col justify-end rounded-lg p-3 text-right ${textClass} ${bgClass}`}
        >
          <div className="mb-1 text-[10px] uppercase tracking-wider opacity-60">Birthdays</div>
          <p className="text-sm opacity-90">Mom in 3 days</p>
        </div>
      );
    case 'tasks':
      return (
        <div
          className={`flex h-full flex-col justify-end rounded-lg p-3 text-right ${textClass} ${bgClass}`}
        >
          <div className="mb-1 text-[10px] uppercase tracking-wider opacity-60">Tasks</div>
          <p className="text-sm opacity-90">Buy groceries</p>
          <p className="mt-0.5 text-xs opacity-50">3 more tasks</p>
        </div>
      );
    case 'chores':
      return (
        <div
          className={`flex h-full flex-col justify-end rounded-lg p-3 text-right ${textClass} ${bgClass}`}
        >
          <div className="mb-1 text-[10px] uppercase tracking-wider opacity-60">Chores</div>
          <p className="text-sm opacity-90">Vacuum living room</p>
          <p className="mt-0.5 text-xs opacity-50">Due today</p>
        </div>
      );
    case 'shopping':
      return (
        <div
          className={`flex h-full flex-col justify-end rounded-lg p-3 text-right ${textClass} ${bgClass}`}
        >
          <div className="mb-1 text-[10px] uppercase tracking-wider opacity-60">Shopping</div>
          <p className="text-sm opacity-90">Milk, Eggs, Bread</p>
          <p className="mt-0.5 text-xs opacity-50">5 items</p>
        </div>
      );
    case 'meals':
      return (
        <div
          className={`flex h-full flex-col justify-end rounded-lg p-3 text-right ${textClass} ${bgClass}`}
        >
          <div className="mb-1 text-[10px] uppercase tracking-wider opacity-60">
            Tonight&apos;s Dinner
          </div>
          <p className="text-sm opacity-90">Pasta Primavera</p>
        </div>
      );
    case 'photos':
      return (
        <div
          className={`flex h-full flex-col justify-end rounded-lg p-3 text-right ${textClass} ${bgClass}`}
        >
          <div className="mb-1 text-[10px] uppercase tracking-wider opacity-60">Photos</div>
          <p className="text-sm opacity-90">Family slideshow</p>
        </div>
      );
    default:
      return <div className={`rounded-lg p-3 text-sm text-white ${bgClass}`}>{widget.i}</div>;
  }
}
