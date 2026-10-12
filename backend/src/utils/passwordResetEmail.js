async function sendPasswordResetEmail(toEmail, resetUrl) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: process.env.BREVO_SENDER_EMAIL },
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
    throw new Error(`Password reset email request failed with status ${response.status}.`);
  }
  return response.json();
}

module.exports = sendPasswordResetEmail;
