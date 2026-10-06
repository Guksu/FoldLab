import { RULES, SEVERITY_LABEL, SEVERITY_ORDER } from '../../../shared/rules';
import type { EmulationSupport } from '../../../shared/protocol';
import type { Analysis, Insets, Layout } from '../../../shared/types';
import { SEVERITY_COLOR } from '../lib/format';

interface Props {
  analysis: Analysis | null;
  layout: Layout | null;
  support: EmulationSupport | null;
  selectedId: string | null;
  numbering: Map<string, number>;
  onSelect: (id: string | null) => void;
  onReveal: (ref: number) => void;
  onReanalyze: () => void;
  live: boolean;
}

function insetText(i: Insets) {
  return `${i.top} / ${i.right} / ${i.bottom} / ${i.left}`;
}

export function IssuePanel({ analysis, layout, support, selectedId, numbering, onSelect, onReveal, onReanalyze, live }: Props) {
  const fresh = analysis && layout && analysis.postureId === layout.postureId ? analysis : null;
  const env = fresh?.env;
  return (
    <aside className="panel">
      <div className="panel-head">
        <div>
          <h2>문제 목록</h2>
          <p className="muted small">{fresh ? `현재 화면 기준 · ${fresh.ms}ms` : live ? '분석 중…' : '주소를 열면 자동으로 검사합니다'}</p>
        </div>
        <button type="button" className="ghost small" onClick={onReanalyze} disabled={!live}>
          다시 검사
        </button>
      </div>

      <div className="counts">
        {SEVERITY_ORDER.map((s) => (
          <span key={s} className={`count ${s}`}>
            <i style={{ background: SEVERITY_COLOR[s] }} />
            {SEVERITY_LABEL[s]} <b>{fresh ? fresh.counts[s] : '–'}</b>
          </span>
        ))}
      </div>

      <ol className="issues">
        {fresh && fresh.issues.length === 0 && <li className="empty">이 자세에서는 문제를 찾지 못했습니다.</li>}
        {fresh?.issues.map((issue) => {
          const n = numbering.get(issue.id);
          const open = issue.id === selectedId;
          return (
            <li key={issue.id} className={`issue ${issue.severity}${open ? ' open' : ''}`}>
              <button type="button" className="issue-main" onClick={() => onSelect(open ? null : issue.id)} aria-expanded={open}>
                <span className="num" style={{ background: SEVERITY_COLOR[issue.severity] }}>
                  {n}
                </span>
                <span className="issue-text">
                  <span className="issue-title">
                    <em className={`sev ${issue.severity}`}>{SEVERITY_LABEL[issue.severity]}</em>
                    {issue.title}
                  </span>
                  {issue.label && <span className="issue-label">{issue.label}</span>}
                </span>
              </button>
              {open && (
                <div className="issue-body">
                  <p>{issue.detail}</p>
                  {issue.hint && <p className="hint">💡 {issue.hint}</p>}
                  {issue.selector && <code className="selector">{issue.selector}</code>}
                  <p className="muted small">{RULES[issue.rule].description}</p>
                  {issue.ref !== undefined && issue.rects.length > 0 && (
                    <button type="button" className="ghost small" onClick={() => onReveal(issue.ref!)}>
                      위치로 스크롤
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {layout && (
        <section className="env">
          <h3>에뮬레이션 상태</h3>
          <dl>
            <dt>뷰포트</dt>
            <dd>
              {layout.viewport.w}×{layout.viewport.h} · DPR {layout.dpr}
            </dd>
            <dt>화면</dt>
            <dd>
              {layout.screen.w}×{layout.screen.h}
              {layout.rotation ? ` · ${layout.rotation}° 회전` : ''}
            </dd>
            <dt>viewport-fit</dt>
            <dd>{layout.fit}</dd>
            <dt>safe-area</dt>
            <dd title="위 / 오른쪽 / 아래 / 왼쪽">
              {env ? insetText(env.safeArea) : insetText(layout.insets)}
              {layout.mode === 'app' && <span className="muted"> (가림 {insetText(layout.rawInsets)})</span>}
            </dd>
            <dt>세그먼트</dt>
            <dd>
              {layout.displayFeature
                ? `${layout.displayFeature.orientation === 'vertical' ? '좌우' : '위아래'} 2개 · 마스크 ${layout.displayFeature.maskLength}px`
                : '1개'}
              {env && env.segments.length > 1 && ' ✓'}
            </dd>
            <dt>device-posture</dt>
            <dd>{env?.posture ?? layout.devicePosture}</dd>
            {env && (
              <>
                <dt>meta viewport</dt>
                <dd className="mono">{env.viewportMeta ?? '없음'}</dd>
              </>
            )}
          </dl>
          {support && (support.segments === 'unsupported' || support.posture === 'unsupported' || support.safeArea === 'unsupported') && (
            <p className="warn-box">
              이 크로미움 버전은
              {support.segments === 'unsupported' && ' 화면 분할(Viewport Segments)'}
              {support.posture === 'unsupported' && ' 자세(Device Posture)'}
              {support.safeArea === 'unsupported' && ' 안전 영역(safe-area-inset)'} 에뮬레이션을 지원하지 않아 결과가 실제와 다를 수 있습니다.
            </p>
          )}
        </section>
      )}
    </aside>
  );
}
