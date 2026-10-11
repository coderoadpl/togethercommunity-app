import { useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { Product } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog } from '../../../components/layout/index.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';

export const DeleteProductDraftAction = ({ product, onDeleted }: {
  product: Product;
  onDeleted?: () => void;
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const deleteDraft = useMutation({
    ...actions.deleteProductDraft,
    onSuccess: async () => {
      setOpen(false);
      onDeleted?.();
      await queryClient.invalidateQueries(actions.productsInvalidates());
    },
  });

  if (product.published) return null;

  return (
    <>
      <Button size="small" color="error" onClick={() => setOpen(true)}>{t.products.deleteDraft}</Button>
      <ConfirmDialog
        open={open}
        title={t.products.deleteDraft}
        body={(
          <Stack spacing={1}>
            <Typography>{t.products.deleteDraftBody}</Typography>
            {deleteDraft.isError ? <Alert severity="error">{localizePanelError(deleteDraft.error, t)}</Alert> : null}
          </Stack>
        )}
        cancelLabel={t.common.cancel}
        confirmLabel={t.products.deleteDraft}
        pending={deleteDraft.isPending}
        onClose={() => setOpen(false)}
        onConfirm={() => deleteDraft.mutate({ productId: product.id })}
      />
    </>
  );
};
