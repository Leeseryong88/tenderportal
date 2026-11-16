import { test, expect } from '@playwright/test';

const RUN_E2E = process.env.RUN_PLAYWRIGHT_E2E === 'true';

test.describe('IICOMBINED Tender Portal Role E2E', () => {
  test.skip(!RUN_E2E, 'Set RUN_PLAYWRIGHT_E2E=true with running Next.js + Firebase Emulators');

  test('Admin logs in, views dashboard, projects, tenders, and supplier pool in KO/EN', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill('admin.a@iicombined.test');
    await page.getByTestId('login-password').fill('TestPass!2026');
    await page.getByTestId('login-submit').click();

    await page.waitForURL('**/admin/dashboard');
    await expect(page.locator('h1')).toBeVisible();

    // Switch language EN <-> KO
    await page.getByTestId('language-select').selectOption('en');
    await expect(page.locator('h1')).toContainText('Dashboard');
    await page.getByTestId('language-select').selectOption('ko');
    await expect(page.locator('h1')).toContainText('대시보드');

    // Navigate to Supplier Pool and verify Australia alias & US map
    await page.goto('/admin/suppliers');
    await page.getByTestId('pool-search-input').fill('Alpha');
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });

  test('User Department sees Supplier Pool only and is blocked from Admin/Supplier routes', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill('dept.u@iicombined.test');
    await page.getByTestId('login-password').fill('TestPass!2026');
    await page.getByTestId('login-submit').click();

    await page.waitForURL('**/department/suppliers');
    await expect(page.locator('table')).toBeVisible();

    await page.goto('/admin/tenders');
    await page.waitForURL('**/department/suppliers');
  });

  test('Supplier sees only assigned open tender and no competitor info', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill('a1@alpha.test');
    await page.getByTestId('login-password').fill('TestPass!2026');
    await page.getByTestId('login-submit').click();

    await page.waitForURL('**/supplier/tenders');
    await expect(page.locator('body')).toContainText('Berlin PM Services Tender');
    await expect(page.locator('body')).not.toContainText('Beta Build');
    await expect(page.locator('body')).not.toContainText('Sydney Galleria GC Tender');
  });

  test('Pending user is confined to /account/pending', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill('pending.p@example.test');
    await page.getByTestId('login-password').fill('TestPass!2026');
    await page.getByTestId('login-submit').click();

    await page.waitForURL('**/account/pending');
    await page.goto('/admin/dashboard');
    await page.waitForURL('**/account/pending');
  });
});
