export const signupTestFixture = {
  "calls": {
    "listMarketingLists:[{\"archived\":false,\"limit\":50}]": {
      "ok": true,
      "value": {
        "lists": [
          {
            "archivedAt": null,
            "createdAt": "2026-07-01T12:00:00.000Z",
            "id": "list-launch",
            "key": "launch",
            "kind": "dynamic",
            "name": "Launch contacts",
            "revision": 1,
            "rule": {
              "kind": "tag",
              "match": "any",
              "tags": [
                "launch"
              ]
            },
            "tenantId": "tenant-studio",
            "updatedAt": "2026-07-01T12:00:00.000Z"
          },
          {
            "archivedAt": null,
            "createdAt": "2026-07-01T12:00:00.000Z",
            "id": "list-newsletter",
            "key": "newsletter",
            "kind": "static",
            "name": "Newsletter",
            "revision": 1,
            "rule": null,
            "tenantId": "tenant-studio",
            "updatedAt": "2026-07-01T12:00:00.000Z"
          }
        ],
        "nextCursor": null
      }
    },
    "listMarketingSignupForms:[{}]": {
      "ok": true,
      "value": {
        "forms": [
          {
            "form": {
              "id": "signup-newsletter",
              "tenantId": "tenant-studio",
              "slug": "newsletter",
              "name": "Studio newsletter",
              "consentDefinitionId": "newsletter",
              "consentVersion": {
                "id": "newsletter-v1",
                "tenantId": "tenant-studio",
                "definitionId": "newsletter",
                "version": 1,
                "label": "I agree to receive the newsletter and occasional product updates.",
                "documentVersionRef": {
                  "mode": "url",
                  "url": "https://example.org/privacy"
                },
                "createdAt": "2026-09-12T10:00:00.000Z",
                "createdBy": "owner"
              },
              "listId": null,
              "tags": [
                "newsletter",
                "website"
              ],
              "collectName": true,
              "successText": {
                "en": "Thank you for joining the newsletter.",
                "pl": "Thank you for joining the newsletter."
              },
              "redirectUrl": null,
              "allowedOrigins": [
                "https://example.org"
              ],
              "token": "signup_token_1234567890123456789012",
              "status": "active",
              "revision": 1,
              "createdAt": "2026-09-12T10:00:00.000Z",
              "updatedAt": "2026-09-12T10:00:00.000Z"
            },
            "counters": {
              "submissions24h": 12,
              "submissions7d": 85,
              "submissionsTotal": 412,
              "confirmed": 389,
              "pending": 23,
              "computedAt": "2026-09-12T10:00:00.000Z"
            }
          }
        ]
      }
    },
    "getTenantRouting:[]": {
      "ok": true,
      "value": {
        "routing": {
          "apexDomainsSupported": false,
          "canAddCustomDomain": true,
          "canonicalOrigin": "https://courses.example.org",
          "customDomains": [
            {
              "domain": "courses.example.org",
              "lastCheckedAt": null,
              "lastError": null,
              "records": [
                {
                  "name": "courses.example.org",
                  "purpose": "routing",
                  "status": "pending",
                  "type": "CNAME",
                  "value": "routing.example.org"
                },
                {
                  "name": "_vercel.courses.example.org",
                  "purpose": "ownership",
                  "status": "verified",
                  "type": "TXT",
                  "value": "vc-domain-verify=courses.example.org,challenge"
                }
              ],
              "status": "pending-dns",
              "storageCorsStatus": "unknown",
              "verified": false
            }
          ],
          "customDomainTarget": "routing.example.org",
          "storageCorsOrigins": [
            "https://workspace.example.org",
            "https://courses.example.org"
          ],
          "tenantHost": "workspace.example.org"
        }
      }
    },
    "listMarketingConsentDefinitions:[]": {
      "ok": true,
      "value": {
        "definitions": [
          {
            "id": "newsletter",
            "tenantId": "tenant-studio",
            "key": "newsletter",
            "kind": "optional_marketing",
            "channel": "email",
            "doubleOptIn": true,
            "status": "active",
            "documentRef": {
              "mode": "url",
              "url": "https://example.org/privacy"
            },
            "createdAt": "2026-09-12T10:00:00.000Z",
            "updatedAt": "2026-09-12T10:00:00.000Z"
          }
        ]
      }
    },
    "listMarketingLists:[{\"limit\":100}]": {
      "ok": true,
      "value": {
        "lists": [],
        "nextCursor": null
      }
    }
  },
  "principal": "creator@together.dev",
  "route": "/panel/marketing/forms",
  "scenario": "panel-marketing-forms",
  "tenant": "studio"
};
