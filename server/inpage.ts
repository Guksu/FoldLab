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
