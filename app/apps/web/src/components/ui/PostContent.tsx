import { Box, styled } from '@mui/material';
import type { ComponentProps } from 'react';

import { FONT_MONO } from '../../theme.js';
import { LinkifiedText } from './LinkifiedText.js';

const PostContentRoot = styled(Box)(({ theme }) => ({
  ...theme.typography.body1,
  overflowWrap: 'anywhere',
  '& > :first-child': { marginTop: 0 },
  '& > :last-child': { marginBottom: 0 },
  '& p': { marginBlock: '0 0.75em' },
  '& h1, & h2, & h3': { marginBlock: '0.8em 0.4em' },
  '& ul, & ol': { marginBlock: '0.75em', paddingInlineStart: '1.5rem' },
  '& blockquote': {
    marginInline: 0,
    paddingInlineStart: '1rem',
    borderInlineStart: `3px solid ${theme.palette.divider}`,
  },
  '& pre': {
    maxWidth: '100%',
    overflowX: 'auto',
    padding: '0.75rem',
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.action.hover,
  },
  '& code': { fontFamily: FONT_MONO, overflowWrap: 'anywhere' },
  '& a': {
    color: theme.palette.primary.main,
    textDecoration: 'underline',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    '&:focus-visible': {
      outline: `3px solid ${theme.focusRing ?? theme.palette.primary.main}`,
      outlineOffset: 2,
    },
  },
}));

type PostContentProps = {
  'data-testid'?: string;
  sx?: ComponentProps<typeof Box>['sx'];
} & (
  | { html: string; plainText?: never; format: 'plain' | 'markdown' }
  | { html?: never; plainText: string; format?: never }
);

export const PostContent = ({ html, plainText, format, sx, ...rest }: PostContentProps) =>
  html === undefined ? (
    <PostContentRoot {...rest} sx={sx} style={{ whiteSpace: 'pre-wrap' }}>
      <LinkifiedText text={plainText} />
    </PostContentRoot>
  ) : (
    <PostContentRoot
      {...rest}
      sx={sx}
      style={format === 'plain' ? { whiteSpace: 'pre-wrap' } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
