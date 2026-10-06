// 서버를 dist/server/index.js 하나로 묶고, 페이지 주입 스크립트와 데모 페이지를 함께 복사한다.
import { cp, mkdir, writeFile } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const out = new URL('../dist/server/', import.meta.url);
await mkdir(out, { recursive: true });

await esbuild.build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  outfile: 'dist/server/index.js',
  legalComments: 'none',
});

const inpage = await esbuild.build({
  entryPoints: ['inpage/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: '__foldlab',
  write: false,
  target: 'chrome110',
  legalComments: 'none',
});
await writeFile(new URL('inpage.js', out), inpage.outputFiles[0].text);
await cp('inpage/hooks.js', new URL('hooks.js', out));
await cp('server/demo', new URL('demo', out), { recursive: true });
await cp('server/measure', new URL('measure', out), { recursive: true });
console.log('built dist/server');
