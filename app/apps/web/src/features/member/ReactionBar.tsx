import { useState } from 'react';
import { Chip, IconButton, Popover, Stack } from '@mui/material';

import { REACTION_EMOJIS, type ReactionEmoji, type ReactionSummary } from '#core/domain/index.js';

import { useTranslations } from '../../i18n/index.js';

const usedReactions = (reactions: ReactionSummary[]): ReactionSummary[] =>
  REACTION_EMOJIS.map((emoji) => reactions.find((reaction) => reaction.emoji === emoji)).filter(
    (reaction): reaction is ReactionSummary => reaction !== undefined,
  );

export const ReactionBar = ({
  postId,
  reactions,
  testIdPrefix,
  onToggle,
  busy = false,
}: {
  postId: string;
  reactions: ReactionSummary[];
  testIdPrefix: string;
  onToggle?: (emoji: ReactionEmoji, reacted: boolean) => void;
  busy?: boolean;
}) => {
  const t = useTranslations();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const used = usedReactions(reactions);

  if (onToggle === undefined) {
    if (used.length === 0) return null;
    return (
      <Stack direction="row" useFlexGap sx={{ columnGap: '0.5rem', flexWrap: 'wrap' }}>
        {used.map((reaction) => (
          <Chip
            key={reaction.emoji}
            size="small"
            variant="outlined"
            data-testid={`${testIdPrefix}-${postId}-${reaction.emoji}`}
            label={`${reaction.emoji} ${String(reaction.count)}`}
          />
        ))}
      </Stack>
    );
  }

  const toggle = (emoji: ReactionEmoji, reacted: boolean) => {
    setAnchorEl(null);
    onToggle(emoji, reacted);
  };

  return (
    <Stack direction="row" useFlexGap sx={{ alignItems: 'center', columnGap: '0.5rem', flexWrap: 'wrap' }}>
      {used.map((reaction) => (
        <Chip
          key={reaction.emoji}
          size="small"
          variant={reaction.viewerReacted ? 'filled' : 'outlined'}
          color={reaction.viewerReacted ? 'primary' : 'default'}
          disabled={busy}
          aria-pressed={reaction.viewerReacted}
          aria-label={t.community.reactAria({ emoji: reaction.emoji })}
          data-testid={`${testIdPrefix}-${postId}-${reaction.emoji}`}
          label={`${reaction.emoji} ${String(reaction.count)}`}
          onClick={() => onToggle(reaction.emoji, reaction.viewerReacted)}
        />
      ))}
      <Chip
        size="small"
        variant="outlined"
        disabled={busy}
        aria-haspopup="true"
        aria-expanded={anchorEl === null ? undefined : true}
        aria-label={t.community.addReaction}
        data-testid={`reaction-picker-${postId}`}
        label="+"
        onClick={(event) => setAnchorEl(event.currentTarget)}
      />
      <Popover
        anchorEl={anchorEl}
        open={anchorEl !== null}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Stack direction="row" useFlexGap sx={{ columnGap: '0.25rem', p: '0.35rem' }}>
          {REACTION_EMOJIS.map((emoji) => {
            const reacted = used.find((reaction) => reaction.emoji === emoji)?.viewerReacted ?? false;
            return (
              <IconButton
                key={emoji}
                size="small"
                color={reacted ? 'primary' : 'default'}
                aria-pressed={reacted}
                aria-label={t.community.reactAria({ emoji })}
                data-testid={`reaction-option-${postId}-${emoji}`}
                onClick={() => toggle(emoji, reacted)}
              >
                {emoji}
              </IconButton>
            );
          })}
        </Stack>
      </Popover>
    </Stack>
  );
};
