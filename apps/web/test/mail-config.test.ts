import { afterEach, expect, it, vi } from "vitest";
const { createTransport, sendMail, getConfig } = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn(), getConfig: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
vi.mock("../lib/server-config", () => ({ getServerConfig: getConfig }));
import { sendPlatformEmail } from "../lib/mail.ts";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("uses the validated production mail host, TLS, credentials and sender", async () => {
  vi.stubEnv("NODE_ENV", "production");
  getConfig.mockReturnValue({ environment: "production", smtp: { host: "smtp.example", port: 587, secure: false, user: "sender", password: "private-password", from: "Service team <team@example.test>" } });
  createTransport.mockReturnValue({ sendMail }); sendMail.mockResolvedValue({ accepted: ["customer@example.test"], messageId: "mail-1" });
  await sendPlatformEmail("customer@example.test", "Your service", "Service details", { name: "Happy Yards", replyTo: "owner@example.test", address: "42 Real Lane" });
  expect(createTransport).toHaveBeenCalledWith({ host: "smtp.example", port: 587, secure: false, requireTLS: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000, auth: { user: "sender", pass: "private-password" } });
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: "Happy Yards via Modular CRM", address: "team@example.test" }, replyTo: "owner@example.test", to: "customer@example.test", subject: "Your service", text: "Service details\n\nHappy Yards\n42 Real Lane", html: expect.stringContaining("42 Real Lane") }));
  expect(sendMail.mock.calls[0]?.[0].headers).toBeUndefined();
});
it("supports implicit TLS without falling back to development transport", async () => {
  vi.stubEnv("NODE_ENV", "production");
  getConfig.mockReturnValue({ environment: "production", smtp: { host: "smtp.example", port: 465, secure: true, from: "team@example.test" } });
  createTransport.mockReturnValue({ sendMail }); sendMail.mockResolvedValue({ accepted: ["customer@example.test"] });
  await sendPlatformEmail("customer@example.test", "Service", "Details");
  expect(createTransport).toHaveBeenCalledWith({ host: "smtp.example", port: 465, secure: true, requireTLS: false, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000 });
});
it("keeps unit tests from sending real mail", async () => {
  vi.stubEnv("NODE_ENV", "test");
  await sendPlatformEmail("customer@example.test", "Service", "Details");
  expect(createTransport).not.toHaveBeenCalled();
});
