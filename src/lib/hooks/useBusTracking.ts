'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useVisibilityPolling } from './useVisibilityPolling';

export interface BusCheckpoint {
  name: string;
  sortOrder: number;
}

export interface BusPrediction {
  status: 'no_data' | 'cold_start' | 'in_transit' | 'at_stop' | 'at_school' | 'overdue';
  etaMinutes: number | null;
  etaRangeLow: number | null;
  etaRangeHigh: number | null;
  lastCheckpointName: string | null;
  lastCheckpointTime: string | null;
  lastCheckpointIndex: number;
  totalCheckpoints: number;
  minutesSinceLastCheckpoint: number | null;
}

export interface BusRouteStatus {
  id: string;
  label: string;
  studentName: string;
  direction: 'AM' | 'PM';
  scheduledTime: string;
  activeDays: number[];
  checkpoints: BusCheckpoint[];
  stopName: string | null;
  schoolName: string | null;
  prediction: BusPrediction;
}

interface BusStatusResponse {
  routes: BusRouteStatus[];
  connected: boolean;
}

const DISPLAY_WINDOW_MS = 60 * 60 * 1000; // ±60 min of scheduledTime

/** Returns true if the route should be visible right now. */
function isRouteVisible(route: BusRouteStatus): boolean {
  const now = new Date();
  // Check activeDays (1=Mon..5=Fri; getDay() is 0=Sun..6=Sat)
  const todayDow = now.getDay();
  if (!route.activeDays?.includes(todayDow)) return false;

  // Check ±60 min window around scheduledTime
  const parts = route.scheduledTime.split(':').map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const scheduled = new Date(now);
  scheduled.setHours(hours, minutes, 0, 0);
  const diffMs = Math.abs(now.getTime() - scheduled.getTime());
  return diffMs <= DISPLAY_WINDOW_MS;
}

/**
 * Determine adaptive polling interval based on bus route statuses.
 * Outside bus window: 0 (disabled)
 * No checkpoint: 60s
 * In transit, ETA > 10min: 30s
 * In transit, ETA 5-10min: 15s
 * In transit, ETA 3-5min: 10s
 * In transit, ETA <= 3min: 5s
 */
function getPollingInterval(routes: BusRouteStatus[]): number {
  if (routes.length === 0) return 0;

  // Check if any route is within its bus window
  const activeRoutes = routes.filter(isRouteVisible);

  if (activeRoutes.length === 0) return 0; // Outside bus window

  // Find the most urgent ETA among active routes
  let minEta = Infinity;
  let hasCheckpoint = false;

  for (const route of activeRoutes) {
    const p = route.prediction;
    if (p.status === 'in_transit' || p.status === 'cold_start') {
      hasCheckpoint = true;
      if (p.etaMinutes !== null && p.etaMinutes < minEta) {
        minEta = p.etaMinutes;
      }
    } else if (p.status === 'at_stop' || p.status === 'at_school') {
      hasCheckpoint = true;
    }
  }

  if (!hasCheckpoint) return 60_000; // 60s — no checkpoint yet
  if (minEta <= 3) return 5_000; // 5s  — ETA ≤ 3 min
  if (minEta <= 5) return 10_000; // 10s — ETA 3-5 min
  if (minEta <= 10) return 15_000; // 15s — ETA 5-10 min
  return 30_000; // 30s — in transit, ETA > 10 min
}

export function useBusTracking() {
  const [routes, setRoutes] = useState<BusRouteStatus[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/bus-tracking/status');
      if (!res.ok) throw new Error('Failed to fetch bus status');
      const data: BusStatusResponse = await res.json();
      setRoutes(data.routes);
      setConnected(data.connected);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Filter to routes that are active today and within the ±60 min display window
  const visibleRoutes = useMemo(() => routes.filter(isRouteVisible), [routes]);

  // Adaptive polling
  const pollingInterval = useMemo(() => getPollingInterval(visibleRoutes), [visibleRoutes]);
  useVisibilityPolling(fetchStatus, pollingInterval);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchStatus();
  }, [fetchStatus]);

  return { routes: visibleRoutes, allRoutes: routes, connected, loading, error, refresh };
}
