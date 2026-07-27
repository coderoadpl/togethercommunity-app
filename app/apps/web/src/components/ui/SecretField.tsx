import type { FormEvent } from 'react';
import {
  Box,
  Button,
  Chip,
  FormControl,
  FormLabel,
  OutlinedInput,
  Typography,
} from '@mui/material';

export const SecretField = ({
  secretKey,
  label,
  maskedPreview,
  value,
  labels,
  saving = false,
  removing = false,
  saved = false,
  onValueChange,
  onSave,
  onRemove,
}: {
  secretKey: string;
  label: string;
  maskedPreview: string | null;
  value: string;
  labels: {
    configured: string;
    notConfigured: string;
    placeholder: string;
    save: string;
    saving: string;
    remove: string;
    removing: string;
    saved: string;
  };
  saving?: boolean;
  removing?: boolean;
  saved?: boolean;
  onValueChange: (value: string) => void;
  onSave: () => void;
  onRemove: () => void;
}) => {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };
  const inputId = `secret-${secretKey}`;

  return (
    <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: '0.6rem' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <FormLabel htmlFor={inputId} sx={{ m: 0 }}>
          {label}
        </FormLabel>
        <Chip
          size="small"
          variant="outlined"
          data-testid={`secret-status-${secretKey}`}
          label={maskedPreview ? `${labels.configured} · ${maskedPreview}` : labels.notConfigured}
        />
      </Box>
      <FormControl fullWidth>
        <OutlinedInput
          id={inputId}
          type="password"
          value={value}
          placeholder={labels.placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          inputProps={{ 'data-testid': `secret-input-${secretKey}` }}
          autoComplete="off"
        />
      </FormControl>
      <Box sx={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Button
          type="submit"
          variant="outlined"
          data-testid={`secret-save-${secretKey}`}
          disabled={saving || value.trim().length === 0}
        >
          {saving ? labels.saving : labels.save}
        </Button>
        {maskedPreview ? (
          <Button
            type="button"
            variant="text"
            color="error"
            data-testid={`secret-remove-${secretKey}`}
            disabled={removing}
            onClick={onRemove}
          >
            {removing ? labels.removing : labels.remove}
          </Button>
        ) : null}
      </Box>
      {saved ? (
        <Typography variant="caption" component="p" data-testid={`secret-saved-${secretKey}`}>
          {labels.saved}
        </Typography>
      ) : null}
    </Box>
  );
};
