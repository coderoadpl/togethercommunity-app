import { Alert, Button, List, ListItem, ListItemButton, ListItemIcon, ListItemText, SvgIcon } from '@mui/material';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { OnboardingStepId } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { SectionCard, StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations, type Messages } from '../../i18n/index.js';
import { ChecklistDoneLabel } from '../../theme.js';

const DONE_ICON_PATH =
  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z';
const OPEN_ICON_PATH =
  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z';

const stepLabel = (steps: Messages['onboarding']['steps'], id: OnboardingStepId): string => {
  switch (id) {
    case 'course_with_lesson':
      return steps.courseWithLesson;
    case 'product_with_price':
      return steps.productWithPrice;
    case 'published_product':
      return steps.publishedProduct;
    case 'first_member':
      return steps.firstMember;
    case 'payments_configured':
      return steps.paymentsConfigured;
  }
};

export const OnboardingChecklist = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const onboarding = useQuery(actions.onboarding);
  const dismiss = useMutation({
    ...actions.dismissOnboarding,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.onboardingInvalidates());
    },
  });

  if (onboarding.isPending) return <StatusView state={{ kind: 'loading', label: t.common.loading }} />;
  if (onboarding.isError) {
    return <StatusView state={{ kind: 'error', message: localizeError(onboarding.error, t), retry: { label: t.common.retry, onRetry: () => void onboarding.refetch() } }} />;
  }
  if (onboarding.data.onboarding.dismissed) return null;

  const steps = onboarding.data.onboarding.steps;
  const done = steps.filter((step) => step.done).length;
  const complete = done === steps.length;
  const stepsVisible = !complete || expanded;

  return (
    <SectionCard
      title={t.onboarding.title}
      description={t.onboarding.progress({ done, total: steps.length })}
      data-testid="onboarding-checklist"
      headerActions={
        <>
          {complete ? (
            <Button
              variant="text"
              aria-expanded={stepsVisible}
              onClick={() => setExpanded((current) => !current)}
              data-testid="onboarding-toggle"
            >
              {stepsVisible ? t.onboarding.hideSteps : t.onboarding.showSteps}
            </Button>
          ) : null}
          <Button
            variant="text"
            onClick={() => dismiss.mutate(undefined)}
            disabled={dismiss.isPending}
            data-testid="onboarding-dismiss"
          >
            {t.onboarding.dismiss}
          </Button>
        </>
      }
    >
      {stepsVisible || dismiss.isError ? (
        <>
          {stepsVisible ? <List disablePadding>
          {steps.map((step) => (
            <ListItem key={step.id} disableGutters disablePadding data-testid={`onboarding-step-${step.id}`}>
              <ListItemButton onClick={() => void navigate({ to: step.target })}>
                <ListItemIcon sx={{ minWidth: '2.25rem' }}>
                  <SvgIcon
                    fontSize="small"
                    viewBox="0 0 24 24"
                    color={step.done ? 'success' : 'disabled'}
                    titleAccess={step.done ? t.onboarding.stepDone : t.onboarding.stepOpen}
                  >
                    <path d={step.done ? DONE_ICON_PATH : OPEN_ICON_PATH} />
                  </SvgIcon>
                </ListItemIcon>
                <ListItemText
                  primary={
                    step.done ? (
                      <ChecklistDoneLabel>{stepLabel(t.onboarding.steps, step.id)}</ChecklistDoneLabel>
                    ) : (
                      stepLabel(t.onboarding.steps, step.id)
                    )
                  }
                />
              </ListItemButton>
            </ListItem>
          ))}
          </List> : null}
          {dismiss.isError ? <Alert severity="error">{localizeError(dismiss.error, t)}</Alert> : null}
        </>
      ) : null}
    </SectionCard>
  );
};
