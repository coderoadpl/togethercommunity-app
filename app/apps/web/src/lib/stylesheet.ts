const MIN_WIDTH = /min-width:\s*(\d+)px/u;

const declarationsOf = (style: CSSStyleDeclaration): [string, string][] =>
  Array.from({ length: style.length }, (_, index) => style.item(index)).map((property) => [
    property,
    style.getPropertyValue(property),
  ]);

const matches = (element: Element, selector: string): boolean => {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
};

const appliedRules = (
  rules: CSSRuleList,
  element: Element,
  viewportWidth: number,
): [string, string][] =>
  [...rules].flatMap((rule) => {
    if (rule instanceof CSSMediaRule) {
      const minWidth = MIN_WIDTH.exec(rule.conditionText);
      return minWidth !== null && Number(minWidth[1]) <= viewportWidth
        ? appliedRules(rule.cssRules, element, viewportWidth)
        : [];
    }
    if (!(rule instanceof CSSStyleRule) || !matches(element, rule.selectorText)) return [];
    return declarationsOf(rule.style);
  });

/**
 * jsdom never evaluates media queries, so `toHaveStyle` sees only the base
 * declarations — responsive `sx` values have to be read off the stylesheet.
 */
export const stylesAt = (
  element: Element | null | undefined,
  viewportWidth: number,
): Record<string, string> => {
  if (element === null || element === undefined) throw new Error('stylesAt was given no element');
  return Object.fromEntries(
    [...document.styleSheets].flatMap((sheet) => appliedRules(sheet.cssRules, element, viewportWidth)),
  );
};
