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

import type {
  ClassifiedField,
  ClassifiedForm,
  DetectedField,
  DetectedForm,
} from '../../shared/messages';
import type { PersonalData } from '../../shared/vault-schema';
import { PERSONAL_DATA_FIELD_SENSITIVITY } from '../../shared/vault-schema';

export type { ClassifiedField, ClassifiedForm };

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

// Exported for loginDetector.ts's own identifier-token matching (Phase 5
// M3) -- the same word-boundary-aware tokenization this file already
// relies on for FIELD_SYNONYMS, reused with a different vocabulary rather
// than reimplemented with a weaker (substring-based) mechanism.
export function tokenize(raw: string): Set<string> {
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

// Input types that can never hold a meaningful PersonalData string value,
// no matter what their name/id happens to contain -- a hidden CSRF token,
// a submit/reset/image button, or a file picker doesn't carry personal
// data just because its id happens to be e.g. "email_hash" or
// "address_proof". Exported and shared with loginDetector.ts's own
// field-count fallback (which independently needs "types that are never a
// meaningful signal" for a related but distinct reason) so the two
// definitions can't drift apart (/code-review finding, Phase 5 M3).
// 'password' is handled as its own, separate case in classifyField below,
// not folded into this set -- loginDetector.ts's field-count heuristic
// DOES want a password field to count as real signal, unlike these.
export const NON_SIGNAL_FIELD_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  'file',
]);

export function classifyField(field: DetectedField): ClassifiedField {
  // input[type] is the strongest, least ambiguous signal available where
  // it exists at all -- checked first, ahead of any token matching.
  //
  // password and NON_SIGNAL_FIELD_TYPES are excluded before any token
  // match is even attempted (/code-review finding, Phase 5 M3): without
  // this, e.g. a password field whose name/id happens to contain a
  // PersonalData synonym token (id="reset_password_email") could get
  // assigned a real fieldType and flow straight into the Policy Engine's
  // auto-apply path -- silently auto-filling a real PersonalData value (a
  // genuine email, say) into a <input type="password"> element, or into a
  // hidden field the user never even saw. This is the actual enforcement
  // background/firewall/loginDetector.ts's own header comment refers to.
  let fieldType: keyof PersonalData | null = null;
  if (
    field.type === 'password' ||
    (field.type !== null && NON_SIGNAL_FIELD_TYPES.has(field.type))
  ) {
    fieldType = null;
  } else if (field.type === 'email') {
    fieldType = 'email';
  } else if (field.type === 'tel') {
    fieldType = 'phone';
  } else {
    fieldType = classifyByTokens(field);
  }

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
