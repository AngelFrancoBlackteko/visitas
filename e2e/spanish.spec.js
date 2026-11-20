import { test, expect } from '@playwright/test';

// Spanish (the product default). The other specs run the site in English
// (DEFAULT_LANGUAGE=en in playwright.config.js) so their selectors stay
// stable; this one switches the site to Spanish, walks the visitor and admin
// surfaces, and switches back. Runs last (alphabetical) and depends on the
// admin password + documents set up by role-admin.spec.js.

//
// The login endpoint is rate limited (10/min per IP) and the earlier specs
// use most of that budget, so this file logs in exactly once and shares the
// signed-in browser context.

const ADMIN_PASSWORD = 'AdminNewPass1234';

test.describe.configure({ mode: 'serial' });

let adminCtx;

async function setLanguage(language) {
  const res = await adminCtx.request.put('/api/settings/language', { data: { language } });
  expect(res.ok()).toBe(true);
}

test.beforeAll(async ({ browser }, testInfo) => {
  adminCtx = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const login = await adminCtx.request.post('/api/auth/login', { data: { username: 'admin', password: ADMIN_PASSWORD } });
  expect(login.ok()).toBe(true);
  await setLanguage('es');
});

test.afterAll(async () => {
  await setLanguage('en');
  await adminCtx.close();
});

test('es: visitor signs in, gets a Spanish badge, and signs out', async ({ page, context }) => {
  await page.addInitScript(() => { window.open = () => null; });
  const createdP = page.waitForResponse(r => r.url().endsWith('/api/visits') && r.request().method() === 'POST');

  await page.goto('/kiosk/default');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { name: 'Bienvenido.' })).toBeVisible();
  await expect(page.getByText('Registre su llegada.')).toBeVisible();

  await page.getByLabel(/Su nombre/).fill('Luis Visitante');
  await page.getByLabel(/Empresa/).fill('ACME');
  await page.getByPlaceholder(/Escriba un nombre…/).fill('Jane');
  await page.getByRole('button', { name: 'Jane Host' }).click();
  await page.getByLabel(/Motivo de la visita/).selectOption('Reunión');
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Safety + NDA documents keep the text the admin wrote; the controls are Spanish.
  await expect(page.getByText(/Paso 2 de 3/)).toBeVisible();
  await page.locator('.doc-body').first().evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.getByRole('button', { name: /Lo he leído/ }).click();

  await page.locator('.doc-body').first().evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByText('Firme con su dedo', { exact: false }).first()).toBeVisible();
  const pad = page.locator('canvas.signature-pad');
  // The pad only accepts ink once the visitor has scrolled to the end.
  await expect(pad).not.toHaveClass(/disabled/);
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 100, { steps: 10 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Acepto y firmo' }).click();

  await expect(page.getByRole('heading', { name: 'Gracias, Luis.' })).toBeVisible();
  await expect(page.getByText(/Ya avisamos a/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reimprimir gafete' })).toBeVisible();

  const visit = (await (await createdP).json()).visit;
  const badgePage = await context.newPage();
  await badgePage.goto(`/api/visits/badge/${visit.publicToken}`);
  await expect(badgePage.getByText('Escanee para salir')).toBeVisible();
  await expect(badgePage.getByText('Visita a:')).toBeVisible();
  const signoutCode = await badgePage.locator('[data-signout-code]').getAttribute('data-signout-code');
  await badgePage.close();

  // Wall view in Spanish.
  await page.goto('/active');
  await expect(page.getByText('Personas en sitio')).toBeVisible();
  await expect(page.getByText(/visita a Jane Host/).first()).toBeVisible();

  // Sign out by scanning the badge.
  await page.goto('/kiosk/signout');
  await expect(page.getByRole('heading', { name: 'Registrar salida' })).toBeVisible();
  await page.getByPlaceholder('Escanee su gafete').fill(`http://kiosk.local/kiosk/signout/${signoutCode}`);
  await page.getByRole('button', { name: 'Registrar salida' }).click();
  await expect(page.getByRole('heading', { name: 'Hasta luego, Luis.' })).toBeVisible();
});

test('es: login screen is in Spanish', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByLabel('Usuario')).toBeVisible();
  await expect(page.getByLabel('Contraseña')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
});

test('es: admin panel is in Spanish and the language can be switched from Settings', async () => {
  const page = await adminCtx.newPage();
  await page.goto('/admin/active-visitors');
  await expect(page.getByRole('link', { name: 'Visitantes en sitio' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Visitantes en sitio' })).toBeVisible();
  await page.getByRole('link', { name: 'Configuración' }).click();
  await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Idioma' })).toBeVisible();

  // Switch to English from the UI, then back to Spanish.
  await page.getByTestId('language-en').check();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await page.getByTestId('language-es').check();
  await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
});
