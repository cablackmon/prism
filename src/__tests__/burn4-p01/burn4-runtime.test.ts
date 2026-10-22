import { loadRuntime } from './burn4-runtime-fixture';

describe('runtime deployment and storage configuration with synthetic settings', () => {
  test('defaults to Docker with separate persistent photo and avatar directories', () => {
    const f = loadRuntime();
    expect(f.runtime.isHaMode()).toBe(false);
    expect(f.runtime.getDeploymentChannel()).toBe('docker');
    expect(f.runtime.getDataRoot()).toBe('/synthetic/prism/data');
    expect(f.runtime.getPhotosRoot()).toBe('/synthetic/prism/data/photos');
    expect(f.runtime.getAvatarsRoot()).toBe('/synthetic/prism/data/avatars');
    expect(f.requireDependency).toHaveBeenCalledTimes(1);
    expect(f.requireDependency).toHaveBeenCalledWith('path');
  });

  test('uses the HA channel only for the explicit enabled flag', () => {
    const { runtime } = loadRuntime({ PRISM_HA_MODE: '1' });
    expect(runtime.isHaMode()).toBe(true);
    expect(runtime.getDeploymentChannel()).toBe('ha');
  });

  test.each(['0', 'true', ' 1 ', ''])('does not interpret %j as an enabled HA flag', (value) => {
    const { runtime } = loadRuntime({ PRISM_HA_MODE: value });
    expect(runtime.isHaMode()).toBe(false);
    expect(runtime.getDeploymentChannel()).toBe('docker');
  });

  test.each([
    ['  PikaPods  ', 'pikapods'],
    ['Render@ East!', 'rendereast'],
    ['SELF_hosted-2', 'self_hosted-2'],
    ['abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnop'],
  ])('normalizes and bounds an explicit deployment channel %j', (value, expected) => {
    const { runtime } = loadRuntime({ PRISM_DEPLOYMENT: value, PRISM_HA_MODE: '1' });
    expect(runtime.getDeploymentChannel()).toBe(expected);
    expect(runtime.isHaMode()).toBe(true);
  });

  test('falls back safely for a nonempty channel with no slug characters', () => {
    const { runtime } = loadRuntime({ PRISM_DEPLOYMENT: ' !!! ', PRISM_HA_MODE: '1' });
    expect(runtime.getDeploymentChannel()).toBe('docker');
  });

  test.each([
    [{ PRISM_DEPLOYMENT: ' \t ', PRISM_HA_MODE: '1' }, 'ha'],
    [{ PRISM_DEPLOYMENT: '' }, 'docker'],
  ])('uses installation mode when an explicit channel is blank: %j', (settings, expected) => {
    expect(loadRuntime(settings).runtime.getDeploymentChannel()).toBe(expected);
  });

  test('moves both storage buckets under an explicit data root', () => {
    const f = loadRuntime({ PRISM_HA_MODE: '1', PRISM_DATA_ROOT: '/synthetic/ha-data' });
    expect(f.runtime.getDataRoot()).toBe('/synthetic/ha-data');
    expect(f.runtime.getPhotosRoot()).toBe('/synthetic/ha-data/photos');
    expect(f.runtime.getAvatarsRoot()).toBe('/synthetic/ha-data/avatars');
    expect(f.currentDirectory).not.toHaveBeenCalled();
  });

  test('honors independent photo and avatar roots ahead of the shared root', () => {
    const f = loadRuntime({
      PRISM_DATA_ROOT: '/synthetic/data',
      PRISM_PHOTO_ROOT: '/synthetic/photos-volume',
      PRISM_AVATAR_ROOT: '/synthetic/avatars-volume',
    });
    expect(f.runtime.getDataRoot()).toBe('/synthetic/data');
    expect(f.runtime.getPhotosRoot()).toBe('/synthetic/photos-volume');
    expect(f.runtime.getAvatarsRoot()).toBe('/synthetic/avatars-volume');
    expect(f.currentDirectory).not.toHaveBeenCalled();
  });

  test('a photo override leaves the default avatar bucket under the shared root', () => {
    const { runtime } = loadRuntime({ PRISM_DATA_ROOT: '/synthetic/data', PRISM_PHOTO_ROOT: '/synthetic/photos' });
    expect(runtime.getPhotosRoot()).toBe('/synthetic/photos');
    expect(runtime.getAvatarsRoot()).toBe('/synthetic/data/avatars');
  });

  test('falls back from empty storage overrides and normalizes the default join', () => {
    const { runtime } = loadRuntime({ PRISM_DATA_ROOT: '', PRISM_PHOTO_ROOT: '', PRISM_AVATAR_ROOT: '' }, '/synthetic/prism/');
    expect(runtime.getDataRoot()).toBe('/synthetic/prism/data');
    expect(runtime.getPhotosRoot()).toBe('/synthetic/prism/data/photos');
    expect(runtime.getAvatarsRoot()).toBe('/synthetic/prism/data/avatars');
  });

  test('resolves the working directory at call time instead of caching an import-time path', () => {
    const f = loadRuntime();
    expect(f.currentDirectory).not.toHaveBeenCalled();
    f.currentDirectory.mockReturnValue('/synthetic/second-install');
    expect(f.runtime.getDataRoot()).toBe('/synthetic/second-install/data');
  });

  test('keeps independently loaded installations isolated without mutating caller settings', () => {
    const settings = Object.freeze({ PRISM_DATA_ROOT: '/synthetic/first-install' });
    const first = loadRuntime(settings).runtime;
    const second = loadRuntime({ PRISM_DATA_ROOT: '/synthetic/second-install' }).runtime;
    expect(first.getPhotosRoot()).toBe('/synthetic/first-install/photos');
    expect(second.getPhotosRoot()).toBe('/synthetic/second-install/photos');
    expect(settings).toEqual({ PRISM_DATA_ROOT: '/synthetic/first-install' });
  });
});
