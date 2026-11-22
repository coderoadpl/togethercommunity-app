import { useState, type ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

import { BreakAnywhereText, CoverImageElement, Eyebrow, FinePrint, VersionDiffRow } from '../../theme.js';

export interface FieldDiffColumn {
  label: ReactNode;
  value: ReactNode;
}

export const FieldDiffRow = ({
  label,
  columns,
  changed,
  labelComponent = 'h4',
  'data-testid': testId,
}: {
  label: ReactNode;
  columns: readonly FieldDiffColumn[];
  changed: boolean;
  labelComponent?: 'h3' | 'h4';
  'data-testid'?: string;
}) => (
  <VersionDiffRow
    useFlexGap
    spacing="0.4rem"
    changed={changed}
    data-testid={testId}
    data-changed={changed ? 'true' : 'false'}
  >
    <Eyebrow variant="overline" component={labelComponent}>
      {label}
    </Eyebrow>
    <Stack useFlexGap direction={{ xs: 'column', sm: 'row' }} spacing="1rem">
      {columns.map((column, index) => (
        <Box key={index} sx={{ flex: 1, minWidth: 0 }}>
          <FinePrint component="p">{column.label}</FinePrint>
          {column.value}
        </Box>
      ))}
    </Stack>
  </VersionDiffRow>
);

export const FieldDiffEmpty = ({ children }: { children: ReactNode }) => (
  <FinePrint component="p">{children}</FinePrint>
);

export const FieldDiffText = ({ children, breakAnywhere = false }: { children: ReactNode; breakAnywhere?: boolean }) =>
  breakAnywhere
    ? <BreakAnywhereText variant="body2">{children}</BreakAnywhereText>
    : <Typography variant="body2">{children}</Typography>;

export const FieldDiffList = ({ items }: { items: readonly { key: string; content: ReactNode }[] }) => (
  <Stack component="ul" useFlexGap spacing="0.15rem" sx={{ m: 0, pl: '1.1rem' }}>
    {items.map((item) => (
      <Typography key={item.key} component="li" variant="body2">
        {item.content}
      </Typography>
    ))}
  </Stack>
);

export const FieldDiffImage = ({ url, failedNote }: { url: string; failedNote?: ReactNode }) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === url;
  return (
    <Stack useFlexGap spacing="0.35rem">
      {failed ? null : (
        <Box sx={{ maxWidth: '12rem' }}>
          <CoverImageElement frame="card" src={url} alt="" onError={() => setFailedUrl(url)} />
        </Box>
      )}
      <BreakAnywhereText component="p" variant="caption">
        {url}
      </BreakAnywhereText>
      {failed && failedNote !== undefined ? <FinePrint component="p">{failedNote}</FinePrint> : null}
    </Stack>
  );
};
