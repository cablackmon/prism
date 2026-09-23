'use client';

import { format, parseISO } from 'date-fns';
import { Emoji } from '@/components/ui/Emoji';
import {
  Plus,
  MapPin,
  Star,
  Search,
  Globe as GlobeIcon,
  Calendar,
  TreePine,
  Route,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { TravelPin, TravelTrip } from '../types';
import { STATUS_CONFIG, TRIP_STYLE_CONFIG, NPS_COLOR } from '../types';
import { usePinListFilter, type FilterTab, type GroupBy } from '../utils/usePinListFilter';

const FILTER_TABS: { key: FilterTab; label: string; icon?: React.ReactNode }[] = [
  { key: 'all', label: 'All' },
  { key: 'been_there', label: 'Been There' },
  { key: 'want_to_go', label: 'Want to Go' },
  { key: 'bucket_list', label: 'Bucket List', icon: <Star className="h-3 w-3" /> },
  {
    key: 'has_national_park',
    label: 'Has NP',
    icon: <TreePine className="h-3 w-3" style={{ color: NPS_COLOR }} />,
  },
];

const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: 'year', label: 'Year' },
  { key: 'country', label: 'Country' },
  { key: 'none', label: 'None' },
];

interface PinListProps {
  pins: TravelPin[];
  trips: TravelTrip[];
  tripStops: TravelPin[];
  pinsWithNpIds: Set<string>;
  selectedPinId: string | null;
  selectedTripId: string | null;
  photoCounts: Record<string, number>;
  onSelectPin: (pin: TravelPin) => void;
  onSelectTrip: (trip: TravelTrip) => void;
  onAddPin: () => void;
  onAddTrip: () => void;
}

