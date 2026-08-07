import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PNG } from 'pngjs';

const iconsDir = join(import.meta.dirname, '..', 'apps', 'web', 'public', 'icons');
const SOURCE_SIZE = 512;
const SAMPLE_GRID = 4;
const SAMPLE_COUNT = SAMPLE_GRID * SAMPLE_GRID;

const insideRoundedSquare = (x: number, y: number, size: number): boolean => {
  const radius = (112 * size) / SOURCE_SIZE;
  const nearestX = Math.max(radius, Math.min(size - radius, x));
  const nearestY = Math.max(radius, Math.min(size - radius, y));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
};

const insideMark = (x: number, y: number, size: number): boolean => {
  const scale = size / SOURCE_SIZE;
  return (
    (x >= 136 * scale && x < 376 * scale && y >= 120 * scale && y < 176 * scale)
    || (x >= 228 * scale && x < 284 * scale && y >= 176 * scale && y < 392 * scale)
  );
};

const render = (svgFile: string, size: number, outFile: string): void => {
  const svg = readFileSync(join(iconsDir, svgFile), 'utf8');
  const rounded = svg.includes('rx="112"');
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let backgroundSamples = 0;
      let markSamples = 0;
      for (let sampleY = 0; sampleY < SAMPLE_GRID; sampleY += 1) {
        for (let sampleX = 0; sampleX < SAMPLE_GRID; sampleX += 1) {
          const pointX = x + (sampleX + 0.5) / SAMPLE_GRID;
          const pointY = y + (sampleY + 0.5) / SAMPLE_GRID;
          if (!rounded || insideRoundedSquare(pointX, pointY, size)) backgroundSamples += 1;
          if (insideMark(pointX, pointY, size)) markSamples += 1;
        }
      }
      const offset = (y * size + x) * 4;
      const tileSamples = backgroundSamples - markSamples;
      png.data[offset] = backgroundSamples === 0
        ? 0
        : Math.round((markSamples * 250 + tileSamples * 24) / backgroundSamples);
      png.data[offset + 1] = backgroundSamples === 0
        ? 0
        : Math.round((markSamples * 250 + tileSamples * 24) / backgroundSamples);
      png.data[offset + 2] = backgroundSamples === 0
        ? 0
        : Math.round((markSamples * 250 + tileSamples * 27) / backgroundSamples);
      png.data[offset + 3] = Math.round((backgroundSamples * 255) / SAMPLE_COUNT);
    }
  }
  writeFileSync(join(iconsDir, outFile), PNG.sync.write(png));
};

render('together-mark.svg', 192, 'pwa-192.png');
render('together-mark.svg', 512, 'pwa-512.png');
render('together-mark-maskable.svg', 512, 'pwa-maskable-512.png');
render('together-mark-maskable.svg', 180, 'apple-touch-icon.png');
