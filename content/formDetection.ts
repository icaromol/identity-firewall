// Pure DOM-extraction logic for the content script's one Phase 1
// responsibility: report which forms exist on a page and their raw
// structural attributes -- never their meaning. Semantic field
// classification (email vs national_identifier, etc.) and any judgment
// about whether HTML "required" can be trusted are Phase 3's Field
// Classifier -- see docs/plans/phase-1-extension-foundation.md's scope
// boundary table.
//
// Kept out of entrypoints/content.ts, and out of entrypoints/ entirely,
// for the same reason background/ split logic out of
// entrypoints/background.ts in M3: entrypoints/*.ts are thin composition
// roots, everything testable lives in a plain module a Vitest test can
// import directly without going through WXT's entrypoint machinery.

import type { DetectedField, DetectedForm, FormDetectedMessage } from '../shared/messages';
import { normalizeOrigin } from '../shared/origin';

// Named once and reused by both functions below, rather than duplicating
// the union type at each use site.
export type DetectableFieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// instanceof, not a tagName string comparison: Element.tagName is
// uppercase in HTML documents but preserves source case in XML/XHTML
// documents (application/xhtml+xml), where a plain `<input>` has
// tagName === 'input'. instanceof checks the element's actual DOM
// interface, so it's correct regardless of the document's content type.
function isDetectableField(el: Element): el is DetectableFieldElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

/**
 * The same field-order, same-filter walk extractForms() uses below --
 * exported so entrypoints/content.ts's AUTOFILL_FIELDS listener (Phase 3
 * M5) can re-derive the identical ordering live from the DOM at fill time,
 * matching the order shared/fieldKey.ts's positional fallback (`#${index}`)
 * assumes.
 */
export function getDetectableFields(form: HTMLFormElement): DetectableFieldElement[] {
  return Array.from(form.elements).filter(isDetectableField);
}

function extractField(el: DetectableFieldElement): DetectedField {
  return {
    tagName: el.tagName.toLowerCase() as DetectedField['tagName'],
    type: el instanceof HTMLInputElement ? el.type : null,
    name: el.name || null,
    id: el.id || null,
    required: el.required,
    // el.autocomplete reflects the raw attribute value, defaulting to ''
    // (not 'off') when absent -- normalized to null like name/id above,
    // rather than reporting the misleading empty string.
    autocomplete: el.autocomplete || null,
  };
}

/**
 * Walks `doc.forms` and reports each form's raw structure: which
 * input/textarea/select fields it contains and their HTML attributes.
 * No semantic classification, no required/optional trust judgment.
 */
export function extractForms(doc: Document): DetectedForm[] {
  return Array.from(doc.forms).map((form, formIndex) => ({
    formIndex,
    action: form.getAttribute('action'),
    method: form.getAttribute('method'),
    fields: getDetectableFields(form).map(extractField),
  }));
}

/**
 * Builds the FORM_DETECTED message to send to background, or null if the
 * page has no forms at all -- Phase 1 sends nothing in that case (see
 * M7's "a page with no <form> produces no popup entry" acceptance check).
 *
 * `href` and `detectedAt` are explicit parameters rather than read
 * internally from `location.href`/`Date.now()`, matching the same
 * testability convention background/session/state.ts's
 * recordFormDetection() already established.
 */
export function buildFormDetectedMessage(
  doc: Document,
  href: string,
  detectedAt: number,
): FormDetectedMessage | null {
  const forms = extractForms(doc);
  if (forms.length === 0) return null;

  return {
    type: 'FORM_DETECTED',
    payload: {
      origin: normalizeOrigin(href),
      url: href,
      detectedAt,
      forms,
    },
  };
}
