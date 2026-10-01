import { ok, type MarketingSignupForm } from '#core/domain/index.js';
import type { MarketingSignupFormRepository } from '../marketing-signup-ports.js';

export class InMemoryMarketingSignupFormRepository implements MarketingSignupFormRepository {
  readonly forms: MarketingSignupForm[] = [];
  async findById(tenantId: string, formId: string) {
    return this.forms.find((form) => form.tenantId === tenantId && form.id === formId) ?? null;
  }
  async findBySlug(tenantId: string, slug: string) {
    return this.forms.find((form) => form.tenantId === tenantId && form.slug === slug) ?? null;
  }
  async findBySlugForUpdate(tenantId: string, slug: string) { return this.findBySlug(tenantId, slug); }
  async list(tenantId: string) { return this.forms.filter((form) => form.tenantId === tenantId); }
  async save(_tenantId: string, form: MarketingSignupForm) {
    const index = this.forms.findIndex((existing) => existing.tenantId === form.tenantId && existing.id === form.id);
    if (index === -1) this.forms.push(form);
    else this.forms.splice(index, 1, form);
    return ok(form);
  }
  async counters(_tenantId: string, _formId: string, now: string) {
    return { submissionsTotal: 0, submissions24h: 0, submissions7d: 0, confirmed: 0, pending: 0, computedAt: now };
  }
  async recordSubmission() {}
}
