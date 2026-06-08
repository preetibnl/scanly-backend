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

const getFromAddress = () => process.env.SMTP_FROM || process.env.SMTP_USER;

export const logMailStartupProbe = async () => {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn(
      "[Mail] SMTP not fully configured. Missing SMTP_HOST/SMTP_USER/SMTP_PASS. Email sending is disabled.",
    );
    return;
  }

  try {
    const smtpTransporter = getTransporter();
    await smtpTransporter.verify();
    console.log(`[Mail] SMTP startup probe OK host=${host} user=${user}`);
  } catch (error) {
    console.error(
      `[Mail] SMTP startup probe failed host=${host} user=${user} message=${error?.message || error}`,
    );
  }
};

export const sendResetPasswordEmail = async ({ to, resetLink }) => {
  const smtpTransporter = getTransporter();
  const from = getFromAddress();

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

export const sendResetOtpEmail = async ({ to, otp }) => {
  const smtpTransporter = getTransporter();
  const from = getFromAddress();

  await smtpTransporter.sendMail({
    from,
    to,
    subject: "Your Scanly password reset OTP",
    text: [
      "We received a request to reset your Scanly password.",
      "",
      `Your OTP is: ${otp}`,
      "",
      "This OTP expires in 10 minutes.",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2 style="margin-bottom: 8px;">Password reset OTP</h2>
        <p>Use this OTP to continue resetting your Scanly password:</p>
        <p style="font-size: 28px; letter-spacing: 4px; font-weight: 700; margin: 14px 0;">${otp}</p>
        <p style="font-size: 13px; color: #555;">This OTP expires in 10 minutes.</p>
        <p style="font-size: 13px; color: #555;">If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
};

export const sendSignupWelcomeEmail = async ({ to, name }) => {
  const smtpTransporter = getTransporter();
  const from = getFromAddress();
  const firstName = String(name || "").trim().split(/\s+/)[0] || "there";

  await smtpTransporter.sendMail({
    from,
    to,
    subject: "Welcome to Scanly",
    text: [
      `Hi ${firstName},`,
      "",
      "Welcome to Scanly. Your account is ready.",
      "You can now scan labels and check ingredients against your allergy profile.",
      "",
      "If you did not create this account, please contact support.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2 style="margin-bottom: 8px;">Welcome to Scanly</h2>
        <p>Hi ${firstName},</p>
        <p>Your account is ready. You can now scan labels and check ingredients against your allergy profile.</p>
        <p style="font-size: 13px; color: #555;">If you did not create this account, please contact support.</p>
      </div>
    `,
  });
};
