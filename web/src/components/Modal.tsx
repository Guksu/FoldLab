import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';

/**
 * 네이티브 <dialog>.showModal() 창(suta modal-dialog 패턴).
 * 포커스 가두기·뒤 화면 막기(inert)·Esc는 브라우저가 맡는다. 부모가 열린 동안만 그리므로
 * 닫을 때는 onClose를 부르고, 사라질 때 열기 전 자리로 포커스를 돌려준다.
 */
export function Modal({
  onClose,
  labelledBy,
  className = '',
  children,
}: {
  onClose: () => void;
  /** 스크린 리더가 창에 들어올 때 읽을 제목 요소의 id */
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    // Esc — 브라우저가 바로 닫지 않게 막고 부모에게 닫기를 맡긴다
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
      opener?.focus();
    };
  }, []);

  // ::backdrop을 누르면 dialog 자신이 target이다(안쪽은 자식이 채운다)
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onCloseRef.current();
  };

  return (
    <dialog ref={ref} className={`modal ${className}`.trim()} aria-labelledby={labelledBy} onClick={onBackdrop}>
      {children}
    </dialog>
  );
}
