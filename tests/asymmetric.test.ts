import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowser } from '../server/browser';
import { LiveSession } from '../server/session';
import { buildCustomDevice, CUSTOM_DEFAULTS } from '../shared/custom';
import { getDevice } from '../shared/devices';
import { computeLayout } from '../shared/geometry';
import type { MeasureSnapshot } from '../shared/measure';
import { customFromSnapshots } from '../shared/measure';
import type { Analysis } from '../shared/types';

/**
 * 아이폰 듀오처럼 모서리 곡률이 비대칭이고 안전 영역이 한쪽(오른쪽 상태 막대)에만 있는 화면을 점검한다.
 * 바깥 화면(접힘): 466×678, 모서리 왼쪽 8 · 오른쪽 59, 안전 영역 위 0 · 오른쪽 84 · 아래 34 · 왼쪽 0
 */

const PAGES: Record<string, string> = {
  // 좌우를 같다고 가정하고 왼쪽 값만 양쪽에 쓴 페이지
  '/mirror': `
    <style>
      body { margin: 0 }
      header { padding: env(safe-area-inset-top) env(safe-area-inset-left) 0 env(safe-area-inset-left); height: 48px }
      footer { position: fixed; bottom: 0; left: 0; right: 0; padding-bottom: env(safe-area-inset-bottom) }
    </style>
    <header>제목</header><footer>하단</footer>`,
  // 넓은 블록이 오른쪽 상태 막대에 4px만 걸치고, 좁은 버튼은 막대 안에 30px 들어가며, 왼쪽 위 모서리에 닫기 버튼이 붙어 있다
  '/edges': `
    <style>
      body { margin: 0; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left) }
      #wide { position: absolute; left: 0; top: 200px; width: calc(100vw - 80px); height: 200px; background: #eee }
      #side { position: fixed; right: 54px; top: 460px; width: 60px; height: 40px }
      #close { position: fixed; left: 0; top: 0; width: 44px; height: 44px }
    </style>
    <p id="wide">넓은 블록</p><button id="side">메뉴</button><button id="close">닫기</button>`,
  // WebKit 흉내가 넣는 사용자 정의 속성만 있고 페이지는 안전 영역을 전혀 쓰지 않는다
  '/own-var': `<html style="--foldlab-safe-area-inset-right: 84px"><body style="margin:0"><p>본문</p></body></html>`,
};

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const body = PAGES[req.url ?? ''] ?? '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width, viewport-fit=cover">${body}`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await closeBrowser();
});

async function analyzeCover(path: string): Promise<Analysis> {
  const session = new LiveSession(
    { json: () => {}, frame: (_h, _j, done) => done() },
    { device: getDevice('iphone-duo')!, postureId: 'folded', mode: 'app', fit: 'page' },
  );
  try {
    await session.start();
    await session.navigate(base + path);
    return (await session.analyze())!;
  } finally {
    await session.close();
  }
}

describe('기하: 비대칭 화면', () => {
  it('아이폰 듀오 바깥 화면은 오른쪽 상태 막대와 비대칭 모서리를 장애물로 낸다', () => {
    const layout = computeLayout(getDevice('iphone-duo')!, 'folded', { mode: 'app', fit: 'cover' });
    expect(layout.insets).toEqual({ top: 0, right: 84, bottom: 34, left: 0 });
    expect(layout.screen.corners).toEqual({ tl: 8, tr: 59, br: 59, bl: 8 });
    const bar = layout.obstructions.find((o) => o.kind === 'status-bar')!;
    expect(bar.edge).toBe('right');
    expect(bar.label).toBe('오른쪽 상태 막대');
  });
});

