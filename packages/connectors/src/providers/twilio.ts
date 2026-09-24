import { ConnectorError, type ScopedCapabilities } from "../types.ts";
import type { ProviderFetch } from "./http.ts";
import { requestJson } from "./http.ts";

type TwilioMessageResponse = { sid?: unknown; status?: unknown };
type TwilioControl = { tenantId: string; now: () => Date; ensureAvailable: () => void; credentials: Readonly<Record<string, string>> };

function required(credentials: Readonly<Record<string, string>>, key: string): string {
  const value = credentials[key]?.trim();
  if (!value) throw new ConnectorError("invalid_request", "Twilio connection details are incomplete", false);
  return value;
}

export function createTwilioConfiguredScope(control: TwilioControl, fetcher: ProviderFetch = fetch): ScopedCapabilities {
  const accountSid = required(control.credentials, "accountSid");
  const authToken = required(control.credentials, "authToken");
  const sender = required(control.credentials, "sender");
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) throw new ConnectorError("invalid_request", "Twilio account ID is invalid", false);
  if (authToken.length > 256 || sender.length > 128) throw new ConnectorError("invalid_request", "Twilio connection details are invalid", false);
  const username = accountSid;
  const authorization = `Basic ${btoa(`${username}:${authToken}`)}`;

  return { sms: { async sendSms(input) {
    control.ensureAvailable();
    const to = input.to.trim();
    const body = input.body.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(to) || !body || body.length > 1_600 || !input.idempotencyKey.trim()) {
      throw new ConnectorError("invalid_request", "Enter a valid phone number and message", false);
    }

    const form = new URLSearchParams({ To: to, Body: body });
    if (/^MG[0-9a-fA-F]{32}$/.test(sender)) form.set("MessagingServiceSid", sender);
    else if (/^\+[1-9]\d{7,14}$/.test(sender)) form.set("From", sender);
    else throw new ConnectorError("invalid_request", "Twilio sender must be a verified number or messaging service", false);

    // The Twilio Messages create endpoint does not document idempotency-key support. The
    // capability key is validated but deliberately not sent as a made-up provider header.
    const result = await requestJson<TwilioMessageResponse>(fetcher,
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
        body: form,
      });
    if (typeof result.sid !== "string" || !/^SM[0-9a-fA-F]{32}$|^MM[0-9a-fA-F]{32}$/.test(result.sid)) {
      throw new ConnectorError("provider_error", "Twilio returned an invalid message reference", false);
    }
    // A successful REST response means Twilio accepted/queued the message, not that the handset received it.
    return { reference: result.sid, status: "sent" as const };
  } } };
}
