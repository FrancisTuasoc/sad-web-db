async function sendVerificationEmail(toEmail, verificationUrl) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: process.env.BREVO_SENDER_EMAIL },
      to: [{ email: toEmail }],
      subject: 'Verify your email address',
      htmlContent: `
        <h2>Verify your email</h2>
        <p>Click the button below to verify your email and complete your registration.</p>
        <a href="${verificationUrl}" style="background:#4F46E5;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Verify Email</a>
        <p>This link expires in 24 hours.</p>
        <p>If you did not register, ignore this email.</p>
      `,
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error('Brevo email failed: ' + JSON.stringify(error));
  }
  return response.json();
}

module.exports = sendVerificationEmail;
