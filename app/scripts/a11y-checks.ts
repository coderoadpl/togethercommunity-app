export type ImpactValue = 'critical' | 'serious' | 'moderate' | 'minor';

export interface RawFinding {
  rule: string;
  impact: ImpactValue;
  message: string;
  target: string;
}

export interface SemanticOutcome {
  findings: RawFinding[];
  checked: number;
}

export type ContrastSkipReason =
  | 'background'
  | 'clipped'
  | 'disabled'
  | 'form-option'
  | 'placeholder'
  | 'pseudo-element'
  | 'text-fill'
  | 'text-shadow'
  | 'transparency';

export const CONTRAST_SKIP_REASONS: ContrastSkipReason[] = [
  'background',
  'clipped',
  'disabled',
  'form-option',
  'placeholder',
  'pseudo-element',
  'text-fill',
  'text-shadow',
  'transparency',
];

export interface ContrastOutcome {
  findings: RawFinding[];
  checked: number;
  skipped: number;
  skippedByReason: Record<ContrastSkipReason, number>;
}

const namedAriaRoles = [
  'checkbox',
  'combobox',
  'listbox',
  'progressbar',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'textbox',
] as const;

export const A11Y_CHECK_IDS = [
  'image-alt',
  'label',
  'button-name',
  'link-name',
  ...namedAriaRoles.map((role) => `aria-${role}-name`),
  'landmark-one-main',
  'region',
  'heading-order',
  'empty-table-header',
  'color-contrast',
] as const;