describe('검사: 좌우 안전 영역과 비대칭 모서리', () => {
  it('왼쪽 값만 양쪽에 쓰면 오른쪽 안전 영역 누락을 알린다', async () => {
    const a = await analyzeCover('/mirror');
    expect(a.env.safeArea.right).toBe(84);
    expect(a.env.safeAreaEdges).toEqual({ top: true, right: false, bottom: true, left: true });
    const edge = a.issues.filter((i) => i.rule === 'safe-area-edge');
    expect(edge).toHaveLength(1);
    expect(edge[0].severity).toBe('warn');
    expect(edge[0].detail).toContain('오른쪽 가장자리에 84px');
    expect(edge[0].detail).toContain('서로 다릅니다');
    expect(a.issues.some((i) => i.rule === 'safe-area-unused')).toBe(false);
  });

  it('옆 상태 막대는 가로로 파고든 깊이로 겹침을 재고, 모서리 잘림은 어느 모서리인지 알린다', async () => {
    const a = await analyzeCover('/edges');
    const bar = a.issues.filter((i) => i.rule === 'status-bar-overlap');
    // 4px만 걸친 넓은 블록은 겹침이 아니다(예전에는 세로 길이 200px로 재서 걸렸다)
    expect(bar.some((i) => i.label?.includes('넓은 블록'))).toBe(false);
    const side = bar.find((i) => i.label?.includes('메뉴'))!;
    expect(side.severity).toBe('high');
    expect(side.detail).toContain('오른쪽 상태 막대에 30px');
    expect(side.detail).toContain('env(safe-area-inset-right)');
    const corner = a.issues.find((i) => i.rule === 'corner-clip' && i.label?.includes('닫기'))!;
    expect(corner.detail).toContain('왼쪽 위 모서리(반경 8px)');
    expect(corner.detail).toContain('모서리마다 곡률이 달라');
    expect(a.issues.some((i) => i.rule === 'safe-area-edge')).toBe(false);
  });

  it('WebKit 흉내가 넣는 사용자 정의 속성은 페이지가 안전 영역을 쓴 것으로 치지 않는다', async () => {
    const a = await analyzeCover('/own-var');
    expect(a.env.usesSafeArea).toBe(false);
    expect(a.issues.some((i) => i.rule === 'safe-area-unused')).toBe(true);
  });
});

describe('기기 만들기: 비대칭 모서리·오른쪽 상태 막대', () => {
  it('커버 힌지 쪽 모서리와 오른쪽 상태 막대를 기기에 반영한다', () => {
    const device = buildCustomDevice(
      { ...CUSTOM_DEFAULTS, platform: 'ios', camera: 'island', radius: 59, hingeRadius: 8, statusBarSide: 'right', statusBar: 84 },
      'custom-duo',
    );
    const cover = device.screens.find((s) => s.id === 'cover')!;
    expect(cover.corners).toEqual({ tl: 8, tr: 59, br: 59, bl: 8 });
    expect(cover.statusBarSide).toBe('right');
    const island = cover.cutouts[0];
    expect(island.x + island.w).toBeLessThanOrEqual(cover.width);
    expect(island.x).toBeGreaterThanOrEqual(cover.width - 84);
    const layout = computeLayout(device, 'folded', { mode: 'app', fit: 'cover' });
    expect(layout.insets.right).toBe(84);
    expect(layout.insets.top).toBe(0);
    // 반경이 같으면 모서리를 따로 두지 않는다
    expect(buildCustomDevice(CUSTOM_DEFAULTS, 'x').screens[0].corners).toBeUndefined();
  });

  it('측정값에서 오른쪽 안전 영역만 크면 오른쪽 상태 막대로 채운다', () => {
    const snap = {
      dpr: 3,
      ua: { string: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', mobile: true, platform: 'iOS', platformVersion: '', model: '' },
      touchPoints: 5,
      viewport: { width: 466, height: 678, clientWidth: 466, clientHeight: 678 },
      screen: { width: 466, height: 678, availWidth: 466, availHeight: 678, orientation: 'portrait-primary', angle: 0 },
      safeArea: { top: 0, right: 84, bottom: 34, left: 0 },
      safeAreaMax: null,
      segments: [],
    } as unknown as MeasureSnapshot;
    const next = customFromSnapshots(CUSTOM_DEFAULTS, { cover: snap });
    expect(next.statusBarSide).toBe('right');
    expect(next.statusBar).toBe(84);
  });
});
