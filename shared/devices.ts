import type { DeviceSpec, PostureSpec } from './types';

/**
 * 기기 카탈로그.
 * CSS px = 물리 px ÷ devicePixelRatio. 크롬 안드로이드는 소수점을 올림한다(예: 1080 ÷ 2.625 = 411.4 → 412).
 * 카메라·상태 표시줄·제스처 영역 같은 값은 공식 자료가 없는 경우 화면 비율로 추정했다(notes 참고).
 * {chrome}은 실행 중인 크로미움 주 버전으로 바뀐다.
 */

const ANDROID_UA = (model: string, android = '16') =>
  `Mozilla/5.0 (Linux; Android ${android}; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome} Mobile Safari/537.36`;

/** 책처럼 펼치는 폴더블 공통 자세 */
function bookPostures(): PostureSpec[] {
  return [
    { id: 'folded', label: '접힘', hint: '커버 화면', screen: 'cover', rotation: 0, posture: 'continuous', segments: false, sheet: true },
    { id: 'unfolded', label: '펼침', hint: '메인 화면을 평평하게', screen: 'main', rotation: 0, posture: 'continuous', segments: false, sheet: true },
    { id: 'split-left', label: '분할 · 왼쪽', hint: '화면 분할 왼쪽 앱', screen: 'main', rotation: 0, region: 'left', posture: 'continuous', segments: false, sheet: true },
    { id: 'split-right', label: '분할 · 오른쪽', hint: '화면 분할 오른쪽 앱', screen: 'main', rotation: 0, region: 'right', posture: 'continuous', segments: false, sheet: true },
    { id: 'book', label: '반 접힘 · 북', hint: '세로 접는 선으로 두 세그먼트', screen: 'main', rotation: 0, posture: 'folded', segments: true, angle: 110 },
    { id: 'tabletop', label: '반 접힘 · 테이블탑', hint: '가로로 눕혀 위아래 두 세그먼트', screen: 'main', rotation: 90, posture: 'folded', segments: true, angle: 110 },
    { id: 'unfolded-landscape', label: '펼침 · 가로', screen: 'main', rotation: 90, posture: 'continuous', segments: false },
    { id: 'folded-landscape', label: '접힘 · 가로', screen: 'cover', rotation: 90, posture: 'continuous', segments: false },
  ];
}

/** 위아래로 접는 플립 공통 자세 */
function flipPostures(): PostureSpec[] {
  return [
    { id: 'cover', label: '커버 화면', hint: '접은 채 바깥 화면', screen: 'cover', rotation: 0, posture: 'continuous', segments: false, sheet: true },
    { id: 'unfolded', label: '펼침', screen: 'main', rotation: 0, posture: 'continuous', segments: false, sheet: true },
    { id: 'flex', label: '반 접힘 · 플렉스', hint: '위아래 두 세그먼트', screen: 'main', rotation: 0, posture: 'folded', segments: true, angle: 100, sheet: true },
    { id: 'split-top', label: '분할 · 위', screen: 'main', rotation: 0, region: 'top', posture: 'continuous', segments: false, sheet: true },
    { id: 'split-bottom', label: '분할 · 아래', screen: 'main', rotation: 0, region: 'bottom', posture: 'continuous', segments: false },
    { id: 'unfolded-landscape', label: '펼침 · 가로', screen: 'main', rotation: 90, posture: 'continuous', segments: false },
  ];
}

