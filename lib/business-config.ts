// `currency` is mutated in place by lib/settings-cache.ts once the demo's runtime settings are
// loaded from the database — this is just the default shown before that first load, or if it fails.
export const businessConfig = {
  currency: 'GNF',
  unit: {
    baseSingular: 'Sac',
    basePlural: 'Sacs',
    baseSingularLower: 'sac',
    basePluralLower: 'sacs',
    bulkLabel: 'Tonne',
    bulkConversionFactor: 1000,
  },
}
