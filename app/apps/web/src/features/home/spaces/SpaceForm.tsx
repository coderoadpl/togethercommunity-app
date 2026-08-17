import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import type { SpaceVisibility } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';

export interface SpaceFormValues {
  name: string;
  slug: string;
  description: string;
  visibility: SpaceVisibility;
  productIds: string[];
  publicReadOnly: boolean;
  position: number;
}

interface SpaceFormProps {
  mode: 'create' | 'edit';
  initial: SpaceFormValues;
  pending: boolean;
  error: unknown;
  isDefaultHomeSpace?: boolean;
  onSubmit: (values: SpaceFormValues) => void;
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export const SpaceForm = ({
  mode,
  initial,
  pending,
  error,
  isDefaultHomeSpace = false,
  onSubmit,
}: SpaceFormProps) => {
  const t = useTranslations();
  const products = useQuery(actions.products);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [slugTouched, setSlugTouched] = useState(mode === 'edit');
  const [description, setDescription] = useState(initial.description);
  const [visibility, setVisibility] = useState<SpaceVisibility>(initial.visibility);
  const [productIds, setProductIds] = useState<string[]>(initial.productIds);
  const [publicReadOnly, setPublicReadOnly] = useState(initial.publicReadOnly);
  const [position, setPosition] = useState(String(initial.position));

  const productGatedMissing = visibility === 'product' && productIds.length === 0;
  const submittable = name.trim().length > 0 && (mode === 'edit' || slug.trim().length > 0) && !productGatedMissing;

  const toggleProduct = (id: string) =>
    setProductIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!submittable) return;
    onSubmit({
      name: name.trim(),
      slug: slug.trim(),
      description,
      visibility,
      productIds,
      publicReadOnly,
      position: Number.parseInt(position, 10) || 0,
    });
  };

  return (
    <SectionCard
      title={t.spacesPanel.detailsHeading}
      onSubmit={submit}
      actions={
        <Button
          type="submit"
          variant="contained"
          disabled={pending || !submittable}
          data-testid="space-form-submit"
        >
          {mode === 'create'
            ? pending
              ? t.spacesPanel.creating
              : t.spacesPanel.create
            : pending
              ? t.spacesPanel.saving
              : t.spacesPanel.save}
        </Button>
      }
    >
      <FormControl fullWidth>
        <FormLabel htmlFor="space-name">{t.spacesPanel.nameLabel}</FormLabel>
        <OutlinedInput
          id="space-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (mode === 'create' && !slugTouched) setSlug(slugify(event.target.value));
          }}
          required
        />
      </FormControl>

      {mode === 'create' ? (
        <FormControl fullWidth>
          <FormLabel htmlFor="space-slug">{t.spacesPanel.slugLabel}</FormLabel>
          <OutlinedInput
            id="space-slug"
            value={slug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(slugify(event.target.value));
            }}
            required
          />
          <FormHelperText>{t.spacesPanel.slugHint}</FormHelperText>
        </FormControl>
      ) : null}

      <FormControl fullWidth>
        <FormLabel htmlFor="space-description">{t.spacesPanel.descriptionLabel}</FormLabel>
        <OutlinedInput
          id="space-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          multiline
          minRows={3}
        />
      </FormControl>

      <FormControl fullWidth>
        <FormLabel htmlFor="space-visibility">{t.spacesPanel.visibilityLabel}</FormLabel>
        <Select
          id="space-visibility"
          value={visibility}
          onChange={(event) => setVisibility(event.target.value === 'product' ? 'product' : 'members')}
          inputProps={{ 'aria-label': t.spacesPanel.visibilityLabel }}
        >
          <MenuItem value="members">{t.spacesPanel.visibilityMembers}</MenuItem>
          <MenuItem value="product">{t.spacesPanel.visibilityProduct}</MenuItem>
        </Select>
      </FormControl>

      {visibility === 'product' ? (
        <FormControl component="fieldset" error={productGatedMissing}>
          <FormLabel component="legend">{t.spacesPanel.productsLabel}</FormLabel>
          {(products.data?.products ?? []).length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: '0.5rem' }}>
              {t.spacesPanel.noProducts}
            </Typography>
          ) : (
            <Stack sx={{ mt: '0.25rem' }}>
              {(products.data?.products ?? []).map((product) => (
                <FormControlLabel
                  key={product.id}
                  control={
                    <Checkbox
                      checked={productIds.includes(product.id)}
                      onChange={() => toggleProduct(product.id)}
                      data-testid={`space-product-${product.id}`}
                    />
                  }
                  label={product.title}
                />
              ))}
            </Stack>
          )}
          <FormHelperText>
            {productGatedMissing ? t.spacesPanel.productGatedNeedsProduct : t.spacesPanel.productsHint}
          </FormHelperText>
        </FormControl>
      ) : null}

      <FormControl>
        <FormControlLabel
          control={(
            <Checkbox
              checked={publicReadOnly}
              disabled={isDefaultHomeSpace && publicReadOnly}
              onChange={(event) => setPublicReadOnly(event.target.checked)}
            />
          )}
          label={t.spacesPanel.publicReadOnlyLabel}
        />
        <FormHelperText>
          {isDefaultHomeSpace && publicReadOnly
            ? t.spacesPanel.publicReadOnlyHomeSpaceBlocked
            : t.spacesPanel.publicReadOnlyHelper}
        </FormHelperText>
      </FormControl>

      {products.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(products.error, t), retry: { label: t.common.retry, onRetry: () => void products.refetch() } }} /> : null}

      {mode === 'edit' ? (
        <FormControl sx={{ maxWidth: '10rem' }}>
          <FormLabel htmlFor="space-position">{t.spacesPanel.positionLabel}</FormLabel>
          <OutlinedInput
            id="space-position"
            type="number"
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            inputProps={{ min: 0 }}
          />
        </FormControl>
      ) : null}

      {error !== undefined && error !== null ? <Alert severity="error">{localizeError(error, t)}</Alert> : null}
    </SectionCard>
  );
};
