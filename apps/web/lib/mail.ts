import nodemailer from "nodemailer";

export async function sendDevelopmentEmail(to: string, subject: string, text: string): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  const transport = nodemailer.createTransport({
    host: process.env.MAILPIT_SMTP_HOST ?? "localhost",
    port: Number(process.env.MAILPIT_SMTP_PORT ?? 1025),
    secure: false,
  });
  await transport.sendMail({ from: "Modular CRM <no-reply@localhost>", to, subject, text });
}
