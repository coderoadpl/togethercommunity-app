import { TenantHomePage } from '../features/home/TenantHomePage.js';
import { AnonHomePage } from '../features/member/AnonHomePage.js';
import { AnonShell } from '../features/member/shell/AnonShell.js';
import { ForeignTenantNotice } from '../features/member/shell/ForeignTenantNotice.js';

export const HomeRoute = () => (
  <TenantHomePage
    renderAnonymousHome={(visitorEmail) => (
      <AnonShell>
        {visitorEmail === null ? null : (
          <ForeignTenantNotice email={visitorEmail} hostname={window.location.hostname} />
        )}
        <AnonHomePage />
      </AnonShell>
    )}
  />
);
