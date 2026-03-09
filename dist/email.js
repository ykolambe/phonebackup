"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendVerificationEmail = sendVerificationEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const host = process.env.SMTP_HOST;
const port = process.env.SMTP_PORT
    ? Number(process.env.SMTP_PORT)
    : undefined;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const secure = process.env.SMTP_SECURE === "true";
const from = process.env.EMAIL_FROM || user || "no-reply@example.com";
let transporter = null;
function ensureTransporter() {
    if (transporter)
        return transporter;
    if (!host || !port || !user || !pass) {
        throw new Error("SMTP is not configured. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and optionally SMTP_SECURE and EMAIL_FROM.");
    }
    transporter = nodemailer_1.default.createTransport({
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
async function sendVerificationEmail(to, code) {
    const t = ensureTransporter();
    const appName = process.env.APP_NAME || "Phone Backup Portal";
    await t.sendMail({
        from,
        to,
        subject: `${appName} – Your verification code`,
        text: `Your verification code is: ${code}\n\nEnter this code in the browser to verify your email.\n\nIf you did not request this, you can ignore this email.`,
    });
}
