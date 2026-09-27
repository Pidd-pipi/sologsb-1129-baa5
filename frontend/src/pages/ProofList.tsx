import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';
import LayoutGrid from '../components/common/LayoutGrid';
import { DRAFT_KEYS, useLocalDraft } from '../hooks/useLocalDraft';
import { useCaseStore } from '../stores/caseStore';
import { useMatrixStore } from '../stores/matrixStore';
import { useUiStore } from '../stores/uiStore';
import type { ProofLayoutStatus, ProofRecord } from '../types/proof';
import {
  CLARITY_LEVELS,
  IMPRESSION_RANGE,
  PRESSURE_RANGE,
  PROOF_TARGET_KINDS,
  proofLayoutStatus,
  validateProofInput,
  type ClarityLevel,
  type ProofInput,
  type ProofTargetKind,
} from '../types/proof';
import type { TypeCase } from '../types/case';
import { dash, formatDate, formatStamp, suggestSampleNo, todayStr } from '../utils/format';

interface ProofFormState {
  targetKind: ProofTargetKind;
  matrixId: string;
  caseId: string;
  targetRef: string;
  pressureKg: string;
  ink: string;
  impressions: string;
  sampleNo: string;
  clarity: ClarityLevel;
  proofDate: string;
  note: string;
}

/** 行标：A、B、C… */
function rowLabel(row: number): string {
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[row] ?? String(row + 1);
}

/** 封存清单的字符清单文本，按行展开，例：「活(A1)、字(A2)…」 */
function sealedCharacterText(proof: ProofRecord): string {
  const slots = proof.caseSnapshot?.slots ?? [];
  if (slots.length === 0) return '（封存时为空格盘）';
  return slots
    .map((s) => `${s.character}(${rowLabel(s.row)}${s.col + 1})`)
    .join('、');
}

/** 整盘试印失效提示徽标（布局恢复原样后提示自然消失） */
function StatusBadge({ status }: { status: ProofLayoutStatus }) {
  if (status === 'current') {
    return (
      <span className="mt-chip border-jade/40 text-jade" data-testid="proof-status-current">
        布局一致
      </span>
    );
  }
  if (status === 'stale') {
    return (
      <span className="mt-chip border-seal/50 bg-seal-pale text-seal" data-testid="proof-status-stale">
        已失效 · 布局已改动
      </span>
    );
  }
  if (status === 'case-missing') {
    return (
      <span className="mt-chip border-seal/50 bg-seal-pale text-seal" data-testid="proof-status-case-missing">
        已失效 · 字盘已删除
      </span>
    );
  }
  if (status === 'unsealed') {
    return (
      <span className="mt-chip border-brass/40 text-brass" data-testid="proof-status-unsealed">
        早期样张 · 无封存清单
      </span>
    );
  }
  return <span className="text-[11px] text-ink-mute">单字试印</span>;
}

