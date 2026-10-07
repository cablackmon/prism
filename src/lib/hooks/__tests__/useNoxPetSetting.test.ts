import { parseNoxPetEnabled } from '../useNoxPetSetting';

describe('parseNoxPetEnabled', () => {
  it('defaults to on when the setting is absent or malformed', () => {
    expect(parseNoxPetEnabled(undefined)).toBe(true);
    expect(parseNoxPetEnabled(null)).toBe(true);
    expect(parseNoxPetEnabled('banana')).toBe(true);
  });
  it('turns off only on an explicit false', () => {
    expect(parseNoxPetEnabled(false)).toBe(false);
    expect(parseNoxPetEnabled('false')).toBe(false);
    expect(parseNoxPetEnabled(true)).toBe(true);
  });
});
