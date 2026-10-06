import type { DeviceSpec } from './types';

/** 사용자 정의 기기처럼 바깥에서 온 기기 정의가 터무니없는 값을 갖지 않는지 확인한다. 문제가 있으면 이유를 돌려준다. */
export function validateDevice(d: unknown): string | null {
  const spec = d as DeviceSpec;
  if (!spec || typeof spec !== 'object') return '기기 정의가 없습니다.';
  const str = (v: unknown, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!str(spec.id, 80) || !str(spec.name, 80)) return '기기 id와 이름이 필요합니다.';
  if (!str(spec.userAgent, 400)) return 'userAgent가 필요합니다.';
  if (!['book', 'flip', 'dual', 'trifold'].includes(spec.kind)) return `알 수 없는 기기 종류: ${String(spec.kind)}`;
  if (!['android', 'ios'].includes(spec.platform)) return `알 수 없는 플랫폼: ${String(spec.platform)}`;
  if (!Array.isArray(spec.screens) || spec.screens.length < 1 || spec.screens.length > 4) return '화면은 1~4개여야 합니다.';
  for (const s of spec.screens) {
    if (!str(s.id, 40)) return '화면 id가 필요합니다.';
    if (!num(s.width, 120, 4000) || !num(s.height, 120, 4000)) return `화면 '${s.id}' 크기는 120~4000px이어야 합니다.`;
    if (!num(s.dpr, 0.5, 6)) return `화면 '${s.id}' DPR은 0.5~6이어야 합니다.`;
    if (!num(s.radius, 0, 200) || !num(s.statusBar, 0, 200) || !num(s.navBar, 0, 200)) return `화면 '${s.id}' 모서리·시스템 바 값이 범위를 벗어났습니다.`;
    if (!Array.isArray(s.cutouts) || s.cutouts.length > 6 || !Array.isArray(s.folds) || s.folds.length > 3) return `화면 '${s.id}' 카메라·접는 선 정의가 잘못됐습니다.`;
    for (const c of s.cutouts) {
      if (!['circle', 'pill', 'rect'].includes(c.shape) || ![c.x, c.y, c.w, c.h].every((v) => num(v, -50, 4000))) return '카메라 위치 값이 잘못됐습니다.';
    }
    for (const f of s.folds) {
      if (!['vertical', 'horizontal'].includes(f.axis) || !num(f.at, 1, 4000) || !num(f.gap, 0, 200) || !['crease', 'hinge'].includes(f.kind)) {
        return '접는 선 값이 잘못됐습니다.';
      }
    }
  }
  if (!Array.isArray(spec.postures) || spec.postures.length < 1 || spec.postures.length > 16) return '자세는 1~16개여야 합니다.';
  for (const p of spec.postures) {
    if (!str(p.id, 40) || !str(p.label, 40)) return '자세 id와 이름이 필요합니다.';
    if (!spec.screens.some((s) => s.id === p.screen)) return `자세 '${p.id}'가 없는 화면 '${p.screen}'을 가리킵니다.`;
    if (![0, 90, 180, 270].includes(p.rotation)) return `자세 '${p.id}'의 회전 값이 잘못됐습니다.`;
    if (!['continuous', 'folded'].includes(p.posture)) return `자세 '${p.id}'의 posture 값이 잘못됐습니다.`;
  }
  return null;
}
