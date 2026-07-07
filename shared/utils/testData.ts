/**
 * Build a unique, deliverable test email.
 *
 * Format: {local}+{DDMMM}{nnn}@{domain}  (e.g. qa.inbox+29jun049@yourcompany.com)
 *   - local/domain: taken from TEST_EMAIL_BASE in .env (a real, monitored inbox)
 *   - DDMMM: today's day (2 digits) + lowercase 3-letter month
 *   - nnn:   3 random digits
 *
 * The +alias routes to the real TEST_EMAIL_BASE inbox, so mail is deliverable
 * (protects our Azure Communication Services domain reputation), while the
 * date + random suffix keeps each address unique per run to avoid
 * duplicate-record collisions.
 *
 * Use this for any form-fill / data-entry email the app actually sends mail to.
 * Do NOT use it for login/admin accounts (those must be real provisioned users)
 * or for negative/boundary validation cases (those intentionally never send).
 */
export function generateTestEmail(): string {
  const base = process.env.TEST_EMAIL_BASE;
  if (!base || !base.includes('@')) {
    throw new Error(
      'TEST_EMAIL_BASE is not set. Add TEST_EMAIL_BASE=<a real, monitored inbox> to .env — ' +
        'generated test emails are +aliases of it and must be deliverable.'
    );
  }
  const [local, domain] = base.split('@');
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mmm = now.toLocaleString('en-US', { month: 'short' }).toLowerCase();
  const nnn = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `${local}+${dd}${mmm}${nnn}@${domain}`;
}