export const runSemanticChecksInDocument = (): SemanticOutcome => {
  const findings: RawFinding[] = [];
  let checked = 0;
  const landmarkSelector = [
    'main',
    'nav',
    'aside',
    'header',
    'footer',
    '[role="main"]',
    '[role="navigation"]',
    '[role="complementary"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[role="region"][aria-label]',
    '[role="region"][aria-labelledby]',
    '[role="search"]',
    'form[aria-label]',
    'form[aria-labelledby]',
  ].join(',');

  const normalize = (value: string | null | undefined): string =>
    (value ?? '').replace(/\s+/g, ' ').trim();

  const isHiddenFromTree = (element: Element): boolean => {
    if (element.closest('[hidden], [inert], [aria-hidden="true"]') !== null) return true;
    const style = window.getComputedStyle(element);
    return style.display === 'none' || style.visibility === 'hidden';
  };

  const isExposed = (element: Element): boolean =>
    !isHiddenFromTree(element) && element.getClientRects().length > 0;

  const targetFor = (element: Element): string => {
    if (element.id !== '') return `#${CSS.escape(element.id)}`;
    const testId = element.getAttribute('data-testid');
    if (testId !== null) return `[data-testid="${testId}"]`;
    const role = element.getAttribute('role');
    return role === null
      ? element.tagName.toLowerCase()
      : `${element.tagName.toLowerCase()}[role="${role}"]`;
  };

  const referencedText = (element: Element): string => {
    const ids = normalize(element.getAttribute('aria-labelledby')).split(' ').filter(Boolean);
    return normalize(ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
  };

  const descendantText = (element: Element): string => {
    const parts: string[] = [];
    const visit = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent ?? '');
        return;
      }
      if (!(node instanceof Element) || isHiddenFromTree(node)) return;
      if (node instanceof HTMLImageElement) {
        parts.push(node.getAttribute('alt') ?? '');
      }
      for (const child of node.childNodes) visit(child);
    };
    for (const child of element.childNodes) visit(child);
    return normalize(parts.join(' '));
  };

  const accessibleName = (element: Element): string => {
    const labelledBy = referencedText(element);
    if (labelledBy !== '') return labelledBy;
    const ariaLabel = normalize(element.getAttribute('aria-label'));
    if (ariaLabel !== '') return ariaLabel;
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ) {
      const labelText = normalize(
        [...(element.labels ?? [])].map((label) => descendantText(label)).join(' '),
      );
      if (labelText !== '') return labelText;
    }
    if (element instanceof HTMLImageElement) return normalize(element.getAttribute('alt'));
    if (
      element instanceof HTMLInputElement &&
      ['button', 'reset', 'submit'].includes(element.type)
    ) {
      const value = normalize(element.value);
      if (value !== '') return value;
    }
    const content = descendantText(element);
    if (content !== '') return content;
    return normalize(element.getAttribute('title'));
  };

  const add = (rule: string, impact: ImpactValue, element: Element, message: string): void => {
    findings.push({ rule, impact, message, target: targetFor(element) });
  };

  for (const image of document.querySelectorAll('img')) {
    if (!isExposed(image)) continue;
    checked += 1;
    if (!image.hasAttribute('alt')) {
      add('image-alt', 'critical', image, 'Image is missing an alt attribute');
    }
  }

  for (const control of document.querySelectorAll(
    'input:not([type="hidden"]), select, textarea',
  )) {
    if (!isExposed(control)) continue;
    checked += 1;
    if (accessibleName(control) === '') {
      add('label', 'critical', control, 'Form control has no accessible name');
    }
  }

  for (const button of document.querySelectorAll('button')) {
    if (!isExposed(button)) continue;
    checked += 1;
    if (accessibleName(button) === '') {
      add('button-name', 'critical', button, 'Button has no accessible name');
    }
  }

  for (const link of document.querySelectorAll('a[href]')) {
    if (!isExposed(link)) continue;
    checked += 1;
    if (accessibleName(link) === '') {
      add('link-name', 'serious', link, 'Link has no accessible name');
    }
  }

  const roleImpacts: Record<(typeof namedAriaRoles)[number], ImpactValue> = {
    checkbox: 'critical',
    combobox: 'critical',
    listbox: 'critical',
    progressbar: 'serious',
    radio: 'critical',
    slider: 'critical',
    spinbutton: 'critical',
    switch: 'critical',
    textbox: 'critical',
  };
  const isNamedAriaRole = (role: string): role is keyof typeof roleImpacts =>
    Object.hasOwn(roleImpacts, role);
  for (const element of document.querySelectorAll('[role]')) {
    const role = element.getAttribute('role') ?? '';
    if (!isNamedAriaRole(role) || !isExposed(element)) continue;
    checked += 1;
    const impact = roleImpacts[role];
    if (accessibleName(element) === '') {
      add(`aria-${role}-name`, impact, element, `${role} has no accessible name`);
    }
  }

  const mains = [...document.querySelectorAll('main, [role="main"]')].filter(isExposed);
  checked += 1;
  if (mains.length !== 1) {
    add(
      'landmark-one-main',
      'moderate',
      document.body,
      `Document has ${String(mains.length)} exposed main landmarks; expected exactly one`,
    );
  }

  const regionCandidates = [
    ...document.querySelectorAll(
      'a[href], button, input, select, textarea, img, h1, h2, h3, h4, h5, h6, p, li, table, [role]',
    ),
  ].filter((element) => isExposed(element) && element.closest(landmarkSelector) === null);
  checked += regionCandidates.length;
  for (const element of regionCandidates) {
    if (
      regionCandidates.some((candidate) => candidate !== element && candidate.contains(element))
    ) {
      continue;
    }
    add('region', 'moderate', element, 'Page content is not contained by a landmark');
  }

  let previousHeadingLevel = 0;
  const headings = document.querySelectorAll(
    'h1, h2, h3, h4, h5, h6, [role="heading"][aria-level]',
  );
  for (const heading of headings) {
    if (!isExposed(heading)) continue;
    checked += 1;
    const nativeMatch = /^H([1-6])$/.exec(heading.tagName);
    const level =
      nativeMatch === null ? Number(heading.getAttribute('aria-level')) : Number(nativeMatch[1]);
    if (
      Number.isInteger(level) &&
      level > previousHeadingLevel + 1 &&
      previousHeadingLevel !== 0
    ) {
      add(
        'heading-order',
        'moderate',
        heading,
        `Heading level ${String(level)} follows level ${String(previousHeadingLevel)}`,
      );
    }
    if (Number.isInteger(level) && level > 0) previousHeadingLevel = level;
  }

  for (const header of document.querySelectorAll('th')) {
    if (!isExposed(header)) continue;
    checked += 1;
    if (accessibleName(header) === '') {
      add('empty-table-header', 'minor', header, 'Table header has no accessible name');
    }
  }

  return { findings, checked };
};

