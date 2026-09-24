import { parseBusEmail, matchEmailToRoute } from '../bus-email-parser';
import type { BusRoute } from '../bus-email-parser';

describe('parseBusEmail', () => {
  const fallbackDate = new Date('2026-03-01T07:15:00');

  describe('distance-based notifications', () => {
    it('parses a distance-based geofence email (real format)', () => {
      const subject = 'First View: Distance-Based Notification';
      const body =
        "FirstView: Distance-Based Notification | EMMA SMITH EMMA SMITH's vehicle entered your 250 ft notification zone near 742 Elm Street (Turned onto Elm, Time Range: 7:30-8:00 AM, Trip: 15-A). Adjust your notification settings in the app.";

      const result = parseBusEmail(subject, body, fallbackDate);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('distance_based');
      expect(result!.studentName).toBe('Emma');
      expect(result!.checkpointName).toBe('Turned onto Elm');
      expect(result!.tripId).toBe('15-A');
      expect(result!.distanceFt).toBe(250);
      expect(result!.rawAddress).toBe('742 Elm Street');
      expect(result!.timeRange).toBe('7:30-8:00 AM');
    });

    it('parses with address containing ampersand', () => {
      const subject = 'First View: Distance-Based Notification';
      const body =
        "FirstView: Distance-Based Notification | EMMA SMITH EMMA SMITH's vehicle entered your 250 ft notification zone near Pine Road & Cedar Lane (Pine @ Cedar, Time Range: 7:13-8:10 AM, Trip: 15-A). Adjust your notification settings in the app.";

      const result = parseBusEmail(subject, body, fallbackDate);

      expect(result).not.toBeNull();
      expect(result!.studentName).toBe('Emma');
      expect(result!.checkpointName).toBe('Pine @ Cedar');
      expect(result!.rawAddress).toBe('Pine Road & Cedar Lane');
    });

    it('parses with simple name format', () => {
      const subject = 'First View: Distance-Based Notification';
      const body =
        "Jane's vehicle entered your 500 ft notification zone near 123 Oak Ave (Oak & Main, Time Range: 7:00 AM - 8:00 AM, Trip: 15-A).";

      const result = parseBusEmail(subject, body, fallbackDate);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('distance_based');
      expect(result!.studentName).toBe('Jane');
      expect(result!.checkpointName).toBe('Oak & Main');
      expect(result!.tripId).toBe('15-A');
      expect(result!.distanceFt).toBe(500);
    });

    it('returns null for non-matching body', () => {
      const subject = 'First View: Distance-Based Notification';
      const body = 'Some random email body that does not match the pattern.';

      const result = parseBusEmail(subject, body, fallbackDate);
      expect(result).toBeNull();
    });
  });

  describe('arrived at stop notifications', () => {
    it('parses with ISO date format (real format)', () => {
      const subject = 'First View: Arrived at Stop | EMMA';
      const body =
        "First View: Arrived at Stop | EMMA EMMA's bus arrived at stop ELM ST & OAK AVE at 04:11 PM 2026-02-27 (15-A - PM, 15-A-PM).";

      const result = parseBusEmail(subject, body, fallbackDate);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('arrived_at_stop');
      expect(result!.studentName).toBe('Emma');
      expect(result!.checkpointName).toBe('ELM ST & OAK AVE');
      expect(result!.tripId).toBe('15-A');
      // Arrival events use emailDate (timezone-safe) instead of parsing body time
      expect(result!.eventTime).toEqual(fallbackDate);
    });

    it('parses with US date format', () => {
      const subject = 'First View: Arrived at Stop | JANE';
      const body = "Jane's bus arrived at stop Oak & Main at 7:22 AM 3/1/2026 (Trip: 15-A).";

      const result = parseBusEmail(subject, body, fallbackDate);

      expect(result).not.toBeNull();
      // Uses emailDate for timezone correctness
      expect(result!.eventTime).toEqual(fallbackDate);
    });

    it('handles 12 PM correctly', () => {
      const subject = 'First View: Arrived at Stop | JANE';
      const body = "Jane's bus arrived at stop Noon Stop at 12:05 PM 3/1/2026 (15-A).";

      const result = parseBusEmail(subject, body, fallbackDate);

      expect(result).not.toBeNull();
      expect(result!.eventTime).toEqual(fallbackDate);
    });

    it('handles 12 AM correctly', () => {
      const subject = 'First View: Arrived at Stop | JANE';
      const body = "Jane's bus arrived at stop Late Stop at 12:01 AM 3/1/2026 (15-A).";

      const result = parseBusEmail(subject, body, fallbackDate);

      expect(result).not.toBeNull();
      expect(result!.eventTime).toEqual(fallbackDate);
    });
  });

  describe('arrived at school notifications', () => {
    it('parses with ISO date format (real format)', () => {
      const subject = 'First View: Arrived at School | EMMA';
      const body =
        "First View: Arrived at School | EMMA EMMA's bus arrived at school stop Riverside Middle School at 07:53 AM 2026-02-27 (15-A - AM, 15-A-AM).";

      const result = parseBusEmail(subject, body, fallbackDate);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('arrived_at_school');
      expect(result!.studentName).toBe('Emma');
      expect(result!.checkpointName).toBe('Riverside Middle School');
      expect(result!.tripId).toBe('15-A');
      // Arrival events use emailDate (timezone-safe)
      expect(result!.eventTime).toEqual(fallbackDate);
    });

    it('parses PM school arrival', () => {
      const subject = 'First View: Arrived at School | EMMA';
      const body =
        "First View: Arrived at School | EMMA EMMA's bus arrived at school stop Riverside Middle School at 02:55 PM 2026-02-27 (15-A - PM, 15-A-PM).";

      const result = parseBusEmail(subject, body, fallbackDate);

      expect(result).not.toBeNull();
      expect(result!.eventTime).toEqual(fallbackDate);
    });
  });

  describe('trip ID extraction', () => {
    it('extracts trip ID from "15-A - PM, 15-A-PM" format', () => {
      const subject = 'First View: Arrived at Stop | EMMA';
      const body =
        "EMMA's bus arrived at stop Test Stop at 04:11 PM 2026-02-27 (15-A - PM, 15-A-PM).";

      const result = parseBusEmail(subject, body, fallbackDate);
      expect(result).not.toBeNull();
      expect(result!.tripId).toBe('15-A');
    });

    it('extracts trip ID from "Trip: 29-D" format', () => {
      const subject = 'First View: Arrived at Stop | JANE';
      const body = "Jane's bus arrived at stop Home Stop at 3:45 PM 3/1/2026 (Trip: 29-D).";

      const result = parseBusEmail(subject, body, fallbackDate);
      expect(result).not.toBeNull();
      expect(result!.tripId).toBe('29-D');
    });
  });

  describe('non-matching emails', () => {
    it('returns null for unrelated subjects', () => {
      const result = parseBusEmail('Weekly Newsletter', 'Hello world', fallbackDate);
      expect(result).toBeNull();
    });

    it('returns null for empty body', () => {
      const result = parseBusEmail('First View: Distance-Based Notification', '', fallbackDate);
      expect(result).toBeNull();
    });
  });
});

