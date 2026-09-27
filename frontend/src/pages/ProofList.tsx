import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';
import LayoutGrid from '../components/common/LayoutGrid';
import { DRAFT_KEYS, useLocalDraft } from '../hooks/useLocalDraft';
import { useCaseStore } from '../stores/caseStore';
import { useMatrixStore } from '../stores/matrixStore';
import { useUiStore } from '../stores/uiStore';
import {
  CLARITY_LEVELS,
  IMPRESSION_RANGE,
  PRESSURE_RANGE,
  PROOF_TARGET_KINDS,
  isProofLayoutStale,
  validateProofInput,
  type ClarityLevel,
  type ProofInput,
  type ProofRecord,
  type ProofTargetKind,
} from '../types/proof';
import { dash, formatDate, formatStamp, suggestSampleNo, todayStr } from '../utils/format';

interface ProofFormState {
  targetKind: ProofTargetKind;
  matrixId: string;
  targetRef: string;
  pressureKg: string;
  ink: string;
  impressions: string;
  sampleNo: string;
  clarity: ClarityLevel;
  proofDate: string;
  note: string;
}

/** `/proofs` 试印记录：登记压力、用墨与样张评价；整盘试印封存当时布局，字盘改动后样张提示已失效 */
export default function ProofList() {
  const matrices = useMatrixStore((s) => s.matrices);
  const proofs = useMatrixStore((s) => s.proofs);
  const proofCount = useMatrixStore((s) => s.proofs.length);
  const addProof = useMatrixStore((s) => s.addProof);
  const cases = useCaseStore((s) => s.cases);
  const pushToast = useUiStore((s) => s.pushToast);
  const sampleQuery = useUiStore((s) => s.sampleQuery);
  const setSampleQuery = useUiStore((s) => s.setSampleQuery);
  const [openSnapshotId, setOpenSnapshotId] = useState('');

  const { draft, patch, reset, savedAt, existed } = useLocalDraft<ProofFormState>(
    DRAFT_KEYS.proofNew,
    {
      targetKind: '字符',
      matrixId: '',
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

  useEffect(() => {
    if (!draft.matrixId && matrices.length > 0) patch({ matrixId: matrices[0].id });
  }, [draft.matrixId, matrices, patch]);

  const selectedMatrix = matrices.find((m) => m.id === draft.matrixId);

  useEffect(() => {
    if (draft.targetKind === '字符' && selectedMatrix) {
      patch({ targetRef: selectedMatrix.character });
    }
  }, [draft.targetKind, selectedMatrix, patch]);

  /** 按编号定位试印记录对应的字盘（用于失效比对） */
  const caseOfProof = (p: ProofRecord) => cases.find((c) => c.code === p.targetRef);

  /** 表单中当前输入的字盘编号匹配到的字盘（登记时将封存其布局） */
  const matchedCase =
    draft.targetKind === '字盘'
      ? cases.find((c) => c.code === draft.targetRef.trim())
      : undefined;

  const toggleSnapshot = (id: string) => setOpenSnapshotId((cur) => (cur === id ? '' : id));

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const input: ProofInput = {
      targetKind: draft.targetKind,
      targetRef: draft.targetRef,
      matrixId: draft.targetKind === '字符' ? draft.matrixId : '',
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
    await addProof(input);
    if (input.targetKind === '字盘') {
      const sealed = matchedCase?.slots.length;
      pushToast(
        sealed !== undefined
          ? `已登记试印样张 ${input.sampleNo}（${input.clarity}），并封存字盘布局 ${sealed} 格`
          : `已登记试印样张 ${input.sampleNo}，但未匹配到字盘「${input.targetRef}」，未封存布局`,
        sealed !== undefined ? 'ok' : 'warn',
      );
    } else {
      pushToast(`已登记试印样张 ${input.sampleNo}（${input.clarity}）`);
    }
    patch({
      note: '',
      sampleNo: suggestSampleNo(todayStr(), proofs.length + 2),
    });
    setErrors({});
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
            登记压力（0.5–60 kg）、用墨与清晰度评价，按样张编号回溯试印批次；整盘试印自动封存当时布局，字盘改动后样张提示已失效。
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
            <div className="md:col-span-2">
              <label className="mt-label" htmlFor="proof-matrix-select">
                关联字模
              </label>
              <select
                id="proof-matrix-select"
                data-testid="proof-matrix-select"
                className="mt-input"
                value={draft.matrixId}
                disabled={draft.targetKind === '字盘'}
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
            <div>
              <label className="mt-label" htmlFor="proof-target-ref">
                字符 / 字盘编号
              </label>
              <input
                id="proof-target-ref"
                data-testid="proof-target-ref"
                className="mt-input"
                placeholder={draft.targetKind === '字盘' ? '例：ZP-A-01' : '例：活'}
                value={draft.targetRef}
                onChange={(e) => patch({ targetRef: e.target.value })}
              />
              {errors.targetRef ? (
                <p className="mt-error" data-testid="error-targetRef">
                  {errors.targetRef}
                </p>
              ) : draft.targetKind === '字盘' && draft.targetRef.trim() ? (
                matchedCase ? (
                  <p className="mt-hint" data-testid="case-snapshot-hint">
                    登记时将封存「{matchedCase.code}」当前布局（{matchedCase.rows}×
                    {matchedCase.cols}，已落位 {matchedCase.slots.length} 格）作为比对依据
                  </p>
                ) : (
                  <p className="mt-hint text-seal" data-testid="case-snapshot-missing">
                    未找到字盘「{draft.targetRef.trim()}」，登记后将没有封存布局可供比对
                  </p>
                )
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
                    <span className="text-ink-mute">{formatDate(p.proofDate)}</span>
                    <span className="text-ink-soft">
                      {p.pressureKg} kg · {p.ink} · 印次 {p.impressions}
                    </span>
                    {isProofLayoutStale(p, caseOfProof(p)) ? (
                      <StaleBadge testId={`trace-stale-${p.id}`} />
                    ) : null}
                    {p.matrixId ? (
                      <Link className="mt-btn mt-btn-ghost" to={`/matrices/${p.matrixId}`} data-testid={`trace-matrix-${p.id}`}>
                        回溯字模
                      </Link>
                    ) : (
                      <span className="text-ink-mute">整盘试印，未关联单枚字模</span>
                    )}
                    {p.layoutSnapshot ? (
                      <button
                        type="button"
                        className="mt-btn mt-btn-ghost"
                        data-testid={`trace-snapshot-toggle-${p.id}`}
                        onClick={() => toggleSnapshot(p.id)}
                      >
                        {openSnapshotId === p.id ? '收起封存清单' : '封存清单'}
                      </button>
                    ) : null}
                  </div>
                  {openSnapshotId === p.id && p.layoutSnapshot ? (
                    <div className="mt-2 border-t border-paper-line pt-2">
                      <SnapshotPanel proof={p} />
                    </div>
                  ) : null}
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
                <th className="mt-th">布局封存</th>
                <th className="mt-th">压力 / 用墨</th>
                <th className="mt-th">印次</th>
                <th className="mt-th">清晰度</th>
                <th className="mt-th">试印日期</th>
                <th className="mt-th">字模</th>
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
                sortedProofs.map((p) => (
                  <Fragment key={p.id}>
                    <tr data-testid={`proof-row-${p.id}`}>
                      <td className="mt-td font-song text-ink">{p.sampleNo}</td>
                      <td className="mt-td">
                        {p.targetKind} · {p.targetRef}
                      </td>
                      <td className="mt-td">
                        {p.targetKind === '字盘' ? (
                          p.layoutSnapshot ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {isProofLayoutStale(p, caseOfProof(p)) ? (
                                <StaleBadge testId={`proof-stale-${p.id}`} />
                              ) : null}
                              <button
                                type="button"
                                className="mt-btn mt-btn-ghost"
                                data-testid={`proof-snapshot-toggle-${p.id}`}
                                onClick={() => toggleSnapshot(p.id)}
                              >
                                {openSnapshotId === p.id ? '收起封存清单' : '封存清单'}
                              </button>
                            </div>
                          ) : (
                            <span className="text-ink-mute" data-testid={`proof-no-snapshot-${p.id}`}>
                              未封存布局
                            </span>
                          )
                        ) : (
                          '—'
                        )}
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
                    </tr>
                    {openSnapshotId === p.id && p.layoutSnapshot ? (
                      <tr data-testid={`proof-snapshot-row-${p.id}`}>
                        <td className="mt-td bg-paper/40" colSpan={8}>
                          <SnapshotPanel proof={p} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const ROW_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 已失效徽标：字盘布局与封存内容不一致（或字盘已删除 / 改号）时展示，布局恢复后自然消失 */
function StaleBadge({ testId }: { testId: string }) {
  return (
    <span
      className="mt-chip border-seal/40 text-seal"
      title="字盘布局与封存时不一致（或字盘已删除），样张反映的是封存时的布局"
      data-testid={testId}
    >
      已失效
    </span>
  );
}

/** 封存清单：只读网格 + 字符清单，回看整盘试印当时封存的格子位置与字符 */
function SnapshotPanel({ proof }: { proof: ProofRecord }) {
  const snap = proof.layoutSnapshot;
  if (!snap) return null;
  const sorted = [...snap.slots].sort((a, b) => a.row - b.row || a.col - b.col);
  return (
    <div className="space-y-2" data-testid={`snapshot-panel-${proof.id}`}>
      <p className="text-[11px] text-ink-mute">
        封存于 {formatStamp(proof.createdAt)} · {snap.rows} 行 × {snap.cols} 列 · 落位{' '}
        {snap.slots.length} 格 · 格子位置与字符以封存时为准
      </p>
      <LayoutGrid
        rows={snap.rows}
        cols={snap.cols}
        slots={snap.slots}
        readOnly
        testIdPrefix={`snapshot-${proof.id}`}
      />
      <p className="text-[11px] leading-5 text-ink-soft" data-testid={`snapshot-chars-${proof.id}`}>
        字符清单：
        {sorted.length
          ? sorted
              .map((s) => `${ROW_LABELS[s.row] ?? s.row + 1}${s.col + 1}「${s.character}」`)
              .join('、')
          : '（空盘）'}
      </p>
    </div>
  );
}
