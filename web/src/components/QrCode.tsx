import { useMemo } from 'react';
import { encode } from 'uqr';

/** 주소를 QR 코드로 그린다(검은 칸을 경로 하나로 합쳐 svg로) */
export function QrCode({ text, size = 168 }: { text: string; size?: number }) {
  const { n, d } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 2 });
    let path = '';
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) path += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { n: qr.size, d: path };
  }, [text]);
  return (
    <svg className="qr" viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label="측정 페이지 주소 QR 코드">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#1b1e24" />
    </svg>
  );
}
