import nodemailer from "nodemailer";
import { getServerConfig } from "./server-config";

export async function sendDevelopmentEmail(to: string, subject: string, text: string): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  const { smtp, environment } = getServerConfig();
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    requireTLS: environment === "production" && !smtp.secure,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password } } : {}),
  });
  await transport.sendMail({ from: smtp.from, to, subject, text });
}