export const runContrastChecksInDocument = (): ContrastOutcome => {
  interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
  }

  const findings: RawFinding[] = [];
  let checked = 0;
  let skipped = 0;
  const skippedByReason: Record<ContrastSkipReason, number> = {
    background: 0,
    clipped: 0,
    disabled: 0,
    'form-option': 0,
    placeholder: 0,
    'pseudo-element': 0,
    'text-fill': 0,
    'text-shadow': 0,
    transparency: 0,
  };

  const styleOf = (element: Element): CSSStyleDeclaration => window.getComputedStyle(element);

  const targetFor = (element: Element): string => {
    if (element.id !== '') return `#${CSS.escape(element.id)}`;
    const tag = element.tagName.toLowerCase();
    const owner = element.closest('[data-testid]')?.getAttribute('data-testid');
    return owner === undefined ? tag : `[data-testid="${owner}"] ${tag}`;
  };

  const parseColor = (value: string): Rgba | null => {
    if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (!value.startsWith('rgb')) return null;
    const parts = value.match(/[\d.]+%?/g);
    if (parts === null || parts.length < 3) return null;
    const channel = (raw: string | undefined): number => Number((raw ?? '0').replace('%', ''));
    const rawAlpha = parts[3];
    const alpha =
      rawAlpha === undefined
        ? 1
        : rawAlpha.endsWith('%')
          ? Number(rawAlpha.slice(0, -1)) / 100
          : Number(rawAlpha);
    const color = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
    return Number.isFinite(color.r + color.g + color.b + color.a) ? color : null;
  };

  const over = (top: Rgba, bottom: Rgba): Rgba => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });

  const luminance = (color: Rgba): number => {
    const channel = (value: number): number => {
      const scaled = value / 255;
      return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };

  const ratioBetween = (a: Rgba, b: Rgba): number => {
    const first = luminance(a);
    const second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };

  const canvas: Rgba = { r: 255, g: 255, b: 255, a: 1 };

  const backgroundBehind = (element: Element): Rgba | null => {
    const layers: Rgba[] = [];
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      const style = styleOf(node);
      if (style.backgroundImage !== 'none') return null;
      if (node !== element && Number(style.opacity) < 1) return null;
      const color = parseColor(style.backgroundColor);
      if (color === null) return null;
      if (color.a > 0) layers.push(color);
      if (color.a === 1) break;
    }
    return layers.reduceRight((below, layer) => over(layer, below), canvas);
  };

  const clipped = (element: Element): boolean => {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      const style = styleOf(node);
      if (style.clip !== 'auto' || style.clipPath !== 'none') return true;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return true;
    }
    return false;
  };

  const hasOwnText = (element: Element): boolean => {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && /[\p{L}\p{N}]/u.test(node.textContent ?? '')) {
        return true;
      }
    }
    return false;
  };

  const hasControlValue = (element: Element): boolean => {
    if (element instanceof HTMLInputElement) {
      return element.type !== 'hidden' && /\S/u.test(element.value);
    }
    if (element instanceof HTMLTextAreaElement) {
      return /\S/u.test(element.value);
    }
    return false;
  };

  const hasPlaceholderText = (element: Element): boolean =>
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    !hasControlValue(element) &&
    /\S/u.test(element.placeholder);

  const hasPseudoText = (element: Element, pseudo: '::before' | '::after'): boolean => {
    const content = window.getComputedStyle(element, pseudo).content;
    if (content === '' || content === 'none' || content === 'normal' || content.startsWith('url(')) {
      return false;
    }
    const unquoted = content.replace(/^(['"])(.*)\1$/u, '$2');
    return /\S/u.test(unquoted);
  };

  const skip = (reason: ContrastSkipReason, count = 1): void => {
    skipped += count;
    skippedByReason[reason] += count;
  };

  const describe = (color: Rgba): string =>
    `rgb(${String(Math.round(color.r))}, ${String(Math.round(color.g))}, ${String(Math.round(color.b))})`;

  for (const element of document.body.querySelectorAll('*')) {
    const style = styleOf(element);
    if (style.display === 'none' || style.visibility !== 'visible') continue;

    const hasBeforeText = hasPseudoText(element, '::before');
    const hasAfterText = hasPseudoText(element, '::after');
    const hasPlaceholder = hasPlaceholderText(element);
    const textRuns =
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? 0
        : hasOwnText(element)
          ? 1
          : 0) + (hasControlValue(element) ? 1 : 0);
    if (element.closest(':disabled, [aria-disabled="true"]') !== null) {
      skip(
        'disabled',
        textRuns + Number(hasPlaceholder) + Number(hasBeforeText) + Number(hasAfterText),
      );
      continue;
    }

    if (element instanceof HTMLOptionElement) {
      if (hasOwnText(element)) skip('form-option');
      continue;
    }

    if (hasBeforeText) skip('pseudo-element');
    if (hasAfterText) skip('pseudo-element');
    if (hasPlaceholder) skip('placeholder');
    if (textRuns === 0) continue;

    if (Number(style.opacity) < 1) {
      skip('transparency', textRuns);
      continue;
    }
    if (style.textShadow !== 'none') {
      skip('text-shadow', textRuns);
      continue;
    }
    if (parseColor(style.getPropertyValue('-webkit-text-fill-color'))?.a === 0) {
      skip('text-fill', textRuns);
      continue;
    }
    if (clipped(element)) {
      skip('clipped', textRuns);
      continue;
    }
    const background = backgroundBehind(element);
    const foreground = parseColor(style.color);
    if (background === null || foreground === null) {
      skip('background', textRuns);
      continue;
    }
    checked += textRuns;
    const ink = foreground.a < 1 ? over(foreground, background) : foreground;
    const size = Number.parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const required = large ? 3 : 4.5;
    const ratio = Math.round(ratioBetween(ink, background) * 100) / 100;
    if (ratio < required) {
      findings.push({
        rule: 'color-contrast',
        impact: 'serious',
        message: `Contrast ${String(ratio)}:1 is below the required ${String(required)}:1 (${describe(ink)} on ${describe(background)} at ${style.fontSize}/${style.fontWeight})`,
        target: targetFor(element),
      });
    }
  }

  return { findings, checked, skipped, skippedByReason };
};
