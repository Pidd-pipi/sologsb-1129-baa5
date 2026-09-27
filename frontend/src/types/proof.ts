/** 试印记录（ProofRecord）：单字或整盘试印的压力、用墨与样张评价 */

import type { CaseSlot, TypeCase } from './case';

/** 试印对象类型：单字试印 / 整盘试印 */
export const PROOF_TARGET_KINDS = ['字符', '字盘'] as const;
export type ProofTargetKind = (typeof PROOF_TARGET_KINDS)[number];

/** 清晰度评价 */
export const CLARITY_LEVELS = ['清晰', '偏淡', '糊版'] as const;
export type ClarityLevel = (typeof CLARITY_LEVELS)[number];

/** 压力 / 印次合法区间 */
export const PRESSURE_RANGE = { min: 0.5, max: 60 } as const;
export const IMPRESSION_RANGE = { min: 1, max: 999 } as const;

/** 整盘试印时封存的布局快照：当时的格子位置与字符清单，作为日后比对的依据 */
export interface ProofLayoutSnapshot {
  /** 封存时的行数 */
  rows: number;
  /** 封存时的列数 */
  cols: number;
  /** 封存时的落位清单（行、列、字符、字模 id、落位时间） */
  slots: CaseSlot[];
}

export interface ProofRecord {
  id: string;
  /** 字符或字盘 */
  targetKind: ProofTargetKind;
  /** 字符内容或字盘编号 */
  targetRef: string;
  /** 关联字模 id（整盘试印时可为空） */
  matrixId: string;
  /** 压力 kg */
  pressureKg: number;
  /** 用墨 */
  ink: string;
  /** 印次 */
  impressions: number;
  /** 样张编号，用于回溯试印批次 */
  sampleNo: string;
  clarity: ClarityLevel;
  /** 试印日期 YYYY-MM-DD */
  proofDate: string;
  note: string;
  /** 整盘试印时封存的布局快照；单字试印与早期记录为空 */
  layoutSnapshot?: ProofLayoutSnapshot | null;
  createdAt: string;
}

export interface ProofInput {
  targetKind: ProofTargetKind;
  targetRef: string;
  matrixId: string;
  pressureKg: number;
  ink: string;
  impressions: number;
  sampleNo: string;
  clarity: ClarityLevel;
  proofDate: string;
  note?: string;
}

export function validateProofInput(input: Partial<ProofInput>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.targetKind) errors.targetKind = '请选择试印对象';
  if (!(input.targetRef || '').trim()) errors.targetRef = '请填写字符或字盘编号';
  const p = Number(input.pressureKg);
  if (!Number.isFinite(p) || p < PRESSURE_RANGE.min || p > PRESSURE_RANGE.max) {
    errors.pressureKg = `压力需在 ${PRESSURE_RANGE.min}–${PRESSURE_RANGE.max} kg 之间`;
  }
  const n = Number(input.impressions);
  if (!Number.isInteger(n) || n < IMPRESSION_RANGE.min || n > IMPRESSION_RANGE.max) {
    errors.impressions = `印次需在 ${IMPRESSION_RANGE.min}–${IMPRESSION_RANGE.max} 之间`;
  }
  if (!(input.ink || '').trim()) errors.ink = '请填写用墨';
  if (!(input.sampleNo || '').trim()) errors.sampleNo = '样张编号不能为空';
  if (!input.clarity) errors.clarity = '请选择清晰度评价';
  const d = (input.proofDate || '').trim();
  if (!d) errors.proofDate = '请填写试印日期';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.proofDate = '日期格式需为 YYYY-MM-DD';
  return errors;
}

/** 提取字盘当前布局生成封存快照；字盘不存在时返回 null（登记后无可比对依据） */
export function snapshotOfCase(typeCase: TypeCase | null | undefined): ProofLayoutSnapshot | null {
  if (!typeCase) return null;
  return {
    rows: typeCase.rows,
    cols: typeCase.cols,
    slots: typeCase.slots.map((s) => ({ ...s })),
  };
}

/**
 * 单格内容键：行、列、字符、字模 id。
 * 刻意忽略落位时间 placedAt —— 同一布局取出又放回视为「恢复原样」，不应判为失效。
 */
function slotContentKey(slot: CaseSlot): string {
  return `${slot.row}#${slot.col}#${slot.character}#${slot.matrixId}`;
}

/** 布局内容指纹：行列数 + 全部格位内容（排序后拼接，与落位先后顺序无关） */
export function layoutFingerprint(rows: number, cols: number, slots: CaseSlot[]): string {
  const body = slots.map(slotContentKey).sort().join('|');
  return `${rows}x${cols}::${body}`;
}

/**
 * 判断整盘试印记录是否已失效：以封存布局与字盘当前布局的内容比对为准。
 * 字盘被删除或改号同样视为失效；布局恢复原样后结果自然回到「未失效」。
 * 无快照的记录（单字试印、早期数据）不参与判断。
 */
export function isProofLayoutStale(
  proof: Pick<ProofRecord, 'targetKind' | 'layoutSnapshot'>,
  typeCase: TypeCase | null | undefined,
): boolean {
  if (proof.targetKind !== '字盘' || !proof.layoutSnapshot) return false;
  if (!typeCase) return true;
  const snap = proof.layoutSnapshot;
  return (
    layoutFingerprint(snap.rows, snap.cols, snap.slots) !==
    layoutFingerprint(typeCase.rows, typeCase.cols, typeCase.slots)
  );
}
