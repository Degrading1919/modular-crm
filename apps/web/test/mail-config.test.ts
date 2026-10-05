import { afterEach, expect, it, vi } from "vitest";
const { createTransport, sendMail, getConfig } = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn(), getConfig: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
vi.mock("../lib/server-config", () => ({ getServerConfig: getConfig }));
import { sendDevelopmentEmail } from "../lib/mail.ts";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("uses the validated production mail host, TLS, credentials and sender", async () => {
  vi.stubEnv("NODE_ENV", "production");
  getConfig.mockReturnValue({ environment: "production", smtp: { host: "smtp.example", port: 587, secure: false, user: "sender", password: "private-password", from: "Service team <team@example.test>" } });
  createTransport.mockReturnValue({ sendMail });
  await sendDevelopmentEmail("customer@example.test", "Your service", "Service details");
  expect(createTransport).toHaveBeenCalledWith({ host: "smtp.example", port: 587, secure: false, requireTLS: true, auth: { user: "sender", pass: "private-password" } });
  expect(sendMail).toHaveBeenCalledWith({ from: "Service team <team@example.test>", to: "customer@example.test", subject: "Your service", text: "Service details" });
});
it("supports implicit TLS without falling back to development transport", async () => {
  vi.stubEnv("NODE_ENV", "production");
  getConfig.mockReturnValue({ environment: "production", smtp: { host: "smtp.example", port: 465, secure: true, from: "team@example.test" } });
  createTransport.mockReturnValue({ sendMail });
  await sendDevelopmentEmail("customer@example.test", "Service", "Details");
  expect(createTransport).toHaveBeenCalledWith({ host: "smtp.example", port: 465, secure: true, requireTLS: false });
});
it("keeps unit tests from sending real mail", async () => {
  vi.stubEnv("NODE_ENV", "test");
  await sendDevelopmentEmail("customer@example.test", "Service", "Details");
  expect(createTransport).not.toHaveBeenCalled();
});
