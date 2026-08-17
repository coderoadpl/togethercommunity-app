import { useState, type ChangeEvent } from 'react';
import {
  Alert,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  Link,
  OutlinedInput,
  Stack,
} from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import { CoverPreview } from './CoverPreview.js';

export interface ImageAssetFieldProps {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  accept: string;
  allowedContentTypes: readonly string[];
  maxBytes: number;
  disabled?: boolean;
  testId: string;
  uploading?: boolean;
  uploadError?: string | null;
  storageMissing?: boolean;
  onUpload: (file: File) => void;
}

export const ImageAssetField = ({
  id,
  label,
  hint,
  value,
  onChange,
  accept,
  allowedContentTypes,
  maxBytes,
  disabled = false,
  testId,
  uploading = false,
  uploadError = null,
  storageMissing = false,
  onUpload,
}: ImageAssetFieldProps) => {
  const t = useTranslations();
  const [localError, setLocalError] = useState<string | null>(null);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    if (file.size > maxBytes) {
      setLocalError(t.imageAssets.tooLarge);
      return;
    }
    const contentType = allowedContentTypes.find((candidate) => candidate === file.type);
    if (contentType === undefined) {
      setLocalError(t.imageAssets.invalidType);
      return;
    }
    setLocalError(null);
    onUpload(file);
  };

  const previewUrl = value.trim();

  return (
    <FormControl fullWidth>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap sx={{ gap: '0.75rem' }}>
        <OutlinedInput
          id={id}
          type="text"
          value={value}
          disabled={disabled || uploading}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://…"
          inputProps={{ inputMode: 'url', 'data-testid': testId }}
          sx={{ flex: 1 }}
        />
        <Button
          component="label"
          variant="outlined"
          disabled={disabled || uploading}
          data-testid={`${testId}-upload`}
        >
          {uploading ? t.imageAssets.uploading : t.imageAssets.upload}
          <input
            type="file"
            accept={accept}
            disabled={disabled || uploading}
            hidden
            onChange={selectFile}
            data-testid={`${testId}-file-input`}
          />
        </Button>
      </Stack>
      {hint === undefined ? null : <FormHelperText>{hint}</FormHelperText>}
      {previewUrl === '' ? null : (
        <CoverPreview
          key={previewUrl}
          src={previewUrl}
          label={label}
          testId={`${testId}-preview`}
        />
      )}
      {localError === null ? null : <Alert severity="error">{localError}</Alert>}
      {storageMissing ? (
        <Alert severity="info">
          {t.imageAssets.storageMissing}{' '}
          <Link href="/panel/integrations#storage">{t.imageAssets.storageLink}</Link>
        </Alert>
      ) : null}
      {uploadError === null ? null : <Alert severity="error">{uploadError}</Alert>}
    </FormControl>
  );
};
