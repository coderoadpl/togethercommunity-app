# SES onboarding

The SNS subscription always points at the platform host for the tenant webhook path. Custom domains
never change the subscription endpoint, so confirming, replacing, or removing a custom domain does
not move the SES feedback loop away from the platform host. User-facing unsubscribe and preference
links may still use the tenant origin separately.
