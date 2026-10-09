import { useState } from 'react';
import { ChevronRight, CircleCheck, Crosshair, Info, Lightbulb, RefreshCw, ScanSearch, TriangleAlert } from 'lucide-react';
import { RULES, SEVERITY_LABEL, SEVERITY_ORDER } from '../../../shared/rules';
import type { EmulationSupport, Engine } from '../../../shared/protocol';
import type { Analysis, Corners, Insets, Layout, PageEnv, Severity } from '../../../shared/types';
import { SEVERITY_COLOR } from '../lib/format';
import { Button, IconButton } from './ui';

interface Props {
  analysis: Analysis | null;
  layout: Layout | null;
  support: EmulationSupport | null;
  engine: Engine;
  engineVersion: string;
  selectedId: string | null;
  numbering: Map<string, number>;
  postureName: string;
  onSelect: (id: string | null) => void;
  onReveal: (ref: number) => void;
  onReanalyze: () => void;
  live: boolean;
}

function insetText(i: Insets) {
  return `${i.top} / ${i.right} / ${i.bottom} / ${i.left}`;
}

function cornerText(c: Corners) {
  return `${Math.round(c.tl)} / ${Math.round(c.tr)} / ${Math.round(c.br)} / ${Math.round(c.bl)}`;
}

function isAsymmetric(c: Corners) {
  const r = [c.tl, c.tr, c.br, c.bl];
  return Math.max(...r) - Math.min(...r) >= 8;
}

/** CSS가 env(safe-area-inset-*)를 쓰는 가장자리 */
function edgeUsageText(e: PageEnv['safeAreaEdges']) {
  const used = (['top', 'right', 'bottom', 'left'] as const).filter((k) => e[k]);
  const name = { top: '위', right: '오른쪽', bottom: '아래', left: '왼쪽' };
  return used.length === 4 ? '네 방향 사용' : `${used.map((k) => name[k]).join('·')}만 사용`;
}

