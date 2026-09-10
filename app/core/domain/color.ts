const hexChannel = (hex: string, offset: number): number =>
  Number.parseInt(hex.slice(offset + 1, offset + 3), 16);

const linearChannel = (value: number): number => {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (hex: string): number =>
  0.2126 * linearChannel(hexChannel(hex, 0)) +
  0.7152 * linearChannel(hexChannel(hex, 2)) +
  0.0722 * linearChannel(hexChannel(hex, 4));

export const contrastRatio = (a: string, b: string): number => {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

export const deriveLightAccent = (
  accent: string,
  backgrounds: readonly string[] = ['#F7F4EF', '#FFFFFF', '#F4F4F2'],
): string => {
  const passes = (color: string): boolean =>
    backgrounds.every((background) => contrastRatio(color, background) >= 4.5);
  if (passes(accent)) return accent;
  const darken = (factor: number): string => `#${[0, 2, 4].map((offset) =>
    Math.round(hexChannel(accent, offset) * factor).toString(16).padStart(2, '0')).join('')}`;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (passes(darken(middle))) low = middle;
    else high = middle;
  }
  return darken(low);
};

export const deriveDarkAccent = (
  accent: string,
  backgrounds: readonly string[] = ['#0F1012', '#17181B', '#1B1D20'],
): string => {
  const passes = (color: string): boolean =>
    backgrounds.every((background) => contrastRatio(color, background) >= 4.5);
  if (passes(accent)) return accent;
  const lighten = (weight: number): string => `#${[0, 2, 4].map((offset) => {
    const channel = hexChannel(accent, offset);
    return Math.round(channel + (255 - channel) * weight).toString(16).padStart(2, '0');
  }).join('')}`;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (passes(lighten(middle))) high = middle;
    else low = middle;
  }
  return lighten(high);
};
