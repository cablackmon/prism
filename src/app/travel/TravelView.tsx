'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Globe, List, Loader2, Moon, Sun, Route, MapPin, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { SubpageHeader } from '@/components/layout/SubpageHeader';
import { useTravelData, TravelAuthError } from './useTravelData';
import { useToast } from '@/components/ui/use-toast';
import { PinList } from './components/PinList';
import { PinDetail } from './components/PinDetail';
import { PinForm } from './components/PinForm';
import { TripForm } from './components/TripForm';
import { TripDetail } from './components/TripDetail';
import type { PinPendingChildren } from './components/PinForm';
import type { TravelPin, TravelTrip, PinType } from './types';

const TravelGlobe = dynamic(() => import('./components/TravelGlobe').then((m) => m.TravelGlobe), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center rounded-lg bg-muted/20">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  ),
});

type ActiveTab = 'globe' | 'places';
type Overlay =
  | { mode: 'none' }
  | { mode: 'detail'; pin: TravelPin }
  | { mode: 'add'; latLng?: { lat: number; lng: number }; parentId?: string; pinType?: PinType }
  | { mode: 'trip-detail'; trip: TravelTrip }
  | { mode: 'trip-add' }
  | { mode: 'trip-edit'; trip: TravelTrip };

export function TravelView() {
  const { pins, trips, loading, addPin, updatePin, deletePin, addTrip, updateTrip, deleteTrip } =
    useTravelData();
  const { toast } = useToast();

  const handleMutationError = useCallback(
    (err: unknown) => {
      if (err instanceof TravelAuthError) {
        toast({
          title: 'Log in to make changes',
          description: 'Enter your PIN to add, edit, or delete places.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Something went wrong',
          description: 'Please try again.',
          variant: 'destructive',
        });
      }
    },
    [toast]
  );

  const [activeTab, setActiveTab] = useState<ActiveTab>('globe');
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>({ mode: 'none' });
  const [showAllChildren, setShowAllChildren] = useState(false);
  const [globeDarkMode, setGlobeDarkMode] = useState(false);

  const photoCounts: Record<string, number> = {};

  const handlePinClick = useCallback((pin: TravelPin) => {
    setSelectedPinId(pin.id);
    setSelectedTripId(null);
    setOverlay({ mode: 'detail', pin });
  }, []);

  const handleTripStopClick = useCallback((pin: TravelPin, trip: TravelTrip) => {
    setSelectedTripId(trip.id);
    setSelectedPinId(null);
    setOverlay({ mode: 'trip-detail', trip });
  }, []);

  const handleListSelectPin = useCallback((pin: TravelPin) => {
    setSelectedPinId(pin.id);
    setSelectedTripId(null);
    setOverlay({ mode: 'detail', pin });
    setActiveTab('globe');
  }, []);

  const handleListSelectTrip = useCallback((trip: TravelTrip) => {
    setSelectedTripId(trip.id);
    setSelectedPinId(null);
    setOverlay({ mode: 'trip-detail', trip });
    setActiveTab('globe');
  }, []);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setOverlay((prev) => {
      if (prev.mode === 'add') return { ...prev, latLng: { lat, lng } };
      return { mode: 'add', latLng: { lat, lng } };
    });
    setSelectedPinId(null);
    setSelectedTripId(null);
  }, []);

  const handleAddFromList = useCallback(() => {
    setOverlay({ mode: 'add' });
    setSelectedPinId(null);
    setSelectedTripId(null);
    setActiveTab('globe');
  }, []);

  const handleAddChildDirect = useCallback(
    async (
      parentId: string,
      name: string,
      lat: number,
      lng: number,
      placeName: string | null,
      pinType: PinType
    ) => {
      const siblings = pins.filter((p) => p.parentId === parentId && p.pinType === pinType);
      try {
        await addPin({
          name,
          latitude: lat,
          longitude: lng,
          placeName,
          pinType,
          parentId,
          status: 'want_to_go',
          isBucketList: false,
          isHub: false,
          tags: [],
          stops: [],
          nationalParks: [],
          sortOrder: siblings.length,
          photoRadiusKm: 50,
        } as Omit<TravelPin, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>);
      } catch (err) {
        handleMutationError(err);
        throw err;
      }
    },
    [addPin, pins, handleMutationError]
  );

  // Add a stop to a trip
  const handleAddTripStop = useCallback(
    async (
      tripId: string,
      name: string,
      lat: number,
      lng: number,
      placeName: string | null,
      pinType: PinType = 'stop'
    ) => {
      const tripStops = pins.filter((p) => p.tripId === tripId);
      const isFirstStop = tripStops.length === 0;
      const trip = trips.find((t) => t.id === tripId);
      // First stop of a hub trip is the home base (only for regular stops, not NPs)
      const isHub = isFirstStop && trip?.tripStyle === 'hub' && pinType === 'stop';
      try {
        await addPin({
          name,
          latitude: lat,
          longitude: lng,
          placeName,
          pinType,
          tripId,
          isHub,
          status: 'want_to_go',
          isBucketList: false,
          tags: [],
          stops: [],
          nationalParks: [],
          sortOrder: tripStops.length,
          photoRadiusKm: 50,
        } as Omit<TravelPin, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>);
      } catch (err) {
        handleMutationError(err);
        throw err;
      }
    },
    [addPin, pins, trips, handleMutationError]
  );

  const handleSaveNew = useCallback(
    async (data: Partial<TravelPin>, pendingChildren?: PinPendingChildren) => {
      let newPin: TravelPin;
      try {
        newPin = await addPin(
          data as Omit<TravelPin, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>
        );
      } catch (err) {
        handleMutationError(err);
        throw err;
      }

      if (newPin.parentId) {
        const parent = pins.find((p) => p.id === newPin.parentId);
        if (parent) {
          setOverlay({ mode: 'detail', pin: parent });
          setSelectedPinId(parent.id);
          return;
        }
      }

      const base = {
        status: 'want_to_go' as const,
        isBucketList: false,
        isHub: false,
        tags: [],
        stops: [],
        nationalParks: [],
        sortOrder: 0,
        photoRadiusKm: 50,
      };
      for (const stop of pendingChildren?.stops ?? []) {
        await addPin({
          ...base,
          name: stop.name,
          latitude: stop.latitude,
          longitude: stop.longitude,
          placeName: stop.placeName ?? null,
          pinType: 'stop',
          parentId: newPin.id,
        });
      }
      for (const park of pendingChildren?.parks ?? []) {
        await addPin({
          ...base,
          name: park.name,
          latitude: park.latitude,
          longitude: park.longitude,
          placeName: park.placeName ?? null,
          pinType: 'national_park',
          parentId: newPin.id,
        });
      }

      setSelectedPinId(newPin.id);
      setSelectedTripId(null);
      setOverlay({ mode: 'detail', pin: newPin });
    },
    [addPin, pins]
  );

  const handleUpdate = useCallback(
    async (id: string, data: Partial<TravelPin>, pendingChildren?: PinPendingChildren) => {
      let updated: TravelPin;
      try {
        updated = await updatePin(id, data);
      } catch (err) {
        handleMutationError(err);
        throw err;
      }
      const base = {
        status: 'want_to_go' as const,
        isBucketList: false,
        isHub: false,
        tags: [],
        stops: [],
        nationalParks: [],
        sortOrder: 0,
        photoRadiusKm: 50,
      };
      for (const stop of pendingChildren?.stops ?? []) {
        await addPin({
          ...base,
          name: stop.name,
          latitude: stop.latitude,
          longitude: stop.longitude,
          placeName: stop.placeName ?? null,
          pinType: 'stop',
          parentId: id,
        });
      }
      for (const park of pendingChildren?.parks ?? []) {
        await addPin({
          ...base,
          name: park.name,
          latitude: park.latitude,
          longitude: park.longitude,
          placeName: park.placeName ?? null,
          pinType: 'national_park',
          parentId: id,
        });
      }
      setOverlay({ mode: 'detail', pin: updated });
      setSelectedPinId(id);
    },
    [updatePin, addPin]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const pin = pins.find((p) => p.id === id);
      const parentId = pin?.parentId;
      try {
        await deletePin(id);
      } catch (err) {
        handleMutationError(err);
        return;
      }
      setSelectedPinId(null);
      if (parentId) {
        const parent = pins.find((p) => p.id === parentId);
        if (parent) {
          setOverlay({ mode: 'detail', pin: parent });
          setSelectedPinId(parentId);
          return;
        }
      }
      setOverlay({ mode: 'none' });
    },
    [deletePin, pins]
  );

  const handleDeleteChild = useCallback(
    async (childId: string) => {
      try {
        await deletePin(childId);
      } catch (err) {
        handleMutationError(err);
      }
    },
    [deletePin, handleMutationError]
  );

  const handleReorderChildren = useCallback(
    async (childIds: string[]) => {
      await Promise.all(childIds.map((id, idx) => updatePin(id, { sortOrder: idx })));
    },
    [updatePin]
  );

  // ── Trip handlers ─────────────────────────────────────────────────────────

  const handleSaveTrip = useCallback(
    async (data: Omit<TravelTrip, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'stops'>) => {
      try {
        const trip = await addTrip(data);
        setSelectedTripId(trip.id);
        setSelectedPinId(null);
        setOverlay({ mode: 'trip-detail', trip });
      } catch (err) {
        handleMutationError(err);
        throw err;
      }
    },
    [addTrip, handleMutationError]
  );

  const handleUpdateTrip = useCallback(
    async (id: string, data: Partial<TravelTrip>) => {
      try {
        const updated = await updateTrip(id, data);
        setOverlay({ mode: 'trip-detail', trip: updated });
      } catch (err) {
        handleMutationError(err);
        throw err;
      }
    },
    [updateTrip, handleMutationError]
  );

  const handleDeleteTrip = useCallback(
    async (id: string) => {
      try {
        await deleteTrip(id);
      } catch (err) {
        handleMutationError(err);
        return;
      }
      setSelectedTripId(null);
      setOverlay({ mode: 'none' });
    },
    [deleteTrip, handleMutationError]
  );

  const handleReorderTripStops = useCallback(
    async (stopIds: string[]) => {
      await Promise.all(stopIds.map((id, idx) => updatePin(id, { sortOrder: idx })));
    },
    [updatePin]
  );

  const closeOverlay = useCallback(() => {
    setOverlay({ mode: 'none' });
    setSelectedPinId(null);
    setSelectedTripId(null);
  }, []);

  // Keep detail overlays fresh when pins/trips update
  useEffect(() => {
    if (overlay.mode === 'detail') {
      const fresh = pins.find((p) => p.id === overlay.pin.id);
      if (fresh) setOverlay({ mode: 'detail', pin: fresh });
    }
    if (overlay.mode === 'trip-detail') {
      const fresh = trips.find((t) => t.id === overlay.trip.id);
      if (fresh) setOverlay({ mode: 'trip-detail', trip: fresh });
    }
  }, [pins, trips]); // eslint-disable-line react-hooks/exhaustive-deps

  // Visible pins on the globe
  const visibleChildParentIds = new Set<string>();
  if (showAllChildren) {
    pins.forEach((p) => {
      if (p.parentId) visibleChildParentIds.add(p.parentId);
    });
  } else if (selectedPinId) {
    visibleChildParentIds.add(selectedPinId);
  }

  const visiblePins = pins.filter((p) => {
    if (p.tripId) return true; // trip stops always visible (globe dims inactive ones)
    return !p.parentId || visibleChildParentIds.has(p.parentId);
  });

  const rootPins = pins.filter((p) => !p.parentId && !p.tripId);

  const pinsWithNpIds = useMemo(() => {
    const s = new Set<string>();
    pins.forEach((p) => {
      if (p.pinType === 'national_park' && p.parentId) s.add(p.parentId);
    });
    rootPins.forEach((p) => {
      if (p.nationalParks && p.nationalParks.length > 0) s.add(p.id);
    });
    return s;
  }, [pins, rootPins]);

  // Current trip stops for TripDetail
  const currentTripStops =
    overlay.mode === 'trip-detail'
      ? pins.filter((p) => p.tripId === overlay.trip.id).sort((a, b) => a.sortOrder - b.sortOrder)
      : [];

  return (
    <PageWrapper>
      <div className="flex h-screen flex-col overflow-hidden">
        <SubpageHeader icon={<Globe className="h-5 w-5 text-primary" />} title="Travel" />
        {/* Tab bar */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-4 pb-0 pt-3">
          <button
            onClick={() => setActiveTab('globe')}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              activeTab === 'globe'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Globe className="h-4 w-4" />
            Globe
          </button>
          <button
            onClick={() => setActiveTab('places')}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              activeTab === 'places'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <List className="h-4 w-4" />
            Places
            {rootPins.length + trips.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs leading-none text-muted-foreground">
                {rootPins.length + trips.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab content */}
        <div className="relative flex-1 overflow-hidden">
          {/* Globe tab */}
          <div
            className={cn(
              'absolute inset-0 flex',
              activeTab !== 'globe' && 'pointer-events-none invisible'
            )}
          >
            <div className="relative flex flex-1 p-4">
              <TravelGlobe
                pins={visiblePins}
                trips={trips}
                selectedPinId={selectedPinId}
                selectedTripId={selectedTripId}
                darkMode={globeDarkMode}
                overlayOpen={overlay.mode !== 'none'}
                onPinClick={handlePinClick}
                onTripStopClick={handleTripStopClick}
                onMapClick={handleMapClick}
              />
              {/* Globe controls */}
              <div className="absolute left-7 top-7 z-10 flex items-center gap-1.5">
                <button
                  onClick={() => setShowAllChildren((v) => !v)}
                  title={
                    showAllChildren ? 'Hide all sub-locations' : 'Show all sub-locations on map'
                  }
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium shadow transition-colors',
                    showAllChildren
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-background/90 text-foreground hover:bg-muted'
                  )}
                >
                  <Globe className="h-3.5 w-3.5" />
                  Sub-locations
                </button>
                <button
                  onClick={() => setGlobeDarkMode((v) => !v)}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-xs font-medium text-foreground shadow transition-colors hover:bg-muted"
                >
                  {globeDarkMode ? (
                    <Sun className="h-3.5 w-3.5" />
                  ) : (
                    <Moon className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Overlay panel */}
            <div
              className={cn(
                'absolute bottom-4 right-4 top-4 flex w-96 flex-col rounded-lg border border-border bg-card shadow-xl transition-transform duration-200',
                overlay.mode === 'none' ? 'translate-x-[calc(100%+2rem)]' : 'translate-x-0'
              )}
            >
              {overlay.mode === 'add' || overlay.mode === 'trip-add' ? (
                <div className="flex h-full flex-col">
                  {/* Place / Trip toggle header */}
                  <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
                    <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
                      <button
                        onClick={() =>
                          setOverlay({
                            mode: 'add',
                            latLng: overlay.mode === 'add' ? overlay.latLng : undefined,
                          })
                        }
                        className={cn(
                          'flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                          overlay.mode === 'add'
                            ? 'bg-background text-foreground shadow'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <MapPin className="h-3 w-3" />
                        Place
                      </button>
                      <button
                        onClick={() => setOverlay({ mode: 'trip-add' })}
                        className={cn(
                          'flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                          overlay.mode === 'trip-add'
                            ? 'bg-background text-foreground shadow'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <Route className="h-3 w-3" />
                        Trip
                      </button>
                    </div>
                    <button
                      onClick={closeOverlay}
                      className="p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {overlay.mode === 'add' ? (
                    <PinForm
                      hideHeader
                      initialLatLng={overlay.latLng}
                      parentId={overlay.parentId}
                      pinType={overlay.pinType ?? 'location'}
                      onSave={handleSaveNew}
                      onCancel={() => {
                        if (overlay.parentId) {
                          const parent = pins.find((p) => p.id === overlay.parentId);
                          if (parent) {
                            setOverlay({ mode: 'detail', pin: parent });
                            setSelectedPinId(parent.id);
                            return;
                          }
                        }
                        closeOverlay();
                      }}
                    />
                  ) : (
                    <TripForm hideHeader onSave={handleSaveTrip} onCancel={closeOverlay} />
                  )}
                </div>
              ) : overlay.mode === 'detail' ? (
                <PinDetail
                  pin={overlay.pin}
                  childPins={pins.filter((p) => p.parentId === overlay.pin.id)}
                  onUpdate={(data, pendingChildren) =>
                    handleUpdate(overlay.pin.id, data, pendingChildren)
                  }
                  onDelete={() => handleDelete(overlay.pin.id)}
                  onDeleteChild={handleDeleteChild}
                  onClose={closeOverlay}
                  onAddChildDirect={(name, lat, lng, placeName, pinType) =>
                    handleAddChildDirect(overlay.pin.id, name, lat, lng, placeName, pinType)
                  }
                  onReorderChildren={(childIds) => handleReorderChildren(childIds)}
                  onSelectChild={(child) => {
                    setSelectedPinId(child.id);
                    setOverlay({ mode: 'detail', pin: child });
                  }}
                />
              ) : overlay.mode === 'trip-edit' ? (
                <TripForm
                  initialData={overlay.trip}
                  onSave={async (data) => handleUpdateTrip(overlay.trip.id, data)}
                  onCancel={() => setOverlay({ mode: 'trip-detail', trip: overlay.trip })}
                />
              ) : overlay.mode === 'trip-detail' ? (
                <TripDetail
                  trip={overlay.trip}
                  stops={currentTripStops}
                  onUpdate={(data) => handleUpdateTrip(overlay.trip.id, data)}
                  onDelete={() => handleDeleteTrip(overlay.trip.id)}
                  onClose={closeOverlay}
                  onAddStop={(name, lat, lng, placeName, pinType) =>
                    handleAddTripStop(overlay.trip.id, name, lat, lng, placeName, pinType)
                  }
                  onDeleteStop={(stopId) => deletePin(stopId)}
                  onReorderStops={handleReorderTripStops}
                  onSelectStop={(stop) => {
                    setSelectedPinId(stop.id);
                    setOverlay({ mode: 'detail', pin: stop });
                  }}
                  onEdit={() => setOverlay({ mode: 'trip-edit', trip: overlay.trip })}
                />
              ) : null}
            </div>
          </div>

          {/* Places tab */}
          <div
            className={cn(
              'absolute inset-0 overflow-y-auto',
              activeTab !== 'places' && 'pointer-events-none invisible'
            )}
          >
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <PinList
                pins={rootPins}
                trips={trips}
                tripStops={pins.filter((p) => !!p.tripId)}
                pinsWithNpIds={pinsWithNpIds}
                selectedPinId={selectedPinId}
                selectedTripId={selectedTripId}
                photoCounts={photoCounts}
                onSelectPin={handleListSelectPin}
                onSelectTrip={handleListSelectTrip}
                onAddPin={handleAddFromList}
                onAddTrip={() => {
                  setOverlay({ mode: 'trip-add' });
                  setActiveTab('globe');
                }}
              />
            )}
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}
