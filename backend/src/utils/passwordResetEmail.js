const {
  PASSWORD_RESET_API_KEY,
  BREVO_API_KEY,
  BREVO_SENDER_EMAIL,
} = require('../config/env');

async function sendPasswordResetEmail(toEmail, resetUrl) {
  const apiKey =
    process.env.PASSWORD_RESET_API_KEY ||
    PASSWORD_RESET_API_KEY ||
    process.env.BREVO_API_KEY ||
    BREVO_API_KEY;
  const senderEmail =
    process.env.BREVO_SENDER_EMAIL ||
    BREVO_SENDER_EMAIL;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: senderEmail },
      to: [{ email: toEmail }],
      subject: 'Reset your GIGABITE password',
      htmlContent: `
        <h2>Reset your password</h2>
        <p>Use the link below to choose a new password for your GIGABITE account.</p>
        <a href="${resetUrl}" style="background:#6b442d;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Reset Password</a>
        <p>This link expires in 30 minutes and can only be used once.</p>
        <p>If you did not request a password reset, you can ignore this email.</p>
      `,
    }),
  });
  if (!response.ok) {
    let detail = '';
    try {
      const err = await response.json();
      detail = `: ${JSON.stringify(err)}`;
    } catch {
      // Ignore JSON parse error
    }
    throw new Error(
      `Password reset email request failed with status ${response.status}${detail}.`
    );
  }
  return response.json();
}

module.exports = sendPasswordResetEmail;