/** 封存清单：封存时的格子位置网格 + 字符清单 */
function SealedArchive({ proof }: { proof: ProofRecord }) {
  const snap = proof.caseSnapshot;
  if (!snap) {
    return (
      <p className="text-xs text-ink-mute" data-testid={`sealed-empty-${proof.id}`}>
        该样张登记于封存功能上线前，未留下当时的格子位置与字符清单。
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid={`sealed-archive-${proof.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-mute">
        <span>
          封存字盘：{snap.caseCode}（{snap.rows} 行 × {snap.cols} 列）
        </span>
        <span>封存时间：{formatStamp(snap.sealedAt)}</span>
        <span>落位 {snap.slots.length} 格</span>
      </div>
      <LayoutGrid
        rows={snap.rows}
        cols={snap.cols}
        slots={snap.slots}
        readOnly
        testIdPrefix={`sealed-slot-${proof.id}`}
      />
      <p className="text-xs leading-relaxed text-ink-soft" data-testid={`sealed-chars-${proof.id}`}>
        <span className="text-ink-mute">字符清单：</span>
        {sealedCharacterText(proof)}
      </p>
    </div>
  );
}

/** `/proofs` 试印记录：登记压力、用墨与清晰度评价，按样张编号回溯试印批次 */
export default function ProofList() {
  const matrices = useMatrixStore((s) => s.matrices);
  const proofs = useMatrixStore((s) => s.proofs);
  const proofCount = useMatrixStore((s) => s.proofs.length);
  const addProof = useMatrixStore((s) => s.addProof);
  const cases = useCaseStore((s) => s.cases);
  const pushToast = useUiStore((s) => s.pushToast);
  const sampleQuery = useUiStore((s) => s.sampleQuery);
  const setSampleQuery = useUiStore((s) => s.setSampleQuery);

  const { draft, patch, reset, savedAt, existed } = useLocalDraft<ProofFormState>(
    DRAFT_KEYS.proofNew,
    {
      targetKind: '字符',
      matrixId: '',
      caseId: '',
      targetRef: '',
      pressureKg: '12.5',
      ink: '油烟墨 101',
      impressions: '40',
      sampleNo: suggestSampleNo(todayStr(), 1),
      clarity: '清晰',
      proofDate: todayStr(),
      note: '',
    },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** 当前展开翻看封存清单的样张 id */
  const [expandedId, setExpandedId] = useState('');

  useEffect(() => {
    if (!draft.matrixId && matrices.length > 0) patch({ matrixId: matrices[0].id });
  }, [draft.matrixId, matrices, patch]);

  useEffect(() => {
    if (!draft.caseId && draft.targetKind === '字盘' && cases.length > 0) {
      patch({ caseId: cases[0].id });
    }
  }, [draft.caseId, draft.targetKind, cases, patch]);

  const selectedMatrix = matrices.find((m) => m.id === draft.matrixId);
  const selectedCase = cases.find((c) => c.id === draft.caseId);

  useEffect(() => {
    if (draft.targetKind === '字符' && selectedMatrix) {
      patch({ targetRef: selectedMatrix.character });
    }
  }, [draft.targetKind, selectedMatrix, patch]);

  useEffect(() => {
    if (draft.targetKind === '字盘' && selectedCase) {
      patch({ targetRef: selectedCase.code });
    }
  }, [draft.targetKind, selectedCase, patch]);

  /** 按 caseId 关联；历史数据没有 caseId 时回退按字盘编号匹配 */
  const caseOfProof = useCallback(
    (proof: ProofRecord): TypeCase | undefined => {
      if (proof.caseId) return cases.find((c) => c.id === proof.caseId);
      return cases.find((c) => c.code === proof.targetRef);
    },
    [cases],
  );

  /** 每条样张相对现行字盘布局的状态（随字盘保存实时重算） */
  const statusById = useMemo(() => {
    const map = new Map<string, ProofLayoutStatus>();
    proofs.forEach((p) => map.set(p.id, proofLayoutStatus(p, caseOfProof(p))));
    return map;
  }, [proofs, caseOfProof]);
  const statusOf = (proof: ProofRecord): ProofLayoutStatus =>
    statusById.get(proof.id) ?? 'single';

  const traced = useMemo(() => {
    const q = sampleQuery.trim().toLowerCase();
    if (!q) return [];
    return proofs.filter(
      (p) => p.sampleNo.toLowerCase().includes(q) || p.targetRef.toLowerCase().includes(q),
    );
  }, [proofs, sampleQuery]);

  const clarityStats = useMemo(() => {
    const out: Record<string, number> = {};
    proofs.forEach((p) => {
      out[p.clarity] = (out[p.clarity] ?? 0) + 1;
    });
    return out;
  }, [proofs]);

  const staleCount = useMemo(() => {
    let n = 0;
    statusById.forEach((s) => {
      if (s === 'stale' || s === 'case-missing') n += 1;
    });
    return n;
  }, [statusById]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const input: ProofInput = {
      targetKind: draft.targetKind,
      targetRef:
        draft.targetKind === '字盘' ? (selectedCase?.code ?? draft.targetRef) : draft.targetRef,
      matrixId: draft.targetKind === '字符' ? draft.matrixId : '',
      caseId: draft.targetKind === '字盘' ? draft.caseId : '',
      pressureKg: Number(draft.pressureKg),
      ink: draft.ink,
      impressions: Number(draft.impressions),
      sampleNo: draft.sampleNo,
      clarity: draft.clarity,
      proofDate: draft.proofDate,
      note: draft.note,
    };
    const next = validateProofInput(input);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      pushToast('试印登记未通过校验，请按提示修正', 'warn');
      return;
    }
    try {
      await addProof(input);
      pushToast(
        draft.targetKind === '字盘'
          ? `已登记整盘试印 ${input.sampleNo}，并封存当时的格子位置与字符清单`
          : `已登记试印样张 ${input.sampleNo}（${input.clarity}）`,
      );
      patch({
        note: '',
        sampleNo: suggestSampleNo(todayStr(), proofs.length + 2),
      });
      setErrors({});
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '试印登记失败', 'error');
    }
  };

  const sortedProofs = useMemo(
    () => [...proofs].sort((a, b) => (a.proofDate < b.proofDate ? 1 : -1)),
    [proofs],
  );

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="mt-title" data-testid="proof-list-title">
            试印记录
          </h2>
          <p className="mt-sub">
            登记压力（0.5–60 kg）、用墨与清晰度评价。整盘试印会封存当时的格子位置与字符清单，字盘布局改动后样张自动标记失效，恢复原样后提示消失。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="mt-chip" data-testid="proof-total">
            试印 {proofCount} 条
          </span>
          {CLARITY_LEVELS.map((c) => (
            <span key={c} className="mt-chip">
              {c} {clarityStats[c] ?? 0}
            </span>
          ))}
          {staleCount > 0 ? (
            <span className="mt-chip border-seal/50 bg-seal-pale text-seal" data-testid="proof-stale-count">
              已失效 {staleCount} 条
            </span>
          ) : null}
        </div>
      </section>

      <section className="mt-panel">
        <div className="mt-panel-head">
          <h3 className="font-song text-sm font-semibold text-ink">登记试印结果</h3>
          <span className="mt-sub" data-testid="proof-draft-status">
            {existed ? `草稿已恢复 · ${savedAt || '—'}` : `草稿自动保存 ${savedAt || '—'}`}
          </span>
        </div>
        <form className="space-y-3 px-4 py-4" onSubmit={handleSubmit} data-testid="proof-form">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className="mt-label" htmlFor="proof-target-kind">
                试印对象
              </label>
              <select
                id="proof-target-kind"
                data-testid="proof-target-kind"
                className="mt-input"
                value={draft.targetKind}
                onChange={(e) => patch({ targetKind: e.target.value as ProofTargetKind })}
              >
                {PROOF_TARGET_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            {draft.targetKind === '字符' ? (
              <div className="md:col-span-2">
                <label className="mt-label" htmlFor="proof-matrix-select">
                  关联字模
                </label>
                <select
                  id="proof-matrix-select"
                  data-testid="proof-matrix-select"
                  className="mt-input"
                  value={draft.matrixId}
                  onChange={(e) => patch({ matrixId: e.target.value })}
                >
                  <option value="">不关联具体字模</option>
                  {matrices.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.character} · {m.code} · {m.font}/{m.sizeName}
                    </option>
                  ))}
                </select>
                {errors.matrixId ? <p className="mt-error">{errors.matrixId}</p> : null}
              </div>
            ) : (
              <div className="md:col-span-2">
                <label className="mt-label" htmlFor="proof-case-select">
                  试印字盘
                </label>
                <select
                  id="proof-case-select"
                  data-testid="proof-case-select"
                  className="mt-input"
                  value={draft.caseId}
                  onChange={(e) => patch({ caseId: e.target.value })}
                >
                  {cases.length === 0 ? <option value="">暂无字盘，请先到字盘布局建档</option> : null}
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.kind} · {c.slots.length} 格
                    </option>
                  ))}
                </select>
                {errors.caseId ? (
                  <p className="mt-error" data-testid="error-caseId">
                    {errors.caseId}
                  </p>
                ) : (
                  <p className="mt-hint">登记时封存当前格子位置与字符清单</p>
                )}
              </div>
            )}
            <div>
              <label className="mt-label" htmlFor="proof-target-ref">
                {draft.targetKind === '字盘' ? '字盘编号' : '字符'}
              </label>
              <input
                id="proof-target-ref"
                data-testid="proof-target-ref"
                className={`mt-input ${draft.targetKind === '字盘' ? 'bg-paper/60 text-ink-mute' : ''}`}
                placeholder={draft.targetKind === '字盘' ? '例：ZP-A-01' : '例：活'}
                value={draft.targetRef}
                readOnly={draft.targetKind === '字盘'}
                onChange={(e) => patch({ targetRef: e.target.value })}
              />
              {errors.targetRef ? (
                <p className="mt-error" data-testid="error-targetRef">
                  {errors.targetRef}
                </p>
              ) : null}
            </div>
            <div>
              <label className="mt-label" htmlFor="proof-pressure-input">
                压力 kg
              </label>
              <input
                id="proof-pressure-input"
                data-testid="proof-pressure-input"
                className="mt-input"
                type="number"
                min={PRESSURE_RANGE.min}
                max={PRESSURE_RANGE.max}
                step={0.5}
                value={draft.pressureKg}
                onChange={(e) => patch({ pressureKg: e.target.value })}
              />
              {errors.pressureKg ? (
                <p className="mt-error" data-testid="error-pressureKg">
                  {errors.pressureKg}
                </p>
              ) : (
                <p className="mt-hint">
                  {PRESSURE_RANGE.min}–{PRESSURE_RANGE.max} kg
                </p>
              )}
            </div>
            <div>
              <label className="mt-label" htmlFor="proof-ink-input">
                用墨
              </label>
              <input
                id="proof-ink-input"
                data-testid="proof-ink-input"
                className="mt-input"
                placeholder="例：油烟墨 101"
                value={draft.ink}
                onChange={(e) => patch({ ink: e.target.value })}
              />
              {errors.ink ? (
                <p className="mt-error" data-testid="error-ink">
                  {errors.ink}
                </p>
              ) : null}
            </div>
            <div>
              <label className="mt-label" htmlFor="proof-impressions-input">
                印次
              </label>
              <input
                id="proof-impressions-input"
                data-testid="proof-impressions-input"
                className="mt-input"
                type="number"
                min={IMPRESSION_RANGE.min}
                max={IMPRESSION_RANGE.max}
                step={1}
                value={draft.impressions}
                onChange={(e) => patch({ impressions: e.target.value })}
              />
              {errors.impressions ? (
                <p className="mt-error" data-testid="error-impressions">
                  {errors.impressions}
                </p>
              ) : null}
            </div>
            <div>
              <label className="mt-label" htmlFor="proof-clarity-select">
                清晰度评价
              </label>
              <select
                id="proof-clarity-select"
                data-testid="proof-clarity-select"
                className="mt-input"
                value={draft.clarity}
                onChange={(e) => patch({ clarity: e.target.value as ClarityLevel })}
              >
                {CLARITY_LEVELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mt-label" htmlFor="proof-sampleno-input">
                样张编号
              </label>
              <div className="flex gap-2">
                <input
                  id="proof-sampleno-input"
                  data-testid="proof-sampleno-input"
                  className="mt-input"
                  value={draft.sampleNo}
                  onChange={(e) => patch({ sampleNo: e.target.value })}
                />
                <button
                  type="button"
                  className="mt-btn whitespace-nowrap"
                  data-testid="suggest-sample-btn"
                  onClick={() => patch({ sampleNo: suggestSampleNo(draft.proofDate, proofs.length + 1) })}
                >
                  按日期生成
                </button>
              </div>
              {errors.sampleNo ? (
                <p className="mt-error" data-testid="error-sampleNo">
                  {errors.sampleNo}
                </p>
              ) : null}
            </div>
            <div>
              <label className="mt-label" htmlFor="proof-date-input">
                试印日期
              </label>
              <input
                id="proof-date-input"
                data-testid="proof-date-input"
                type="date"
                className="mt-input"
                value={draft.proofDate}
                onChange={(e) => patch({ proofDate: e.target.value })}
              />
              {errors.proofDate ? (
                <p className="mt-error" data-testid="error-proofDate">
                  {errors.proofDate}
                </p>
              ) : null}
            </div>
            <div className="md:col-span-4">
              <label className="mt-label" htmlFor="proof-note-input">
                备注
              </label>
              <input
                id="proof-note-input"
                data-testid="proof-note-input"
                className="mt-input"
                placeholder="例：压力偏低，建议加压至 12kg"
                value={draft.note}
                onChange={(e) => patch({ note: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="mt-btn mt-btn-primary" data-testid="submit-proof">
              登记试印
            </button>
            <button
              type="button"
              className="mt-btn"
              data-testid="reset-proof-draft"
              onClick={() => {
                reset();
                setErrors({});
                pushToast('已清空试印登记草稿', 'warn');
              }}
            >
              清空草稿
            </button>
            <span className="mt-hint">
              当前对象：{draft.targetKind} · {dash(draft.targetRef)}
            </span>
          </div>
        </form>
      </section>

      <section className="mt-panel" data-testid="trace-panel">
        <div className="mt-panel-head">
          <h3 className="font-song text-sm font-semibold text-ink">按样张编号回溯</h3>
          <input
            className="mt-input max-w-[240px]"
            placeholder="输入样张编号片段，例：YZ-2025"
            data-testid="sample-search-input"
            value={sampleQuery}
            onChange={(e) => setSampleQuery(e.target.value)}
          />
        </div>
        <div className="px-4 py-3">
          {sampleQuery.trim() === '' ? (
            <p className="text-xs text-ink-mute">输入样张编号或字符即可回溯试印批次与对应字模。</p>
          ) : traced.length === 0 ? (
            <EmptyState
              title="没有匹配的试印记录"
              description="请检查样张编号片段，或先登记一条试印记录。"
              testId="trace-empty"
            />
          ) : (
            <ul className="space-y-2" data-testid="sample-search-result">
              {traced.map((p) => (
                <li key={p.id} className="rounded border border-paper-line bg-paper/40 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-song text-sm text-ink">{p.sampleNo}</span>
                    <span className="mt-chip">{p.clarity}</span>
                    {p.targetKind === '字盘' ? <StatusBadge status={statusOf(p)} /> : null}
                    <span className="text-ink-mute">{formatDate(p.proofDate)}</span>
                    <span className="text-ink-soft">
                      {p.pressureKg} kg · {p.ink} · 印次 {p.impressions}
                    </span>
                    {p.matrixId ? (
                      <Link className="mt-btn mt-btn-ghost" to={`/matrices/${p.matrixId}`} data-testid={`trace-matrix-${p.id}`}>
                        回溯字模
                      </Link>
                    ) : (
                      <span className="text-ink-mute">整盘试印，未关联单枚字模</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-panel">
        <div className="mt-panel-head">
          <h3 className="font-song text-sm font-semibold text-ink">试印台账</h3>
          <span className="mt-sub">共 {proofs.length} 条</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full" data-testid="proof-table">
            <thead className="border-b border-paper-line bg-paper/60">
              <tr>
                <th className="mt-th">样张编号</th>
                <th className="mt-th">对象</th>
                <th className="mt-th">压力 / 用墨</th>
                <th className="mt-th">印次</th>
                <th className="mt-th">清晰度</th>
                <th className="mt-th">试印日期</th>
                <th className="mt-th">字模</th>
                <th className="mt-th">封存布局</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {sortedProofs.length === 0 ? (
                <tr>
                  <td className="mt-td text-ink-mute" colSpan={8}>
                    暂无试印记录。
                  </td>
                </tr>
              ) : (
                sortedProofs.map((p) => {
                  const status = statusOf(p);
                  const expanded = expandedId === p.id;
                  return [
                    <tr key={p.id} data-testid={`proof-row-${p.id}`}>
                      <td className="mt-td font-song text-ink">{p.sampleNo}</td>
                      <td className="mt-td">
                        {p.targetKind} · {p.targetRef}
                      </td>
                      <td className="mt-td">
                        {p.pressureKg} kg · {p.ink}
                      </td>
                      <td className="mt-td">{p.impressions}</td>
                      <td className="mt-td">
                        <span
                          className={`mt-chip ${
                            p.clarity === '清晰'
                              ? 'border-jade/40 text-jade'
                              : p.clarity === '偏淡'
                                ? 'border-brass/40 text-brass'
                                : 'border-seal/40 text-seal'
                          }`}
                        >
                          {p.clarity}
                        </span>
                      </td>
                      <td className="mt-td">{formatDate(p.proofDate)}</td>
                      <td className="mt-td">
                        {p.matrixId ? (
                          <Link
                            className="text-seal hover:underline"
                            to={`/matrices/${p.matrixId}`}
                            data-testid={`proof-matrix-link-${p.id}`}
                          >
                            查看字模
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="mt-td">
                        {p.targetKind === '字盘' ? (
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={status} />
                            <button
                              type="button"
                              className="mt-btn mt-btn-ghost"
                              data-testid={`view-sealed-${p.id}`}
                              onClick={() => setExpandedId(expanded ? '' : p.id)}
                            >
                              {expanded ? '收起封存清单' : '翻看封存清单'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-ink-mute" data-testid={`single-proof-${p.id}`}>
                            单字试印
                          </span>
                        )}
                      </td>
                    </tr>,
                    expanded && p.targetKind === '字盘' ? (
                      <tr key={`${p.id}-sealed`} data-testid={`sealed-row-${p.id}`}>
                        <td className="mt-td bg-paper/40" colSpan={8}>
                          <SealedArchive proof={p} />
                        </td>
                      </tr>
                    ) : null,
                  ];
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
