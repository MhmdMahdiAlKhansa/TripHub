import { expect, test } from '@playwright/test';

test('a new business owner registers, verifies by the dev mailbox link, creates and submits a business', async ({ page, request }) => {
  const email = `e2e-${Date.now()}@example.test`;
  const password = 'a-long-e2e-password-1';

  await page.goto('/en/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Almost there')).toBeVisible();

  // Local development mailbox: the only place the link exists (nothing is emailed).
  const box = await request.get('/api/v1/dev/mailbox');
  expect(box.status()).toBe(200);
  const mail = ((await box.json()) as { mails: Array<{ to: string; template: string; link: string }> }).mails.find((m) => m.to === email && m.template === 'verify-email');
  expect(mail, 'verification link in the dev mailbox').toBeTruthy();
  await page.goto(mail!.link);
  await expect(page.getByText('Your email is verified')).toBeVisible();

  await page.goto('/en/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/profile/);

  await page.goto('/en/business');
  await page.getByLabel('Business name').fill('E2E Mountain Guides');
  await page.getByRole('button', { name: 'Create business' }).click();
  await page.getByRole('listitem').filter({ hasText: 'E2E Mountain Guides' }).getByRole('link', { name: 'Open' }).click();
  await page.getByRole('tab', { name: 'Business profile' }).click();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();

  // Submitting an incomplete profile is refused with what is missing.
  await page.getByRole('button', { name: 'Submit for verification' }).click();
  await expect(page.getByText(/Still missing/)).toBeVisible();

  await page.getByLabel('About your business').fill('Guided day hikes through the Qadisha Valley with local mountain guides.');
  await page.getByLabel('Contact email').fill('hello@example-business.test');
  await page.getByLabel('Phone').fill('+961 3 123 456');
  await page.getByLabel('City').fill('Bsharri');
  await page.getByLabel('Hiking').check();
  await page.getByLabel('English').check();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status').first()).toContainText('Saved.');

  // A disguised file is refused; a real PDF is accepted.
  await page.setInputFiles('input[type=file]', { name: 'virus.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ not a pdf at all') });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('status').first()).toContainText('did not work');
  await page.setInputFiles('input[type=file]', { name: 'licence.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% e2e licence placeholder\n') });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText('licence.pdf')).toBeVisible();

  await page.getByRole('button', { name: 'Submit for verification' }).click();
  await expect(page.getByText('Waiting for TripHub review')).toBeVisible();
});
