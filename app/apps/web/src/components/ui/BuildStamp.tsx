import { Typography } from '@mui/material';

import { buildStampText } from '../../lib/build-info.js';

export const BuildStamp = () => (
  <Typography
    variant="caption"
    component="span"
    color="text.secondary"
    data-testid="build-stamp"
  >
    {buildStampText()}
  </Typography>
);
