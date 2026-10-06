import { afterAll, describe, expect, it } from 'vitest';
import { rewriteSafeArea } from '../inpage/safearea';

describe('WebKit 안전 영역 CSS 바꾸기', () => {
  it('env()를 바꿀 수 있는 사용자 정의 속성으로 감싼다', () => {
    expect(rewriteSafeArea('padding-top: env(safe-area-inset-top);')).toBe(
      'padding-top: var(--foldlab-safe-area-inset-top, env(safe-area-inset-top));',
    );
  });

  it('대체값·calc·여러 개·옛 constant() 문법을 처리한다', () => {
    const css =
      '.a{padding:calc(8px + env(safe-area-inset-top, calc(2px + 3px))) env(safe-area-inset-right,0) constant(safe-area-inset-bottom) ENV( safe-area-inset-left )}';
    expect(rewriteSafeArea(css)).toBe(
      '.a{padding:calc(8px + var(--foldlab-safe-area-inset-top, env(safe-area-inset-top, calc(2px + 3px)))) ' +
        'var(--foldlab-safe-area-inset-right, env(safe-area-inset-right,0)) ' +
        'var(--foldlab-safe-area-inset-bottom, constant(safe-area-inset-bottom)) ' +
        'var(--foldlab-safe-area-inset-left, ENV( safe-area-inset-left ))}',
    );
  });

  it('여러 번 돌려도 결과가 같다', () => {
    const once = rewriteSafeArea('bottom: max(16px, env(safe-area-inset-bottom));');
    expect(rewriteSafeArea(once)).toBe(once);
  });

  it('관계없는 CSS와 다른 env 값은 그대로 둔다', () => {
    const css = '.b{margin:env(titlebar-area-height, 0px);padding:env(safe-area-max-inset-bottom)}';
    expect(rewriteSafeArea(css)).toBe(css);
    expect(rewriteSafeArea('')).toBe('');
  });

  it('괄호가 닫히지 않으면 남은 부분을 건드리지 않는다', () => {
    expect(rewriteSafeArea('a{top:env(safe-area-inset-top')).toBe('a{top:env(safe-area-inset-top');
  });
});

describe('페이지 안 안전 영역 흉내(크로미움에서 동작 확인)', () => {
  afterAll(async () => {
    const { closeBrowser } = await import('../server/browser');
    await closeBrowser();
  });

  /** 흉내 스크립트를 문서 시작 때 심은 새 페이지를 연다 */
  async function shimPage() {
    const { getSafeAreaShimSource } = await import('../server/inpage');
    const { getBrowser } = await import('../server/browser');
    const context = await (await getBrowser()).newContext();
    await context.addInitScript({ content: await getSafeAreaShimSource() });
    return { context, page: await context.newPage() };
  }

  it('style·style 속성·CSSOM·섀도 DOM의 env()를 바꾸고 값을 바꿀 수 있다', async () => {
    const { context, page } = await shimPage();
    try {
      await page.setContent(`
        <style>#a{padding-top:env(safe-area-inset-top)}</style>
        <div id="a"></div>
        <div id="b" style="padding-bottom: max(4px, env(safe-area-inset-bottom))"></div>
        <div id="c"></div><div id="d"></div><div id="host"></div>
        <script>
          const s = document.createElement('style');
          document.head.appendChild(s);
          s.sheet.insertRule('#c{padding-left:env(safe-area-inset-left, 3px)}');
          document.getElementById('d').style.setProperty('padding-right', 'env(safe-area-inset-right)');
          const root = document.getElementById('host').attachShadow({ mode: 'open' });
          root.innerHTML = '<style>p{padding-top:env(safe-area-inset-top)}</style><p>x</p>';
        </script>`);
      const read = () =>
        page.evaluate(() => {
          const px = (el: Element, prop: string) => parseFloat(getComputedStyle(el).getPropertyValue(prop));
          const shadowP = document.getElementById('host')!.shadowRoot!.querySelector('p')!;
          return {
            a: px(document.getElementById('a')!, 'padding-top'),
            b: px(document.getElementById('b')!, 'padding-bottom'),
            c: px(document.getElementById('c')!, 'padding-left'),
            d: px(document.getElementById('d')!, 'padding-right'),
            shadow: px(shadowP, 'padding-top'),
          };
        });
      expect(await read()).toEqual({ a: 0, b: 4, c: 0, d: 0, shadow: 0 });
      await page.evaluate(() => (window as any).__foldlabSafeArea.set({ top: 47, right: 10, bottom: 34, left: 12 }));
      expect(await read()).toEqual({ a: 47, b: 34, c: 12, d: 10, shadow: 47 });
    } finally {
      await context.close();
    }
  });

  it('이미 바꾼 <style>에 덧붙인 CSS 조각도 바꾸고, 라이브러리가 쥔 조각은 그대로 둔다', async () => {
    const { context, page } = await shimPage();
    try {
      await page.setContent('<div id="e"></div><div id="f"></div>');
      // styled-components 개발 모드처럼 <style> 하나에 규칙마다 글 조각(텍스트 노드)을 덧붙인다
      const kept = await page.evaluate(async () => {
        const tick = () => new Promise((r) => setTimeout(r, 0));
        const style = document.createElement('style');
        const first = document.createTextNode('#e{padding-top:env(safe-area-inset-top)}');
        style.appendChild(first);
        document.head.appendChild(style);
        await tick();
        style.appendChild(document.createTextNode('#f{padding-bottom:env(safe-area-inset-bottom)}'));
        await tick();
        (window as any).__foldlabSafeArea.set({ top: 47, right: 0, bottom: 34, left: 0 });
        return first.parentNode === style;
      });
      expect(kept).toBe(true);
      const px = await page.evaluate(() => {
        const get = (id: string, prop: string) => parseFloat(getComputedStyle(document.getElementById(id)!).getPropertyValue(prop));
        return { e: get('e', 'padding-top'), f: get('f', 'padding-bottom') };
      });
      expect(px).toEqual({ e: 47, f: 34 });
    } finally {
      await context.close();
    }
  });
});
