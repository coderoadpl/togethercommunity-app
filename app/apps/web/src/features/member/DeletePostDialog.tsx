import { ConfirmDialog } from '../../components/layout/index.js';
import { useTranslations } from '../../i18n/index.js';

export const DeletePostDialog = ({
  pending,
  onClose,
  onConfirm,
}: {
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) => {
  const t = useTranslations();
  return (
    <ConfirmDialog
      open
      title={t.discussion.deleteConfirmTitle}
      body={t.discussion.deleteConfirmBody}
      confirmLabel={pending ? t.discussion.deleting : t.discussion.deleteConfirm}
      cancelLabel={t.common.cancel}
      pending={pending}
      onClose={onClose}
      onConfirm={onConfirm}
      confirmTestId="confirm-delete-post"
    />
  );
};