export const DEVICES: DeviceSpec[] = [
  {
    id: 'galaxy-z-fold7',
    name: 'Galaxy Z Fold7',
    brand: 'Samsung',
    kind: 'book',
    platform: 'android',
    status: 'released',
    released: '2025-07',
    userAgent: ANDROID_UA('SM-F966N'),
    uaModel: 'SM-F966N',
    platformVersion: '16.0.0',
    frameColor: '#1d2330',
    screens: [
      {
        id: 'cover',
        label: '커버 화면 6.5″',
        width: 412,
        height: 960,
        dpr: 2.625,
        radius: 34,
        cutouts: [{ shape: 'circle', x: 196, y: 12, w: 20, h: 20, label: '전면 카메라' }],
        folds: [],
        statusBar: 40,
        navBar: 24,
        physical: { width: 1080, height: 2520, diagonal: 6.5 },
      },
      {
        id: 'main',
        label: '메인 화면 8.0″',
        width: 750,
        height: 832,
        dpr: 2.625,
        radius: 26,
        cutouts: [{ shape: 'circle', x: 668, y: 12, w: 20, h: 20, label: '안쪽 카메라' }],
        folds: [{ axis: 'vertical', at: 375, gap: 0, kind: 'crease' }],
        statusBar: 40,
        navBar: 24,
        physical: { width: 1968, height: 2184, diagonal: 8.0 },
      },
    ],
    postures: bookPostures(),
  },
  {
    id: 'galaxy-z-flip7',
    name: 'Galaxy Z Flip7',
    brand: 'Samsung',
    kind: 'flip',
    platform: 'android',
    status: 'released',
    released: '2025-07',
    userAgent: ANDROID_UA('SM-F766N'),
    uaModel: 'SM-F766N',
    platformVersion: '16.0.0',
    frameColor: '#20304a',
    screens: [
      {
        id: 'cover',
        label: '플렉스윈도우 4.1″',
        width: 361,
        height: 400,
        dpr: 2.625,
        radius: 40,
        cutouts: [
          { shape: 'circle', x: 20, y: 296, w: 40, h: 40, label: '후면 카메라' },
          { shape: 'circle', x: 76, y: 296, w: 40, h: 40, label: '후면 카메라' },
        ],
        folds: [],
        statusBar: 28,
        navBar: 0,
        physical: { width: 948, height: 1048, diagonal: 4.1 },
      },
      {
        id: 'main',
        label: '메인 화면 6.9″',
        width: 412,
        height: 960,
        dpr: 2.625,
        radius: 30,
        cutouts: [{ shape: 'circle', x: 196, y: 12, w: 20, h: 20, label: '전면 카메라' }],
        folds: [{ axis: 'horizontal', at: 480, gap: 0, kind: 'crease' }],
        statusBar: 40,
        navBar: 24,
        physical: { width: 1080, height: 2520, diagonal: 6.9 },
      },
    ],
    postures: flipPostures(),
  },
  {
    id: 'surface-duo-2',
    name: 'Surface Duo 2',
    brand: 'Microsoft',
    kind: 'dual',
    platform: 'android',
    status: 'released',
    released: '2021-10',
    userAgent: ANDROID_UA('Surface Duo 2', '12'),
    uaModel: 'Surface Duo 2',
    platformVersion: '12.0.0',
    frameColor: '#d9d9d6',
    screens: [
      {
        id: 'single',
        label: '한 화면 5.8″',
        width: 540,
        height: 720,
        dpr: 2.5,
        radius: 12,
        cutouts: [],
        folds: [],
        statusBar: 24,
        navBar: 16,
      },
      {
        id: 'dual',
        label: '두 화면 8.3″',
        width: 1114,
        height: 720,
        dpr: 2.5,
        radius: 12,
        cutouts: [],
        folds: [{ axis: 'vertical', at: 557, gap: 34, kind: 'hinge' }],
        statusBar: 24,
        navBar: 16,
      },
    ],
    postures: [
      { id: 'single', label: '한 화면', screen: 'single', rotation: 0, posture: 'continuous', segments: false, sheet: true },
      { id: 'spanned', label: '두 화면 걸침', hint: '힌지 아래는 화면이 없음', screen: 'dual', rotation: 0, posture: 'continuous', segments: true, sheet: true },
      { id: 'spanned-landscape', label: '두 화면 · 가로', hint: '위아래로 걸침', screen: 'dual', rotation: 90, posture: 'continuous', segments: true, sheet: true },
      { id: 'single-landscape', label: '한 화면 · 가로', screen: 'single', rotation: 90, posture: 'continuous', segments: false },
    ],
  },
];

export function getDevice(id: string): DeviceSpec | undefined {
  return DEVICES.find((d) => d.id === id);
}

export const DEFAULT_DEVICE_ID = 'galaxy-z-fold7';
