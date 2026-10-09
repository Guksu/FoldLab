import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowser, getBrowser } from '../server/browser';
import { MeasureHub } from '../server/measure';
import { CUSTOM_DEFAULTS } from '../shared/custom';
import { getDevice } from '../shared/devices';
import { computeLayout } from '../shared/geometry';
import { closestPosture, compareSnapshot, customFromSnapshots, describeUa, parseSnapshot, type MeasureSnapshot } from '../shared/measure';

const fold7 = getDevice('galaxy-z-fold7')!;

/** 카탈로그 값과 똑같이 잰 것처럼 만든 측정값 */
function snapshotFor(deviceId: string, postureId: string, mode: 'browser' | 'app', patch: Partial<MeasureSnapshot> = {}): MeasureSnapshot {
  const device = getDevice(deviceId)!;
  const layout = computeLayout(device, postureId, { mode, fit: 'cover' });
  const f = layout.displayFeature;
  const segments = !f
    ? []
    : f.orientation === 'vertical'
      ? [
          { x: 0, y: 0, w: f.offset, h: layout.viewport.h },
          { x: f.offset + f.maskLength, y: 0, w: layout.viewport.w - f.offset - f.maskLength, h: layout.viewport.h },
        ]
      : [
          { x: 0, y: 0, w: layout.viewport.w, h: f.offset },
          { x: 0, y: f.offset + f.maskLength, w: layout.viewport.w, h: layout.viewport.h - f.offset - f.maskLength },
        ];
  const parsed = parseSnapshot({
    id: 'test',
    at: 1,
    secure: true,
    displayMode: mode === 'browser' ? 'browser' : 'standalone',
    touchPoints: 5,
    ua: { string: 'Mozilla/5.0 (Linux; Android 16; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', model: 'SM-F966N' },
    dpr: layout.dpr,
    screen: { width: layout.screen.w, height: layout.screen.h, availWidth: layout.screen.w, availHeight: layout.screen.h, orientation: 'portrait-primary', angle: 0 },
    viewport: { width: layout.viewport.w, height: layout.viewport.h },
    units: { svh: layout.viewport.h, lvh: layout.viewport.h, dvh: layout.viewport.h },
    safeArea: layout.insets,
    segments,
    posture: layout.devicePosture,
  });
  if (typeof parsed === 'string') throw new Error(parsed);
  return { ...parsed, ...patch };
}

describe('측정값 검사와 비교', () => {
  it('잘못된 값은 거른다', () => {
    expect(parseSnapshot(null)).toBeTypeOf('string');
    expect(parseSnapshot({ dpr: 3, viewport: { width: 'x', height: 10 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } })).toBeTypeOf('string');
    expect(parseSnapshot({ dpr: 99, viewport: { width: 10, height: 10 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } })).toBeTypeOf('string');
    const ok = parseSnapshot({ dpr: 3, viewport: { width: 400, height: 800 }, safeArea: { top: 1, right: 0, bottom: 0, left: 0 }, posture: 'tilted' });
    expect(typeof ok).toBe('object');
    expect((ok as MeasureSnapshot).posture).toBeNull();
  });

  it('카탈로그와 같으면 모두 일치하고, 다르면 그 항목만 표시한다', () => {
    const same = snapshotFor('galaxy-z-fold7', 'book', 'browser');
    const rows = compareSnapshot(fold7, 'book', 'browser', same);
    expect(rows.filter((r) => r.ok === false)).toEqual([]);
    expect(rows.find((r) => r.label === '세그먼트')?.expected).toContain('+');

    const off = { ...same, safeArea: { ...same.safeArea, bottom: same.safeArea.bottom + 20 }, dpr: 3 };
    const bad = compareSnapshot(fold7, 'book', 'browser', off).filter((r) => r.ok === false).map((r) => r.label);
    expect(bad).toEqual(['DPR', '안전 영역 아래']);
  });

  it('측정값과 가장 비슷한 자세를 고른다', () => {
    for (const p of ['folded', 'unfolded', 'book', 'split-left']) {
      expect(closestPosture(fold7, 'browser', snapshotFor('galaxy-z-fold7', p, 'browser'))).toBe(p);
    }
  });

  it('측정값으로 기기 만들기 폼을 채운다', () => {
    const cover = snapshotFor('galaxy-z-fold7', 'folded', 'app');
    const main = snapshotFor('galaxy-z-fold7', 'unfolded', 'app');
    const params = customFromSnapshots(CUSTOM_DEFAULTS, { cover, main });
    const coverScreen = fold7.screens.find((s) => s.id === 'cover')!;
    const mainScreen = fold7.screens.find((s) => s.id === 'main')!;
    expect(params).toMatchObject({
      name: 'SM-F966N',
      platform: 'android',
      dpr: mainScreen.dpr,
      coverW: coverScreen.width,
      coverH: coverScreen.height,
      mainW: mainScreen.width,
      mainH: mainScreen.height,
      hingeGap: 0,
    });
    expect(describeUa(main).text).toContain('크롬 141');
  });
});

