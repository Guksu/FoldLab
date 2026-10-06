import { describe, expect, it } from 'vitest';
import { buildCustomDevice, CUSTOM_DEFAULTS } from '../shared/custom';
import { DEVICES, getDevice } from '../shared/devices';
import { computeLayout, parseViewportFit, resolveFit, rotateCorners, rotateFold, rotatePoint, rotateRect } from '../shared/geometry';
import { validateDevice } from '../shared/validate';

const fold7 = getDevice('galaxy-z-fold7')!;
const flip7 = getDevice('galaxy-z-flip7')!;
const duo2 = getDevice('surface-duo-2')!;
const iphoneDuo = getDevice('iphone-duo')!;

describe('회전', () => {
  it('90도는 기기 윗변을 왼쪽으로 보낸다', () => {
    // 기본 방향 W=100, H=200에서 오른쪽 위 꼭짓점은 회전 후 왼쪽 위가 된다
    expect(rotatePoint(100, 0, 100, 200, 90)).toEqual([0, 0]);
    expect(rotatePoint(0, 0, 100, 200, 90)).toEqual([0, 100]);
    expect(rotatePoint(0, 0, 100, 200, 270)).toEqual([200, 0]);
    expect(rotatePoint(10, 20, 100, 200, 180)).toEqual([90, 180]);
  });

  it('사각형을 회전해도 크기는 가로세로만 바뀐다', () => {
    expect(rotateRect({ x: 10, y: 20, w: 30, h: 40 }, 100, 200, 90)).toEqual({ x: 20, y: 60, w: 40, h: 30 });
  });

  it('세로 접는 선은 가로로 바뀐다', () => {
    expect(rotateFold({ axis: 'vertical', at: 375, gap: 0, kind: 'crease' }, 750, 832, 90)).toMatchObject({ axis: 'horizontal', at: 375 });
    expect(rotateFold({ axis: 'vertical', at: 300, gap: 0, kind: 'crease' }, 750, 832, 90)).toMatchObject({ axis: 'horizontal', at: 450 });
    expect(rotateFold({ axis: 'horizontal', at: 480, gap: 0, kind: 'crease' }, 412, 960, 270)).toMatchObject({ axis: 'vertical', at: 480 });
  });

  it('모서리 반경도 함께 돈다', () => {
    expect(rotateCorners({ tl: 8, tr: 59, br: 59, bl: 8 }, 90)).toEqual({ tl: 59, tr: 59, br: 8, bl: 8 });
    expect(rotateCorners({ tl: 1, tr: 2, br: 3, bl: 4 }, 270)).toEqual({ tl: 4, tr: 1, br: 2, bl: 3 });
  });
});

