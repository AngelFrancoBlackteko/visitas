import { test, expect } from '@playwright/test';

// Visitor-perspective tests — public surfaces only, no auth.

test('visitor: opens kiosk, sees welcome with kiosk identity', async ({ page }) => {
  await page.goto('/kiosk/default');
  await expect(page.getByRole('heading', { name: 'Welcome.' })).toBeVisible();
  await expect(page.locator('.kiosk-loc')).toHaveText('Reception');
});

test('visitor: bare /kiosk redirects to /kiosk/default', async ({ page }) => {
  await page.goto('/kiosk');
  await expect(page).toHaveURL(/\/kiosk\/default/);
});

test('visitor: unknown kiosk slug shows a friendly error', async ({ page }) => {
  await page.goto('/kiosk/never-heard-of-it');
  await expect(page.getByRole('heading', { name: 'Unknown kiosk' })).toBeVisible();
});

test('visitor: full flow form → safety → NDA + signature → thanks → badge', async ({ page, context }) => {
  // Block the print-window popup so we don't leave a stray tab in tests.
  await page.addInitScript(() => { window.open = () => null; });

  await page.goto('/kiosk/loading-dock');
  await expect(page.getByRole('heading', { name: 'Welcome.' })).toBeVisible();
  await expect(page.locator('.kiosk-loc')).toHaveText('Loading dock');

  // (Empty-submit validation is enforced by the browser via HTML5 `required`,
  // not by our React handler — clicking Continue with an empty name field
  // triggers the native validation tooltip and the form doesn't submit. We
  // just walk the happy path here.)

  // Fill the form.
  await page.getByLabel(/Your name/).fill('Bob Visitor');
  await page.getByLabel(/Company/).fill('Test Co');
  await page.getByLabel(/Email/).fill('bob@example.com');
  await page.getByPlaceholder(/Type a name…/).fill('Jane');
  await page.getByRole('button', { name: 'Jane Host' }).click();
  await page.getByLabel(/Reason for visit/).selectOption('Meeting');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Safety screen — scroll to bottom to enable.
  await expect(page.getByRole('heading', { name: /Workshop safety/i })).toBeVisible();
  await page.locator('.doc-body').first().evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.getByRole('button', { name: /I have read this/ }).click();

  // NDA screen — scroll + sign + confirm.
  await expect(page.getByRole('heading', { name: /Visitor non-disclosure/i })).toBeVisible();
  await page.locator('.doc-body').first().evaluate(el => { el.scrollTop = el.scrollHeight; });
  // Draw a stroke on the signature pad.
  const pad = page.locator('canvas.signature-pad');
  // The pad only accepts ink once the doc is scrolled to the end; wait for
  // that instead of racing the scroll handler.
  await expect(pad).not.toHaveClass(/disabled/);
  const padBox = await pad.boundingBox();
  await page.mouse.move(padBox.x + 20, padBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(padBox.x + 200, padBox.y + 100, { steps: 10 });
  await page.mouse.up();

  await page.getByRole('button', { name: /I agree and sign/ }).click();

  await expect(page.getByRole('heading', { name: /Thanks, Bob/ })).toBeVisible();
  await expect(page.getByText(/Jane Host/)).toBeVisible();
  await expect(page.getByText(/Dock Printer/)).toBeVisible();
  await expect(page.getByText(/copy of the signed NDA has been emailed/)).toBeVisible();

  // Badge endpoint reachable.
  const badgePage = await context.newPage();
  const href = await page.getByRole('link', { name: 'Reprint badge' }).getAttribute('href');
  expect(href).toMatch(/\/api\/visits\/badge\/[0-9a-f]{64}/);
  const res = await badgePage.goto(href);
  expect(res?.ok()).toBe(true);
  await expect(badgePage.locator('text=Bob Visitor').first()).toBeVisible();
});

test('visitor: signs in (with safety + NDA) then signs out at /kiosk/signout by scanning the badge', async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null; });

  // Capture the new visit so we can read the QR payload off its badge.
  const createdP = page.waitForResponse(r => r.url().endsWith('/api/visits') && r.request().method() === 'POST');

  await page.goto('/kiosk/default');
  await page.getByLabel(/Your name/).fill('Going-Home Greta');
  await page.getByPlaceholder(/Type a name…/).fill('Jane');
  await page.getByRole('button', { name: 'Jane Host' }).click();
  await page.getByLabel(/Reason for visit/).selectOption('Meeting');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Safety
  await page.locator('.doc-body').first().evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.getByRole('button', { name: /I have read this/ }).click();

  // NDA
  await page.locator('.doc-body').first().evaluate(el => { el.scrollTop = el.scrollHeight; });
  const pad = page.locator('canvas.signature-pad');
  // The pad only accepts ink once the doc is scrolled to the end; wait for
  // that instead of racing the scroll handler.
  await expect(pad).not.toHaveClass(/disabled/);
  const padBox = await pad.boundingBox();
  await page.mouse.move(padBox.x + 20, padBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(padBox.x + 200, padBox.y + 100, { steps: 10 });
  await page.mouse.up();
  await page.getByRole('button', { name: /I agree and sign/ }).click();

  await expect(page.getByRole('heading', { name: /Thanks, Going-Home/ })).toBeVisible();
  // Read the create response before navigating away (Playwright drops it after).
  const { visit } = await (await createdP).json();

  // Wall view shows them on site.
  await page.goto('/active');
  await expect(page.getByText('Going-Home Greta')).toBeVisible();

  // The badge carries a sign-out QR; read the code it encodes.
  const badge = await page.request.get(`/api/visits/badge/${visit.publicToken}`);
  const code = (await badge.text()).match(/data-signout-code="([0-9a-f]{32})"/)[1];

  // Default kiosk mode: no name list, only the badge scanner.
  await page.goto('/kiosk/signout');
  await expect(page.getByRole('button', { name: /Going-Home Greta/ })).toHaveCount(0);

  // A USB/Bluetooth scanner "types" the QR URL and presses Enter.
  await page.getByLabel('Badge code').fill(`http://kiosk.example/kiosk/signout/${code}`);
  await page.getByLabel('Badge code').press('Enter');
  await expect(page.getByRole('heading', { name: /Goodbye, Going-Home/ })).toBeVisible();

  await page.goto('/active');
  await expect(page.getByText('Going-Home Greta')).not.toBeVisible();
});

test('visitor: phone camera scan of the badge QR opens a sign-out page', async ({ page }) => {
  const hosts = await (await page.request.get('/api/hosts')).json();
  const host = hosts.hosts.find(h => h.displayName === 'Jane Host');
  // 1x1 transparent PNG stands in for the drawn NDA signature.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const created = await page.request.post('/api/visits', {
    data: {
      visitorName: 'Phone Paco', hostUserId: host.id,
      acknowledgments: [
        { kind: 'safety' },
        { kind: 'nda', signedName: 'Phone Paco', signaturePngBase64: png },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const { visit } = await created.json();
  const badge = await page.request.get(`/api/visits/badge/${visit.publicToken}`);
  const code = (await badge.text()).match(/data-signout-code="([0-9a-f]{32})"/)[1];

  await page.goto(`/kiosk/signout/${code}`);
  await page.getByRole('button', { name: 'Sign me out' }).click();
  await expect(page.getByRole('heading', { name: /Goodbye, Phone/ })).toBeVisible();
});
