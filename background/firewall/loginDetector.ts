// Phase 5 M3 -- recognizes a login/signup form and tells the two apart.
// Deliberately a SEPARATE module from classifier.ts, not an extension of
// it: a password is never one of PersonalDataSchema's six field types, and
// must never flow through responseAvailability.ts's real/synthetic/
// nonsense/deny matrix, which doesn't apply to credentials at all.
// classifier.ts's classifyField() enforces this directly (a type="password"
// field, and a handful of other never-personal-data types, are excluded
// before any token match is even attempted) -- this module doesn't need
// to re-check that itself, since a field it's told about here never went
// through classification in the first place.
//
// This module's output isn't wired into any message yet -- that's M4/M5's
// job, once there's an actual capture/save/autofill flow to feed it into.
// If a future milestone needs this shape across the popup<->background
// message boundary, it moves into shared/messages.ts then, matching how
// ClassifiedField/ClassifiedForm made that same move in Phase 3.

import type { DetectedField, DetectedForm } from '../../shared/messages';
import { NON_SIGNAL_FIELD_TYPES, tokenize } from './classifier';

export type LoginFormKind = 'login' | 'signup';

export interface DetectedLoginForm {
  kind: LoginFormKind;
  // Index within DetectedForm.fields -- the SAME positional identity
  // shared/fieldKey.ts's getFieldKey() already relies on elsewhere in this
  // codebase, so a caller can locate the live DOM element the same way
  // content/autofill.ts already does for PersonalData fields. This
  // assumes the SAME, unfiltered fields array that produced these indexes
  // is also what a later lookup uses -- true of every producer today
  // (content/formDetection.ts's extractForms, classifier.ts's
  // classifyForm), but would silently break if a future step ever
  // filters/reorders fields between detection and lookup.
  //
  // Both indexes can legitimately be 0 -- a future caller MUST check
  // `!== null` (identifierFieldIndex) or use these as plain array
  // indexes, never a truthy check.
  passwordFieldIndex: number;
  // null when no paired username/email/phone field could be confidently
  // found -- still a valid password-bearing form, just without an
  // identified companion field.
  identifierFieldIndex: number | null;
}

const CONFIRM_PASSWORD_FALLBACK_MAX_FIELDS = 3;

function isPasswordField(field: DetectedField): boolean {
  return field.type === 'password';
}

// The `autocomplete` attribute is legitimately a space-separated token
// list per the WHATWG spec (e.g. "username webauthn", "section-login
// current-password") -- a plain `=== token` check would miss any field
// declaring more than one token. Lowercased before splitting: unlike
// `type` (DOM-normalized), content/formDetection.ts captures the RAW
// autocomplete attribute value, so real-world markup like
// autocomplete="New-Password" must still match. Deliberately NOT
// classifier.ts's tokenize() -- that splits on hyphens too, which would
// incorrectly break "current-password" into two separate tokens; this
// attribute's tokens are spec-defined as whitespace-separated, hyphens
// included, not classifier.ts's general-purpose word tokenizer.
function hasAutocompleteToken(field: DetectedField, token: string): boolean {
  return (field.autocomplete ?? '').toLowerCase().split(/\s+/).includes(token);
}

const IDENTIFIER_TYPE_CANDIDATES = new Set(['email', 'text', 'tel']);

function isPlausibleIdentifierField(field: DetectedField): boolean {
  return IDENTIFIER_TYPE_CANDIDATES.has(field.type ?? '');
}

// A handful of login-specific tokens, checked only as a last-resort
// fallback -- deliberately NOT classifier.ts's FIELD_SYNONYMS vocabulary
// (email/phone/name/address/etc.), which answers a different question
// ("what PersonalData does this field hold") than the one this module
// asks ("is this field the login identifier for the password next to
// it"). A field can be a login identifier without holding real personal
// data at all (e.g. a site-specific handle). Matched via classifier.ts's
// own tokenize() (word-boundary aware, not a raw substring check) --
// without it, e.g. id="museum" would wrongly match the "user" token as a
// mere substring (/code-review finding, Phase 5 M3).
const IDENTIFIER_NAME_TOKENS = ['user', 'username', 'login', 'identifier'];

function looksLikeIdentifierByToken(field: DetectedField): boolean {
  const tokens = tokenize(`${field.name ?? ''} ${field.id ?? ''}`);
  return IDENTIFIER_NAME_TOKENS.some((token) => tokens.has(token));
}

// Searches one direction's worth of (field, original index) pairs for a
// plausible identifier: autocomplete="username" first, then a field type
// candidate, then a login-specific name/id token. Password fields are
// excluded up front, before any tier runs -- a confirm-password field
// (e.g. Rails-style name="user[password_confirmation]") would otherwise
// match the token tier purely because its name contains "user"
// (/code-review finding, Phase 5 M3). Returns the ORIGINAL index directly
// rather than the field itself -- no indexOf/reference-equality lookup
// needed, which would silently mispair on two structurally-identical
// fields (/code-review finding).
function searchForIdentifier(candidates: { field: DetectedField; index: number }[]): number | null {
  const eligible = candidates.filter((c) => !isPasswordField(c.field));

  const byAutocomplete = eligible.find((c) => hasAutocompleteToken(c.field, 'username'));
  if (byAutocomplete) return byAutocomplete.index;

  const byType = eligible.find((c) => isPlausibleIdentifierField(c.field));
  if (byType) return byType.index;

  const byToken = eligible.find((c) => looksLikeIdentifierByToken(c.field));
  return byToken ? byToken.index : null;
}

