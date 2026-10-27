import { describe, it, expect, vi, afterEach } from 'vitest';
import { better, toFix, isGoodEnough, isRough, accuracyLabel, fixMessage, grabBestFix } from '../src/lib/gpsGrab';

const fix = (accuracyFt: number, lat = 32.94, lng = -97.15) => ({ lat, lng, accuracyFt });

describe('gpsGrab pure helpers', () => {
  it('converts metres to feet', () => { expect(Math.round(toFix({ latitude: 1, longitude: 2, accuracy: 100 }).accuracyFt)).toBe(328); });
  it('keeps the tighter reading', () => {
    expect(better(fix(350), fix(20)).accuracyFt).toBe(20);
    expect(better(fix(20), fix(350)).accuracyFt).toBe(20);
    expect(better(null, fix(80)).accuracyFt).toBe(80);
  });
  it('good enough at 16 ft or better', () => { expect(isGoodEnough(fix(16))).toBe(true); expect(isGoodEnough(fix(17))).toBe(false); });
  it('rough above 50 ft', () => { expect(isRough(fix(51))).toBe(true); expect(isRough(fix(50))).toBe(false); });
  it('labels', () => { expect(accuracyLabel(0.2)).toBe('±1 ft'); expect(accuracyLabel(12.4)).toBe('±12 ft'); });
  it('rough message tells him to grab again', () => { expect(fixMessage(fix(350))).toMatch(/Grab again/); expect(fixMessage(fix(10))).toBe('GPS good to ±10 ft.'); });
});

describe('grabBestFix with a fake phone', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  function fakePhone(readingsM: number[], stepMs = 1000) {
    let cleared = false;
    vi.stubGlobal('navigator', { geolocation: {
      watchPosition(ok: any) {
        readingsM.forEach((m, i) => setTimeout(() => { if (!cleared) ok({ coords: { latitude: 32.94 + i, longitude: -97.15, accuracy: m } }); }, stepMs * (i + 1)));
        return 1;
      },
      clearWatch() { cleared = true; },
    } });
  }
  it('26-448 case: first reading ~350 ft, stops at the first under 16 ft', async () => {
    vi.useFakeTimers();
    fakePhone([107, 40, 12, 3, 2]);      // metres: 351 ft, 131 ft, 39 ft, 9.8 ft …
    const p = grabBestFix().done;
    await vi.advanceTimersByTimeAsync(5000);
    const f = await p;
    expect(Math.round(f.accuracyFt)).toBe(10);
    expect(f.lat).toBe(32.94 + 3);       // NOT the first reading
  });
  it('times out with the best it got when it never gets good', async () => {
    vi.useFakeTimers();
    fakePhone([107, 30, 60]);
    const p = grabBestFix(undefined, 20000).done;
    await vi.advanceTimersByTimeAsync(21000);
    const f = await p;
    expect(Math.round(f.accuracyFt)).toBe(98);
    expect(isRough(f)).toBe(true);
  });
  it('rejects when the phone gives nothing', async () => {
    vi.useFakeTimers();
    fakePhone([]);
    const p = grabBestFix(undefined, 5000).done;
    const r = expect(p).rejects.toBeTruthy();
    await vi.advanceTimersByTimeAsync(6000);
    await r;
  });
});
