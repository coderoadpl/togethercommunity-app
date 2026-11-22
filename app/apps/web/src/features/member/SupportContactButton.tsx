import { Button, type ButtonProps } from '@mui/material';
import { createLink } from '@tanstack/react-router';

import { useTranslations } from '../../i18n/index.js';

type SupportContact = { kind: 'address'; href: string; external: boolean } | { kind: 'form' };

export const resolveSupportContact = (supportUrl: string | null | undefined, supportConfigured: boolean): SupportContact | null => {
  if (typeof supportUrl === 'string') {
    return { kind: 'address', href: supportUrl, external: !supportUrl.toLowerCase().startsWith('mailto:') };
  }
  return supportUrl === null && supportConfigured ? { kind: 'form' } : null;
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
