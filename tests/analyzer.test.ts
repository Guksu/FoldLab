import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowser, getBrowser } from '../server/browser';
import { LiveSession } from '../server/session';
import { getDevice } from '../shared/devices';
import type { CaptureResult } from '../shared/protocol';
import type { RuleId } from '../shared/types';

/** 실제 크로미움으로 데모 페이지를 열어 자세별 규칙이 걸리는지 확인한다 */

let server: Server;
let base = '';

beforeAll(async () => {
  const html = await readFile(new URL('../server/demo/trip.html', import.meta.url), 'utf8');
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/demo/trip`;
});

afterAll(async () => {
  server?.close();
  await closeBrowser();
});

async function captureDemo(query: string, deviceId: string, postureIds: string[], mode: 'app' | 'browser' = 'app'): Promise<CaptureResult> {
  const device = getDevice(deviceId)!;
  const browser = await getBrowser();
  const session = new LiveSession(
    browser,
    { json: () => {}, frame: (_h, _j, done) => done() },
    { device, postureId: postureIds[0], mode, fit: 'page' },
  );
  try {
    await session.start();
    await session.navigate(base + query);
    return await session.capture(postureIds, () => {});
  } finally {
    await session.close();
  }
}

const rulesOf = (r: CaptureResult, postureId: string) => {
  const item = r.items.find((i) => i.postureId === postureId)!;
  return new Map<RuleId, string[]>(
    [...new Set(item.analysis.issues.map((i) => i.rule))].map((rule) => [
      rule,
      item.analysis.issues.filter((i) => i.rule === rule).map((i) => i.severity),
    ]),
  );
};

describe('문제 있는 데모 페이지', () => {
  it('갤럭시 Z 폴드7 앱 모드에서 자세별 문제를 찾는다', async () => {
    const r = await captureDemo('', 'galaxy-z-fold7', ['folded', 'unfolded', 'book', 'split-left']);
    const folded = rulesOf(r, 'folded');
    expect(folded.get('h-overflow')).toContain('high');
    expect(folded.get('status-bar-overlap')).toContain('high');
    expect(folded.get('nav-bar-overlap')).toContain('high');
    expect(folded.get('cutout-overlap')).toBeDefined();
    expect(folded.has('safe-area-unused')).toBe(true);

    const unfolded = rulesOf(r, 'unfolded');
    expect(unfolded.get('fold-straddle')).toEqual(['warn']);
    expect(unfolded.has('h-overflow')).toBe(false);

    const book = rulesOf(r, 'book');
    expect(book.get('fold-straddle')).toContain('high');
    const bookEnv = r.items.find((i) => i.postureId === 'book')!.analysis.env;
    expect(bookEnv.segments).toHaveLength(2);
    expect(bookEnv.posture).toBe('folded');
    expect(bookEnv.media.horizontalSegments2).toBe(true);

    expect(rulesOf(r, 'split-left').get('h-overflow')).toContain('high');
    // 캡처는 2배 해상도 PNG
    expect(r.items[0].image.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('서피스 듀오 2 두 화면 걸침에서 힌지에 가려진 요소를 찾는다', async () => {
    const r = await captureDemo('', 'surface-duo-2', ['spanned']);
    const spanned = rulesOf(r, 'spanned');
    expect(spanned.get('hinge-hidden')).toContain('high');
    expect(r.items[0].analysis.env.segments).toHaveLength(2);
  });

  it('갤럭시 Z 플립7 커버 화면에서 카메라에 가려진 요소를 찾는다', async () => {
    const r = await captureDemo('', 'galaxy-z-flip7', ['cover']);
    expect(rulesOf(r, 'cover').get('cutout-overlap')).toBeDefined();
  });
});

describe('고친 데모 페이지', () => {
  it('높음 문제가 없다', async () => {
    const r = await captureDemo('?fixed', 'galaxy-z-fold7', ['folded', 'unfolded', 'book', 'split-right']);
    for (const item of r.items) {
      const high = item.analysis.issues.filter((i) => i.severity === 'high');
      expect(high.map((i) => `${item.postureId}: ${i.rule} ${i.label ?? ''}`)).toEqual([]);
    }
    const env = r.items.find((i) => i.postureId === 'unfolded')!.analysis.env;
    expect(env.usesSafeArea).toBe(true);
    expect(env.usesSegments).toBe(true);
  });
});
