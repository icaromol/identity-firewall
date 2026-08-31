import { describe, expect, it } from 'vitest';
import { classifyField, classifyForm } from '../../../../background/firewall/classifier';
import type { DetectedField, DetectedForm } from '../../../../shared/messages';

function field(overrides: Partial<DetectedField> = {}): DetectedField {
  return {
    tagName: 'input',
    type: 'text',
    name: null,
    id: null,
    required: false,
    autocomplete: null,
    ...overrides,
  };
}

describe('classifyField', () => {
  it('classifies input[type=email] as email, private sensitivity', () => {
    const result = classifyField(field({ type: 'email' }));
    expect(result.fieldType).toBe('email');
    expect(result.sensitivity).toBe('private');
  });

  it('classifies input[type=tel] as phone, sensitive sensitivity', () => {
    const result = classifyField(field({ type: 'tel' }));
    expect(result.fieldType).toBe('phone');
    expect(result.sensitivity).toBe('sensitive');
  });

  it('classifies autocomplete="bday" as birthDate', () => {
    const result = classifyField(field({ autocomplete: 'bday' }));
    expect(result.fieldType).toBe('birthDate');
    expect(result.sensitivity).toBe('sensitive');
  });

  it('classifies autocomplete="street-address" as address', () => {
    const result = classifyField(field({ autocomplete: 'street-address' }));
    expect(result.fieldType).toBe('address');
  });

  it('classifies autocomplete="given-name" as name (first/last split folds onto one field)', () => {
    const result = classifyField(field({ autocomplete: 'given-name' }));
    expect(result.fieldType).toBe('name');
  });

  it('falls back to a name/id regex when type and autocomplete give no signal: id="cpf" -> nationalId, highlySensitive', () => {
    const result = classifyField(field({ id: 'cpf' }));
    expect(result.fieldType).toBe('nationalId');
    expect(result.sensitivity).toBe('highlySensitive');
  });

  it('matches Portuguese synonyms with diacritics: name="endereço" -> address', () => {
    const result = classifyField(field({ name: 'endereço' }));
    expect(result.fieldType).toBe('address');
  });

  it('matches Portuguese synonym "telefone" -> phone', () => {
    const result = classifyField(field({ name: 'telefone' }));
    expect(result.fieldType).toBe('phone');
  });

  it('matches "full_name" (separator-split tokens) -> name', () => {
    const result = classifyField(field({ id: 'full_name' }));
    expect(result.fieldType).toBe('name');
  });

  it('does NOT misclassify "username" as name (no false substring match)', () => {
    const result = classifyField(field({ name: 'username' }));
    expect(result.fieldType).toBeNull();
    expect(result.sensitivity).toBeNull();
  });

  it('never classifies a password field, even when its name/id contains a synonym token (/code-review regression guard, Phase 5 M3)', () => {
    const result = classifyField(field({ type: 'password', id: 'reset_password_email' }));
    expect(result.fieldType).toBeNull();
    expect(result.sensitivity).toBeNull();
  });

  it.each(['hidden', 'submit', 'button', 'reset', 'image', 'file'])(
    'never classifies a type=%s field, even when its name/id contains a synonym token (/code-review regression guard, Phase 5 M3)',
    (type) => {
      const result = classifyField(field({ type, id: 'address_proof' }));
      expect(result.fieldType).toBeNull();
      expect(result.sensitivity).toBeNull();
    },
  );

  it('classifies an unrecognized field as null fieldType and null sensitivity', () => {
    const result = classifyField(field({ tagName: 'textarea', type: null, name: 'message' }));
    expect(result.fieldType).toBeNull();
    expect(result.sensitivity).toBeNull();
  });

  it('passes apparentlyRequired through directly from the raw required attribute', () => {
    expect(classifyField(field({ required: true })).apparentlyRequired).toBe(true);
    expect(classifyField(field({ required: false })).apparentlyRequired).toBe(false);
  });

  it('prioritizes input[type] over a conflicting name/id token', () => {
    // type=email wins even though the id would otherwise suggest phone.
    const result = classifyField(field({ type: 'email', id: 'telefone' }));
    expect(result.fieldType).toBe('email');
  });
});

describe('classifyForm', () => {
  it('classifies every field and preserves formIndex/action/method', () => {
    const form: DetectedForm = {
      formIndex: 2,
      action: '/signup',
      method: 'post',
      fields: [field({ type: 'email' }), field({ id: 'cpf' })],
    };

    const result = classifyForm(form);
    expect(result.formIndex).toBe(2);
    expect(result.action).toBe('/signup');
    expect(result.method).toBe('post');
    expect(result.fields.map((f) => f.fieldType)).toEqual(['email', 'nationalId']);
  });
});
