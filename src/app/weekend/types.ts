export interface WeekendPlace {
  id: string;
  name: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  placeName: string | null;
  address: string | null;
  url: string | null;
  status: 'backlog' | 'visited';
  isFavorite: boolean;
  rating: number | null;
  notes: string | null;
  tags: string[];
  sourceProvider: 'mapbox' | 'nominatim' | 'manual' | null;
  sourceId: string | null;
  lastVisitedDate: string | null;
  visitCount: number;
  createdBy: { id: string; name: string; color: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeekendVisit {
  id: string;
  placeId: string;
  visitedBy: { id: string; name: string } | null;
  visitedOn: string;
  rating: number | null;
  notes: string | null;
  createdAt: string;
}

export type WeekendPlaceFormData = Omit<
  WeekendPlace,
  'id' | 'visitCount' | 'lastVisitedDate' | 'createdBy' | 'createdAt' | 'updatedAt'
>;
