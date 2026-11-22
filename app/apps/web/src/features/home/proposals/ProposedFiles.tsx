import { useState } from 'react';
import { Alert, Button, Stack } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';
import type { ChangeProposalProposedFile } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatFileSize } from '../../../lib/format.js';
import { FinePrint, VisuallyHidden, WrapAnywhereText } from '../../../theme.js';
import { FieldDiffRow } from '../FieldDiff.js';
import { imageFingerprint, type FileChange, type FileChanges, type ProposalFile } from './proposal-display.js';
import { fileTypeLabel, Isolated } from './proposal-text.js';

type Translations = Messages['changeProposals'];

type DownloadState = 'idle' | 'loading' | 'gone' | 'failed';

const NBSP = '\u00a0';
const SEPARATOR = `${NBSP}· `;

export const Fingerprint = ({ value }: { value: string }) => (
  <span title={value} data-testid="file-fingerprint">
    <span aria-hidden>{imageFingerprint(value)}</span>
    <VisuallyHidden>{value}</VisuallyHidden>
  </span>
);

const FingerprintPart = ({ value }: { value: string | null }) => {
  const t = useTranslations().changeProposals;
  return value === null ? null : <>{`${SEPARATOR}${t.fileFingerprint}${NBSP}`}<Fingerprint value={value} /></>;
};

const FileUnavailable = () => {
  const t = useTranslations().changeProposals;
  return <Alert severity="warning" data-testid="proposed-file-unavailable">{t.fileUnavailable}</Alert>;
};

const FileDownload = ({ proposalId, fileId }: { proposalId: string; fileId: string }) => {
  const t = useTranslations().changeProposals;
  const queryClient = useQueryClient();
  const [state, setState] = useState<DownloadState>('idle');
  const download = async () => {
    setState('loading');
    try {
      const link = await queryClient.fetchQuery(actions.changeProposalFileLink({ id: proposalId, fileId }));
      setState('idle');
      window.location.assign(link.download.url);
    } catch (error) {
      setState(error instanceof ApiError && error.appError.code === 'not_found' ? 'gone' : 'failed');
    }
  };
  if (state === 'gone') return <FileUnavailable />;
  const loading = state === 'loading';
  return (
    <Stack useFlexGap spacing="0.35rem" sx={{ alignItems: 'flex-start', pt: '0.25rem' }}>
      <Button
        size="small"
        variant="outlined"
        disabled={loading}
        aria-busy={loading}
        onClick={() => void download()}
        data-testid="proposed-file-download"
      >
        {loading ? t.fileDownloadPreparing : t.fileDownload}
      </Button>
      {state === 'failed' ? <Alert severity="error" data-testid="proposed-file-download-failed">{t.fileDownloadFailed}</Alert> : null}
    </Stack>
  );
};

const ProposedFileFacts = ({
  file,
  proposed,
  pendingProposalId,
}: {
  file: ProposalFile;
  proposed: ChangeProposalProposedFile | undefined;
  pendingProposalId: string | null;
}) => {
  const t = useTranslations().changeProposals;
  const copiedFrom = proposed?.copiedFrom ?? null;
  return (
    <>
      {file.versionNote === null ? null : (
        <FinePrint component="p"><Isolated sentence={(note) => t.fileVersionNote({ note })} value={file.versionNote} /></FinePrint>
      )}
      {copiedFrom === null ? null : (
        <FinePrint component="p" data-testid="proposed-file-copy">
          {copiedFrom.productTitle === null
            ? t.fileCopiedFromGone({ version: copiedFrom.versionNumber })
            : <Isolated sentence={(product) => t.fileCopiedFrom({ version: copiedFrom.versionNumber, product })} value={copiedFrom.productTitle} />}
        </FinePrint>
      )}
      {pendingProposalId === null ? null : proposed?.available === false
        ? <FileUnavailable />
        : <FileDownload proposalId={pendingProposalId} fileId={file.id} />}
    </>
  );
};

