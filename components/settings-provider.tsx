'use client'

import { createContext, useContext, type ReactNode } from 'react'

export type AppSettings = { companyName: string; companyShortName: string; country: string; currency: string; address: string; phone: string; email: string }

const SettingsContext = createContext<AppSettings | null>(null)

export function SettingsProvider({ value, children }: { value: AppSettings; children: ReactNode }) {
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

/** Live branding (company name, country, currency) — set from the Paramètres page, server-fetched
 * on every page load. Prefer this over the static `companyInfo`/`businessConfig` imports in any
 * client component that displays them. */
export function useSettings(): AppSettings {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider')
  return ctx
}
