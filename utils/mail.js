import nodemailer from "nodemailer";

let transporter;

const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP is not configured. Missing SMTP_HOST/SMTP_USER/SMTP_PASS");
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return transporter;
};

export const sendResetPasswordEmail = async ({ to, resetLink }) => {
  const smtpTransporter = getTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  await smtpTransporter.sendMail({
    from,
    to,
    subject: "Reset your Scanly password",
    text: [
      "We received a request to reset your Scanly password.",
      "",
      `Reset link: ${resetLink}`,
      "",
      "This link expires in 15 minutes.",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2 style="margin-bottom: 8px;">Reset your Scanly password</h2>
        <p>We received a request to reset your password.</p>
        <p>
          <a href="${resetLink}" style="display:inline-block;padding:10px 14px;background:#0e9f9f;color:#fff;text-decoration:none;border-radius:8px;">
            Reset password
          </a>
        </p>
        <p style="font-size: 13px; color: #555;">This link expires in 15 minutes.</p>
        <p style="font-size: 13px; color: #555;">If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
};
