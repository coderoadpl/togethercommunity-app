import type { CustomProjectConfig } from 'lost-pixel';

export const config: CustomProjectConfig = {
  storybookShots: {
    storybookUrl: 'storybook-static',
    breakpoints: [390, 1440],
  },
  imagePathBaseline: 'tasks/lost-pixel-baselines',
  imagePathCurrent: 'out/lost-pixel/current',
  imagePathDifference: 'out/lost-pixel/difference',
  compareEngine: 'pixelmatch',
  threshold: 0.01,
  failOnDifference: true,
  waitBeforeScreenshot: 500,
  flakynessRetries: 1,
  shotConcurrency: 4,
};
