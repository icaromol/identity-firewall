// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyAutofill } from '../../../content/autofill';
import { getFieldKey } from '../../../shared/fieldKey';
import type { AutofillFieldsMessage } from '../../../shared/messages';

beforeEach(() => {
  document.body.innerHTML = '';
});

function message(formIndex: number, values: Record<string, string>): AutofillFieldsMessage {
  return { type: 'AUTOFILL_FIELDS', payload: { formIndex, values } };
}

describe('applyAutofill', () => {
  it('fills a field matched by name and dispatches input/change events', () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" />
      </form>
    `;
    const input = document.querySelector('input') as HTMLInputElement;
    let inputEventFired = false;
    let changeEventFired = false;
    input.addEventListener('input', () => {
      inputEventFired = true;
    });
    input.addEventListener('change', () => {
      changeEventFired = true;
    });

    const key = getFieldKey({ name: 'email', id: null }, 0);
    applyAutofill(document, message(0, { [key]: 'user@example.com' }));

    expect(input.value).toBe('user@example.com');
    expect(inputEventFired).toBe(true);
    expect(changeEventFired).toBe(true);
  });

  it('falls back to id when name is absent', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" id="full-name" />
      </form>
    `;
    const key = getFieldKey({ name: null, id: 'full-name' }, 0);
    applyAutofill(document, message(0, { [key]: 'Ícaro' }));
    expect((document.getElementById('full-name') as HTMLInputElement).value).toBe('Ícaro');
  });

  it('falls back to a plain positional key when neither name nor id is present', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" />
      </form>
    `;
    const key = getFieldKey({ name: null, id: null }, 0);
    applyAutofill(document, message(0, { [key]: 'value-by-position' }));
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('value-by-position');
  });

  it('index-prefixes the key so two same-named fields in one form never collide', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="address" />
        <input type="text" name="address" />
      </form>
    `;
    const firstKey = getFieldKey({ name: 'address', id: null }, 0);
    const secondKey = getFieldKey({ name: 'address', id: null }, 1);
    expect(firstKey).not.toBe(secondKey);

    applyAutofill(document, message(0, { [firstKey]: 'billing', [secondKey]: 'shipping' }));

    const inputs = document.querySelectorAll('[name=address]');
    expect((inputs[0] as HTMLInputElement).value).toBe('billing');
    expect((inputs[1] as HTMLInputElement).value).toBe('shipping');
  });

  it('leaves a field untouched when its key has no matching value', () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" value="original" />
        <input type="tel" name="phone" />
      </form>
    `;
    const emailKey = getFieldKey({ name: 'email', id: null }, 0);
    applyAutofill(document, message(0, { [emailKey]: 'new@example.com' }));

    expect((document.querySelector('[name=email]') as HTMLInputElement).value).toBe(
      'new@example.com',
    );
    expect((document.querySelector('[name=phone]') as HTMLInputElement).value).toBe('');
  });

  it('does nothing when the formIndex no longer exists on the page', () => {
    document.body.innerHTML = '<div>no forms here</div>';
    const key = getFieldKey({ name: 'email', id: null }, 0);
    expect(() => applyAutofill(document, message(0, { [key]: 'x@example.com' }))).not.toThrow();
  });

  it('fills a textarea and select using their own native setters', () => {
    document.body.innerHTML = `
      <form>
        <textarea name="bio"></textarea>
        <select name="country">
          <option value="us">US</option>
          <option value="br">BR</option>
        </select>
      </form>
    `;
    const bioKey = getFieldKey({ name: 'bio', id: null }, 0);
    const countryKey = getFieldKey({ name: 'country', id: null }, 1);
    applyAutofill(document, message(0, { [bioKey]: 'hello', [countryKey]: 'br' }));

    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('hello');
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('br');
  });

  it('targets the correct form by formIndex when multiple forms exist', () => {
    document.body.innerHTML = `
      <form><input type="text" name="a" /></form>
      <form><input type="text" name="a" /></form>
    `;
    const key = getFieldKey({ name: 'a', id: null }, 0);
    applyAutofill(document, message(1, { [key]: 'second-form-value' }));

    const inputs = document.querySelectorAll('[name=a]');
    expect((inputs[0] as HTMLInputElement).value).toBe('');
    expect((inputs[1] as HTMLInputElement).value).toBe('second-form-value');
  });
});
