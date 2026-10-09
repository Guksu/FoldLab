import { bookPostures, flipPostures } from './devices';
import type { Corners, Cutout, DeviceSpec, Fold, PostureSpec, ScreenSpec } from './types';

/** 기기 직접 만들기 폼의 값 */
export interface CustomParams {
  name: string;
  kind: 'book' | 'flip' | 'dual';
  platform: 'android' | 'ios';
  dpr: number;
  /** 커버(바깥) 화면. 듀얼 스크린에서는 쓰지 않는다 */
  coverW: number;
  coverH: number;
  /** 메인(안쪽) 화면. 듀얼 스크린에서는 화면 한 장 크기 */
  mainW: number;
  mainH: number;
  /** 0이면 이어진 주름, 0보다 크면 화면이 끊긴 물리 힌지 */
  hingeGap: number;
  camera: 'none' | 'top-center' | 'top-left' | 'top-right' | 'island';
  cameraSize: number;
  statusBar: number;
  navBar: number;
  radius: number;
  /** 커버 화면의 힌지 쪽 모서리 반경. 아이폰 듀오처럼 바깥쪽만 둥글면 radius보다 작다 */
  hingeRadius: number;
  /** 상태 표시줄 위치. 'right'는 아이폰 듀오처럼 오른쪽 세로 막대에 시계·다이내믹 아일랜드가 있다 */
  statusBarSide: 'top' | 'right';
}

/** 종류를 바꾸면 그 종류에 흔한 값으로 채운다 */
export const CUSTOM_PRESETS: Record<CustomParams['kind'], Omit<CustomParams, 'name' | 'kind' | 'platform'>> = {
  book: { dpr: 2.625, coverW: 412, coverH: 904, mainW: 744, mainH: 832, hingeGap: 0, camera: 'top-center', cameraSize: 22, statusBar: 40, navBar: 15, radius: 20, hingeRadius: 20, statusBarSide: 'top' },
  flip: { dpr: 3, coverW: 360, coverH: 380, mainW: 360, mainH: 840, hingeGap: 0, camera: 'top-center', cameraSize: 20, statusBar: 36, navBar: 15, radius: 24, hingeRadius: 24, statusBarSide: 'top' },
  dual: { dpr: 2.5, coverW: 0, coverH: 0, mainW: 540, mainH: 720, hingeGap: 34, camera: 'none', cameraSize: 12, statusBar: 24, navBar: 24, radius: 0, hingeRadius: 0, statusBarSide: 'top' },
};

export const CUSTOM_DEFAULTS: CustomParams = { name: '내 폴더블', kind: 'book', platform: 'android', ...CUSTOM_PRESETS.book };

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 16; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome} Mobile Safari/537.36';

function camera(p: CustomParams, w: number, offsetX = 0, regionW = w): Cutout[] {
  const d = p.cameraSize;
  const top = Math.max(6, Math.round((Math.min(p.statusBar, 60) - d) / 2));
  switch (p.camera) {
    case 'none':
      return [];
    case 'island':
      // 상태 막대가 오른쪽 세로 막대면 아일랜드도 세워서 그 안에 둔다(아이폰 듀오)
      if (p.statusBarSide === 'right') {
        return [{ shape: 'pill', x: offsetX + regionW - Math.round((p.statusBar + 37) / 2), y: 20, w: 37, h: 120, label: '다이내믹 아일랜드' }];
      }
      return [{ shape: 'pill', x: offsetX + Math.round(regionW / 2 - 63), y: 11, w: 126, h: 37, label: '다이내믹 아일랜드' }];
    case 'top-left':
      return [{ shape: 'circle', x: offsetX + 24, y: top, w: d, h: d, label: '전면 카메라' }];
    case 'top-right':
      return [{ shape: 'circle', x: offsetX + regionW - 24 - d, y: top, w: d, h: d, label: '전면 카메라' }];
    default:
      return [{ shape: 'circle', x: offsetX + Math.round(regionW / 2 - d / 2), y: top, w: d, h: d, label: '전면 카메라' }];
  }
}

