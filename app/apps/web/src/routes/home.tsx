import { TenantHomePage } from '../features/home/TenantHomePage.js';
import { AnonHomePage } from '../features/member/AnonHomePage.js';
import { AnonShell } from '../features/member/shell/AnonShell.js';

export const HomeRoute = () => (
  <TenantHomePage
    anonymousHome={
      <AnonShell>
        <AnonHomePage />
      </AnonShell>
    }
  />
);
