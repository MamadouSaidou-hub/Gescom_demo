/**
 * Countries offered when configuring a workspace, with the currency normally used there.
 *
 * FCFA is the common screen label for both the UEMOA (XOF) and CEMAC (XAF) francs — intentionally
 * not the ISO code, per the team's call that "XOF" would confuse clients who only know "FCFA".
 *
 * Deliberately a short list of the markets actually targeted rather than every country in the
 * world: anything missing is handled by the "Autre" option, which lets the country and currency
 * be typed in freely.
 */
export const COUNTRY_OPTIONS = [
  { name: 'Guinée', currency: 'GNF' },
  { name: 'Sénégal', currency: 'FCFA' },
  { name: 'Côte d’Ivoire', currency: 'FCFA' },
  { name: 'Mali', currency: 'FCFA' },
  { name: 'Burkina Faso', currency: 'FCFA' },
  { name: 'Bénin', currency: 'FCFA' },
  { name: 'Togo', currency: 'FCFA' },
  { name: 'Niger', currency: 'FCFA' },
  { name: 'Guinée-Bissau', currency: 'FCFA' },
  { name: 'Cameroun', currency: 'FCFA' },
  { name: 'Gabon', currency: 'FCFA' },
  { name: 'Tchad', currency: 'FCFA' },
  { name: 'Congo', currency: 'FCFA' },
  { name: 'Mauritanie', currency: 'MRU' },
  { name: 'Djibouti', currency: 'DJF' },
] as const

export const OTHER_COUNTRY = 'Autre'

export function currencyForCountry(country: string): string | null {
  return COUNTRY_OPTIONS.find((option) => option.name === country)?.currency ?? null
}

export function isKnownCountry(country: string): boolean {
  return COUNTRY_OPTIONS.some((option) => option.name === country)
}
