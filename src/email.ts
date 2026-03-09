import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const host = process.env.SMTP_HOST;
const port = process.env.SMTP_PORT
  ? Number(process.env.SMTP_PORT)
  : undefined;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const secure = process.env.SMTP_SECURE === "true";
const from = process.env.EMAIL_FROM || user || "no-reply@example.com";

let transporter: nodemailer.Transporter | null = null;

function ensureTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  if (!host || !port || !user || !pass) {
    throw new Error(
      "SMTP is not configured. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and optionally SMTP_SECURE and EMAIL_FROM.",
    );
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });

  return transporter;
}

export async function sendVerificationEmail(
  to: string,
  code: string,
): Promise<void> {
  const t = ensureTransporter();

  const appName = process.env.APP_NAME || "Phone Backup Portal";

  await t.sendMail({
    from,
    to,
    subject: `${appName} – Your verification code`,
    text: `Your verification code is: ${code}\n\nEnter this code in the browser to verify your email.\n\nIf you did not request this, you can ignore this email.`,
  });
}

