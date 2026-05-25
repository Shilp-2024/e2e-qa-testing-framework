#!/usr/bin/env node
/**
 * auto_locator_extractor.js
 *
 * Headless DOM crawler — auto-extracts Playwright locators from live pages.
 * Used as Step 0 in Agent 2's hybrid locator pipeline.
 *
 * Static elements (~60-70%) are captured automatically.
 * Dynamic elements (error states, post-submit banners) are flagged for Codegen fallback.
 *
 * Usage:
 *   node scripts/auto_locator_extractor.js --feature UserLogin --page signInPage --url /Account/SignIn
 *   node scripts/auto_locator_extractor.js --feature UserLogin --page dashboardPage --url / --login /Account/SignIn
 *   node scripts/auto_locator_extractor.js --feature UserLogin --page signInPage --url /Account/SignIn --headed
 *
 * Options:
 *   --feature   PascalCase feature name (matches features/ folder name)
 *   --page      camelCase page group name used as the JSON section key (e.g. signInPage)
 *   --url       Relative URL of the page to extract from (e.g. /Account/SignIn)
 *   --login     Optional: relative login URL if the target page requires authentication
 *   --headed    Run with a visible browser window (default: headless)
 *
 * Environment variables (from .env):
 *   BASE_URL           — base URL of the application under test
 *   TEST_USER_EMAIL    — test account email (required only when --login is used)
 *   TEST_USER_PASSWORD — test account password (required only when --login is used)
 *
 * Output:
 *   features/{Feature}/locators/extract_{Feature}_auto.json
 *   (Merges with existing file when called multiple times for different pages)
 */

'use strict';

const path = require('path');
const fs   = require('fs');

require('dotenv').config();

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };

  const feature  = get('--feature');
  const pageName = get('--page');
  const url      = get('--url');

  if (!feature || !pageName || !url) {
    console.error(
      '\nUsage:\n' +
      '  node scripts/auto_locator_extractor.js \\\n' +
      '    --feature <PascalCaseName> \\\n' +
      '    --page    <camelCasePageName> \\\n' +
      '    --url     <relative-url> \\\n' +
      '    [--login  <relative-login-url>] \\\n' +
      '    [--headed]\n'
    );
    process.exit(1);
  }

  return { feature, pageName, url, loginUrl: get('--login'), headed: args.includes('--headed') };
}

// ─── Element name generation ──────────────────────────────────────────────────

const ROLE_SUFFIX = {
  textbox: 'Input', searchbox: 'Input', button: 'Button',
  link: 'Link', checkbox: 'Checkbox', radio: 'Radio',
  combobox: 'Dropdown', tab: 'Tab', switch: 'Toggle',
};

const ROLE_TYPE_LABEL = {
  textbox: 'TextInput', searchbox: 'TextInput', button: 'Button',
  link: 'Link', checkbox: 'Checkbox', radio: 'RadioButton', combobox: 'Dropdown',
};

function toElementName(role, name) {
  const clean = name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('');

  const suffix = ROLE_SUFFIX[role] || (role[0].toUpperCase() + role.slice(1));
  return clean.toLowerCase().endsWith(suffix.toLowerCase()) ? clean : clean + suffix;
}

// ─── Locator expression generation ───────────────────────────────────────────

