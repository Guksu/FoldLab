import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';

/** 화면 전체에서 같은 크기·모양을 쓰도록 모은 작은 UI 조각들 */

type Variant = 'primary' | 'secondary' | 'ghost';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: LucideIcon }) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 14 : 15} strokeWidth={2} aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      <Icon size={16} strokeWidth={2} aria-hidden />
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  hint?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
  disabled,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`seg ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          title={o.hint}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <o.icon size={14} strokeWidth={2} aria-hidden />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden />
      <span>{children}</span>
    </label>
  );
}

export function Select({
  icon: Icon,
  children,
  className = '',
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { icon?: LucideIcon }) {
  return (
    <span className={`select${Icon ? ' with-icon' : ''} ${className}`}>
      {Icon && <Icon className="select-lead" size={15} strokeWidth={2} aria-hidden />}
      <select {...rest}>{children}</select>
      <ChevronDown className="select-chev" size={14} strokeWidth={2} aria-hidden />
    </span>
  );
}

export function ToggleChip({
  on,
  onClick,
  icon: Icon,
  children,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toggle-chip${on ? ' on' : ''}`}
      aria-pressed={on}
      title={typeof children === 'string' ? children : undefined}
      onClick={onClick}
      disabled={disabled}
    >
      {Icon && <Icon size={14} strokeWidth={2} aria-hidden />}
      <span className="toggle-chip-label">{children}</span>
    </button>
  );
}

/** 여러 개를 고르는 칩(체크 상자 모양) */
export function CheckChip({ on, onChange, children, disabled }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      className={`check-chip${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
      disabled={disabled}
    >
      <span className="box" aria-hidden>
        <Check size={11} strokeWidth={3} />
      </span>
      {children}
    </button>
  );
}

/** 왼쪽 판은 그대로, 오른쪽 판은 펼쳐지는 모양의 로고(무채색) */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="2.5" y="4.5" width="8.5" height="15" rx="2.2" fill="#101828" />
      <path
        d="M13 5.7c0-.45.3-.85.73-.98l6.2-1.86A1.2 1.2 0 0 1 21.5 4v16a1.2 1.2 0 0 1-1.57 1.14l-6.2-1.86A1.03 1.03 0 0 1 13 18.3z"
        fill="#667085"
      />
    </svg>
  );
}
