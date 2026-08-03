import { err, integrationUnavailable, ok, type AppError, type Result } from '#core/domain/index.js';
import type { EmailPort } from '#core/server/index.js';

export interface ResendEmailSettings {
  apiKey: string;
  from: string;
  apiBaseUrl?: string;
}

export interface ResendHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface ResendHttpClient {
  request(input: {
    url: string;
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string;
  }): Promise<ResendHttpResponse>;
}

const resendMessageId = (value: unknown): string | null =>
  typeof value === 'object'
  && value !== null
  && 'id' in value
  && typeof value.id === 'string'
  && value.id !== ''
    ? value.id
    : null;

const resendErrorMessage = (value: unknown): string | null =>
  typeof value === 'object'
  && value !== null
  && 'message' in value
  && typeof value.message === 'string'
  && value.message !== ''
    ? value.message
    : null;

const defaultClient: ResendHttpClient = {
  request: (input) => fetch(input.url, {
    method: input.method,
    headers: input.headers,
    ...(input.body === undefined ? {} : { body: input.body }),
  }),
};

const failure = async (response: ResendHttpResponse): Promise<AppError> => {
  const body = await response.json().catch(() => null);
  const detail = resendErrorMessage(body) ?? `HTTP ${String(response.status)}`;
  return integrationUnavailable(`Resend rejected the request: ${detail}`);
};

export const createResendEmailPort = (
  settings: ResendEmailSettings,
  client: ResendHttpClient = defaultClient,
): EmailPort => {
  const apiBaseUrl = settings.apiBaseUrl ?? 'https://api.resend.com';
  const headers = {
    authorization: `Bearer ${settings.apiKey}`,
    'content-type': 'application/json',
  };
  const healthcheck = async (): Promise<Result<{ healthy: true }, AppError>> => {
    try {
      const response = await client.request({
        url: `${apiBaseUrl}/domains?limit=1`,
        method: 'GET',
        headers,
      });
      return response.ok ? ok({ healthy: true }) : err(await failure(response));
    } catch (cause) {
      return err(integrationUnavailable(`Could not connect to Resend: ${String(cause)}`));
    }
  };

  return {
    healthcheck,
    test: async () => {
      const healthy = await healthcheck();
      return healthy.ok
        ? ok({ code: 'email.available', message: 'Resend accepted the API key.' })
        : healthy;
    },
    send: async (message) => {
      try {
        const response = await client.request({
          url: `${apiBaseUrl}/emails`,
          method: 'POST',
          headers,
          body: JSON.stringify({
            from: settings.from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            ...(message.headers === undefined ? {} : { headers: message.headers }),
          }),
        });
        if (!response.ok) return err(await failure(response));
        const messageId = resendMessageId(await response.json());
        return messageId !== null
          ? ok({ messageId })
          : err(integrationUnavailable('Resend returned an invalid send response'));
      } catch (cause) {
        return err(integrationUnavailable(`Could not send Resend e-mail: ${String(cause)}`));
      }
    },
  };
};
