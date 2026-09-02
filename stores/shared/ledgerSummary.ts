// Shared by entrypoints/popup/App.vue's single-origin "What this site knows
// about you" section and entrypoints/options/App.vue's all-sites "Who
// knows what about me" tab -- both aggregate a list of PrivacyLedgerEntry
// into the same per-service summary privacy-model.md's own mockup shows
// ("Disclosed: ✓ Email, ✓ Username / Denied: ✕ Name..."), not the raw
// per-event list. A field can appear in both a disclosed and a later
// denied entry (the user changed their mind between visits); the MOST
// RECENT entry touching that field wins, matching "what does this site
// currently have," not a full history of every past decision. Originally
// duplicated between the two components (a /code-review finding, Phase 6)
// -- extracted here so a future change to this semantics only needs to
// happen once.

import type {
  PersonalDataFieldName,
  PrivacyLedgerEntry,
  ResponseType,
} from '../../shared/vault-schema';

export interface LedgerSummary {
  disclosed: Map<PersonalDataFieldName, ResponseType>;
  denied: Set<PersonalDataFieldName>;
  lastAccess: number | null;
}

export function summarizeLedgerEntries(entries: PrivacyLedgerEntry[]): LedgerSummary {
  const disclosed = new Map<PersonalDataFieldName, ResponseType>();
  const denied = new Set<PersonalDataFieldName>();
  let lastAccess: number | null = null;

  for (const entry of entries) {
    lastAccess = lastAccess === null ? entry.at : Math.max(lastAccess, entry.at);
    for (const field of entry.deniedFields) {
      denied.add(field);
      disclosed.delete(field);
    }
    for (const [field, responseType] of Object.entries(entry.disclosedFields) as [
      PersonalDataFieldName,
      ResponseType,
    ][]) {
      disclosed.set(field, responseType);
      denied.delete(field);
    }
  }

  return { disclosed, denied, lastAccess };
}
