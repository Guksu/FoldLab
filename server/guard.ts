import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** 사용자가 입력한 주소를 http(s) URL로 정규화한다. 스킴이 없으면 붙여 준다. */
export function normalizeUrl(input: string): URL {
  let s = input.trim();
  if (!s) throw new Error('주소를 입력하세요.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/i.test(s);
    s = (local ? 'http://' : 'https://') + s;
  }
  const url = new URL(s);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('http, https 주소만 열 수 있습니다.');
  return url;
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

const cache = new Map<string, { at: number; blocked: boolean }>();

/** 호스트가 사설망·루프백으로 풀리면 true */
export async function resolvesToPrivate(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isIP(host)) return isPrivateAddress(host);
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < 60_000) return hit.blocked;
  let blocked = true;
  try {
    const addrs = await lookup(host, { all: true });
    blocked = addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address));
  } catch {
    blocked = false; // 해석 실패는 브라우저가 알아서 오류를 낸다
  }
  cache.set(host, { at: Date.now(), blocked });
  return blocked;
}