describe('matchEmailToRoute', () => {
  const routes: BusRoute[] = [
    {
      id: 'route-1',
      studentName: 'Emma',
      tripId: '15-A',
      direction: 'AM',
      checkpoints: [
        { name: 'Pine @ Cedar', sortOrder: 0 },
        { name: 'Turned onto Elm', sortOrder: 1 },
      ],
      stopName: 'ELM ST & OAK AVE',
      schoolName: 'Riverside Middle School',
    },
    {
      id: 'route-2',
      studentName: 'Emma',
      tripId: '15-A',
      direction: 'PM',
      checkpoints: [{ name: 'School Gate', sortOrder: 0 }],
      stopName: 'ELM ST & OAK AVE',
      schoolName: 'Riverside Middle School',
    },
  ];

  it('matches a distance-based email to the correct checkpoint', () => {
    const parsed = {
      type: 'distance_based' as const,
      studentName: 'Emma',
      checkpointName: 'Turned onto Elm',
      tripId: '15-A',
      eventTime: new Date(),
      directionHint: null,
    };

    const match = matchEmailToRoute(parsed, routes);

    expect(match).not.toBeNull();
    expect(match!.routeId).toBe('route-1');
    expect(match!.checkpointIndex).toBe(1);
    expect(match!.checkpointName).toBe('Turned onto Elm');
  });

  it('matches arrived-at-stop to the stop checkpoint', () => {
    const parsed = {
      type: 'arrived_at_stop' as const,
      studentName: 'Emma',
      checkpointName: 'ELM ST & OAK AVE',
      tripId: '15-A',
      eventTime: new Date(),
      directionHint: null,
    };

    const match = matchEmailToRoute(parsed, routes);

    expect(match).not.toBeNull();
    expect(match!.routeId).toBe('route-1');
    expect(match!.checkpointIndex).toBe(2); // After 2 checkpoints
  });

  it('matches arrived-at-school to the school checkpoint', () => {
    const parsed = {
      type: 'arrived_at_school' as const,
      studentName: 'Emma',
      checkpointName: 'Riverside Middle School',
      tripId: '15-A',
      eventTime: new Date(),
      directionHint: null,
    };

    const match = matchEmailToRoute(parsed, routes);

    expect(match).not.toBeNull();
    expect(match!.routeId).toBe('route-1');
    expect(match!.checkpointIndex).toBe(3); // After 2 checkpoints + stop
  });

  it('fuzzy matches stop name with abbreviations', () => {
    const parsed = {
      type: 'arrived_at_stop' as const,
      studentName: 'Emma',
      checkpointName: 'ELM RD & OAK AVE',
      tripId: '15-A',
      eventTime: new Date(),
      directionHint: null,
    };

    // Route uses shorthand "Elm & Oak"
    const shortRoutes: BusRoute[] = [
      {
        ...routes[0]!,
        stopName: 'Elm & Oak',
      },
    ];

    const match = matchEmailToRoute(parsed, shortRoutes);
    expect(match).not.toBeNull();
    expect(match!.checkpointIndex).toBe(2);
  });

  it('fuzzy matches school name abbreviations', () => {
    const parsed = {
      type: 'arrived_at_school' as const,
      studentName: 'Emma',
      checkpointName: 'Riverside Middle School',
      tripId: '15-A',
      eventTime: new Date(),
      directionHint: null,
    };

    // Exact match still works with full name
    const match = matchEmailToRoute(parsed, routes);
    expect(match).not.toBeNull();
    expect(match!.checkpointIndex).toBe(3);
  });

  it('returns null for unknown student name', () => {
    const parsed = {
      type: 'distance_based' as const,
      studentName: 'Unknown',
      checkpointName: 'Pine @ Cedar',
      tripId: '15-A',
      eventTime: new Date(),
      directionHint: null,
    };

    expect(matchEmailToRoute(parsed, routes)).toBeNull();
  });

  it('matches case-insensitively on student name', () => {
    const parsed = {
      type: 'distance_based' as const,
      studentName: 'EMMA',
      checkpointName: 'Pine @ Cedar',
      tripId: '15-A',
      eventTime: new Date(),
      directionHint: null,
    };

    const match = matchEmailToRoute(parsed, routes);
    expect(match).not.toBeNull();
    expect(match!.routeId).toBe('route-1');
  });
});