function toLocatorExpression(role, name, domInfo) {
  const esc = name.replace(/'/g, "\\'");

  switch (role) {
    case 'textbox':
    case 'searchbox': {
      const primary  = `page.getByRole('textbox', { name: '${esc}' })`;
      const fallback = domInfo?.placeholder
        ? `page.getByPlaceholder('${domInfo.placeholder.replace(/'/g, "\\'")}')`
        : domInfo?.id ? `page.locator('#${domInfo.id}')` : primary;
      return { primary, fallback };
    }
    case 'button': {
      const primary  = `page.getByRole('button', { name: '${esc}' })`;
      const fallback = domInfo?.id
        ? `page.locator('#${domInfo.id}')`
        : `page.locator("button:has-text('${esc}')")`;
      return { primary, fallback };
    }
    case 'link': {
      return {
        primary:  `page.getByRole('link', { name: '${esc}' })`,
        fallback: `page.getByText('${esc}')`,
      };
    }
    case 'checkbox': {
      const primary  = domInfo?.id
        ? `page.locator('#${domInfo.id}')`
        : `page.getByRole('checkbox', { name: '${esc}' })`;
      return { primary, fallback: `page.getByLabel('${esc}')` };
    }
    case 'radio': {
      const primary  = `page.getByRole('radio', { name: '${esc}' })`;
      return { primary, fallback: domInfo?.id ? `page.locator('#${domInfo.id}')` : primary };
    }
    case 'combobox': {
      const primary  = `page.getByRole('combobox', { name: '${esc}' })`;
      return { primary, fallback: domInfo?.id ? `page.locator('#${domInfo.id}')` : primary };
    }
    default: {
      const primary  = `page.getByRole('${role}', { name: '${esc}' })`;
      return { primary, fallback: `page.getByText('${esc}')` };
    }
  }
}

// ─── DOM info extractor (runs inside the browser) ────────────────────────────

async function extractDomInfo(page) {
  const rows = await page.evaluate(() => {
    const results = [];

    const getLabel = (el) => {
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
      const lbId = el.getAttribute('aria-labelledby');
      if (lbId) {
        const lbEl = document.getElementById(lbId);
        if (lbEl) return lbEl.textContent.trim();
      }
      if (el.id) {
        const lbEl = document.querySelector(`label[for="${el.id}"]`);
        if (lbEl) return lbEl.textContent.trim();
      }
      return el.placeholder || el.textContent?.trim() || el.name || '';
    };

    // Inputs, textareas, selects
    document.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach((el) => {
      results.push({
        tag:         el.tagName.toLowerCase(),
        id:          el.id || '',
        type:        el.type || '',
        name:        el.name || '',
        placeholder: el.placeholder || '',
        labelText:   getLabel(el),
      });
    });

    // Buttons and role=button
    document.querySelectorAll('button, [role="button"]').forEach((el) => {
      results.push({
        tag:         'button',
        id:          el.id || '',
        type:        'button',
        name:        '',
        placeholder: '',
        labelText:   el.getAttribute('aria-label') || el.textContent?.trim() || '',
      });
    });

    return results;
  });

  const lookup = new Map();
  for (const row of rows) {
    const keys = [row.labelText, row.placeholder, row.name].filter(Boolean).map(k => k.toLowerCase());
    for (const k of keys) {
      if (!lookup.has(k)) lookup.set(k, row);
    }
  }
  return lookup;
}

// ─── DOM-based interactive element collector (replaces deprecated page.accessibility) ──

async function extractInteractiveElements(page) {
  return page.evaluate(() => {
    const getAccessibleName = (el) => {
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        const txt = labelledby.split(/\s+/)
          .map(id => { const e = document.getElementById(id); return e ? e.textContent.trim() : ''; })
          .filter(Boolean).join(' ');
        if (txt) return txt;
      }
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) return lbl.textContent.trim();
      }
      if (el.placeholder) return el.placeholder;
      const innerText = el.textContent?.trim();
      if (innerText && innerText.length <= 80) return innerText;
      return el.name || '';
    };

    const getRole = (el) => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag  = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'button' || type === 'button' || type === 'submit' || type === 'reset') return 'button';
      if (tag === 'a') return 'link';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input') {
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio')    return 'radio';
        if (type === 'search')   return 'searchbox';
        return 'textbox';
      }
      return tag;
    };

    const SELECTORS = [
      'button:not([disabled])', '[role="button"]',
      'a[href]', '[role="link"]',
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])', 'select:not([disabled])',
      '[role="checkbox"]', '[role="radio"]', '[role="combobox"]',
      '[role="tab"]', '[role="menuitem"]', '[role="switch"]',
    ].join(',');

    const seen    = new Set();
    const results = [];

    document.querySelectorAll(SELECTORS).forEach((el) => {
      const role = getRole(el);
      const name = getAccessibleName(el);
      if (!name) return;

      const key = `${role}::${name}`;
      if (seen.has(key)) return;
      seen.add(key);

      results.push({
        role,
        name,
        id:          el.id   || '',
        type:        el.getAttribute('type') || '',
        placeholder: el.placeholder || '',
      });
    });

    return results;
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { feature, pageName, url, loginUrl, headed } = parseArgs();

  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    console.error('ERROR: BASE_URL is not set in .env');
    process.exit(1);
  }

  // Import playwright (handles both install paths)
  let chromium;
  try       { ({ chromium } = require('playwright')); }
  catch (_) {
    try     { ({ chromium } = require('@playwright/test')); }
    catch   { console.error('ERROR: playwright not found — run: npm install'); process.exit(1); }
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Auto Locator Extractor');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Feature : ${feature}`);
  console.log(`  Page    : ${pageName}`);
  console.log(`  URL     : ${baseUrl}${url}`);
  console.log(`  Mode    : ${loginUrl ? 'authenticated (--login)' : 'unauthenticated'}`);
  console.log(`  Browser : ${headed ? 'headed' : 'headless'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ baseURL: baseUrl });
  const page    = await context.newPage();

  try {
    // ── Authenticate if needed ──────────────────────────────────────────────
    if (loginUrl) {
      const email    = process.env.TEST_USER_EMAIL;
      const password = process.env.TEST_USER_PASSWORD;
      if (!email || !password) {
        console.error(
          'ERROR: --login requires TEST_USER_EMAIL and TEST_USER_PASSWORD in .env\n' +
          '       These are the test account credentials for authentication.'
        );
        process.exit(1);
      }

      console.log(`🔐 Authenticating via ${loginUrl} ...`);
      await page.goto(loginUrl);
      await page.waitForLoadState('domcontentloaded');

      // Generic login — matches common label patterns
      const usernameField = page.getByRole('textbox', { name: /username|email/i }).first();
      const passwordField = page.getByRole('textbox', { name: /password/i }).first();
      const submitButton  = page
        .getByRole('button', { name: /sign in/i })
        .or(page.getByRole('button', { name: /log in/i }))
        .first();

      await usernameField.fill(email);
      await passwordField.fill(password);
      await submitButton.click();
      await page.waitForLoadState('networkidle');
      console.log(`   ✅ Authenticated — current URL: ${page.url()}\n`);
    }

    // ── Navigate to target page ─────────────────────────────────────────────
    console.log(`📄 Navigating to ${url} ...`);
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    console.log(`   Loaded: ${page.url()}\n`);

    // ── DOM-based element scan (page.accessibility removed in Playwright 1.46+) ──
    const nodes = await extractInteractiveElements(page);
    console.log(`📋 Found ${nodes.length} interactive elements via DOM scan\n`);

    // ── DOM info for richer fallbacks ───────────────────────────────────────
    const domLookup = await extractDomInfo(page);

    // ── Build locator entries ───────────────────────────────────────────────
    const locators = {};
    const seen     = new Set();

    for (const node of nodes) {
      const key = `${node.role}::${node.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const elemName = toElementName(node.role, node.name);
      // Merge domLookup data with node's own attributes (node is richer now)
      const domInfo  = domLookup.get(node.name.toLowerCase()) ?? {
        id:          node.id,
        type:        node.type,
        placeholder: node.placeholder,
      };
      const { primary, fallback } = toLocatorExpression(node.role, node.name, domInfo);
      const typeLabel = ROLE_TYPE_LABEL[node.role] || node.role;
      const isPassword = domInfo?.type === 'password' || node.type === 'password';

      const entry = {
        primary,
        fallback,
        type:        isPassword ? 'PasswordInput' : typeLabel,
        description: `${node.role} "${node.name}" — auto-extracted from ${pageName}`,
        acRefs:      [],
        status:      'auto-captured',
        autoNote:    'DRAFT: assign acRefs from spec UI Element Inventory before passing to Agent 2.',
      };

      if (isPassword) {
        entry.autoNote += ' PASSWORD FIELD — verify type="password" attribute in POM.';
      }

      locators[elemName] = entry;
      console.log(`   ✅  ${elemName.padEnd(38)} ${primary}`);
    }

    // ── Write output ────────────────────────────────────────────────────────
    const outputPath = path.join('features', feature, 'locators', `extract_${feature}_auto.json`);

    // Merge with existing file (supports running multiple times for different pages)
    let existing = {};
    if (fs.existsSync(outputPath)) {
      try { existing = JSON.parse(fs.readFileSync(outputPath, 'utf8')); }
      catch { existing = {}; }
    }

    const output = {
      metadata: {
        ...(existing.metadata || {}),
        feature,
        dateGenerated: new Date().toISOString().split('T')[0],
        source:        'auto_locator_extractor.js',
        baseUrl,
        note: 'DRAFT — auto-extracted from live DOM. Assign acRefs, verify password fields, run Codegen for dynamic elements.',
      },
      ...existing,
      [pageName]: locators,
    };

    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  Extraction Complete');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  Elements captured : ${Object.keys(locators).length}`);
    console.log(`  Output file       : ${outputPath}`);
    console.log('');
    console.log('  ⚠️  NOT captured (require Codegen fallback):');
    console.log('     • Error / validation messages (appear after failed submit)');
    console.log('     • Success banners (appear after action completes)');
    console.log('     • Elements revealed by hover or click interactions');
    console.log('     • Elements behind authentication not yet visited');
    console.log('');
    console.log('  📋 Next steps:');
    console.log(`     1. Open ${outputPath}`);
    console.log('     2. Assign acRefs for each element from the spec UI Element Inventory');
    console.log('     3. For any dynamic / missing elements, run targeted Codegen:');
    console.log(`        npx playwright codegen ${baseUrl}${url}`);
    console.log('     4. Pass both files to Agent 2 for final locator JSON generation');
    console.log('══════════════════════════════════════════════════════════\n');

  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message || err);
  process.exit(1);
});