describe('안드로이드 자세별 레이아웃', () => {
  it('앱 모드 + cover: 화면 전체가 뷰포트이고 시스템 바 높이가 안전 영역이 된다', () => {
    const l = computeLayout(fold7, 'unfolded', { mode: 'app', fit: 'cover' });
    expect(l.viewport).toEqual({ x: 0, y: 0, w: 750, h: 832 });
    // 안쪽 펀치 홀은 안드로이드가 알려 주지 않으므로 오른쪽 안전 영역이 생기지 않는다
    expect(l.insets).toEqual({ top: 34, right: 0, bottom: 15, left: 0 });
    expect(l.obstructions.some((o) => o.kind === 'cutout')).toBe(true);
    expect(l.displayFeature).toBeNull();
    expect(l.devicePosture).toBe('continuous');
    expect(l.folds[0]).toMatchObject({ axis: 'vertical', at: 375, separating: false });
  });

  it('앱 모드 + auto: 안전 영역 밖은 레터박스가 되고 env 값은 0이다', () => {
    const l = computeLayout(fold7, 'unfolded', { mode: 'app', fit: 'auto' });
    expect(l.viewport).toEqual({ x: 0, y: 34, w: 750, h: 783 });
    expect(l.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(l.rawInsets).toEqual({ top: 34, right: 0, bottom: 15, left: 0 });
    expect(l.letterbox.length).toBeGreaterThan(0);
  });

  it('안드로이드 웹뷰는 viewport-fit과 상관없이 cover처럼 동작한다', () => {
    expect(resolveFit(fold7, 'app', 'page', 'auto')).toBe('cover');
    expect(resolveFit(fold7, 'browser', 'page', 'auto')).toBe('auto');
    expect(resolveFit(iphoneDuo, 'app', 'page', 'auto')).toBe('auto');
    expect(resolveFit(fold7, 'app', 'auto', 'cover')).toBe('auto');
  });

  it('크롬 탭: 상태 표시줄과 주소창 아래부터, cover면 제스처 영역까지 그린다', () => {
    const l = computeLayout(fold7, 'folded', { mode: 'browser', fit: 'auto' });
    expect(l.viewport.y).toBe(42 + 56);
    expect(l.viewport.h).toBe(960 - 42 - 56 - 15);
    expect(l.browserBar).not.toBeNull();
    expect(l.maxInsets.bottom).toBe(15);
    const cover = computeLayout(fold7, 'folded', { mode: 'browser', fit: 'cover' });
    expect(cover.viewport.h).toBe(960 - 42 - 56);
    expect(cover.insets.bottom).toBe(15);
  });

  it('크롬 탭 가로 모드: 카메라 쪽은 cover여도 안전 영역 대신 폭을 줄인다', () => {
    const l = computeLayout(fold7, 'folded-landscape', { mode: 'browser', fit: 'cover' });
    expect(l.screen.w).toBe(960);
    expect(l.viewport.x).toBeGreaterThan(0);
    expect(l.insets.left).toBe(0);
    expect(l.insets.right).toBe(0);
  });

  it('반 접힘(북)은 세로 디스플레이 기능 하나와 folded 자세를 낸다', () => {
    const l = computeLayout(fold7, 'book', { mode: 'app', fit: 'cover' });
    expect(l.displayFeature).toEqual({ orientation: 'vertical', offset: 375, maskLength: 0 });
    expect(l.devicePosture).toBe('folded');
    expect(l.folds[0].separating).toBe(true);
    // 반 접히면 위험 구역이 접는 선 양쪽 24px로 넓어진다
    expect(l.folds[0].zone.w).toBe(48);
  });

  it('테이블탑은 돌려서 위아래로 나눈다', () => {
    const l = computeLayout(fold7, 'tabletop', { mode: 'app', fit: 'cover' });
    expect(l.screen).toMatchObject({ w: 832, h: 750 });
    expect(l.displayFeature).toEqual({ orientation: 'horizontal', offset: 375, maskLength: 0 });
  });

  it('크롬 탭에서는 디스플레이 기능 위치가 뷰포트 기준이다(툴바 높이만큼 위로)', () => {
    const l = computeLayout(flip7, 'flex', { mode: 'browser', fit: 'auto' });
    expect(l.displayFeature?.orientation).toBe('horizontal');
    expect(l.displayFeature?.offset).toBe(420 - l.viewport.y);
  });

  it('화면 분할: 접는 선 양쪽으로 창을 나누고 반대편은 다른 앱이다', () => {
    const left = computeLayout(fold7, 'split-left', { mode: 'app', fit: 'cover' });
    const right = computeLayout(fold7, 'split-right', { mode: 'app', fit: 'cover' });
    expect(left.viewport.x).toBe(0);
    expect(left.viewport.w).toBeLessThan(375);
    expect(right.viewport.x).toBeGreaterThan(375);
    expect(left.viewport.w + right.viewport.w).toBeLessThan(750);
    expect(left.otherApp?.x).toBe(right.window.x);
    expect(left.folds).toHaveLength(0);
  });

  it('플립7 커버 화면은 아래쪽 카메라 섬만큼 안전 영역이 생긴다', () => {
    const l = computeLayout(flip7, 'cover', { mode: 'app', fit: 'cover' });
    expect(l.insets.bottom).toBeGreaterThan(70);
    expect(l.insets.left).toBe(0);
  });

  it('듀얼 스크린 힌지는 마스크 길이를 가진다', () => {
    const l = computeLayout(duo2, 'spanned', { mode: 'app', fit: 'cover' });
    const hinge = duo2.screens.find((s) => s.id === 'dual')!.folds[0];
    expect(l.displayFeature).toEqual({ orientation: 'vertical', offset: Math.round(hinge.at - hinge.gap / 2), maskLength: hinge.gap });
    expect(l.obstructions.some((o) => o.kind === 'hinge')).toBe(true);
  });
});

describe('아이폰 듀오', () => {
  it('접힘: 오른쪽 세로 상태 막대 84pt와 홈 인디케이터 34pt가 안전 영역이다', () => {
    const l = computeLayout(iphoneDuo, 'folded', { mode: 'app', fit: 'cover' });
    expect(l.viewport).toEqual({ x: 0, y: 0, w: 466, h: 678 });
    expect(l.insets).toEqual({ top: 0, right: 84, bottom: 34, left: 0 });
    expect(l.screen.corners).toEqual({ tl: 8, tr: 59, br: 59, bl: 8 });
  });

  it('사파리 탭(cover 아님)에서는 안전 영역 382×644만 쓴다', () => {
    const l = computeLayout(iphoneDuo, 'folded', { mode: 'browser', fit: 'auto' });
    expect(l.viewport).toEqual({ x: 0, y: 0, w: 382, h: 644 });
    expect(l.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('펼침은 951×669 가로형, 접는 선은 가운데', () => {
    const l = computeLayout(iphoneDuo, 'unfolded', { mode: 'app', fit: 'cover' });
    expect(l.viewport).toMatchObject({ w: 951, h: 669 });
    expect(l.folds[0]).toMatchObject({ axis: 'vertical', at: 475.5 });
  });

  it('반 접어도 사파리는 세그먼트·자세를 알려 주지 않지만 가운데 40pt는 위험 구역이다', () => {
    const l = computeLayout(iphoneDuo, 'book', { mode: 'app', fit: 'cover' });
    expect(l.displayFeature).toBeNull();
    expect(l.devicePosture).toBe('continuous');
    expect(l.halfOpen).toBe(true);
    expect(l.folds[0].separating).toBe(true);
    expect(l.folds[0].zone.w).toBe(40);
  });

  it('Split View 오른쪽 창만 오른쪽 상태 막대를 가진다', () => {
    const left = computeLayout(iphoneDuo, 'split-left', { mode: 'app', fit: 'cover' });
    const right = computeLayout(iphoneDuo, 'split-right', { mode: 'app', fit: 'cover' });
    expect(left.insets.right).toBe(0);
    expect(right.insets.right).toBe(84);
  });

  it('안쪽 화면을 세로로 돌리면 위쪽 가로 상태 표시줄을 쓴다', () => {
    const l = computeLayout(iphoneDuo, 'unfolded-rotated', { mode: 'app', fit: 'cover' });
    expect(l.screen).toMatchObject({ w: 669, h: 951 });
    expect(l.insets.top).toBe(54);
    expect(l.insets.right).toBe(0);
  });
});

describe('기기 카탈로그', () => {
  it('모든 기기가 검증을 통과하고 모든 자세가 계산된다', () => {
    for (const d of DEVICES) {
      expect(validateDevice(d), d.id).toBeNull();
      expect(d.postures.some((p) => p.sheet), d.id).toBe(true);
      for (const p of d.postures) {
        for (const mode of ['app', 'browser'] as const) {
          const l = computeLayout(d, p.id, { mode, fit: 'cover' });
          expect(l.viewport.w, `${d.id}/${p.id}/${mode}`).toBeGreaterThan(200);
          expect(l.viewport.h, `${d.id}/${p.id}/${mode}`).toBeGreaterThan(180);
        }
      }
    }
  });

  it('아이디가 겹치지 않는다', () => {
    expect(new Set(DEVICES.map((d) => d.id)).size).toBe(DEVICES.length);
  });

  it('직접 만든 기기도 같은 규칙으로 계산된다', () => {
    for (const kind of ['book', 'flip', 'dual'] as const) {
      const d = buildCustomDevice({ ...CUSTOM_DEFAULTS, kind }, `custom-${kind}`);
      expect(validateDevice(d)).toBeNull();
      for (const p of d.postures) computeLayout(d, p.id, { mode: 'app', fit: 'cover' });
    }
  });
});

describe('viewport-fit 파싱', () => {
  it('메타 content에서 값을 읽는다', () => {
    expect(parseViewportFit('width=device-width, initial-scale=1, viewport-fit=cover')).toBe('cover');
    expect(parseViewportFit('width=device-width,viewport-fit = contain')).toBe('contain');
    expect(parseViewportFit('width=device-width')).toBe('auto');
    expect(parseViewportFit(null)).toBe('auto');
  });
});
