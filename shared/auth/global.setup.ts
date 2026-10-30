/**
 * Global auth setup — generic, project-agnostic.
 *
 * Runs as the `setup` Playwright project (see playwright.config.ts) BEFORE the test
 * suite, but only when shared/auth/auth.config.json has enabled=true. Logs in once,
 * saves storageState, and all dependent projects reuse the session — eliminating
 * per-test login, a major per-test time sink.
 *
 * Login steps are driven entirely by auth.config.json (URL + locator expressions +
 * which .env vars hold the credentials), so no app-specific logic lives here.
 */

import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigLoader } from '../utils/ConfigLoader';
import { ACTION_TIMEOUT } from '../utils/timeouts';

interface AuthField {
  expr: string;
  envVar?: string;
}
interface ClubSwitchConfig {
  dropdownExpr: string;
  envVar: string;
}
interface AuthConfig {
  enabled: boolean;
  loginUrl: string;
  username: AuthField;
  nextButton?: AuthField;
  password: AuthField;
  submit: AuthField;
  successUrlContains?: string;
  clubSwitch?: ClubSwitchConfig;
  storageStatePath: string;
}

const authConfigPath = path.resolve(__dirname, 'auth.config.json');
const authConfig: AuthConfig = JSON.parse(fs.readFileSync(authConfigPath, 'utf-8'));

setup('authenticate', async ({ page }) => {
  setup.skip(!authConfig.enabled, 'Global auth disabled (auth.config.json enabled=false).');

  const user = process.env[authConfig.username.envVar ?? 'TEST_USER_EMAIL'];
  const pass = process.env[authConfig.password.envVar ?? 'TEST_USER_PASSWORD'];
  if (!user || !pass) {
    throw new Error(
      `Global auth enabled but credentials missing. Set ${authConfig.username.envVar} and ` +
      `${authConfig.password.envVar} in .env.`
    );
  }

  await page.goto(authConfig.loginUrl);
  await page.waitForLoadState('domcontentloaded');

  await ConfigLoader.evalLocatorExpr(page, authConfig.username.expr).fill(user, {
    timeout: ACTION_TIMEOUT,
  });

  // Multi-step login (email -> Next -> separate password screen): if the password field isn't
  // present yet, look for a "Next"-style continue button and click it before filling password.
  let passwordField = ConfigLoader.evalLocatorExpr(page, authConfig.password.expr);
  if (!(await passwordField.count()) && authConfig.nextButton) {
    const nextBtn = ConfigLoader.evalLocatorExpr(page, authConfig.nextButton.expr);
    if (await nextBtn.count()) {
      await nextBtn.click({ timeout: ACTION_TIMEOUT });
      await page.waitForLoadState('networkidle').catch(() => {});
    }
  }
  passwordField = ConfigLoader.evalLocatorExpr(page, authConfig.password.expr);
  await passwordField.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT });
  await passwordField.fill(pass, { timeout: ACTION_TIMEOUT });

  await ConfigLoader.evalLocatorExpr(page, authConfig.submit.expr).click({
    timeout: ACTION_TIMEOUT,
  });

  // 'networkidle' can resolve prematurely between two bursts of SPA requests (auth POST, then a
  // delayed second wave — profile fetch, router guards — before the redirect fires). Wait
  // explicitly for navigation away from the sign-in URL first, THEN settle on networkidle.
  await page.waitForURL((u) => !/sign-in|\/login\b/i.test(u.toString()), { timeout: ACTION_TIMEOUT }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: ACTION_TIMEOUT }).catch(() => {});

  if (authConfig.successUrlContains) {
    await page.waitForURL(new RegExp(authConfig.successUrlContains.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), {
      timeout: ACTION_TIMEOUT,
    });
  }
  await expect(page).toHaveURL(/.*/); // sanity: a navigation completed

  // Optional post-login club/org switch for multi-tenant accounts.
  if (authConfig.clubSwitch) {
    const clubName = process.env[authConfig.clubSwitch.envVar];
    if (clubName) {
      try {
        const clubSwitcher = ConfigLoader.evalLocatorExpr(page, authConfig.clubSwitch.dropdownExpr);
        await clubSwitcher.click({ timeout: ACTION_TIMEOUT });
        const clubOption = page.getByRole('option', { name: clubName, exact: true });
        await clubOption.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT });
        await clubOption.click();
        await page.waitForLoadState('networkidle', { timeout: ACTION_TIMEOUT }).catch(() => {});
      } catch (e) {
        console.warn(`⚠️  could not switch to club "${clubName}": ${(e as Error).message?.split('\n')[0]}`);
      }
    }
  }

  const statePath = path.resolve(process.cwd(), authConfig.storageStatePath);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  await page.context().storageState({ path: statePath });
  console.log(`✅ Global auth saved storageState → ${authConfig.storageStatePath}`);
});
