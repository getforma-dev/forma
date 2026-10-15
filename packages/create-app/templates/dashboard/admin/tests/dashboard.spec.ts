import { test, expect } from '@playwright/test';

test.describe('Dashboard Navigation', () => {
  test('sidebar navigation switches pages', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Infrastructure Overview');

    await page.click('button:has-text("Deployments")');
    await expect(page.locator('h1')).toContainText('Deployments');
    expect(page.url()).toContain('/deployments');

    await page.click('button:has-text("Servers")');
    await expect(page.locator('h1')).toContainText('Server Fleet');
    expect(page.url()).toContain('/servers');

    await page.click('button:has-text("Dashboard")');
    await expect(page.locator('h1')).toContainText('Infrastructure Overview');
  });

  test('browser back/forward buttons work', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Deployments")');
    await expect(page.locator('h1')).toContainText('Deployments');

    await page.goBack();
    await expect(page.locator('h1')).toContainText('Infrastructure Overview');

    await page.goForward();
    await expect(page.locator('h1')).toContainText('Deployments');
  });

  test('direct URL navigation works', async ({ page }) => {
    await page.goto('/deployments');
    await expect(page.locator('h1')).toContainText('Deployments');

    await page.goto('/servers');
    await expect(page.locator('h1')).toContainText('Server Fleet');
  });
});

test.describe('Deployments Page', () => {
  test('displays stat cards with data', async ({ page }) => {
    await page.goto('/deployments');
    await expect(page.locator('text=Today\'s Deploys')).toBeVisible();
    await expect(page.locator('text=Success Rate')).toBeVisible();
    await expect(page.locator('text=Avg Duration')).toBeVisible();
    await expect(page.locator('text=Rollbacks')).toBeVisible();
  });

  test('displays deployment table with rows', async ({ page }) => {
    await page.goto('/deployments');
    await expect(page.locator('text=Deployment History')).toBeVisible();
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(12);
    await expect(rows.first()).toContainText('api-gateway');
  });

  test('deployment table shows status badges', async ({ page }) => {
    await page.goto('/deployments');
    await expect(page.locator('text=success').first()).toBeVisible();
    await expect(page.locator('text=failed').first()).toBeVisible();
    await expect(page.locator('text=rolling').first()).toBeVisible();
  });
});

test.describe('Overview Page', () => {
  test('displays metric cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Uptime')).toBeVisible();
    await expect(page.locator('text=Avg Latency')).toBeVisible();
    await expect(page.locator('text=Server Load')).toBeVisible();
    await expect(page.locator('text=Deploy Rate')).toBeVisible();
  });

  test('displays service status summary', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Service Status')).toBeVisible();
    await expect(page.getByText('Healthy', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Degraded', { exact: true }).first()).toBeVisible();
  });

  test('displays SVG chart', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Request Volume')).toBeVisible();
    const svg = page.locator('svg');
    await expect(svg.first()).toBeVisible();
  });

  test('displays recent deployments', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Deployment Pipeline')).toBeVisible();
    await expect(page.locator('text=api-gateway').first()).toBeVisible();
  });

  test('displays active incidents', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Active Incidents')).toBeVisible();
    await expect(page.locator('text=INC-2847')).toBeVisible();
  });
});

test.describe('Servers Page', () => {
  test('displays server cards', async ({ page }) => {
    await page.goto('/servers');
    await expect(page.locator('text=prod-web-01')).toBeVisible();
    await expect(page.locator('text=prod-api-01')).toBeVisible();
  });

  test('filter tabs work', async ({ page }) => {
    await page.goto('/servers');

    await page.click('button:has-text("Degraded")');
    await expect(page.locator('text=prod-cache-01')).toBeVisible();

    await page.click('button:has-text("Offline")');
    await expect(page.locator('text=dev-ml-01')).toBeVisible();

    await page.click('button:has-text("All")');
    await expect(page.locator('text=prod-web-01')).toBeVisible();
  });

  test('server cards show progress bars', async ({ page }) => {
    await page.goto('/servers');
    await expect(page.locator('text=CPU').first()).toBeVisible();
    await expect(page.locator('text=Memory').first()).toBeVisible();
    await expect(page.locator('text=Disk').first()).toBeVisible();
  });
});

test.describe('API Routes', () => {
  test('all API endpoints return valid JSON', async ({ request }) => {
    const endpoints = [
      '/api/metrics',
      '/api/deployment-stats',
      '/api/deployments',
      '/api/services',
      '/api/service-summary',
      '/api/servers',
      '/api/request-volume',
      '/api/incidents',
    ];

    for (const endpoint of endpoints) {
      const response = await request.get(endpoint);
      expect(response.ok()).toBeTruthy();
      const json = await response.json();
      expect(json).toBeDefined();
    }
  });
});

test.describe('Page loads without errors', () => {
  test('no JS console errors on any page', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.goto('/deployments');
    await page.waitForTimeout(1000);
    await page.goto('/servers');
    await page.waitForTimeout(1000);

    expect(errors).toEqual([]);
  });
});
