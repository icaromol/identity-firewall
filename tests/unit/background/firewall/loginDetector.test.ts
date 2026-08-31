import { describe, expect, it } from 'vitest';
import { detectLoginForm } from '../../../../background/firewall/loginDetector';
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

function form(fields: DetectedField[], action: string | null = null): DetectedForm {
  return { formIndex: 0, action, method: null, fields };
}

describe('detectLoginForm', () => {
  it('returns null when the form has no password field', () => {
    expect(detectLoginForm(form([field({ type: 'email' }), field({ type: 'text' })]))).toBeNull();
  });

  it('classifies autocomplete="current-password" as login', () => {
    const result = detectLoginForm(
      form([
        field({ type: 'email', autocomplete: 'username' }),
        field({ type: 'password', autocomplete: 'current-password' }),
      ]),
    );
    expect(result?.kind).toBe('login');
    expect(result?.passwordFieldIndex).toBe(1);
    expect(result?.identifierFieldIndex).toBe(0);
  });

  it('classifies autocomplete="new-password" as signup', () => {
    const result = detectLoginForm(
      form([
        field({ type: 'email', autocomplete: 'username' }),
        field({ type: 'password', autocomplete: 'new-password' }),
      ]),
    );
    expect(result?.kind).toBe('signup');
  });

  it('handles a multi-token autocomplete value (WebAuthn conditional UI convention)', () => {
    const result = detectLoginForm(
      form([
        field({ type: 'email', autocomplete: 'username webauthn' }),
        field({ type: 'password', autocomplete: 'current-password' }),
      ]),
    );
    expect(result?.identifierFieldIndex).toBe(0);
  });

  it('resolves a mixed current+new-password (change-password) form to signup', () => {
    const result = detectLoginForm(
      form([
        field({ type: 'password', autocomplete: 'current-password' }),
        field({ type: 'password', autocomplete: 'new-password' }),
      ]),
    );
    expect(result?.kind).toBe('signup');
  });

  it('resolves current-password + an UNLABELED second password field to signup, not login', () => {
    // A real change-password form where only the current-password box got
    // tagged (a common real-world omission) -- the >=2-password check
    // must win over the lone current-password match, or this would
    // misread as 'login'.
    const result = detectLoginForm(
      form([
        field({ type: 'password', autocomplete: 'current-password' }),
        field({ type: 'password' }),
      ]),
    );
    expect(result?.kind).toBe('signup');
  });

  it('falls back to a confirm-password field (no autocomplete) as signup', () => {
    const result = detectLoginForm(
      form([
        field({ type: 'email' }),
        field({ type: 'password' }),
        field({ type: 'password' }), // confirm password, no autocomplete
      ]),
    );
    expect(result?.kind).toBe('signup');
    // The FIRST password field is "the" password, even on a signup form.
    expect(result?.passwordFieldIndex).toBe(1);
  });

  it('falls back to field count for a bare lean form (login)', () => {
    const result = detectLoginForm(form([field({ type: 'email' }), field({ type: 'password' })]));
    expect(result?.kind).toBe('login');
  });

  it('falls back to field count for a bare form with extra fields (signup)', () => {
    const result = detectLoginForm(
      form([
        field({ type: 'text', name: 'name' }),
        field({ type: 'email' }),
        field({ type: 'password' }),
        field({ type: 'tel' }),
      ]),
    );
    expect(result?.kind).toBe('signup');
  });

  it('excludes hidden/submit/button fields from the field-count fallback', () => {
    // A minimal 2-field login form (email + password) plus a hidden CSRF
    // token and a submit button -- 4 raw fields, but only 2 are a real
    // signal. Without the exclusion this would misread as signup.
    const result = detectLoginForm(
      form([
        field({ type: 'email' }),
        field({ type: 'password' }),
        field({ type: 'hidden', name: 'csrf_token' }),
        field({ type: 'submit' }),
      ]),
    );
    expect(result?.kind).toBe('login');
  });

  it('uses the form action URL as a signal ahead of the field-count fallback', () => {
    const signup = detectLoginForm(
      form([field({ type: 'email' }), field({ type: 'password' })], '/api/signup'),
    );
    expect(signup?.kind).toBe('signup');

    const login = detectLoginForm(
      form(
        [
          field({ type: 'text', name: 'name' }),
          field({ type: 'email' }),
          field({ type: 'password' }),
          field({ type: 'tel' }),
        ],
        '/api/login',
      ),
    );
    expect(login?.kind).toBe('login');
  });

  it('prefers autocomplete="username" over the nearest preceding text field', () => {
    const result = detectLoginForm(
      form([
        field({ type: 'text', name: 'promo-code' }),
        field({ type: 'email', autocomplete: 'username' }),
        field({ type: 'password', autocomplete: 'current-password' }),
      ]),
    );
    expect(result?.identifierFieldIndex).toBe(1);
  });

  it('accepts a type="tel" identifier field (phone/OTP-first login)', () => {
    const result = detectLoginForm(form([field({ type: 'tel' }), field({ type: 'password' })]));
    expect(result?.identifierFieldIndex).toBe(0);
  });

  it('finds an identifier field AFTER the password field when nothing plausible precedes it', () => {
    const result = detectLoginForm(form([field({ type: 'password' }), field({ type: 'email' })]));
    expect(result?.identifierFieldIndex).toBe(1);
  });

  it('falls back to a login-specific name/id token when type gives no signal', () => {
    const result = detectLoginForm(
      form([field({ type: 'text', name: 'login_id' }), field({ type: 'password' })]),
    );
    expect(result?.identifierFieldIndex).toBe(0);
  });

  it('returns identifierFieldIndex: null when no plausible identifier field exists anywhere', () => {
    const result = detectLoginForm(form([field({ type: 'password' })]));
    expect(result?.identifierFieldIndex).toBeNull();
  });

  it('matches autocomplete regardless of case (raw, non-normalized attribute value)', () => {
    const result = detectLoginForm(
      form([
        field({ type: 'email', autocomplete: 'Username' }),
        field({ type: 'password', autocomplete: 'New-Password' }),
      ]),
    );
    expect(result?.kind).toBe('signup');
    expect(result?.identifierFieldIndex).toBe(0);
  });

  it('never treats a confirm-password field as the identifier, even when its name contains a login token (Rails-style naming)', () => {
    const result = detectLoginForm(
      form([
        field({ type: 'password', name: 'user[password]' }),
        field({ type: 'password', name: 'user[password_confirmation]' }),
      ]),
    );
    // Neither password field should ever be picked as "the identifier" --
    // there's no other candidate here, so this must resolve to null, not
    // the confirm-password field just because its name contains "user".
    expect(result?.identifierFieldIndex).toBeNull();
  });

  it('does not false-positive on an action URL that merely contains a keyword as a substring', () => {
    const result = detectLoginForm(
      form([field({ type: 'email' }), field({ type: 'password' })], '/contracts/esigning'),
    );
    // "esigning" must not match "signin" -- falls through to the (lean,
    // 2-field) field-count fallback instead, which correctly reads login.
    expect(result?.kind).toBe('login');
  });
});
