import nodemailer from "nodemailer";
import { createHash } from "node:crypto";
import { ConnectorError, type EmailCapability, type EmailInput } from "./types.ts";

export type EmailBusiness = { name: string; address?: string; replyTo?: string; tenantId?: string; customerId?: string };
export type SmtpConfig = { host: string; port: number; secure: boolean; user?: string; password?: string; from: string };
export function unsubscribeHeaders(url?: string) {
  return url ? { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined;
}
/** MIME for live email APIs that accept raw messages, composed without network IO. */
export async function compileEmailMime(input: EmailInput): Promise<Buffer> {
  const result = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" }).sendMail({
    to: input.to, subject: input.subject, text: input.body, html: input.html, replyTo: input.replyTo, headers: unsubscribeHeaders(input.unsubscribeUrl),
  });
  if (!Buffer.isBuffer(result.message)) throw new ConnectorError("provider_error", "This email could not be prepared.", false);
  return result.message;
}
export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
export function customerEmailParts(body: string, business: EmailBusiness, unsubscribeUrl?: string) {
  const footer = [business.name, business.address].filter(Boolean).join("\n");
  return {
    body: `${body}\n\n${footer}${unsubscribeUrl ? `\nStop promotional emails: ${unsubscribeUrl}` : ""}`,
    html: `<div>${escapeEmailHtml(body).replace(/\n/g, "<br>")}</div><hr><p>${escapeEmailHtml(footer).replace(/\n/g, "<br>")}</p>${unsubscribeUrl ? `<p><a href="${escapeEmailHtml(unsubscribeUrl)}">Stop promotional emails</a></p>` : ""}`,
    ...(business.replyTo ? { replyTo: business.replyTo } : {}),
    ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
  };
}
/** Runtime SMTP only. No owner setup, vendor SDK, or test-success shortcut. */
export function createPlatformEmailSender(smtp: SmtpConfig, production: boolean, business: EmailBusiness = { name: "Modular CRM" }, platformName = "Modular CRM"): EmailCapability {
  const transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure,
    requireTLS: production && !smtp.secure, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password } } : {}),
  });
  const address = smtp.from.match(/<([^<>]+)>/)?.[1] ?? smtp.from;
  return { async sendEmail(input) {
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.to) || !input.subject.trim() || /[\r\n]/.test(input.subject)) {
      throw new ConnectorError("invalid_request", "Check the email address and subject.", false);
    }
    try {
      const sent = await transport.sendMail({ from: { name: `${business.name} via ${platformName}`, address }, to: input.to, subject: input.subject,
        text: input.body, html: input.html ?? `<p>${escapeEmailHtml(input.body).replace(/\n/g, "<br>")}</p>`,
        replyTo: input.replyTo ?? business.replyTo,
        // Stable identity aids diagnostics; SMTP itself cannot guarantee exactly-once delivery.
        messageId: `<${createHash("sha256").update(input.idempotencyKey).digest("hex")}@${address.split("@")[1]}>`,
        headers: unsubscribeHeaders(input.unsubscribeUrl),
      });
      if (sent.rejected?.length || !sent.accepted?.length) throw new Error("Recipient not accepted");
      return { status: "sent", ...(typeof sent.messageId === "string" ? { reference: sent.messageId } : {}) };
    } catch { throw new ConnectorError("provider_error", "We couldn’t send this email. We’ll try again.", true); }
  } };
}