describe('측정 페이지와 수신', () => {
  const hub = new MeasureHub();
  const received: MeasureSnapshot[] = [];
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const app = express();
    app.use(hub.router({ requireTokenForPage: false }));
    hub.subscribe((s) => received.push(s));
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    await hub.closeLan();
    await closeBrowser();
  });

  it('토큰이 없거나 틀리면 받지 않는다', async () => {
    const res = await fetch(`${base}/measure/report?t=wrong`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(403);
  });

  it('폴드7 반 접힘을 흉내 낸 크로미움에서 화면 값을 재서 보낸다', async () => {
    const layout = computeLayout(fold7, 'book', { mode: 'browser', fit: 'cover' });
    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const f = layout.displayFeature!;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: layout.viewport.w,
      height: layout.viewport.h,
      deviceScaleFactor: layout.dpr,
      mobile: true,
      displayFeature: { orientation: f.orientation, offset: f.offset, maskLength: f.maskLength },
      devicePosture: { type: 'folded' },
    } as never);
    await cdp.send('Emulation.setDevicePostureOverride', { posture: { type: 'folded' } } as never).catch(() => {});
    await cdp
      .send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, right: 0, bottom: 24, left: 0, topMax: 0, rightMax: 0, bottomMax: 24, leftMax: 0 } } as never)
      .catch(() => {});
    try {
      await page.goto(`${base}/measure?t=${hub.token}`);
      // 크로미움은 새 문서에 자세 재정의를 늦게 반영해 첫 측정값이 펼침일 수 있다. 측정 페이지는 자세가 바뀌면 다시 재서 보낸다
      await expect.poll(() => received.at(-1)?.posture, { timeout: 15000 }).toBe('folded');
      const s = received[received.length - 1];
      expect(s.ua.string).toContain('Chrome');
      expect(s.viewport).toMatchObject({ width: layout.viewport.w, height: layout.viewport.h });
      expect(s.dpr).toBeCloseTo(layout.dpr, 2);
      expect(s.secure).toBe(true);
      expect(s.segments).toHaveLength(2);
      expect(s.segments[0].w + s.segments[1].w + f.maskLength).toBeCloseTo(layout.viewport.w, 0);
      expect(s.posture).toBe('folded');
      // 안전 영역 흉내를 지원하는 크로미움이면 env() 값도 그대로 읽힌다
      const supported = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sai-bottom').trim());
      if (supported && supported !== '0px') expect(s.safeArea.bottom).toBe(24);
      const rows = compareSnapshot(fold7, closestPosture(fold7, 'browser', s), 'browser', s);
      expect(rows.find((r) => r.label === '세그먼트')?.ok).toBe(true);
      expect(rows.find((r) => r.label === '자세')?.ok).toBe(true);
    } finally {
      await context.close();
    }
  });
});
