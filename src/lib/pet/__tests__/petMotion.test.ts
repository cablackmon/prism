import {
  petBounds,
  petFeetDrop,
  petSizeFor,
  petSpeed,
  startWalk,
  stepPet,
  isPetWalkMeta,
  PET_MAX_FRAME_S,
  type PetState,
  type PetWalkMeta,
} from '../petMotion';

const WALK: PetWalkMeta = {
  frames: 114,
  fps: 24,
  duration: 4.75,
  facing: 'right',
  box: [63, 110.2, 939, 1731],
  groundY: 1828.5,
  strideStagePx: 1110.6,
};

describe('petSizeFor', () => {
  it('is 12% of a 1080px viewport, about 130px', () => {
    expect(petSizeFor(1080)).toBe(130);
  });
  it('clamps phones and very tall screens', () => {
    expect(petSizeFor(500)).toBe(88);
    expect(petSizeFor(4000)).toBe(200);
  });
});

describe('petSpeed', () => {
  it('derives speed from stride, duration and figure scale like the desktop pet', () => {
    expect(petSpeed(WALK, 130)).toBeCloseTo((1110.6 / 4.75) * (130 / 1736.2), 6);
  });
});

describe('petBounds', () => {
  it('keeps the whole figure box on screen when facing right or mirrored', () => {
    const size = 130;
    const s = size / 1736.2;
    const b = petBounds(WALK, size, 1000);
    expect(b.min + 63 * s).toBeGreaterThanOrEqual(-1e-9);
    expect(b.min + (1080 - 1002) * s).toBeGreaterThanOrEqual(-1e-9);
    expect(b.max + 1002 * s).toBeLessThanOrEqual(1000 + 1e-9);
    expect(b.max + (1080 - 63) * s).toBeLessThanOrEqual(1000 + 1e-9);
  });
  it('collapses to a single point when the viewport is narrower than the pet', () => {
    const b = petBounds(WALK, 130, 10);
    expect(b.max).toBe(b.min);
  });
});

describe('petFeetDrop', () => {
  it('is the video margin under the ground line, scaled', () => {
    expect(petFeetDrop(WALK, 1736.2)).toBeCloseTo(1766 - (1828.5 - 86), 6);
  });
});

describe('stepPet', () => {
  const bounds = { min: 0, max: 500 };
  const fixedRand = () => 0.5;
  const fresh = (patch: Partial<PetState> = {}): PetState => ({ mode: 'walk', x: 100, direction: 1, modeUntil: 1e9, ...patch });

  it('moves by speed over delta time', () => {
    const s = fresh();
    stepPet(s, 1050, 1000, 20, bounds, fixedRand);
    expect(s.x).toBeCloseTo(101, 6);
  });
  it('clamps a stalled frame so a resumed tab cannot teleport', () => {
    const s = fresh();
    stepPet(s, 61000, 1000, 20, bounds, fixedRand);
    expect(s.x).toBeCloseTo(100 + 20 * PET_MAX_FRAME_S, 6);
  });
  it('reverses and clamps at the right edge', () => {
    const s = fresh({ x: 499.9 });
    const r = stepPet(s, 1100, 1000, 50, bounds, fixedRand);
    expect(r.turned).toBe(true);
    expect(s.x).toBe(500);
    expect(s.direction).toBe(-1);
  });
  it('reverses at the left edge', () => {
    const s = fresh({ x: 0.1, direction: -1 });
    stepPet(s, 1100, 1000, 50, bounds, fixedRand);
    expect(s.direction).toBe(1);
    expect(s.x).toBe(0);
  });
  it('walks 8-20s then idles 2-6s then walks again', () => {
    const s = fresh({ x: 250, modeUntil: 0 });
    startWalk(s, 0, bounds, () => 0);
    expect(s.modeUntil).toBe(8000);
    startWalk(s, 0, bounds, () => 1);
    expect(s.modeUntil).toBe(20000);

    s.modeUntil = 5000;
    const r1 = stepPet(s, 5000, 4990, 0, bounds, () => 0);
    expect(r1.modeChanged).toBe(true);
    expect(s.mode).toBe('idle');
    expect(s.modeUntil).toBe(7000);

    const x = s.x;
    stepPet(s, 6000, 5990, 20, bounds, () => 0);
    expect(s.x).toBe(x);
    const r2 = stepPet(s, 7000, 6990, 20, bounds, () => 0);
    expect(r2.modeChanged).toBe(true);
    expect(s.mode).toBe('walk');
  });
  it('does not move during an action', () => {
    const s = fresh({ mode: 'action' });
    stepPet(s, 1100, 1000, 50, bounds, fixedRand);
    expect(s.x).toBe(100);
  });
  it('starts walking away from the edge it stands on', () => {
    const s = fresh({ x: 500, direction: 1 });
    startWalk(s, 0, bounds, fixedRand);
    expect(s.direction).toBe(-1);
  });
});

describe('isPetWalkMeta', () => {
  it('accepts the delivered Family walk.json and rejects junk', () => {
    expect(isPetWalkMeta(WALK)).toBe(true);
    expect(isPetWalkMeta({ ...WALK, strideStagePx: 0 })).toBe(false);
    expect(isPetWalkMeta(null)).toBe(false);
    expect(isPetWalkMeta({ ...WALK, box: [1, 2] })).toBe(false);
  });
});
