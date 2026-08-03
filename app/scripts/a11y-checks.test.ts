// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  A11Y_CHECK_IDS,
  runContrastChecksInDocument,
  runSemanticChecksInDocument,
} from './a11y-checks.js';

const installDom = (html: string): void => {
  vi.restoreAllMocks();
  document.body.innerHTML = html;
  vi.stubGlobal('CSS', { escape: (value: string) => value });

  Object.defineProperty(Element.prototype, 'getClientRects', {
    configurable: true,
    value: () => [{ height: 20, width: 100 }],
  });
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ height: 20, width: 100 }),
  });

  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const computed = document.createElement('div').style;
    if (pseudo === '::before' || pseudo === '::after') {
      const attribute = pseudo === '::before' ? 'data-before' : 'data-after';
      Object.defineProperty(computed, 'content', {
        configurable: true,
        value: element.getAttribute(attribute) ?? 'none',
      });
      return computed;
    }
    const style = element instanceof HTMLElement ? element.style : undefined;
    computed.backgroundColor = style?.backgroundColor || 'rgba(0, 0, 0, 0)';
    computed.backgroundImage = style?.backgroundImage || 'none';
    computed.clip = style?.clip || 'auto';
    computed.clipPath = style?.clipPath || 'none';
    computed.color = style?.color || 'rgb(0, 0, 0)';
    computed.display = style?.display || 'block';
    computed.fontSize = style?.fontSize || '16px';
    computed.fontWeight = style?.fontWeight || '400';
    computed.opacity = style?.opacity || '1';
    computed.textShadow = style?.textShadow || 'none';
    computed.visibility = style?.visibility || 'visible';
    return computed;
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.textContent = '';
});

describe('semantic accessibility checks', () => {
  it('does not treat hidden descendant text as an accessible name', () => {
    installDom(`
      <main>
        <button id="hidden-aria"><span aria-hidden="true">Secret</span></button>
        <a id="hidden-css" href="/"><span style="display: none">Secret</span></a>
        <button id="visible"><span>Visible name</span></button>
      </main>
    `);

    const outcome = runSemanticChecksInDocument();

    expect(outcome.findings.map(({ rule, target }) => ({ rule, target }))).toEqual([
      { rule: 'button-name', target: '#hidden-aria' },
      { rule: 'link-name', target: '#hidden-css' },
    ]);
    expect(outcome.checked).toBeGreaterThanOrEqual(4);
  });

  it('publishes every rule id that the checker can emit', () => {
    expect(A11Y_CHECK_IDS).toEqual([
      'image-alt',
      'label',
      'button-name',
      'link-name',
      'aria-checkbox-name',
      'aria-combobox-name',
      'aria-listbox-name',
      'aria-progressbar-name',
      'aria-radio-name',
      'aria-slider-name',
      'aria-spinbutton-name',
      'aria-switch-name',
      'aria-textbox-name',
      'landmark-one-main',
      'region',
      'heading-order',
      'empty-table-header',
      'color-contrast',
    ]);
  });
});

describe('contrast accessibility checks', () => {
  it('measures form values and accounts for option and pseudo-element text', () => {
    installDom(`
      <main>
        <input id="email" aria-label="Email" value="person@example.test">
        <textarea id="bio" aria-label="Bio">Profile text</textarea>
        <select aria-label="Plan"><option>Free</option><option>Paid</option></select>
        <span id="required" data-before="&quot;Required&quot;"></span>
      </main>
    `);

    const outcome = runContrastChecksInDocument();

    expect(outcome.checked).toBe(2);
    expect(outcome.skipped).toBe(3);
    expect(outcome.skippedByReason['form-option']).toBe(2);
    expect(outcome.skippedByReason['pseudo-element']).toBe(1);
  });

  it('skips placeholder-only controls instead of measuring them as input values', () => {
    installDom(`
      <main>
        <input aria-label="Email" placeholder="person@example.test">
        <textarea aria-label="Bio" placeholder="Profile text"></textarea>
      </main>
    `);

    const outcome = runContrastChecksInDocument();

    expect(outcome.checked).toBe(0);
    expect(outcome.skipped).toBe(2);
    expect(outcome.skippedByReason.placeholder).toBe(2);
  });

  it('accounts for native and ARIA-disabled text runs', () => {
    installDom(`
      <main>
        <button disabled>Native disabled</button>
        <div aria-disabled="true"><span>ARIA disabled</span></div>
        <button id="enabled">Enabled</button>
      </main>
    `);

    const outcome = runContrastChecksInDocument();

    expect(outcome.checked).toBe(1);
    expect(outcome.skipped).toBe(2);
    expect(outcome.skippedByReason.disabled).toBe(2);
  });

  it('reports low computed-style contrast', () => {
    installDom(`
      <main>
        <p id="low" style="color: rgb(119, 119, 119); background-color: rgb(255, 255, 255)">Low contrast</p>
      </main>
    `);

    const outcome = runContrastChecksInDocument();

    expect(outcome.checked).toBe(1);
    expect(outcome.findings).toMatchObject([
      { rule: 'color-contrast', impact: 'serious', target: '#low' },
    ]);
  });
});
