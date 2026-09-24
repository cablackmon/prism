'use client';

import * as React from 'react';
import { X, Trash2, Plus, GripVertical, MapPin, Pencil, TreePine } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import type { TravelTrip, TravelPin, PinType } from '../types';
import { TRIP_STYLE_CONFIG, STATUS_CONFIG, NPS_COLOR } from '../types';
import { InlineChildAdd } from './InlineChildAdd';

interface TripDetailProps {
  trip: TravelTrip;
  stops: TravelPin[];
  onUpdate: (data: Partial<TravelTrip>) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
  onAddStop: (
    name: string,
    lat: number,
    lng: number,
    placeName: string | null,
    pinType?: PinType
  ) => Promise<void>;
  onDeleteStop: (stopId: string) => void;
  onReorderStops: (stopIds: string[]) => Promise<void>;
  onSelectStop: (stop: TravelPin) => void;
  onEdit: () => void;
}

function SortableStopItem({
  stop,
  stopNumber,
  tripStyle,
  onSelect,
  onDelete,
}: {
  stop: TravelPin;
  stopNumber: number;
  tripStyle: 'route' | 'loop' | 'hub';
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.id,
  });
  const isHub = stop.isHub;
  const isNP = stop.pinType === 'national_park';

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1.5"
    >
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab touch-none text-muted-foreground/40 hover:text-muted-foreground"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Stop number / hub / NP indicator */}
      {isNP ? (
        <TreePine className="h-4 w-4 shrink-0" style={{ color: NPS_COLOR }} />
      ) : (
        <div
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ background: isHub ? '#F59E0B' : tripStyle === 'hub' ? '#6B7280' : '#8B5CF6' }}
        >
          {isHub ? '⌂' : tripStyle === 'hub' ? '·' : stopNumber}
        </div>
      )}

      <button onClick={onSelect} className="min-w-0 flex-1 text-left">
        <p className="truncate text-xs font-medium">{stop.name}</p>
        {stop.visitedDate && (
          <p className="text-[10px] text-muted-foreground">
            {format(parseISO(stop.visitedDate), 'MMM d, yyyy')}
          </p>
        )}
      </button>

      {!stop.latitude && !stop.longitude && (
        <span title="No coordinates yet">
          <MapPin className="h-3 w-3 shrink-0 text-amber-500" />
        </span>
      )}

      <button
        onClick={onDelete}
        className="shrink-0 text-muted-foreground/40 transition-colors hover:text-destructive"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

export function TripDetail({
  trip,
  stops,
  onUpdate,
  onDelete,
  onClose,
  onAddStop,
  onDeleteStop,
  onReorderStops,
  onSelectStop,
  onEdit,
}: TripDetailProps) {
  const [localStops, setLocalStops] = React.useState(stops);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    setLocalStops(stops);
  }, [stops]);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = localStops.findIndex((s) => s.id === active.id);
    const newIdx = localStops.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(localStops, oldIdx, newIdx);
    setLocalStops(reordered);
    await onReorderStops(reordered.map((s) => s.id));
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${trip.name}" and all its stops?`)) return;
    setDeleting(true);
    onDelete();
  };

  const styleConfig = TRIP_STYLE_CONFIG[trip.tripStyle];
  const tripColor = trip.color || STATUS_CONFIG[trip.status].color;

  let dateStr = '';
  if (trip.visitedDate) {
    const start = format(parseISO(trip.visitedDate), 'MMM d, yyyy');
    const end = trip.visitedEndDate
      ? ` – ${format(parseISO(trip.visitedEndDate), 'MMM d, yyyy')}`
      : '';
    dateStr = `${start}${end}`;
  }

  // For hub-style: sorted stops with hub first
  const sortedStops =
    trip.tripStyle === 'hub'
      ? [...localStops].sort(
          (a, b) => (b.isHub ? 1 : 0) - (a.isHub ? 1 : 0) || a.sortOrder - b.sortOrder
        )
      : [...localStops].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className="text-base">{styleConfig.icon}</span>
            <h2 className="truncate text-sm font-semibold">{trip.name}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{styleConfig.label}</span>
            {dateStr && <span className="text-xs text-muted-foreground">· {dateStr}</span>}
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{ background: tripColor + '22', color: tripColor }}
            >
              {trip.status === 'been_there' ? '✓ Been There' : 'Want to Go'}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onEdit}
            className="p-1 text-muted-foreground transition-colors hover:text-foreground"
            title="Edit trip"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {trip.description && <p className="text-xs text-muted-foreground">{trip.description}</p>}

        {/* Stops */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {trip.tripStyle === 'hub' ? 'Locations' : 'Stops'} ({localStops.length})
            </h3>
          </div>

          {localStops.length === 0 ? (
            <p className="py-2 text-xs italic text-muted-foreground">
              No stops yet — add the{' '}
              {trip.tripStyle === 'hub' ? 'home base first' : 'first stop below'}.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedStops.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1.5">
                  {sortedStops.map((stop, idx) => (
                    <SortableStopItem
                      key={stop.id}
                      stop={stop}
                      stopNumber={idx + 1}
                      tripStyle={trip.tripStyle}
                      onSelect={() => onSelectStop(stop)}
                      onDelete={() => onDeleteStop(stop.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* Add stop / NP */}
          <div className="flex gap-3 pt-0.5">
            <InlineChildAdd
              childType="stop"
              onAdd={(name, lat, lng, placeName) => onAddStop(name, lat, lng, placeName, 'stop')}
            />
            <InlineChildAdd
              childType="national_park"
              onAdd={(name, lat, lng, placeName) =>
                onAddStop(name, lat, lng, placeName, 'national_park')
              }
            />
          </div>
        </div>

        {/* Hub tip */}
        {trip.tripStyle === 'hub' && localStops.length > 0 && !localStops.some((s) => s.isHub) && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
            Tip: click a stop and mark it as the Home Base to show spokes on the map.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={handleDelete}
          disabled={deleting}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete Trip
        </Button>
      </div>
    </div>
  );
}
