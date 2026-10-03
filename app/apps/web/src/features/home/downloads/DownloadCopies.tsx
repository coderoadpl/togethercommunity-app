import { useState, type FormEvent } from 'react';
import { Alert, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { useInfiniteQuery } from '@tanstack/react-query';

import { copyIdentifierSchema } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { SectionCard } from '../../../components/layout/index.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';

export const DownloadCopies = ({ query }: { query: Parameters<typeof actions.downloadCopies>[0] }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const copies = useInfiniteQuery(actions.downloadCopies(query));
  const rows = copies.data?.pages.flatMap((page) => page.copies);
  return <SectionCard title={t.downloadCopies.title}>
    <Stack useFlexGap spacing="1rem">
      {copies.isPending ? <Typography>{t.common.loading}</Typography> : null}
      {copies.isError ? <Alert severity="error">{localizePanelError(copies.error, t)}</Alert> : null}
      {rows?.length === 0 ? <Typography>{t.downloadCopies.empty}</Typography> : null}
      {rows?.map((copy) => <Stack key={copy.id} spacing="0.25rem" sx={{ overflowWrap: 'anywhere' }}>
        <Typography>{t.downloadCopies.identifier}: {copy.copyIdentifier}</Typography>
        <Typography>{t.downloadCopies.member}: <Link href={`/panel/members/${encodeURIComponent(copy.memberId)}`}>{copy.memberId}</Link></Typography>
        <Typography>{t.downloadCopies.order}: {copy.orderId === null ? t.downloadCopies.noOrder : <Link href={`/panel/sales/${encodeURIComponent(copy.orderId)}`}>{copy.orderId}</Link>}</Typography>
        {query.memberId === undefined ? null : <Typography>{t.downloadCopies.product}: <Link href={`/panel/products/${encodeURIComponent(copy.productId)}`}>{copy.productId}</Link></Typography>}
        <Typography>{t.downloadCopies.file}: {copy.fileName}</Typography>
        <Typography>{t.downloadCopies.version}: {copy.versionNumber}</Typography>
        <Typography>{t.downloadCopies.time}: {formatDateTime(copy.createdAt, language)}</Typography>
        {!copy.personalised ? <Typography color="text.secondary">{t.downloadCopies.fallback}</Typography> : null}
      </Stack>)}
      {copies.hasNextPage ? <Button disabled={copies.isFetchingNextPage} onClick={() => { void copies.fetchNextPage(); }}>
        {t.downloadCopies.showMore}
      </Button> : null}
    </Stack>
  </SectionCard>;
};

export const DownloadCopyLookup = ({ productId }: { productId: string }) => {
  const t = useTranslations();
  const [input, setInput] = useState('');
  const [identifier, setIdentifier] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = copyIdentifierSchema.safeParse(input.trim());
    setInvalid(!parsed.success);
    if (parsed.success) setIdentifier(parsed.data);
  };
  return <>
    <SectionCard title={t.downloadCopies.find} data-testid="download-copy-lookup">
      <Stack component="form" onSubmit={submit} useFlexGap spacing="1rem">
        <TextField label={t.downloadCopies.identifier} value={input} onChange={(event) => setInput(event.target.value)}
          error={invalid} helperText={invalid ? t.downloadCopies.invalid : undefined} />
        <Button type="submit">{t.downloadCopies.search}</Button>
      </Stack>
    </SectionCard>
    {identifier === null ? null : <DownloadCopies query={{ productId, copyIdentifier: identifier }} />}
  </>;
};
