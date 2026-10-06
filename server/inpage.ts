import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let analyzerSource: Promise<string> | null = null;
let hooksSource: Promise<string> | null = null;

/** 페이지 안에서 돌 분석기 IIFE. 빌드 결과물이 있으면 그것을, 없으면(개발 중) esbuild로 바로 묶는다. */
export function getAnalyzerSource(): Promise<string> {
  analyzerSource ??= (async () => {
    const prebuilt = fileURLToPath(new URL('./inpage.js', import.meta.url));
    if (existsSync(prebuilt)) return readFile(prebuilt, 'utf8');
    return bundleAnalyzer();
  })();
  return analyzerSource;
}

export async function bundleAnalyzer(): Promise<string> {
  const esbuild = await import('esbuild');
  const entry = fileURLToPath(new URL('../inpage/index.ts', import.meta.url));
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    globalName: '__foldlab',
    write: false,
    target: 'chrome110',
    legalComments: 'none',
  });
  return result.outputFiles[0].text;
}

let safeAreaSource: Promise<string> | null = null;

/** WebKit용 안전 영역 흉내 스크립트. 분석기와 같은 방식으로 빌드 결과물이 없으면 바로 묶는다. */
export function getSafeAreaShimSource(): Promise<string> {
  safeAreaSource ??= (async () => {
    const prebuilt = fileURLToPath(new URL('./safearea.js', import.meta.url));
    if (existsSync(prebuilt)) return readFile(prebuilt, 'utf8');
    const esbuild = await import('esbuild');
    const result = await esbuild.build({
      entryPoints: [fileURLToPath(new URL('../inpage/safearea-entry.ts', import.meta.url))],
      bundle: true,
      format: 'iife',
      write: false,
      target: 'safari16',
      legalComments: 'none',
    });
    return result.outputFiles[0].text;
  })();
  return safeAreaSource;
}

export function getHooksSource(): Promise<string> {
  hooksSource ??= (async () => {
    for (const candidate of ['./hooks.js', '../inpage/hooks.js']) {
      const p = fileURLToPath(new URL(candidate, import.meta.url));
      if (existsSync(p)) return readFile(p, 'utf8');
    }
    return '';
  })();
  return hooksSource;
}
