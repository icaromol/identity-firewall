import { describe, expect, it } from 'vitest';
import type { PrivacyLedgerEntry } from '../../../../shared/vault-schema';
import { summarizeLedgerEntries } from '../../../../stores/shared/ledgerSummary';

describe('summarizeLedgerEntries', () => {
  it('returns empty results and a null lastAccess for no entries', () => {
    expect(summarizeLedgerEntries([])).toEqual({
      disclosed: new Map(),
      denied: new Set(),
      lastAccess: null,
    });
  });

  it('a later denial clears an earlier disclosure of the same field', () => {
    const entries: PrivacyLedgerEntry[] = [
      {
        origin: 'https://example.com',
        at: 1000,
        requestedFields: ['email'],
        disclosedFields: { email: 'real' },
        deniedFields: [],
        authorizationMethod: null,
      },
      {
        origin: 'https://example.com',
        at: 2000,
        requestedFields: ['email'],
        disclosedFields: {},
        deniedFields: ['email'],
        authorizationMethod: null,
      },
    ];

    const result = summarizeLedgerEntries(entries);

    expect(result.disclosed.size).toBe(0);
    expect(result.denied.has('email')).toBe(true);
    expect(result.lastAccess).toBe(2000);
  });

  it('a later disclosure clears an earlier denial of the same field', () => {
    const entries: PrivacyLedgerEntry[] = [
      {
        origin: 'https://example.com',
        at: 1000,
        requestedFields: ['phone'],
        disclosedFields: {},
        deniedFields: ['phone'],
        authorizationMethod: null,
      },
      {
        origin: 'https://example.com',
        at: 2000,
        requestedFields: ['phone'],
        disclosedFields: { phone: 'synthetic' },
        deniedFields: [],
        authorizationMethod: null,
      },
    ];

    const result = summarizeLedgerEntries(entries);

    expect(result.denied.size).toBe(0);
    expect(result.disclosed.get('phone')).toBe('synthetic');
    expect(result.lastAccess).toBe(2000);
  });
});
