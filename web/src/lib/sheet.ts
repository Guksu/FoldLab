import { RULES, SEVERITY_LABEL } from '../../../shared/rules';
import type { CaptureResult } from '../../../shared/protocol';
import type { DeviceSpec } from '../../../shared/types';
import { MODE_LABEL, formatTime, postureLabel } from './format';

/** 비교 시트 svg를 PNG Blob으로 바꾼다(스크린샷은 data URL이라 캔버스가 오염되지 않는다) */
export async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 변환 실패'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export async function copyPng(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export function sheetFilename(result: CaptureResult, device: DeviceSpec, debug: boolean): string {
  const d = new Date(result.at);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  let host = 'page';
  try {
    host = new URL(result.url).host.replace(/[^a-z0-9.-]/gi, '_');
  } catch {
    /* 기본값 */
  }
  return `foldlab-${host}-${device.id}-${stamp}${debug ? '' : '-clean'}.png`;
}

/** PR·Jira에 붙일 요약 */
export function buildMarkdown(result: CaptureResult, device: DeviceSpec): string {
  const lines: string[] = [];
  lines.push(`### FoldLab 비교 시트 — ${device.name} (${MODE_LABEL[result.mode]})`);
  lines.push('');
  lines.push(`- 주소: ${result.url}`);
  lines.push(`- 캡처: ${formatTime(result.at)}`);
  lines.push('');
  lines.push('| 자세 | 뷰포트 | 높음 | 주의 | 참고 |');
  lines.push('| --- | --- | ---: | ---: | ---: |');
  for (const it of result.items) {
    const c = it.analysis.counts;
    lines.push(`| ${postureLabel(device, it.postureId)} | ${it.layout.viewport.w}×${it.layout.viewport.h} | ${c.high} | ${c.warn} | ${c.info} |`);
  }
  for (const it of result.items) {
    if (!it.analysis.issues.length) continue;
    lines.push('');
    lines.push(`#### ${postureLabel(device, it.postureId)}`);
    it.analysis.issues.forEach((issue, i) => {
      const where = issue.selector ? ` \`${issue.selector}\`` : '';
      lines.push(`${i + 1}. **[${SEVERITY_LABEL[issue.severity]}] ${issue.title}**${where} — ${issue.detail}`);
      if (issue.hint) lines.push(`   - 제안: ${issue.hint}`);
    });
  }
  lines.push('');
  lines.push(`<sub>규칙 설명: ${Object.values(RULES).length}개 규칙 · FoldLab</sub>`);
  return lines.join('\n');
}
