import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Playwright Configuration
 * https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './features',
  timeout: 90000, // 90 seconds per test
  expect: { timeout: 90000 }, // 90 seconds for assertions
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  /* Retry failed tests twice on CI to reduce flaky failures.
  Increases execution time, so keep disabled during local development. */
  //retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  outputDir: './reports/test-results',
  /* Do NOT pass --reporter on the CLI — it overrides outputFolder and writes to ./playwright-report (root).
  All reporters are configured here so reports always land in reports/. */
  reporter: [
    ['html', { outputFolder: 'reports/playwright-report', open: 'never' }],
    ['json', { outputFile: 'reports/test-results/results.json' }],
    ['junit', { outputFile: 'reports/test-results/junit.xml' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL,
    /*── Evidence capture ────────────────────────────────────────────────────
    LIGHT mode (active) — captures only on failure, saves disk space.
    Default for CI and regular test runs. */

    // trace: 'retain-on-failure',
    // screenshot: 'only-on-failure',
    // video: 'retain-on-failure',

    /* FULL mode — captures everything on every test.
    Use when investigating a bug or collecting evidence for a bug report.
    To enable: uncomment the three lines below and comment out the LIGHT mode lines above. */

    trace: 'on',
    screenshot: 'on',
    video: 'on',

    // ────────────────────────────────────────────────────────────────────────
    actionTimeout: 90000, // 90 seconds for individual actions
    navigationTimeout: 90000, // 90 seconds for page navigation
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // 
    // Other browsers - commented out for faster test runs during development
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
    // Mobile browsers - commented out for faster test runs during development
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },
  ],

  // Run global setup script before tests
  // globalSetup: require.resolve('./PlaywrightScripts/globalSetup.ts'),

  // Run global teardown script after tests
  // globalTeardown: require.resolve('./PlaywrightScripts/globalTeardown.ts'),

  // webServer: undefined,
});
