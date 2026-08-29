// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyAutofill } from '../../../content/autofill';
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

    applyAutofill(document, message(0, { email: 'user@example.com' }));

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
    applyAutofill(document, message(0, { 'full-name': 'Ícaro' }));
    expect((document.getElementById('full-name') as HTMLInputElement).value).toBe('Ícaro');
  });

  it('falls back to positional key when neither name nor id is present', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" />
      </form>
    `;
    applyAutofill(document, message(0, { '#0': 'value-by-position' }));
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('value-by-position');
  });

  it('leaves a field untouched when its key has no matching value', () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" value="original" />
        <input type="tel" name="phone" />
      </form>
    `;
    applyAutofill(document, message(0, { email: 'new@example.com' }));

    expect((document.querySelector('[name=email]') as HTMLInputElement).value).toBe(
      'new@example.com',
    );
    expect((document.querySelector('[name=phone]') as HTMLInputElement).value).toBe('');
  });

  it('does nothing when the formIndex no longer exists on the page', () => {
    document.body.innerHTML = '<div>no forms here</div>';
    expect(() => applyAutofill(document, message(0, { email: 'x@example.com' }))).not.toThrow();
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
    applyAutofill(document, message(0, { bio: 'hello', country: 'br' }));

    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('hello');
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('br');
  });

  it('targets the correct form by formIndex when multiple forms exist', () => {
    document.body.innerHTML = `
      <form><input type="text" name="a" /></form>
      <form><input type="text" name="a" /></form>
    `;
    applyAutofill(document, message(1, { a: 'second-form-value' }));

    const inputs = document.querySelectorAll('[name=a]');
    expect((inputs[0] as HTMLInputElement).value).toBe('');
    expect((inputs[1] as HTMLInputElement).value).toBe('second-form-value');
  });
});