export function PinList({
  pins,
  trips,
  tripStops,
  pinsWithNpIds,
  selectedPinId,
  selectedTripId,
  photoCounts,
  onSelectPin,
  onSelectTrip,
  onAddPin,
  onAddTrip,
}: PinListProps) {
  const { filter, setFilter, search, setSearch, groupBy, setGroupBy, stats, groups } =
    usePinListFilter(pins, pinsWithNpIds);

  const filteredTrips = search
    ? trips.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : trips;

  return (
    <div className="flex h-full flex-col">
      {/* Stats bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-border bg-muted/30 px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span>
            <strong className="text-foreground">{stats.been_there}</strong> visited
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
          <span>
            <strong className="text-foreground">{stats.want_to_go}</strong> want to go
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
          <span>
            <strong className="text-foreground">{stats.bucket_list}</strong> bucket list
          </span>
        </span>
        {trips.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Route className="h-3 w-3" />
            <span>
              <strong className="text-foreground">{trips.length}</strong>{' '}
              {trips.length === 1 ? 'trip' : 'trips'}
            </span>
          </span>
        )}
        {stats.countries > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GlobeIcon className="h-3 w-3" />
            <span>
              <strong className="text-foreground">{stats.countries}</strong>{' '}
              {stats.countries === 1 ? 'country' : 'countries'}
            </span>
          </span>
        )}
      </div>

      {/* Search + Add buttons */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search places & trips…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-7 text-sm"
          />
        </div>
        <Button
          size="sm"
          onClick={onAddTrip}
          variant="outline"
          className="h-8 shrink-0 gap-1 px-2.5 text-xs"
        >
          <Route className="h-3.5 w-3.5" />
          Trip
        </Button>
        <Button size="sm" onClick={onAddPin} className="h-8 shrink-0 gap-1 px-2.5 text-xs">
          <Plus className="h-3.5 w-3.5" />
          Place
        </Button>
      </div>

      {/* Filter pills (pins only) */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-2">
        <div className="flex flex-1 gap-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                'flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                filter === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {tab.icon}
              {tab.label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px] leading-none',
                  filter === tab.key ? 'bg-primary-foreground/20' : 'bg-muted-foreground/20'
                )}
              >
                {stats[tab.key]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2">
          <span className="mr-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {groupBy === 'year' ? (
              <Calendar className="h-3 w-3" />
            ) : (
              <GlobeIcon className="h-3 w-3" />
            )}
          </span>
          {GROUP_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setGroupBy(opt.key)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                groupBy === opt.key
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {/* Trips section */}
        {filteredTrips.length > 0 && (
          <div>
            <div className="sticky top-0 z-10 border-b border-border bg-muted/80 px-4 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur-sm">
              Trips
              <span className="ml-1.5 font-normal opacity-60">({filteredTrips.length})</span>
            </div>
            <ul className="divide-y divide-border">
              {filteredTrips.map((trip) => {
                const cfg = TRIP_STYLE_CONFIG[trip.tripStyle];
                const tripColor = trip.color || STATUS_CONFIG[trip.status].color;
                const stopCount = tripStops.filter((p) => p.tripId === trip.id).length;
                const isSelected = trip.id === selectedTripId;
                return (
                  <li key={trip.id}>
                    <button
                      onClick={() => onSelectTrip(trip)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                        isSelected
                          ? 'border-l-2 border-primary bg-primary/10'
                          : 'border-l-2 border-transparent hover:bg-muted/50'
                      )}
                    >
                      <span className="mt-0.5 shrink-0 text-base leading-none">{cfg.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{trip.name}</span>
                          {trip.isBucketList && (
                            <Star className="h-3 w-3 shrink-0 fill-amber-500 text-amber-500" />
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ background: tripColor + '22', color: tripColor }}
                          >
                            {cfg.label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {stopCount} {stopCount === 1 ? 'stop' : 'stops'}
                          </span>
                          {trip.visitedDate && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {trip.visitedEndDate
                                ? `${format(parseISO(trip.visitedDate), 'MMM d')}–${format(parseISO(trip.visitedEndDate), 'MMM d, yyyy')}`
                                : format(parseISO(trip.visitedDate), 'MMM yyyy')}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Standalone pins */}
        {groups.every((g) => g.pins.length === 0) && filteredTrips.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center p-4 text-center">
            <MapPin className="mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {search
                ? `No places matching "${search}"`
                : 'No places yet. Click the globe to add one.'}
            </p>
          </div>
        ) : groups.every((g) => g.pins.length === 0) ? null : (
          <>
            {trips.length > 0 && (
              <div className="sticky top-0 z-10 border-b border-border bg-muted/80 px-4 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur-sm">
                Places
              </div>
            )}
            {groups.map((group) => (
              <div key={group.key}>
                {group.label && (
                  <div className="sticky top-0 z-10 border-b border-border bg-muted/80 px-4 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur-sm">
                    {group.label}
                    <span className="ml-1.5 font-normal opacity-60">({group.pins.length})</span>
                  </div>
                )}
                <ul className="divide-y divide-border">
                  {group.pins.map((pin) => {
                    const config = STATUS_CONFIG[pin.status];
                    const isSelected = pin.id === selectedPinId;
                    return (
                      <li key={pin.id}>
                        <button
                          onClick={() => onSelectPin(pin)}
                          className={cn(
                            'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                            isSelected
                              ? 'border-l-2 border-primary bg-primary/10'
                              : 'border-l-2 border-transparent hover:bg-muted/50'
                          )}
                        >
                          <span
                            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: pin.color || config.color }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{pin.name}</span>
                              {pin.isBucketList && (
                                <Star className="h-3 w-3 shrink-0 fill-amber-500 text-amber-500" />
                              )}
                              {(photoCounts[pin.id] ?? 0) > 0 && (
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  <Emoji e="📷" /> {photoCounts[pin.id]}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2">
                              {pin.tripLabel && (
                                <span className="truncate text-xs text-muted-foreground">
                                  {pin.tripLabel}
                                </span>
                              )}
                              {!pin.tripLabel && pin.placeName && pin.placeName !== pin.name && (
                                <span className="truncate text-xs text-muted-foreground">
                                  {pin.placeName.split(',').slice(0, 2).join(',')}
                                </span>
                              )}
                              {pin.visitedDate && (
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {pin.visitedEndDate
                                    ? `${format(parseISO(pin.visitedDate), 'MMM d')}–${format(parseISO(pin.visitedEndDate), 'MMM d, yyyy')}`
                                    : format(parseISO(pin.visitedDate), 'MMM yyyy')}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
