import { emailUnsubscribeTarget, unsubscribeEmail } from "@modular-crm/db";
import { escapeEmailHtml } from "@modular-crm/connectors";
import { getDb } from "../../../lib/db";
import { authSigningSecret } from "../../../lib/runtime-secret";
import { apiError } from "../../../lib/api/http";

function page(message: string, token?: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Email preferences</title><body><main><h1>Email preferences</h1><p>${escapeEmailHtml(message)}</p>${token ? `<form method="post" action="?token=${escapeEmailHtml(encodeURIComponent(token))}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Stop promotional emails</button></form>` : ""}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'", "x-robots-tag": "noindex" } });
}
export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    if (!await emailUnsubscribeTarget(getDb(), token, authSigningSecret())) return page("This email preference link is not valid.", undefined, 400);
    return page("Stop promotional emails from this business. Service updates such as appointment reminders and invoices, and account access emails, continue.", token);
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 2048) return page("This request is too large.", undefined, 413);
    const body = await request.formData();
    if (body.get("List-Unsubscribe") !== "One-Click") return page("This email preference request is not valid.", undefined, 400);
    const token = new URL(request.url).searchParams.get("token") ?? "";
    if (!await unsubscribeEmail(getDb(), token, authSigningSecret())) return page("This email preference link is not valid.", undefined, 400);
    return page("You’ve stopped promotional emails from this business. Service updates such as appointment reminders and invoices, and account access emails, continue.");
  } catch (error) { return apiError(error); }
}
