// Reduction levers. The ENGINE computes every number; AI (when available) only writes the wording around them.
// Percentages are planning assumptions, not guarantees. Each lever says what it acts on and what proof is needed.
export const LEVERS = [
  { id: 'led', name: 'LED lighting and controls', acts: ['elec'], pct: 0.08, cost: 'low', payback: '1-3 yrs', effort: 'easy', proof: 'Supplier invoices and before/after meter readings' },
  { id: 'hvac', name: 'Efficient cooling and HVAC set-points', acts: ['elec'], pct: 0.10, cost: 'medium', payback: '2-4 yrs', effort: 'medium', proof: 'Sub-meter data and service records' },
  { id: 'solar', name: 'On-site rooftop solar (PV)', acts: ['elec'], pct: 0.25, cost: 'high', payback: '4-6 yrs', effort: 'hard', proof: 'Inverter generation logs; keep certificates (do not double count)' },
  { id: 'ppa', name: 'Renewable electricity contract or certificates', acts: ['elec'], pct: 0.40, cost: 'medium', payback: 'n/a', effort: 'medium', proof: 'Certificate or contract; counts in market-based Scope 2 only', marketOnly: true },
  { id: 'fleet', name: 'Fleet routing, driver training, and EV pilots', acts: ['diesel', 'petrol'], pct: 0.12, cost: 'medium', payback: '2-5 yrs', effort: 'medium', proof: 'Fuel card data and trip logs' },
  { id: 'genset', name: 'Cut generator hours (grid or solar backup)', acts: ['diesel'], pct: 0.20, cost: 'medium', payback: '2-4 yrs', effort: 'medium', proof: 'Generator run-hour logs and fuel purchases' },
  { id: 'boiler', name: 'Boiler tune-up and heat recovery', acts: ['gas', 'lpg'], pct: 0.10, cost: 'low', payback: '1-3 yrs', effort: 'easy', proof: 'Service report and gas bills' },
  { id: 'refrig', name: 'Refrigerant leak detection and low-GWP replacement', acts: ['r134a', 'r32', 'r410a', 'r407c', 'r404a'], pct: 0.30, cost: 'medium', payback: 'n/a', effort: 'medium', proof: 'Technician top-up records' },
  { id: 'travel', name: 'Travel policy: virtual first, fewer flights', acts: ['air'], pct: 0.25, cost: 'low', payback: 'immediate', effort: 'easy', proof: 'Travel agent report' },
  { id: 'commute', name: 'Staff shuttle, remote days, and transit support', acts: ['comm'], pct: 0.15, cost: 'low', payback: 'immediate', effort: 'easy', proof: 'Annual staff commute survey' },
  { id: 'waste', name: 'Waste segregation and recycling', acts: ['waste'], pct: 0.30, cost: 'low', payback: '1-2 yrs', effort: 'easy', proof: 'Waste contractor weight tickets' },
];

/** byFactor: { key: tCO2e for the year }. Returns levers ranked by tonnes saved, with a simple total that avoids double counting. */
export function rankLevers(byFactor, scopeOf) {
  const out = [];
  for (const l of LEVERS) {
    const base = l.acts.reduce((s, k) => s + (byFactor[k] || 0), 0);
    if (base <= 0) continue;
    const t = base * l.pct;
    out.push({ ...l, baseT: round(base), savingT: round(t), scope: Math.min(...l.acts.map((k) => scopeOf[k] || 3)) });
  }
  // levers on the same activity overlap: apply them one after another on the shrinking base
  const left = { ...byFactor };
  const ordered = out.sort((a, b) => (a.marketOnly ? 1 : 0) - (b.marketOnly ? 1 : 0) || b.savingT - a.savingT);
  for (const l of ordered) {
    const base = l.acts.reduce((s, k) => s + (left[k] || 0), 0);
    l.realSavingT = round(base * l.pct);
    for (const k of l.acts) left[k] = (left[k] || 0) * (1 - l.pct);
  }
  return ordered;
}
export const round = (n) => Math.round(n * 10) / 10;
