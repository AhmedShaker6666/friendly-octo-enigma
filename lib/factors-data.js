// Illustrative placeholder factors. Replace each with a published, dated source before real reporting.
const U = (o) => o;
export default [
  { key: 'gas', name: 'Natural gas for boilers and process heat', scope: 1, category: 'Stationary combustion', units: U({ 'm³': 1, 'kWh (gross CV)': 0.0963, 'MWh (gross CV)': 96.3 }), base_unit: 'm³', co2: 2.0, ch4: 0.0004, n2o: 0.00004, year: 2024, geo: 'Global default' },
  { key: 'diesel', name: 'Diesel for fleet and generators', scope: 1, category: 'Combustion', units: U({ L: 1, 'US gal': 3.785 }), base_unit: 'L', co2: 2.66, ch4: 0.00011, n2o: 0.00012, year: 2024, geo: 'Global default' },
  { key: 'petrol', name: 'Petrol for fleet', scope: 1, category: 'Mobile combustion', units: U({ L: 1, 'US gal': 3.785 }), base_unit: 'L', co2: 2.28, ch4: 0.0002, n2o: 0.00015, year: 2024, geo: 'Global default' },
  { key: 'lpg', name: 'LPG', scope: 1, category: 'Stationary combustion', units: U({ kg: 1, L: 0.51, tonne: 1000 }), base_unit: 'kg', co2: 2.94, ch4: 0.0001, n2o: 0.00002, year: 2024, geo: 'Global default' },
  { key: 'r134a', name: 'Refrigerant leak: HFC-134a', scope: 1, category: 'Fugitive emissions', units: U({ kg: 1 }), base_unit: 'kg', gwp: 1530, year: 2021, geo: 'IPCC AR6' },
  { key: 'r32', name: 'Refrigerant leak: R-32', scope: 1, category: 'Fugitive emissions', units: U({ kg: 1 }), base_unit: 'kg', gwp: 771, year: 2021, geo: 'IPCC AR6' },
  { key: 'r410a', name: 'Refrigerant leak: R-410A', scope: 1, category: 'Fugitive emissions', units: U({ kg: 1 }), base_unit: 'kg', gwp: 2256, year: 2021, geo: 'IPCC AR6 blend' },
  { key: 'r407c', name: 'Refrigerant leak: R-407C', scope: 1, category: 'Fugitive emissions', units: U({ kg: 1 }), base_unit: 'kg', gwp: 1908, year: 2021, geo: 'IPCC AR6 blend' },
  { key: 'r404a', name: 'Refrigerant leak: R-404A', scope: 1, category: 'Fugitive emissions', units: U({ kg: 1 }), base_unit: 'kg', gwp: 4728, year: 2021, geo: 'IPCC AR6 blend' },
  { key: 'elec', name: 'Purchased electricity', scope: 2, category: 'Electricity', units: U({ kWh: 1, MWh: 1000 }), base_unit: 'kWh', loc: 0.479, resid: 0.52, year: 2024, geo: 'Egypt grid (illustrative)' },
  { key: 'steam', name: 'Purchased steam or heat', scope: 2, category: 'Steam and heat', units: U({ kWh: 1, MWh: 1000, GJ: 277.8 }), base_unit: 'kWh', loc: 0.2, resid: 0.2, year: 2024, geo: 'Global default' },
  { key: 'cool', name: 'Purchased cooling', scope: 2, category: 'Cooling', units: U({ kWh: 1, MWh: 1000 }), base_unit: 'kWh', loc: 0.15, resid: 0.15, year: 2024, geo: 'Global default' },
  { key: 'air', name: 'Business travel by air', scope: 3, category: 'Cat 6 Business travel', units: U({ 'passenger-km': 1 }), base_unit: 'passenger-km', co2e: 0.15, year: 2024, geo: 'Global default' },
  { key: 'comm', name: 'Employee commuting', scope: 3, category: 'Cat 7 Commuting', units: U({ 'passenger-km': 1 }), base_unit: 'passenger-km', co2e: 0.12, year: 2024, geo: 'Global default' },
  { key: 'goods', name: 'Purchased goods and services (spend)', scope: 3, category: 'Cat 1 Purchased goods', units: U({ EGP: 1, 'EGP thousand': 1000 }), base_unit: 'EGP', co2e: 0.008, year: 2023, geo: 'Spend-based (illustrative)' },
  { key: 'freight', name: 'Upstream transport and distribution', scope: 3, category: 'Cat 4 Upstream transport', units: U({ 'tonne-km': 1 }), base_unit: 'tonne-km', co2e: 0.1, year: 2024, geo: 'Global default' },
  { key: 'waste', name: 'Waste generated in operations', scope: 3, category: 'Cat 5 Waste', units: U({ kg: 1, tonne: 1000 }), base_unit: 'kg', co2e: 0.5, year: 2024, geo: 'Global default' }
];
