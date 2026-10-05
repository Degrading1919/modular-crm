import { afterEach, expect, it, vi } from "vitest";
const { createTransport, sendMail } = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
import { createPlatformEmailSender, customerEmailParts, unsubscribeHeaders } from "./platform-email.ts";
import { createConnectorRegistry } from "./mocks.ts";
afterEach(() => vi.clearAllMocks());
const smtp = { host: "relay.example.test", port: 587, secure: false, from: "Platform <mail@platform.test>", user: "relay-user", password: "relay-secret" };
const business = { name: "Yards & More", address: "42 Real Street", replyTo: "owner@business.test" };

it("sends multipart business mail with platform From, Reply-To, stable identity and one-click headers", async () => {
  createTransport.mockReturnValue({ sendMail });
  sendMail.mockResolvedValue({ accepted: ["customer@example.test"], rejected: [], messageId: "accepted-message" });
  const url = "https://crm.example.test/email/unsubscribe?token=signed";
  const parts = customerEmailParts("Visit <confirmed>\nTomorrow", business, url);
  const sender = createPlatformEmailSender(smtp, true, business);
  const input = { to: "customer@example.test", subject: "Your visit", idempotencyKey: "tenant:message", ...parts };
  await expect(sender.sendEmail(input)).resolves.toEqual({ status: "sent", reference: "accepted-message" });
  await sender.sendEmail(input);
  expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ requireTLS: true, auth: { user: "relay-user", pass: "relay-secret" } }));
  expect(sendMail.mock.calls[0]![0]).toMatchObject({ from: { name: business.name, address: "mail@platform.test" }, replyTo: business.replyTo,
    text: `Visit <confirmed>\nTomorrow\n\nYards & More\n42 Real Street\nStop automated emails: ${url}`,
    html: expect.stringContaining("Visit &lt;confirmed&gt;<br>Tomorrow"), headers: unsubscribeHeaders(url) });
  expect(sendMail.mock.calls[0]![0].messageId).toBe(sendMail.mock.calls[1]![0].messageId);
  expect(parts.html).toContain("Yards &amp; More");
});

it("exempts transactional mail and refuses bad input or SMTP rejection without leaking diagnostics", async () => {
  createTransport.mockReturnValue({ sendMail });
  const sender = createPlatformEmailSender(smtp, false, business);
  const input = { to: "customer@example.test", subject: "Receipt", body: "Thank you", idempotencyKey: "receipt" };
  await expect(sender.sendEmail({ ...input, subject: "Receipt\r\nBcc: victim@example.test" })).rejects.toMatchObject({ code: "invalid_request", retryable: false });
  expect(sendMail).not.toHaveBeenCalled();
  sendMail.mockResolvedValue({ accepted: [], rejected: [input.to] });
  await expect(sender.sendEmail(input)).rejects.toMatchObject({ code: "provider_error", retryable: true });
  sendMail.mockRejectedValue(new Error("relay-secret SMTP internals"));
  await expect(sender.sendEmail(input)).rejects.toMatchObject({ message: "We couldn’t send this email. We’ll try again." });
  expect(sendMail.mock.calls[0]![0].headers).toBeUndefined();
  expect(customerEmailParts("Receipt", business)).not.toHaveProperty("unsubscribeUrl");
});

it("registers no mocks in the production registry unless explicitly enabled", () => {
  expect(createConnectorRegistry().getDefinition("mock-communication")).toBeUndefined();
  expect(createConnectorRegistry().getDefinition("google-workspace")).toBeDefined();
  expect(createConnectorRegistry({ mockConnectors: true }).getDefinition("mock-communication")).toBeDefined();
});
