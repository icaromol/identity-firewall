import { describe, expect, it } from 'vitest';
import { computeAutoApply } from '../../../../background/policy/autoApply';
import type { ClassifiedForm } from '../../../../shared/messages';
import type { PersonalData, PolicyRule } from '../../../../shared/vault-schema';

function form(fields: ClassifiedForm['fields']): ClassifiedForm {
  return { formIndex: 0, action: null, method: null, fields };
}

function field(
  fieldType: ClassifiedForm['fields'][number]['fieldType'],
  overrides: Partial<ClassifiedForm['fields'][number]> = {},
): ClassifiedForm['fields'][number] {
  return {
    tagName: 'input',
    type: 'text',
    name: fieldType,
    id: null,
    required: true,
    autocomplete: null,
    fieldType,
    sensitivity: fieldType ? 'private' : null,
    apparentlyRequired: true,
    ...overrides,
  };
}

const baseContext = {
  policies: [] as PolicyRule[],
  personalData: {} as PersonalData,
  isHighTrustOrigin: false,
  aliasProviderConfigured: false,
};

describe('computeAutoApply', () => {
  it('is not fullyResolved when the only recognized field falls back to the "ask" baseline', () => {
    const result = computeAutoApply('https://example.com', form([field('name')]), baseContext);
    expect(result.fullyResolved).toBe(false);
    expect(result.askCount).toBe(1);
  });

  it('an apparently-optional recognized field with no policy is fully auto-denied, not asked', () => {
    // name's fieldType baseline is 'ask', but "optional fields are blocked
    // by default" wins when the field instance itself is optional.
    const result = computeAutoApply(
      'https://example.com',
      form([field('name', { required: false, apparentlyRequired: false })]),
      baseContext,
    );
    expect(result.fullyResolved).toBe(true);
    expect(result.deniedFields).toEqual(['name']);
  });

  it('is not fullyResolved when a form has no recognized fields at all', () => {
    const result = computeAutoApply(
      'https://example.com',
      form([field(null, { name: 'message', sensitivity: null, apparentlyRequired: false })]),
      baseContext,
    );
    expect(result.fullyResolved).toBe(false);
    expect(result.askCount).toBe(0);
  });

  it('fully resolves via the baseline alone when the only recognized field defaults to "deny"', () => {
    // phone's PERSONAL_DATA_FIELD_DEFAULT_ACTION baseline is 'deny' with
    // no policy needed at all -- privacy-model.md's own example rule.
    const result = computeAutoApply('https://example.com', form([field('phone')]), baseContext);

    expect(result.fullyResolved).toBe(true);
    expect(result.deniedFields).toEqual(['phone']);
    expect(result.disclosedFields).toEqual({});
  });

  it('discloses a field with a global "real" policy when PersonalData has a value', () => {
    const context = {
      ...baseContext,
      policies: [
        { scope: { kind: 'global' as const }, fieldType: 'name' as const, action: 'real' as const },
      ],
      personalData: { name: 'Ícaro' } as PersonalData,
    };
    const result = computeAutoApply('https://example.com', form([field('name')]), context);

    expect(result.fullyResolved).toBe(true);
    expect(result.disclosedFields).toEqual({ name: 'real' });
    expect(Object.values(result.values)).toEqual(['Ícaro']);
  });

  it('treats a "real" policy with nothing on file as denied, not as a crash', () => {
    const context = {
      ...baseContext,
      policies: [
        { scope: { kind: 'global' as const }, fieldType: 'name' as const, action: 'real' as const },
      ],
      personalData: {} as PersonalData, // no name set
    };
    const result = computeAutoApply('https://example.com', form([field('name')]), context);

    expect(result.fullyResolved).toBe(true);
    expect(result.deniedFields).toEqual(['name']);
    expect(result.disclosedFields).toEqual({});
  });

  it('is not fullyResolved when even one recognized field still needs "ask"', () => {
    const context = {
      ...baseContext,
      policies: [
        {
          scope: { kind: 'global' as const },
          fieldType: 'phone' as const,
          action: 'deny' as const,
        },
        // name has no rule -> baseline 'ask'
      ],
    };
    const result = computeAutoApply(
      'https://example.com',
      form([field('phone'), field('name')]),
      context,
    );

    expect(result.fullyResolved).toBe(false);
    expect(result.askCount).toBe(1);
  });

  it('a global "real" rule for nationalId is clamped to "ask" via resolvePolicy, so the form is not fullyResolved', () => {
    const context = {
      ...baseContext,
      policies: [
        {
          scope: { kind: 'global' as const },
          fieldType: 'nationalId' as const,
          action: 'real' as const,
        },
      ],
      personalData: { nationalId: '123.456.789-00' } as PersonalData,
    };
    const result = computeAutoApply('https://example.com', form([field('nationalId')]), context);

    expect(result.fullyResolved).toBe(false);
    expect(result.askCount).toBe(1);
  });

  it('high-trust safe mode forces every field to "ask", overriding a matching policy', () => {
    const context = {
      ...baseContext,
      policies: [
        {
          scope: { kind: 'global' as const },
          fieldType: 'phone' as const,
          action: 'deny' as const,
        },
      ],
      isHighTrustOrigin: true,
    };
    const result = computeAutoApply('https://gov.example', form([field('phone')]), context);

    expect(result.fullyResolved).toBe(false);
    expect(result.askCount).toBe(1);
  });
});