function screen(
  id: string,
  label: string,
  w: number,
  h: number,
  p: CustomParams,
  cutouts: Cutout[],
  folds: Fold[],
  corners?: Corners,
): ScreenSpec {
  const side = p.statusBarSide === 'right' ? { statusBarSide: 'right' as const } : {};
  return { id, label, width: w, height: h, dpr: p.dpr, radius: p.radius, corners, cutouts, folds, statusBar: p.statusBar, navBar: p.navBar, ...side };
}

/** 커버 화면은 힌지 쪽(책형은 왼쪽, 플립형은 아래쪽) 모서리 반경을 따로 줄 수 있다 */
function coverCorners(p: CustomParams, flip: boolean): Corners | undefined {
  const h = p.hingeRadius ?? p.radius;
  if (h === p.radius) return undefined;
  return flip ? { tl: p.radius, tr: p.radius, br: h, bl: h } : { tl: h, tr: p.radius, br: p.radius, bl: h };
}

export function buildCustomDevice(p: CustomParams, id = `custom-${Date.now().toString(36)}`): DeviceSpec {
  const base = {
    id,
    name: p.name.trim() || '내 기기',
    brand: '사용자 정의',
    platform: p.platform,
    status: 'custom' as const,
    userAgent: p.platform === 'ios' ? IOS_UA : ANDROID_UA,
    frameColor: '#2a2f3a',
    notes: '직접 입력한 값으로 만든 기기입니다.',
  };
  const kind: DeviceSpec['kind'] = p.kind;
  if (p.kind === 'dual') {
    const gap = Math.max(1, p.hingeGap || 28);
    const spanW = p.mainW * 2 + gap;
    const postures: PostureSpec[] = [
      { id: 'single', label: '한 화면', screen: 'single', rotation: 0, posture: 'continuous', segments: false, sheet: true },
      { id: 'spanned', label: '두 화면 걸침', screen: 'dual', rotation: 0, posture: 'continuous', segments: true, sheet: true },
      { id: 'spanned-landscape', label: '두 화면 · 가로', screen: 'dual', rotation: 90, posture: 'continuous', segments: true, sheet: true },
      { id: 'single-landscape', label: '한 화면 · 가로', screen: 'single', rotation: 90, posture: 'continuous', segments: false },
    ];
    return {
      ...base,
      kind,
      screens: [
        screen('single', `한 화면 ${p.mainW}×${p.mainH}`, p.mainW, p.mainH, p, camera(p, p.mainW), []),
        screen('dual', `두 화면 ${spanW}×${p.mainH}`, spanW, p.mainH, p, camera(p, spanW, p.mainW + gap, p.mainW), [
          { axis: 'vertical', at: p.mainW + gap / 2, gap, kind: 'hinge' },
        ]),
      ],
      postures,
    };
  }
  const flip = p.kind === 'flip';
  const fold: Fold = flip
    ? { axis: 'horizontal', at: Math.round(p.mainH / 2), gap: p.hingeGap, kind: p.hingeGap > 0 ? 'hinge' : 'crease' }
    : { axis: 'vertical', at: Math.round(p.mainW / 2), gap: p.hingeGap, kind: p.hingeGap > 0 ? 'hinge' : 'crease' };
  // 책형은 안쪽 카메라를 오른쪽 면 기준으로 둔다
  const mainCamera = flip ? camera(p, p.mainW) : camera(p, p.mainW, Math.round(p.mainW / 2), Math.round(p.mainW / 2));
  return {
    ...base,
    kind,
    screens: [
      screen('cover', `커버 화면 ${p.coverW}×${p.coverH}`, p.coverW, p.coverH, p, camera(p, p.coverW), [], coverCorners(p, flip)),
      screen('main', `메인 화면 ${p.mainW}×${p.mainH}`, p.mainW, p.mainH, p, mainCamera, [fold]),
    ],
    postures: flip ? flipPostures() : bookPostures(),
  };
}