// Preceding fields (in document order, nearest first) are checked before
// following fields -- "identifier field directly before the password" is
// the near-universal real-world layout; fields after the password are
// only consulted when nothing plausible precedes it at all.
function findIdentifierFieldIndex(
  fields: DetectedField[],
  passwordFieldIndex: number,
): number | null {
  const indexed = fields.map((field, index) => ({ field, index }));
  const preceding = indexed.slice(0, passwordFieldIndex).reverse();
  const following = indexed.slice(passwordFieldIndex + 1);
  return searchForIdentifier(preceding) ?? searchForIdentifier(following);
}

const SIGNUP_ACTION_TOKENS = new Set(['signup', 'register', 'createaccount', 'join']);
const LOGIN_ACTION_TOKENS = new Set(['login', 'signin', 'session']);

// Hyphens/underscores stripped before splitting -- "sign-up"/"sign_up"
// must fold to the single token "signup", not survive as one hyphenated
// token (classifier.ts's tokenize() splits on them, which is right for
// its own multi-word synonyms but wrong here) nor split into "sign"/"up"
// (which would make "sign" alone ambiguous between signup and signin).
// Exact token-set membership, never substring matching -- a raw
// `.includes('signin')` would false-positive on "/document-signing" or
// "/contracts/esigning" (/code-review finding, Phase 5 M3).
function tokenizeAction(action: string): Set<string> {
  return new Set(
    action
      .toLowerCase()
      .replace(/[-_]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

// The form's OWN action URL (where it submits to), not the page's URL --
// this module only ever sees one DetectedForm at a time, not the page it
// came from.
function classifyByAction(action: string | null): LoginFormKind | null {
  if (!action) return null;
  const tokens = tokenizeAction(action);
  if ([...SIGNUP_ACTION_TOKENS].some((t) => tokens.has(t))) return 'signup';
  if ([...LOGIN_ACTION_TOKENS].some((t) => tokens.has(t))) return 'login';
  return null;
}

// Priority order confirmed with the user: (1) the standardized
// autocomplete="current-password"/"new-password" tokens -- the same
// signal browsers' own built-in password managers key off of; (2) a
// second password field (a "confirm password" box), when autocomplete
// isn't declared; (3) the form's action URL, then field count, as a last,
// low-confidence resort.
//
// The >=2-password check runs BEFORE the lone current-password check
// (not after, as an earlier version of this function had it) --
// otherwise a real change-password form (current password + a new
// password box that itself never got tagged new-password, a common
// real-world omission) would match on autocomplete="current-password"
// alone and resolve to 'login', when capturing a new password to save is
// exactly the 'signup' behavior this module exists to trigger.
//
// Known, accepted limitation: two password fields with NO autocomplete
// hints at all are always read as a confirm-password pair (-> signup).
// A step-up/reauthentication form asking for two genuinely different
// secrets (e.g. a password plus a separate transaction PIN, both
// type="password", neither autocompleted) is indistinguishable from a
// signup form under a purely structural heuristic -- there is no
// available signal to tell them apart without page semantics this module
// doesn't have. Rare enough in practice not to block this milestone on.
function classifyKind(form: DetectedForm, passwordFields: DetectedField[]): LoginFormKind {
  if (passwordFields.some((f) => hasAutocompleteToken(f, 'new-password'))) return 'signup';
  if (passwordFields.length >= 2) return 'signup';
  if (passwordFields.some((f) => hasAutocompleteToken(f, 'current-password'))) return 'login';

  const byAction = classifyByAction(form.action);
  if (byAction) return byAction;

  // Last resort: a lean form (identifier + password, maybe a "remember me"
  // checkbox) reads as login; extra fields beyond that read as signup
  // collecting a fuller profile. NON_SIGNAL_FIELD_TYPES (shared with
  // classifier.ts) are excluded so a hidden CSRF token doesn't push an
  // otherwise-minimal login form over the threshold -- the password field
  // itself is NOT excluded here (unlike classifier.ts's own use of this
  // set), since it's a real, meaningful field for this specific count.
  // Low-confidence by design -- this branch only runs when none of the
  // stronger signals above said anything.
  const signalFieldCount = form.fields.filter(
    (f) => !NON_SIGNAL_FIELD_TYPES.has(f.type ?? ''),
  ).length;
  return signalFieldCount > CONFIRM_PASSWORD_FALLBACK_MAX_FIELDS ? 'signup' : 'login';
}

// null when the form has no password field at all -- not a login/signup
// form by definition, and none of this module's job. findIndex/filter,
// not an index-collect-then-remap -- both return values TypeScript
// already knows are safe (a plain number, a plain array), unlike indexing
// form.fields[i] again by hand under noUncheckedIndexedAccess.
export function detectLoginForm(form: DetectedForm): DetectedLoginForm | null {
  const passwordFieldIndex = form.fields.findIndex(isPasswordField);
  if (passwordFieldIndex === -1) return null;

  const passwordFields = form.fields.filter(isPasswordField);

  return {
    kind: classifyKind(form, passwordFields),
    passwordFieldIndex,
    identifierFieldIndex: findIdentifierFieldIndex(form.fields, passwordFieldIndex),
  };
}
