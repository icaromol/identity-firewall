// Phase 3's Field Classifier -- maps a Phase 1 DetectedField's raw
// structural attributes onto one of PersonalDataSchema's six known
// fields, or null when nothing matches. See
// docs/plans/phase-3-identity-firewall.md's "Key design decisions" for
// why the heuristic is scoped the way it is (three-tier priority,
// English+Portuguese synonyms, exactly six field types, apparentlyRequired
// as a direct passthrough).
//
// A field this can't confidently classify is left entirely alone by the
// rest of the Firewall -- not blocked, not asked about -- since there is
// no vault data model for it and mis-blocking an arbitrary comment/company/
// country field would break ordinary site functionality.

import type { DetectedField, DetectedForm } from '../../shared/messages';
import type { PersonalData, SensitivityLevel } from '../../shared/vault-schema';
import { PERSONAL_DATA_FIELD_SENSITIVITY } from '../../shared/vault-schema';

export interface ClassifiedField extends DetectedField {
  fieldType: keyof PersonalData | null;
  sensitivity: SensitivityLevel | null;
  apparentlyRequired: boolean;
}

export interface ClassifiedForm {
  formIndex: number;
  action: string | null;
  method: string | null;
  fields: ClassifiedField[];
}

// Known first/last-name split forms (autocomplete="given-name"/"family-name")
// both fold onto the single 'name' field, same as PersonalDataSchema itself
// only ever stores one combined name string -- a known, documented
// simplification, not an oversight: filling both boxes with the same full
// name is the best this data model can do without a first/last-name split
// of its own.
const FIELD_SYNONYMS: Record<keyof PersonalData, string[]> = {
  // 'mail', not 'e-mail' -- the tokenizer splits on any non-alphanumeric
  // character, so a literal hyphenated synonym could never match a token.
  email: ['email', 'mail'],
  phone: ['phone', 'tel', 'telefone', 'celular', 'mobile'],
  nationalId: ['cpf', 'documento', 'nationalid'],
  name: ['name', 'nome', 'givenname', 'familyname', 'fullname'],
  address: ['address', 'endereco', 'streetaddress', 'addressline1'],
  birthDate: ['birthdate', 'birthday', 'bday', 'nascimento', 'dob'],
};

// Priority order for the token-matching pass -- only matters when a
// haystack coincidentally contains synonyms for more than one field type,
// which the chosen vocabularies make unlikely in practice.
const FIELD_TYPE_PRIORITY: (keyof PersonalData)[] = [
  'email',
  'phone',
  'nationalId',
  'name',
  'address',
  'birthDate',
];

// Strips diacritics (NFD-decompose, drop combining marks) so 'endereço'
// tokenizes identically to 'endereco' -- Portuguese matters here because
// PersonalData's own nationalId field is explicitly a Brazilian identifier
// (CPF), so real-world forms this needs to handle skew Brazilian.
// U+0300-U+036F is the Unicode "Combining Diacritical Marks" block --
// written as explicit code-point arithmetic, not a regex literal, since a
// literal combining character sitting directly in source is visually
// indistinguishable from plain text and easy to mis-copy.
const COMBINING_MARK_RANGE_START = 0x0300;
const COMBINING_MARK_RANGE_END = 0x036f;

function tokenize(raw: string): Set<string> {
  const stripped = Array.from(raw.normalize('NFD'))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < COMBINING_MARK_RANGE_START || code > COMBINING_MARK_RANGE_END;
    })
    .join('');
  const normalized = stripped.toLowerCase();
  return new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
}

function classifyByTokens(field: DetectedField): keyof PersonalData | null {
  const haystack = [field.autocomplete, field.name, field.id].filter(Boolean).join(' ');
  const tokens = tokenize(haystack);

  for (const fieldType of FIELD_TYPE_PRIORITY) {
    if (FIELD_SYNONYMS[fieldType].some((synonym) => tokens.has(synonym))) {
      return fieldType;
    }
  }
  return null;
}

export function classifyField(field: DetectedField): ClassifiedField {
  // input[type] is the strongest, least ambiguous signal available where
  // it exists at all -- checked first, ahead of any token matching.
  let fieldType: keyof PersonalData | null = null;
  if (field.type === 'email') fieldType = 'email';
  else if (field.type === 'tel') fieldType = 'phone';
  else fieldType = classifyByTokens(field);

  return {
    ...field,
    fieldType,
    sensitivity: fieldType ? PERSONAL_DATA_FIELD_SENSITIVITY[fieldType] : null,
    apparentlyRequired: field.required,
  };
}

export function classifyForm(form: DetectedForm): ClassifiedForm {
  return {
    formIndex: form.formIndex,
    action: form.action,
    method: form.method,
    fields: form.fields.map(classifyField),
  };
}
