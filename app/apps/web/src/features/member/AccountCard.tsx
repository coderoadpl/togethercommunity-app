import type { ComponentProps, ReactNode } from 'react';
import { Box } from '@mui/material';
import { SectionCard } from '../../components/layout/SectionCard.js';

export const AccountCard = ({ icon, title, ...props }: ComponentProps<typeof SectionCard> & { icon?: ReactNode }) => (
  <SectionCard {...props} mobilePadding title={icon === undefined ? title : (
    <Box component="span" sx={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      {icon}{title}
    </Box>
  )} />
);