export const currentVersionText = (t: Translations, change: Extract<FileChange, { kind: 'removed' }>): string => {
  if (change.current === null) return t.fileNoVersionLeft;
  return change.file.latest
    ? t.fileBecomesCurrent({ version: change.current.versionNumber })
    : t.fileStaysCurrent({ version: change.current.versionNumber });
};

const FileChangeText = ({
  change,
  proposedFiles,
  pendingProposalId,
}: {
  change: FileChange;
  proposedFiles: readonly ChangeProposalProposedFile[];
  pendingProposalId: string | null;
}) => {
  const t = useTranslations().changeProposals;
  const { language } = useLanguage();
  const size = (file: ProposalFile): string => formatFileSize(file.sizeBytes, language).replaceAll(' ', NBSP);
  const proposed = proposedFiles.find((entry) => entry.id === change.file.id);
  switch (change.kind) {
    case 'added':
      return (
        <Stack useFlexGap spacing="0.25rem" data-testid="proposed-file" data-change="added">
          <WrapAnywhereText variant="body2" component="p">
            <Isolated sentence={(name) => t.fileAdded({ name })} value={change.file.fileName} />
            {`${SEPARATOR}${fileTypeLabel(change.file.contentType)}${SEPARATOR}${size(change.file)}`}
            <FingerprintPart value={change.file.fingerprint} />
          </WrapAnywhereText>
          <ProposedFileFacts file={change.file} proposed={proposed} pendingProposalId={pendingProposalId} />
        </Stack>
      );
    case 'replaced':
      return (
        <Stack useFlexGap spacing="0.25rem" data-testid="proposed-file" data-change="replaced">
          <WrapAnywhereText variant="body2" component="p">
            <Isolated
              sentence={(name) => t.fileReplaced({ name, from: change.previous.versionNumber, to: change.file.versionNumber })}
              value={change.previous.fileName}
            />
            {`${SEPARATOR}${fileTypeLabel(change.file.contentType)}${SEPARATOR}${size(change.previous)}${NBSP}→ ${size(change.file)}`}
            <FingerprintPart value={change.file.fingerprint} />
          </WrapAnywhereText>
          {change.file.fileName === change.previous.fileName ? null : (
            <FinePrint component="p"><Isolated sentence={(name) => t.fileNewName({ name })} value={change.file.fileName} /></FinePrint>
          )}
          <ProposedFileFacts file={change.file} proposed={proposed} pendingProposalId={pendingProposalId} />
        </Stack>
      );
    case 'removed':
      return (
        <Stack useFlexGap spacing="0.25rem" data-testid="proposed-file" data-change="removed">
          <WrapAnywhereText variant="body2" component="p">
            <Isolated sentence={(name) => t.fileRemoved({ name, version: change.file.versionNumber })} value={change.file.fileName} />
            {`${SEPARATOR}${fileTypeLabel(change.file.contentType)}${SEPARATOR}${size(change.file)}`}
          </WrapAnywhereText>
          <FinePrint component="p">{currentVersionText(t, change)}</FinePrint>
          <FinePrint component="p">{t.fileRemoveOnlyFile}</FinePrint>
        </Stack>
      );
  }
};

export const FileChangeRows = ({
  files,
  proposedFiles,
  pendingProposalId,
  label,
  labelComponent,
}: {
  files: FileChanges;
  proposedFiles: readonly ChangeProposalProposedFile[];
  pendingProposalId: string | null;
  label: string;
  labelComponent: 'h3' | 'h4';
}) => {
  const t = useTranslations().changeProposals;
  return (
    <FieldDiffRow
      label={label}
      labelComponent={labelComponent}
      changed
      data-testid="proposal-file-changes"
      columns={[{
        label: t.columnAfter,
        value: (
          <Stack useFlexGap spacing="0.75rem">
            {files.changes.map((change) => (
              <FileChangeText key={`${change.kind}:${change.file.id}`} change={change} proposedFiles={proposedFiles} pendingProposalId={pendingProposalId} />
            ))}
          </Stack>
        ),
      }]}
    />
  );
};
