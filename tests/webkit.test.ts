import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowser, webkitInstalled } from '../server/browser';
import { LiveSession } from '../server/session';
import { buildCustomDevice, CUSTOM_DEFAULTS } from '../shared/custom';
import { getDevice } from '../shared/devices';
import type { ServerMessage, SessionState } from '../shared/protocol';

/**
 * WebKit(사파리 엔진) 통합 테스트. Playwright WebKit이 없으면 건너뛴다.
 * 설치: npx playwright install webkit (리눅스는 --with-deps를 붙인다)
 */
const enabled = webkitInstalled();

let server: Server;
let base = '';

beforeAll(async () => {
  if (!enabled) return;
  const html = await readFile(new URL('../server/demo/trip.html', import.meta.url), 'utf8');
  const css = '.edge{position:fixed;left:0;right:0;bottom:0;padding-bottom:env(safe-area-inset-bottom)}';
  server = createServer((req, res) => {
    if (req.url?.startsWith('/edge.css')) {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end(css);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    // 외부 CSS 파일의 env()도 바뀌는지 보려고 링크를 하나 더 넣는다
    res.end(html.replace('</head>', '<link rel="stylesheet" href="/edge.css"></head>').replace('</body>', '<div class="edge" id="edge"></div></body>'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/demo/trip?fixed`;
});

afterAll(async () => {
  server?.close();
  await closeBrowser();
});

function collect() {
  const messages: ServerMessage[] = [];
  let frames = 0;
  return {
    sink: {
      json: (m: ServerMessage) => void messages.push(m),
      frame: (_h: unknown, _j: Buffer, done: () => void) => {
        frames++;
        done();
      },
    },
    state: () => [...messages].reverse().find((m): m is { t: 'state'; state: SessionState } => m.t === 'state')?.state,
    frames: () => frames,
  };
}

describe.skipIf(!enabled)('WebKit 엔진', () => {
  it('아이폰 듀오를 사파리 엔진으로 그리고, 안전 영역을 페이지 CSS에 반영한다', async () => {
    const c = collect();
    const session = new LiveSession(c.sink, { device: getDevice('iphone-duo')!, postureId: 'unfolded', mode: 'app', fit: 'page', engine: 'webkit' });
    try {
      await session.start();
      await session.navigate(base);
      const state = c.state()!;
      expect(state.engine).toBe('webkit');
      expect(state.support.posture).toBe('unsupported');
      const analysis = (await session.analyze())!;
      expect(analysis.env.safeArea).toEqual(state.layout.insets);
      expect(analysis.env.segments.length).toBeLessThan(2);
      expect(analysis.issues.some((i) => i.rule === 'segments-unaware')).toBe(false);
      await expect.poll(() => c.frames(), { timeout: 10000 }).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  });

  it('자세별 비교 시트를 캡처한다', async () => {
    const c = collect();
    const session = new LiveSession(c.sink, { device: getDevice('iphone-duo')!, postureId: 'folded', mode: 'app', fit: 'page', engine: 'webkit' });
    try {
      await session.start();
      await session.navigate(base);
      const result = await session.capture(['folded', 'unfolded'], () => {});
      expect(result.items.map((i) => i.postureId)).toEqual(['folded', 'unfolded']);
      for (const item of result.items) {
        expect(item.image.startsWith('data:image/png;base64,')).toBe(true);
        expect(item.analysis.env.safeArea).toEqual(item.layout.insets);
      }
    } finally {
      await session.close();
    }
  });

  it('DPR이 다른 기기로 바꾸면 페이지를 새로 열고 같은 주소를 유지한다', async () => {
    const c = collect();
    const session = new LiveSession(c.sink, { device: getDevice('iphone-duo')!, postureId: 'unfolded', mode: 'app', fit: 'page', engine: 'webkit' });
    try {
      await session.start();
      await session.navigate(base);
      const custom = buildCustomDevice({ ...CUSTOM_DEFAULTS, platform: 'ios', camera: 'island', dpr: 2 }, 'custom-ios-test');
      await session.configure({ device: custom, postureId: 'unfolded' });
      const state = c.state()!;
      expect(state.deviceId).toBe('custom-ios-test');
      expect(state.url).toBe(base);
      expect((await session.analyze())!.env.dpr).toBe(2);
    } finally {
      await session.close();
    }
  });

  it('크로미움과 WebKit을 오가며 같은 주소를 연다', async () => {
    const c = collect();
    const session = new LiveSession(c.sink, { device: getDevice('iphone-duo')!, postureId: 'unfolded', mode: 'app', fit: 'page', engine: 'chromium' });
    try {
      await session.start();
      await session.navigate(base);
      await session.configure({ engine: 'webkit' });
      expect(c.state()!.engine).toBe('webkit');
      expect(c.state()!.url).toBe(base);
      await session.configure({ engine: 'chromium' });
      expect(c.state()!.engine).toBe('chromium');
      expect(c.state()!.url).toBe(base);
    } finally {
      await session.close();
    }
  });
});
