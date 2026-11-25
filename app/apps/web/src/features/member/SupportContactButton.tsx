import { Button, type ButtonProps } from '@mui/material';
import { createLink } from '@tanstack/react-router';

import { useTranslations } from '../../i18n/index.js';

type SupportContact = { kind: 'address'; href: string; external: boolean } | { kind: 'form' };

const LINKABLE_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

const protocolOf = (url: string): string | null => {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
};

export const resolveSupportContact = (supportUrl: string | null | undefined, supportConfigured: boolean): SupportContact | null => {
  const protocol = typeof supportUrl === 'string' ? protocolOf(supportUrl) : null;
  if (typeof supportUrl === 'string' && protocol !== null && LINKABLE_PROTOCOLS.has(protocol)) {
    return { kind: 'address', href: supportUrl, external: protocol !== 'mailto:' };
  }
  return supportUrl !== undefined && supportConfigured ? { kind: 'form' } : null;
};

const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

const ButtonLink = createLink(({ href = '', ...props }: Omit<ButtonProps<'a'>, 'component'>) => <Button href={href} {...props} />);

export const SupportContactButton = ({ contact, testId, ...buttonProps }: { contact: SupportContact; testId: string } & Pick<ButtonProps, 'size' | 'fullWidth'>) => {
  const t = useTranslations();
  if (contact.kind === 'form') {
    return (
      <ButtonLink to="/account" search={{ tab: 'profile', support: 'open' }} variant="outlined" data-testid={testId} {...buttonProps}>
        {t.lesson.contactCreator}
      </ButtonLink>
    );
  }
  return (
    <Button
      href={contact.href}
      variant="outlined"
      data-testid={testId}
      {...buttonProps}
      {...(contact.external ? NEW_TAB : {})}
      aria-label={`${t.lesson.contactCreator} ${contact.external ? t.lesson.newTabHint : t.lesson.mailHint}`}
    >
      {t.lesson.contactCreator}
    </Button>
  );
};
