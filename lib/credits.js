// FRA carbon-credit planner for non-bank financial institutions (NBFIs).
// Rules (research, Nov 2026): FRA Decision 36/2026 - NBFIs with capital or net equity above EGP 100m must report Scope 1+2,
// verified by an FRA-registered body, and offset 20% of annual emissions within 90 days of filing. Credits must sit in the FRA
// Climate Project Registry and be bought on a regulated voluntary carbon market (EGCX). First report deadline: 31 Dec 2026.
// Prices are indicative bands for budgeting only, not quotes.
export const FRA = { thresholdM: 100, offsetShare: 0.2, daysAfterFiling: 90, firstDeadline: '2026-12-31', decision: 'FRA Decision 36/2026 (deadline per Decision 115/2026)' };

export const BANDS = [
  { id: 'avoid', name: 'Renewable energy or efficiency (avoidance)', low: 3, high: 8, note: 'Cheapest. Check additionality; ICVCM scrutiny is high for older wind/solar.' },
  { id: 'cookstove', name: 'Improved cookstoves and household energy', low: 8, high: 18, note: 'Co-benefits are strong. Pick recent methodologies with conservative baselines.' },
  { id: 'nature', name: 'Nature-based (forestry, mangroves)', low: 10, high: 30, note: 'Check permanence, buffer pools and local-community terms.' },
  { id: 'removal', name: 'Engineered or biochar removals', low: 80, high: 250, note: 'Premium quality. Use for a small share if the board wants high integrity.' },
];

export const CHECKLIST = [
  'Report verified by an FRA-registered verifier',
  'Report filed with FRA (first deadline 31 Dec 2026)',
  'Credits issued under a standard listed on the FRA Climate Project Registry',
  'Credits bought on a regulated voluntary carbon market (EGCX)',
  'Purchase completed within 90 days of filing',
  'Retirement certificate stored with the evidence register',
  'Claim wording uses "offset" or "contribution", never "carbon neutral" without a reduction path',
];

export function creditsPlan({ capitalM, totalT, mix }) {
  const applies = capitalM >= FRA.thresholdM;
  const obligationT = applies ? Math.ceil(totalT * FRA.offsetShare) : 0;
  const m = mix || { avoid: 0.4, cookstove: 0.3, nature: 0.3, removal: 0 };
  const sum = Object.values(m).reduce((s, v) => s + v, 0) || 1;
  const lines = BANDS.map((b) => {
    const share = (m[b.id] || 0) / sum;
    const t = Math.round(obligationT * share);
    return { ...b, share: Math.round(share * 100) / 100, tonnes: t, costLow: Math.round(t * b.low), costHigh: Math.round(t * b.high) };
  });
  return {
    applies, thresholdM: FRA.thresholdM, capitalM, obligationT, offsetShare: FRA.offsetShare, daysAfterFiling: FRA.daysAfterFiling, firstDeadline: FRA.firstDeadline, decision: FRA.decision,
    lines, budgetUsd: { low: lines.reduce((s, l) => s + l.costLow, 0), high: lines.reduce((s, l) => s + l.costHigh, 0) }, checklist: CHECKLIST,
    caveats: ['Voluntary credits do not reduce CBAM certificate costs.', 'Offsets come after reductions. The FRA obligation is 20% of Scope 1+2 only.', 'Prices are indicative bands, confirm with EGCX before buying.'],
  };
}
