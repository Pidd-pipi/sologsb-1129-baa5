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

/**
 * 整盘试印封存的格位清单：只保留与布局内容相关的字段（行 / 列 / 字符 / 字模 id），
 * 不随 placedAt 等元数据变化而失效。
 */
export interface CaseSnapshotSlot {
  row: number;
  col: number;
  character: string;
  matrixId: string;
}

/** 整盘试印时封存的字盘布局快照 */
export interface CaseLayoutSnapshot {
  /** 关联字盘 id（按 id 关联，字盘改编号不影响比对） */
  caseId: string;
  /** 封存时的字盘编号（留档用） */
  caseCode: string;
  /** 封存时的行数 / 列数（尺寸变化也算布局变化） */
  rows: number;
  cols: number;
  /** 封存时的格子位置与字符清单 */
  slots: CaseSnapshotSlot[];
  /** 封存时间 */
  sealedAt: string;
}

export interface ProofRecord {
  id: string;
  /** 字符或字盘 */
  targetKind: ProofTargetKind;
  /** 字符内容或字盘编号 */
  targetRef: string;
  /** 关联字模 id（整盘试印时为空） */
  matrixId: string;
  /** 关联字盘 id（整盘试印时使用，单字试印为空） */
  caseId: string;
  /** 整盘试印时封存的布局清单；单字试印为 null */
  caseSnapshot: CaseLayoutSnapshot | null;
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
  createdAt: string;
}

export interface ProofInput {
  targetKind: ProofTargetKind;
  targetRef: string;
  matrixId: string;
  /** 整盘试印时选中的字盘 id */
  caseId: string;
  pressureKg: number;
  ink: string;
  impressions: number;
  sampleNo: string;
  clarity: ClarityLevel;
  proofDate: string;
  note?: string;
}

/** 取一个格位的布局内容键：行 / 列 / 字符 / 字模 任一不同即视为布局不同 */
function slotContentKey(s: { row: number; col: number; character: string; matrixId: string }): string {
  return `${s.row}|${s.col}|${s.character}|${s.matrixId}`;
}

/** 由当前字盘生成整盘试印的封存清单（剔除 placedAt 等易变元数据） */
export function buildCaseSnapshot(typeCase: TypeCase, sealedAt = new Date().toISOString()): CaseLayoutSnapshot {
  const slots: CaseSnapshotSlot[] = typeCase.slots
    .map((s: CaseSlot) => ({
      row: s.row,
      col: s.col,
      character: s.character,
      matrixId: s.matrixId,
    }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
  return {
    caseId: typeCase.id,
    caseCode: typeCase.code,
    rows: typeCase.rows,
    cols: typeCase.cols,
    slots,
    sealedAt,
  };
}

/**
 * 布局内容比对：以封存清单中的行列尺寸与每个格位的「位置 + 字符 + 字模」为依据。
 * 字盘之后挪过格位、取出 / 替换过字模或改过行列数，均判定为不一致；
 * 布局恢复原样后重新一致，失效提示自然消失。
 */
export function snapshotMatchesCurrent(snapshot: CaseLayoutSnapshot, typeCase: TypeCase): boolean {
  if (snapshot.caseId !== typeCase.id) return false;
  if (snapshot.rows !== typeCase.rows || snapshot.cols !== typeCase.cols) return false;
  if (snapshot.slots.length !== typeCase.slots.length) return false;
  const sealed = snapshot.slots.map(slotContentKey).sort();
  const current = typeCase.slots.map(slotContentKey).sort();
  return sealed.every((key, i) => key === current[i]);
}

/** 样张相对当前字盘布局的有效性状态 */
export type ProofLayoutStatus =
  | 'single' // 单字试印，不做布局比对
  | 'current' // 整盘试印，当前布局与封存清单一致
  | 'stale' // 整盘试印，字盘布局已改动
  | 'unsealed' // 早期整盘试印，未留下封存清单
  | 'case-missing'; // 整盘试印，对应字盘已删除

/** 按封存清单比对当前字盘，得出样张状态 */
export function proofLayoutStatus(
  proof: Pick<ProofRecord, 'targetKind' | 'caseId' | 'caseSnapshot'>,
  typeCase: TypeCase | undefined,
): ProofLayoutStatus {
  if (proof.targetKind !== '字盘') return 'single';
  if (!proof.caseSnapshot) return 'unsealed';
  if (!typeCase || proof.caseId !== typeCase.id) return 'case-missing';
  return snapshotMatchesCurrent(proof.caseSnapshot, typeCase) ? 'current' : 'stale';
}

export function validateProofInput(input: Partial<ProofInput>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.targetKind) errors.targetKind = '请选择试印对象';
  if (input.targetKind === '字盘' && !(input.caseId || '').trim()) {
    errors.caseId = '请选择试印字盘';
  }
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
