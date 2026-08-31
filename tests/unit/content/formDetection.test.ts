// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildFormDetectedMessage,
  buildFormSubmittedMessage,
  extractForms,
  extractSubmittedFields,
} from '../../../content/formDetection';

// Shared by every describe block below -- each test sets its own fixture
// markup, but all of them need a clean document.body first.
beforeEach(() => {
  document.body.innerHTML = '';
});

describe('extractForms', () => {
  it('captures tagName, type, name, id, required, and autocomplete for a required email input', () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" id="email-field" autocomplete="email" required />
      </form>
    `;

    const forms = extractForms(document);
    expect(forms[0]?.fields).toEqual([
      {
        tagName: 'input',
        type: 'email',
        name: 'email',
        id: 'email-field',
        required: true,
        autocomplete: 'email',
      },
    ]);
  });

  it('reports null autocomplete when the attribute is absent', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="plain" />
      </form>
    `;

    expect(extractForms(document)[0]?.fields?.[0]?.autocomplete).toBeNull();
  });

  it('reports null name and id for a field with neither attribute', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" />
      </form>
    `;

    const fields = extractForms(document)[0]?.fields;
    expect(fields?.[0]?.name).toBeNull();
    expect(fields?.[0]?.id).toBeNull();
  });

  it('assigns formIndex per document.forms position and keeps fields from bleeding across forms', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="first-form-field" />
      </form>
      <form>
        <input type="text" name="second-form-field" />
      </form>
    `;

    const forms = extractForms(document);
    expect(forms).toHaveLength(2);
    expect(forms[0]?.formIndex).toBe(0);
    expect(forms[0]?.fields).toEqual([
      {
        tagName: 'input',
        type: 'text',
        name: 'first-form-field',
        id: null,
        required: false,
        autocomplete: null,
      },
    ]);
    expect(forms[1]?.formIndex).toBe(1);
    expect(forms[1]?.fields).toEqual([
      {
        tagName: 'input',
        type: 'text',
        name: 'second-form-field',
        id: null,
        required: false,
        autocomplete: null,
      },
    ]);
  });

  it('lowercases tagName and reports a null type for select and textarea fields', () => {
    document.body.innerHTML = `
      <form>
        <select name="country"><option value="us">US</option></select>
        <textarea name="bio"></textarea>
      </form>
    `;

    const fields = extractForms(document)[0]?.fields;
    expect(fields?.[0]).toMatchObject({ tagName: 'select', type: null });
    expect(fields?.[1]).toMatchObject({ tagName: 'textarea', type: null });
  });

  it('filters out non-field form controls like a submit button', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="username" />
        <button type="submit">Submit</button>
      </form>
    `;

    const fields = extractForms(document)[0]?.fields;
    expect(fields).toHaveLength(1);
    expect(fields?.[0]?.name).toBe('username');
  });

  it('returns an empty array for a page with no forms', () => {
    document.body.innerHTML = '<div>no forms here</div>';
    expect(extractForms(document)).toEqual([]);
  });
});

describe('buildFormDetectedMessage', () => {
  it('returns null when the page has no forms', () => {
    document.body.innerHTML = '<div>no forms here</div>';
    expect(
      buildFormDetectedMessage(document, 'https://example.com/login', 1_700_000_000_000),
    ).toBeNull();
  });

  it('builds a FORM_DETECTED message with a normalized origin, the given url, and detectedAt', () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" required />
      </form>
    `;

    const message = buildFormDetectedMessage(
      document,
      'https://Example.com:443/login?next=/home',
      1_700_000_000_000,
    );

    expect(message).toEqual({
      type: 'FORM_DETECTED',
      payload: {
        origin: 'https://example.com',
        url: 'https://Example.com:443/login?next=/home',
        detectedAt: 1_700_000_000_000,
        forms: [
          {
            formIndex: 0,
            action: null,
            method: null,
            fields: [
              {
                tagName: 'input',
                type: 'email',
                name: 'email',
                id: null,
                required: true,
                autocomplete: null,
              },
            ],
          },
        ],
      },
    });
  });
});

describe('extractSubmittedFields (Phase 5 M4)', () => {
  it('captures the live value alongside the same structural attributes extractForms reports', () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" autocomplete="username" />
        <input type="password" name="password" autocomplete="current-password" />
      </form>
    `;
    const form = document.querySelector('form') as HTMLFormElement;
    (form.querySelector('input[type=email]') as HTMLInputElement).value = 'alice@example.com';
    (form.querySelector('input[type=password]') as HTMLInputElement).value = 'hunter2';

    expect(extractSubmittedFields(form)).toEqual([
      {
        tagName: 'input',
        type: 'email',
        name: 'email',
        id: null,
        required: false,
        autocomplete: 'username',
        value: 'alice@example.com',
      },
      {
        tagName: 'input',
        type: 'password',
        name: 'password',
        id: null,
        required: false,
        autocomplete: 'current-password',
        value: 'hunter2',
      },
    ]);
  });
});

describe('buildFormSubmittedMessage (Phase 5 M4)', () => {
  it('returns null when the form has no password field', () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" />
      </form>
    `;
    const form = document.querySelector('form') as HTMLFormElement;
    expect(buildFormSubmittedMessage(form, 0, 'https://example.com/search')).toBeNull();
  });

  it('builds a FORM_SUBMITTED message with a normalized origin when a password field exists', () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" />
        <input type="password" name="password" />
      </form>
    `;
    const form = document.querySelector('form') as HTMLFormElement;
    (form.querySelector('input[type=email]') as HTMLInputElement).value = 'alice@example.com';
    (form.querySelector('input[type=password]') as HTMLInputElement).value = 'hunter2';

    const message = buildFormSubmittedMessage(form, 0, 'https://Example.com:443/login');

    expect(message).toMatchObject({
      type: 'FORM_SUBMITTED',
      payload: {
        origin: 'https://example.com',
        formIndex: 0,
        fields: [
          expect.objectContaining({ value: 'alice@example.com' }),
          expect.objectContaining({ value: 'hunter2' }),
        ],
      },
    });
  });
});
