import { Link } from '@mui/material';

import { linkify } from '../../lib/linkify.js';

export const LinkifiedText = ({ text }: { text: string }) =>
  linkify(text).map((segment, index) => segment.href === null ? segment.text : (
    <Link key={index} href={segment.href} target="_blank" rel="noopener noreferrer nofollow" underline="always">
      {segment.text}
    </Link>
  ));
