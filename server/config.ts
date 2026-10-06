function flag(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

const host = process.env.FOLDLAB_HOST ?? '127.0.0.1';
const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';

export const config = {
  host,
  port: Number(process.env.FOLDLAB_PORT ?? process.env.PORT ?? 4280),
  /** 로컬에서만 열면 localhost·사설망 주소(개발 서버)를 허용하고, 외부에 열면 기본으로 막는다 */
  allowPrivateNetwork: flag('FOLDLAB_ALLOW_PRIVATE', loopback),
  maxSessions: Number(process.env.FOLDLAB_MAX_SESSIONS ?? 6),
  idleTimeoutMs: Number(process.env.FOLDLAB_IDLE_MINUTES ?? 20) * 60_000,
  chromiumPath: process.env.FOLDLAB_CHROMIUM_PATH ?? process.env.CHROME_PATH ?? '',
};
