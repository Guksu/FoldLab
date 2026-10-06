import { describe, expect, it } from 'vitest';
import { DEVICES, getDevice } from '../shared/devices';
import { computeLayout, parseViewportFit, rotateFold, rotatePoint, rotateRect } from '../shared/geometry';

const fold7 = getDevice('galaxy-z-fold7')!;
const flip7 = getDevice('galaxy-z-flip7')!;
const duo2 = getDevice('surface-duo-2')!;

describe('회전', () => {
  it('90도는 기기 윗변을 왼쪽으로 보낸다', () => {
    // 기본 방향 W=100, H=200에서 오른쪽 위 꼭짓점은 회전 후 왼쪽 위가 된다
    expect(rotatePoint(100, 0, 100, 200, 90)).toEqual([0, 0]);
    expect(rotatePoint(0, 0, 100, 200, 90)).toEqual([0, 100]);
    expect(rotatePoint(0, 0, 100, 200, 270)).toEqual([200, 0]);
    expect(rotatePoint(10, 20, 100, 200, 180)).toEqual([90, 180]);
  });

  it('사각형을 회전해도 크기는 가로세로만 바뀐다', () => {
    const r = rotateRect({ x: 10, y: 20, w: 30, h: 40 }, 100, 200, 90);
    expect(r).toEqual({ x: 20, y: 60, w: 40, h: 30 });
  });

  it('세로 접는 선은 가로로 바뀐다', () => {
    expect(rotateFold({ axis: 'vertical', at: 375, gap: 0, kind: 'crease' }, 750, 832, 90)).toMatchObject({ axis: 'horizontal', at: 375 });
    expect(rotateFold({ axis: 'vertical', at: 300, gap: 0, kind: 'crease' }, 750, 832, 90)).toMatchObject({ axis: 'horizontal', at: 450 });
    expect(rotateFold({ axis: 'horizontal', at: 480, gap: 0, kind: 'crease' }, 412, 960, 270)).toMatchObject({ axis: 'vertical', at: 480 });
  });
});

describe('자세별 레이아웃', () => {
  it('앱 모드 + cover: 화면 전체가 뷰포트이고 시스템 바 높이가 안전 영역이 된다', () => {
    const l = computeLayout(fold7, 'unfolded', { mode: 'app', fit: 'cover' });
    expect(l.viewport).toEqual({ x: 0, y: 0, w: 750, h: 832 });
    expect(l.insets).toEqual({ top: 40, right: 0, bottom: 24, left: 0 });
    expect(l.displayFeature).toBeNull();
    expect(l.devicePosture).toBe('continuous');
    expect(l.folds).toHaveLength(1);
    expect(l.folds[0]).toMatchObject({ axis: 'vertical', at: 375, separating: false });
  });

  it('앱 모드 + auto: 안전 영역 밖은 레터박스가 되고 env 값은 0이다', () => {
    const l = computeLayout(fold7, 'unfolded', { mode: 'app', fit: 'auto' });
    expect(l.viewport).toEqual({ x: 0, y: 40, w: 750, h: 768 });
    expect(l.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(l.rawInsets).toEqual({ top: 40, right: 0, bottom: 24, left: 0 });
    expect(l.letterbox.length).toBeGreaterThan(0);
  });

  it('브라우저 탭: 상태 표시줄과 주소창 아래부터 그린다', () => {
    const l = computeLayout(fold7, 'folded', { mode: 'browser', fit: 'auto' });
    expect(l.viewport.y).toBe(40 + 56);
    expect(l.viewport.h).toBe(960 - 40 - 56 - 24);
    expect(l.browserBar).not.toBeNull();
    const cover = computeLayout(fold7, 'folded', { mode: 'browser', fit: 'cover' });
    expect(cover.viewport.h).toBe(960 - 40 - 56);
    expect(cover.insets.bottom).toBe(24);
  });

  it('반 접힘(북)은 세로 디스플레이 기능 하나와 folded 자세를 낸다', () => {
    const l = computeLayout(fold7, 'book', { mode: 'app', fit: 'cover' });
    expect(l.displayFeature).toEqual({ orientation: 'vertical', offset: 375, maskLength: 0 });
    expect(l.devicePosture).toBe('folded');
    expect(l.folds[0].separating).toBe(true);
  });

  it('테이블탑은 가로로 돌려 위아래로 나눈다', () => {
    const l = computeLayout(fold7, 'tabletop', { mode: 'app', fit: 'cover' });
    expect(l.screen).toMatchObject({ w: 832, h: 750 });
    expect(l.displayFeature).toEqual({ orientation: 'horizontal', offset: 375, maskLength: 0 });
  });

  it('브라우저 탭에서는 디스플레이 기능 위치가 뷰포트 기준이다', () => {
    const l = computeLayout(flip7, 'flex', { mode: 'browser', fit: 'auto' });
    expect(l.displayFeature?.orientation).toBe('horizontal');
    expect(l.displayFeature?.offset).toBe(480 - l.viewport.y);
  });

  it('화면 분할: 접는 선 양쪽으로 창을 나누고 나머지는 다른 앱이다', () => {
    const left = computeLayout(fold7, 'split-left', { mode: 'app', fit: 'cover' });
    const right = computeLayout(fold7, 'split-right', { mode: 'app', fit: 'cover' });
    expect(left.viewport.x).toBe(0);
    expect(left.viewport.w).toBeLessThan(375);
    expect(right.viewport.x).toBeGreaterThan(375);
    expect(left.viewport.w + right.viewport.w).toBeLessThan(750);
    expect(left.otherApp?.x).toBeGreaterThan(375);
    expect(left.folds).toHaveLength(0);
  });

  it('듀얼 스크린 힌지는 마스크 길이를 가진다', () => {
    const l = computeLayout(duo2, 'spanned', { mode: 'app', fit: 'cover' });
    const hinge = duo2.screens.find((s) => s.id === 'dual')!.folds[0];
    expect(l.displayFeature).toEqual({ orientation: 'vertical', offset: hinge.at - hinge.gap / 2, maskLength: hinge.gap });
    expect(l.obstructions.some((o) => o.kind === 'hinge')).toBe(true);
  });
});

describe('기기 카탈로그', () => {
  it('모든 자세가 존재하는 화면을 가리키고 비교 시트 기본 자세가 있다', () => {
    for (const d of DEVICES) {
      expect(d.postures.some((p) => p.sheet), d.id).toBe(true);
      for (const p of d.postures) {
        expect(d.screens.some((s) => s.id === p.screen), `${d.id}/${p.id}`).toBe(true);
        const l = computeLayout(d, p.id, { mode: 'app', fit: 'cover' });
        expect(l.viewport.w, `${d.id}/${p.id}`).toBeGreaterThan(200);
        expect(l.viewport.h, `${d.id}/${p.id}`).toBeGreaterThan(200);
      }
    }
  });

  it('아이디가 겹치지 않는다', () => {
    expect(new Set(DEVICES.map((d) => d.id)).size).toBe(DEVICES.length);
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
