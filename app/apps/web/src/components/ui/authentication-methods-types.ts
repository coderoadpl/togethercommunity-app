import type { ComponentType, ReactNode } from 'react';
import type { AccountSectionProps } from './AccountSection.js';
interface OperationState {
  pending: boolean;
  success: boolean;
  error: Error | null;
}

interface PasskeyRow {
  id: string;
  name: string;
  createdAt: string;
}

export interface AuthenticationMethodsProps {
  twoFactorEnabled?: boolean;
  onSecurityRefresh?(): void;
  passwordCard?: ReactNode;
  sessionsCard?: ReactNode;
  Card?: ComponentType<AccountSectionProps>;
  presentation?: 'account' | 'embedded';
  passkeys: {
    data: PasskeyRow[] | undefined;
    pending: boolean;
    error: Error | null;
    retry(): void;
  };
  registerPasskey: OperationState & {
    run(input: { name: string; password: string }): void;
  };
  removePasskey: OperationState & {
    run(input: { id: string; password: string }): void;
  };
  requestPasswordSetup: OperationState & {
    run(): void;
  };
  enableTwoFactor: OperationState & {
    data: { totpURI: string; backupCodes: string[] } | undefined;
    submittedAt: number;
    run(input: { password: string }): void;
  };
  verifyTotp: OperationState & {
    submittedAt: number;
    run(input: { code: string }): void;
  };
  disableTwoFactor: OperationState & {
    submittedAt: number;
    run(input: { password: string }): void;
  };
  regenerateBackupCodes: OperationState & {
    data: string[] | undefined;
    submittedAt: number;
    run(input: { password: string }): void;
  };
}