export function IssuePanel(props: Props) {
  const { analysis, layout, support, engine, engineVersion, selectedId, numbering, postureName, onSelect, onReveal, onReanalyze, live } = props;
  const webkit = engine === 'webkit';
  const [filter, setFilter] = useState<Severity | null>(null);
  const fresh = analysis && layout && analysis.postureId === layout.postureId ? analysis : null;
  const env = fresh?.env;
  const issues = fresh ? (filter ? fresh.issues.filter((i) => i.severity === filter) : fresh.issues) : [];
  // WebKit은 사파리처럼 화면 분할·자세 API가 원래 없으므로 '미지원' 경고 대상이 아니다
  const unsupported =
    !webkit && support && (support.segments === 'unsupported' || support.posture === 'unsupported' || support.safeArea === 'unsupported');

  return (
    <aside className="inspector" aria-label="검사 결과">
      <header className="inspector-head">
        <div>
          <h2>
            문제 목록
            {fresh && <span className="count-pill">{fresh.issues.length}</span>}
          </h2>
          <p>{fresh ? `${postureName} 자세 · ${fresh.ms}ms` : live ? '페이지를 분석하는 중…' : '주소를 열면 자동으로 검사합니다'}</p>
        </div>
        <IconButton icon={RefreshCw} label="다시 검사" onClick={onReanalyze} disabled={!live} />
      </header>

      <div className="sev-tiles" role="group" aria-label="등급별로 거르기">
        {SEVERITY_ORDER.map((s) => {
          const n = fresh ? fresh.counts[s] : null;
          const on = filter === s;
          return (
            <button
              key={s}
              type="button"
              className={`sev-tile ${s}${on ? ' on' : ''}${!n ? ' zero' : ''}`}
              aria-pressed={on}
              disabled={!fresh || (!n && !on)}
              onClick={() => setFilter(on ? null : s)}
              title={on ? '거르기 해제' : `${SEVERITY_LABEL[s]}만 보기`}
            >
              <span className="sev-tile-label">
                <i className="dot" style={{ background: SEVERITY_COLOR[s] }} />
                {SEVERITY_LABEL[s]}
              </span>
              <b>{n ?? '–'}</b>
            </button>
          );
        })}
      </div>

      <div className="inspector-body scroll-y">
        {!fresh ? (
          <div className="empty-state">
            <span className="empty-icon">{live ? <span className="spinner" /> : <ScanSearch size={20} aria-hidden />}</span>
            <h3>{live ? '분석 중' : '아직 검사한 페이지가 없어요'}</h3>
            <p>
              {live
                ? '화면이 안정되면 접는 선·카메라·시스템 바에 걸린 요소를 찾아 보여 줍니다.'
                : '위에서 주소를 열면 지금 자세에서 생기는 화면 문제를 자동으로 찾아 줍니다.'}
            </p>
          </div>
        ) : fresh.issues.length === 0 ? (
          <div className="empty-state ok">
            <span className="empty-icon">
              <CircleCheck size={20} aria-hidden />
            </span>
            <h3>이 자세에서는 문제를 찾지 못했어요</h3>
            <p>다른 자세로 바꿔 보거나 비교 시트로 한 번에 확인해 보세요.</p>
          </div>
        ) : (
          <>
            {filter && (
              <div className="filter-note">
                <span>
                  {SEVERITY_LABEL[filter]} {issues.length}개만 보는 중
                </span>
                <Button variant="ghost" size="sm" onClick={() => setFilter(null)}>
                  모두 보기
                </Button>
              </div>
            )}
            <ol className="issue-list">
              {issues.map((issue) => {
                const n = numbering.get(issue.id);
                const open = issue.id === selectedId;
                return (
                  <li key={issue.id} className={`issue ${issue.severity}${open ? ' open' : ''}`}>
                    <button type="button" className="issue-row" onClick={() => onSelect(open ? null : issue.id)} aria-expanded={open}>
                      <span className="issue-num" style={{ background: SEVERITY_COLOR[issue.severity] }} aria-label={SEVERITY_LABEL[issue.severity]}>
                        {n}
                      </span>
                      <span className="issue-text">
                        <span className="issue-title">{issue.title}</span>
                        <span className="issue-sub">
                          {SEVERITY_LABEL[issue.severity]} · {issue.label || RULES[issue.rule].name}
                        </span>
                      </span>
                      <ChevronRight className="issue-chev" size={16} aria-hidden />
                    </button>
                    {open && (
                      <div className="issue-body">
                        <p>{issue.detail}</p>
                        {issue.hint && (
                          <p className="hint">
                            <Lightbulb size={14} aria-hidden />
                            <span>{issue.hint}</span>
                          </p>
                        )}
                        {issue.selector && <code className="selector">{issue.selector}</code>}
                        <p className="rule-desc">{RULES[issue.rule].description}</p>
                        {issue.ref !== undefined && issue.rects.length > 0 && (
                          <div className="issue-actions">
                            <Button size="sm" icon={Crosshair} onClick={() => onReveal(issue.ref!)}>
                              위치로 스크롤
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}

        {layout && (
          <details className="env">
            <summary>
              <ChevronRight size={14} aria-hidden />
              에뮬레이션 정보
              {webkit && <span className="badge badge-neutral">WebKit</span>}
              {unsupported && (
                <span className="badge badge-warn">
                  <TriangleAlert size={12} aria-hidden />
                  일부 미지원
                </span>
              )}
            </summary>
            <dl>
              <dt>엔진</dt>
              <dd>{webkit ? `WebKit ${engineVersion} (사파리 엔진)` : `Chromium ${engineVersion}`}</dd>
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
                {env?.usesSafeArea && <span className="muted"> · CSS {edgeUsageText(env.safeAreaEdges)}</span>}
              </dd>
              <dt>모서리</dt>
              <dd title="왼쪽 위 / 오른쪽 위 / 오른쪽 아래 / 왼쪽 아래 반경">
                {cornerText(layout.screen.corners)}
                {isAsymmetric(layout.screen.corners) && <span className="badge badge-neutral">비대칭</span>}
              </dd>
              <dt>세그먼트</dt>
              <dd>
                {webkit
                  ? '1개 (사파리 미지원)'
                  : layout.displayFeature
                    ? `${layout.displayFeature.orientation === 'vertical' ? '좌우' : '위아래'} 2개 · 마스크 ${layout.displayFeature.maskLength}px`
                    : '1개'}
                {env && env.segments.length > 1 && ' ✓'}
              </dd>
              <dt>device-posture</dt>
              <dd>{webkit ? (env?.posture ?? '없음 (사파리 미지원)') : (env?.posture ?? layout.devicePosture)}</dd>
              {env && (
                <>
                  <dt>meta viewport</dt>
                  <dd className="mono">{env.viewportMeta ?? '없음'}</dd>
                </>
              )}
            </dl>
            {webkit && (
              <p className="callout callout-info">
                <Info size={14} aria-hidden />
                <span>
                  사파리와 같은 WebKit 엔진으로 그리는 중입니다. 사파리에는 화면 분할·자세 API가 없어 실제 아이폰처럼 쓰지 않습니다. 안전 영역은
                  페이지 CSS의 env()를 바꿔 넣어 흉내 냅니다.
                </span>
              </p>
            )}
            {unsupported && (
              <p className="callout callout-warn">
                <TriangleAlert size={14} aria-hidden />
                <span>
                  이 크로미움 버전은
                  {support.segments === 'unsupported' && ' 화면 분할(Viewport Segments)'}
                  {support.posture === 'unsupported' && ' 자세(Device Posture)'}
                  {support.safeArea === 'unsupported' && ' 안전 영역(safe-area-inset)'} 에뮬레이션을 지원하지 않아 결과가 실제와 다를 수 있습니다.
                </span>
              </p>
            )}
          </details>
        )}
      </div>
    </aside>
  );
}
