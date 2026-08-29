// Phase 3 M5 -- writes background's resolved field values back into the
// live page, the last step of browser-architecture.md's 7-step legacy
// pipeline ("Autofill: the resulting values are written into the form
// fields exactly as if the user had typed them").
//
// Setting element.value directly is invisible to a framework-controlled
// input (React, Vue): those track their own state via a wrapped setter,
// so a plain assignment updates the DOM node but never notifies the
// framework, and the framework's own re-render silently reverts it. The
// fix, used by every real-world autofill/extension-automation tool: call
// the native (unwrapped) property setter from the element's own prototype,
// then dispatch real input/change events so the page's own listeners
// (including a framework's synthetic event system, which listens at the
// document level) see the change exactly as if a person had typed it.

import { getFieldKey } from '../shared/fieldKey';
import type { AutofillFieldsMessage } from '../shared/messages';
import { getDetectableFields } from './formDetection';

function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const prototype =
    el instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype;

  const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    // No known case reaches this fallback (all three prototypes define a
    // 'value' setter in every real DOM implementation) -- kept only so a
    // future, unexpected environment degrades to a plain assignment
    // instead of throwing.
    el.value = value;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Applies one AUTOFILL_FIELDS message to the live document. Silently does
 * nothing for a formIndex that no longer exists (the tab may have
 * navigated away between the request and the response) or a key with no
 * matching live field -- there's no useful recovery action from a content
 * script here, matching entrypoints/content.ts's own established
 * fire-and-forget error-tolerance for this boundary.
 */
export function applyAutofill(doc: Document, message: AutofillFieldsMessage): void {
  const form = doc.forms[message.payload.formIndex];
  if (!form) return;

  const fields = getDetectableFields(form);
  fields.forEach((field, index) => {
    const key = getFieldKey({ name: field.name || null, id: field.id || null }, index);
    const value = message.payload.values[key];
    if (value !== undefined) setNativeValue(field, value);
  });
}
