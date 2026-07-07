#!/usr/bin/env node
/**
 * auto_locator_extractor.js
 *
 * Single-session Playwright locator extractor for Agent 2. One browser launch per page does
 * EVERYTHING that used to take three separate passes:
 *   1. Interactive elements (buttons, links, inputs, dropdowns) via DOM scan
 *   2. Structural elements (headings, nav, header, footer, landmarks, images) — folded in
 *   3. Dynamic elements revealed by declarative interactions (open dropdown / submit invalid
 *      form / click delete → modal), driven by an optional interactions.json
 *   4. Uniqueness validation — every selector gets a `matchCount` in the SAME session, so
 *      Agent 2 never relaunches a browser to validate
 *
 * Output is the FINAL, merge-preserving `{Feature}_locators.json` (existing acRefs / findings /
 * status overrides are never clobbered on re-run) plus a raw `extract_{Feature}_auto.json`
 * audit snapshot. DOM-hash caching skips re-extraction of unchanged pages (override with --force).
 *
 * Usage:
 *   node scripts/auto_locator_extractor.js --feature CountyAssignment --page createAgencyPage --url /agencies/add --login /
 *   node scripts/auto_locator_extractor.js --feature CountyAssignment --page createAgencyPage --url /agencies/add --login / --force --headed
 *
 * Options:
 *   --feature   PascalCase feature name (matches features/ folder name)
 *   --page      camelCase page group name used as the JSON section key (e.g. createAgencyPage)
 *   --url       Relative URL of the page to extract from (e.g. /agencies/add)
 *   --login     Optional: relative login URL if the target page requires authentication
 *   --interactions  Optional: path to interactions.json (default features/{Feature}/locators/interactions.json)
 *   --force     Ignore the DOM-hash cache and re-extract
 *   --headed    Run with a visible browser window (default: headless)
 *
 * Environment variables (from .env):
 *   BASE_URL, TEST_USER_EMAIL, TEST_USER_PASSWORD, ACTION_TIMEOUT
 *
 * interactions.json schema (all generic — values are project-specific, schema is not):
 *   {
 *     "createAgencyPage": {
 *       "steps": [
 *         { "action": "click",        "target": "page.getByRole('button', { name: 'Counties Served' })", "captureAfter": true, "note": "open counties dropdown" },
 *         { "action": "fill",         "target": "page.getByPlaceholder('Search county...')", "value": "Aut" },
 *         { "action": "selectOption", "target": "page.locator('#state')", "value": "Alabama" },
 *         { "action": "waitFor",      "target": "page.getByRole('dialog')" },
 *         { "action": "submitInvalid","target": "page.getByRole('button', { name: 'Save' })", "captureAfter": true, "note": "trigger validation errors" }
 *       ]
 *     }
 *   }
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');

require('dotenv').config();

const ACTION_TIMEOUT = Number(process.env.ACTION_TIMEOUT) || 90000;

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
      '    [--interactions <path>] [--force] [--headed]\n'
    );
    process.exit(1);
  }

  return {
    feature, pageName, url,
    loginUrl:     get('--login'),
    interactions: get('--interactions'),
    force:        args.includes('--force'),
    headed:       args.includes('--headed'),
  };
}

// ─── Element name / type / expression generation ─────────────────────────────

const ROLE_SUFFIX = {
  textbox: 'Input', searchbox: 'Input', button: 'Button',
  link: 'Link', checkbox: 'Checkbox', radio: 'Radio',
  combobox: 'Dropdown', tab: 'Tab', switch: 'Toggle',
  heading: 'Heading', dialog: 'Dialog', alert: 'Alert',
  navigation: 'Nav', img: 'Image',
};

const ROLE_TYPE_LABEL = {
  textbox: 'TextInput', searchbox: 'TextInput', button: 'Button',
  link: 'Link', checkbox: 'Checkbox', radio: 'RadioButton', combobox: 'Dropdown',
  heading: 'Heading', dialog: 'Dialog', alert: 'Alert', navigation: 'Nav', img: 'Image',
};

function toElementName(role, name) {
  const clean = (name || '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('');

  const base = clean || role;
  const suffix = ROLE_SUFFIX[role] || (role[0].toUpperCase() + role.slice(1));
  return base.toLowerCase().endsWith(suffix.toLowerCase()) ? base : base + suffix;
}

function toLocatorExpression(role, name, domInfo) {
  const esc = (name || '').replace(/'/g, "\\'");

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
    case 'link':
      return { primary: `page.getByRole('link', { name: '${esc}' })`, fallback: `page.getByText('${esc}')` };
    case 'checkbox': {
      const primary = domInfo?.id ? `page.locator('#${domInfo.id}')` : `page.getByRole('checkbox', { name: '${esc}' })`;
      return { primary, fallback: `page.getByLabel('${esc}')` };
    }
    case 'radio':
      return { primary: `page.getByRole('radio', { name: '${esc}' })`, fallback: domInfo?.id ? `page.locator('#${domInfo.id}')` : `page.getByRole('radio', { name: '${esc}' })` };
    case 'combobox':
      return { primary: `page.getByRole('combobox', { name: '${esc}' })`, fallback: domInfo?.id ? `page.locator('#${domInfo.id}')` : `page.getByRole('combobox', { name: '${esc}' })` };
    case 'heading':
      return { primary: `page.getByRole('heading', { name: '${esc}' })`, fallback: domInfo?.tag ? `page.locator('${domInfo.tag}')` : `page.getByText('${esc}')` };
    case 'navigation':
      return { primary: `page.getByRole('navigation')`, fallback: `page.locator('nav')` };
    case 'img':
      return { primary: `page.getByRole('img', { name: '${esc}' })`, fallback: `page.getByAltText('${esc}')` };
    case 'dialog':
      return { primary: `page.getByRole('dialog')`, fallback: `page.getByRole('alertdialog')` };
    case 'alert':
      return { primary: `page.getByRole('alert')`, fallback: `page.getByText('${esc}')` };
    default:
      return { primary: `page.getByRole('${role}', { name: '${esc}' })`, fallback: `page.getByText('${esc}')` };
  }
}

// ─── Browser-side collectors ──────────────────────────────────────────────────

async function extractDomInfo(page) {
  const rows = await page.evaluate(() => {
    const results = [];
    const getLabel = (el) => {
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
      const lbId = el.getAttribute('aria-labelledby');
      if (lbId) { const lbEl = document.getElementById(lbId); if (lbEl) return lbEl.textContent.trim(); }
      if (el.id) { const lbEl = document.querySelector(`label[for="${el.id}"]`); if (lbEl) return lbEl.textContent.trim(); }
      return el.placeholder || el.textContent?.trim() || el.name || '';
    };
    document.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach((el) => {
      results.push({ tag: el.tagName.toLowerCase(), id: el.id || '', type: el.type || '', name: el.name || '', placeholder: el.placeholder || '', labelText: getLabel(el) });
    });
    document.querySelectorAll('button, [role="button"]').forEach((el) => {
      results.push({ tag: 'button', id: el.id || '', type: 'button', name: '', placeholder: '', labelText: el.getAttribute('aria-label') || el.textContent?.trim() || '' });
    });
    return results;
  });
  const lookup = new Map();
  for (const row of rows) {
    const keys = [row.labelText, row.placeholder, row.name].filter(Boolean).map(k => k.toLowerCase());
    for (const k of keys) if (!lookup.has(k)) lookup.set(k, row);
  }
  return lookup;
}

async function extractInteractiveElements(page) {
  return page.evaluate(() => {
    const getAccessibleName = (el) => {
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        const txt = labelledby.split(/\s+/).map(id => { const e = document.getElementById(id); return e ? e.textContent.trim() : ''; }).filter(Boolean).join(' ');
        if (txt) return txt;
      }
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;
      if (el.id) { const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (lbl) return lbl.textContent.trim(); }
      if (el.placeholder) return el.placeholder;
      const innerText = el.textContent?.trim();
      if (innerText && innerText.length <= 80) return innerText;
      return el.name || '';
    };
    const getRole = (el) => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'button' || type === 'button' || type === 'submit' || type === 'reset') return 'button';
      if (tag === 'a') return 'link';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input') {
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'search') return 'searchbox';
        return 'textbox';
      }
      return tag;
    };
    const SELECTORS = [
      'button:not([disabled])', '[role="button"]', 'a[href]', '[role="link"]',
      'input:not([type="hidden"]):not([disabled])', 'textarea:not([disabled])', 'select:not([disabled])',
      '[role="checkbox"]', '[role="radio"]', '[role="combobox"]', '[role="tab"]', '[role="menuitem"]', '[role="switch"]', '[role="option"]',
    ].join(',');
    const seen = new Set(); const results = [];
    document.querySelectorAll(SELECTORS).forEach((el) => {
      const role = getRole(el); const name = getAccessibleName(el);
      if (!name) return;
      const key = `${role}::${name}`;
      if (seen.has(key)) return; seen.add(key);
      results.push({ role, name, id: el.id || '', type: el.getAttribute('type') || '', placeholder: el.placeholder || '' });
    });
    return results;
  });
}

// Structural elements (folds in the old mandatory "Step 1.5" structural DOM pass).
async function extractStructuralElements(page) {
  return page.evaluate(() => {
    const results = [];
    const push = (role, name, tag, id) => { if (name || role === 'navigation') results.push({ role, name: name || '', tag, id: id || '' }); };
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => push('heading', el.textContent?.trim() || '', el.tagName.toLowerCase(), el.id));
    document.querySelectorAll('nav, [role="navigation"]').forEach((el) => push('navigation', el.getAttribute('aria-label') || '', 'nav', el.id));
    document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((el) => push('dialog', el.getAttribute('aria-label') || (el.querySelector('h1,h2,h3')?.textContent?.trim()) || '', 'dialog', el.id));
    document.querySelectorAll('[role="alert"], [aria-live="assertive"], [aria-live="polite"]').forEach((el) => push('alert', el.textContent?.trim()?.slice(0, 60) || '', 'alert', el.id));
    document.querySelectorAll('img[alt]').forEach((el) => { const alt = el.getAttribute('alt'); if (alt) push('img', alt, 'img', el.id); });
    return results;
  });
}

// ─── interactions.json replay ─────────────────────────────────────────────────

function evalLocator(page, expr) {
  // eslint-disable-next-line no-new-func
  return new Function('page', `return (${expr});`)(page);
}

async function runInteractionStep(page, step) {
  const loc = step.target ? evalLocator(page, step.target) : null;
  switch (step.action) {
    case 'click':        await loc.click({ timeout: ACTION_TIMEOUT }); break;
    case 'fill':         await loc.fill(step.value ?? '', { timeout: ACTION_TIMEOUT }); break;
    case 'selectOption': await loc.selectOption(step.value, { timeout: ACTION_TIMEOUT }); break;
    case 'waitFor':      await loc.waitFor({ state: step.state || 'visible', timeout: ACTION_TIMEOUT }); break;
    case 'submitInvalid':await loc.click({ timeout: ACTION_TIMEOUT }); break; // click submit with empty/invalid form
    case 'press':        await page.keyboard.press(step.value || 'Enter'); break;
    default: console.warn(`   ⚠️  unknown interaction action: ${step.action}`);
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
}

// ─── Entry building + uniqueness validation ───────────────────────────────────

function buildEntry(node, pageName, source) {
  const domInfo = { id: node.id, type: node.type, placeholder: node.placeholder, tag: node.tag };
  const { primary, fallback } = toLocatorExpression(node.role, node.name, domInfo);
  const isPassword = node.type === 'password';
  const typeLabel = ROLE_TYPE_LABEL[node.role] || node.role;
  return {
    primary,
    fallback,
    type: isPassword ? 'PasswordInput' : typeLabel,
    description: `${node.role} "${node.name}" — extracted from ${pageName}${source === 'interaction' ? ' (after interaction)' : ''}`,
    acRefs: [],
    source,            // 'dom-scan' | 'structural' | 'interaction'
    status: 'captured',
  };
}

// Count matches for each entry's primary (and fallback) in the SAME session.
async function validateUniqueness(page, locators) {
  for (const entry of Object.values(locators)) {
    let count = 0;
    try { count = await evalLocator(page, entry.primary).count(); } catch { count = -1; }
    entry.matchCount = count;
    if (count === 0) {
      // primary missed — check fallback; if it hits, promote a note for Agent 2/3.
      let fbCount = -1;
      try { fbCount = await evalLocator(page, entry.fallback).count(); } catch { fbCount = -1; }
      entry.fallbackMatchCount = fbCount;
      if (fbCount > 0) {
        entry.validationNote = 'primary matched 0 — fallback matches; runtime .or() will use fallback';
      } else {
        entry.status = 'missing';
        entry.validationNote = 'neither primary nor fallback matched on this page snapshot';
      }
    } else if (count > 1) {
      entry.validationNote = `primary matches ${count} elements — may need scoping (Agent 2 review)`;
    }
  }
}

// ─── Merge-preserving write ────────────────────────────────────────────────────

// Preserve human/Agent-assigned fields when an element already exists in the final file.
const PRESERVE_FIELDS = ['acRefs', 'finding', 'codegenForm', 'fragile', 'fragileNote', 'captureNote'];

function mergePage(existingPage, freshPage) {
  const merged = { ...freshPage };
  for (const [name, freshEntry] of Object.entries(freshPage)) {
    const prev = existingPage && existingPage[name];
    if (!prev) continue;
    for (const f of PRESERVE_FIELDS) {
      if (prev[f] !== undefined && (freshEntry[f] === undefined || (Array.isArray(freshEntry[f]) && freshEntry[f].length === 0))) {
        freshEntry[f] = prev[f];
      }
    }
    // Keep a human "missing→captured" promotion: if prev was captured manually, don't downgrade.
    if (prev.status === 'captured' && freshEntry.status === 'missing') {
      freshEntry.statusNote = `re-extract found 0 matches but prior run had it captured — verify (was: ${prev.primary})`;
    }
  }
  // Carry over any elements that existed before but the fresh scan didn't see (e.g. dynamic).
  if (existingPage) {
    for (const [name, prevEntry] of Object.entries(existingPage)) {
      if (!merged[name]) merged[name] = prevEntry;
    }
  }
  return merged;
}

// ─── Caching ───────────────────────────────────────────────────────────────────

function cachePath(feature) {
  return path.join('features', feature, 'locators', '.extract_cache.json');
}
function readCache(feature) {
  const p = cachePath(feature);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}
function writeCache(feature, cache) {
  fs.writeFileSync(cachePath(feature), JSON.stringify(cache, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { feature, pageName, url, loginUrl, interactions, force, headed } = parseArgs();

  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) { console.error('ERROR: BASE_URL is not set in .env'); process.exit(1); }

  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (_) {
    try { ({ chromium } = require('@playwright/test')); }
    catch { console.error('ERROR: playwright not found — run: npm install'); process.exit(1); }
  }

  // Load interactions for this page (optional).
  const interactionsPath = interactions || path.join('features', feature, 'locators', 'interactions.json');
  let pageInteractions = null;
  if (fs.existsSync(interactionsPath)) {
    try {
      const all = JSON.parse(fs.readFileSync(interactionsPath, 'utf8'));
      pageInteractions = all[pageName] || null;
    } catch (e) { console.warn(`⚠️  could not parse ${interactionsPath}: ${e.message}`); }
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Auto Locator Extractor (single-session)');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Feature      : ${feature}`);
  console.log(`  Page         : ${pageName}`);
  console.log(`  URL          : ${baseUrl}${url}`);
  console.log(`  Auth         : ${loginUrl ? 'authenticated (--login)' : 'unauthenticated'}`);
  console.log(`  Interactions : ${pageInteractions ? `${pageInteractions.steps?.length || 0} step(s)` : 'none'}`);
  console.log(`  Cache        : ${force ? 'bypassed (--force)' : 'enabled'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();

  try {
    if (loginUrl) {
      const email = process.env.TEST_USER_EMAIL, password = process.env.TEST_USER_PASSWORD;
      if (!email || !password) { console.error('ERROR: --login requires TEST_USER_EMAIL and TEST_USER_PASSWORD in .env'); process.exit(1); }
      console.log(`🔐 Authenticating via ${loginUrl} ...`);
      await page.goto(loginUrl);
      await page.waitForLoadState('domcontentloaded');
      await page.getByRole('textbox', { name: /username|email/i }).first().fill(email);
      await page.getByRole('textbox', { name: /password/i }).first().fill(password);
      await page.getByRole('button', { name: /sign in/i }).or(page.getByRole('button', { name: /log in/i })).first().click();
      await page.waitForLoadState('networkidle');
      console.log(`   ✅ Authenticated — ${page.url()}\n`);
    }

    console.log(`📄 Navigating to ${url} ...`);
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    console.log(`   Loaded: ${page.url()}\n`);

    // ── DOM-hash cache check ────────────────────────────────────────────────
    const finalPath = path.join('features', feature, 'locators', `${feature}_locators.json`);
    const domHash = crypto.createHash('sha1').update(await page.content()).digest('hex');
    const cache = readCache(feature);
    if (!force && cache[pageName]?.domHash === domHash && fs.existsSync(finalPath)) {
      console.log(`✅ Cache hit for ${pageName} (DOM unchanged) — skipping extraction. Use --force to override.\n`);
      await browser.close();
      return;
    }

    // ── 1. Interactive + structural scan (initial page state) ────────────────
    const nodes = await extractInteractiveElements(page);
    const structural = await extractStructuralElements(page);
    const domLookup = await extractDomInfo(page);
    console.log(`📋 ${nodes.length} interactive + ${structural.length} structural element(s) on initial load`);

    const locators = {};
    // domInfo rows carry name:'' for buttons — never let empty values clobber the computed accessible name
    const mergeNonEmpty = (node, domInfo) => {
      const merged = { ...(domInfo || {}) };
      for (const [k, v] of Object.entries(node)) if (v !== '' && v != null) merged[k] = v;
      return merged;
    };
    const addNodes = (list, source) => {
      for (const node of list) {
        const domInfo = domLookup.get((node.name || '').toLowerCase());
        const merged = mergeNonEmpty(node, domInfo);
        const elemName = toElementName(node.role, node.name);
        if (!locators[elemName]) locators[elemName] = buildEntry(merged, pageName, source);
      }
    };
    addNodes(nodes, 'dom-scan');
    addNodes(structural, 'structural');

    // ── 2. Replay declarative interactions to reveal dynamic elements ────────
    if (pageInteractions?.steps?.length) {
      console.log(`\n🎬 Replaying ${pageInteractions.steps.length} interaction step(s) for dynamic elements ...`);
      const triggerNotes = [];
      for (const step of pageInteractions.steps) {
        try {
          await runInteractionStep(page, step);
          if (step.note) triggerNotes.push(step.note);
          console.log(`   ▶ ${step.action}${step.note ? ` — ${step.note}` : ''}`);
          if (step.captureAfter) {
            const dyn = await extractInteractiveElements(page);
            const dynStruct = await extractStructuralElements(page);
            const before = Object.keys(locators).length;
            const trigger = triggerNotes.join(' → ');
            for (const node of [...dyn, ...dynStruct]) {
              const elemName = toElementName(node.role, node.name);
              if (!locators[elemName]) {
                const domInfo = domLookup.get((node.name || '').toLowerCase());
                const entry = buildEntry(mergeNonEmpty(node, domInfo), pageName, 'interaction');
                entry.trigger = trigger || 'after interaction';
                locators[elemName] = entry;
              }
            }
            console.log(`     captured ${Object.keys(locators).length - before} new dynamic element(s)`);
          }
        } catch (e) {
          console.warn(`   ⚠️  step failed (${step.action}): ${e.message?.split('\n')[0]}`);
        }
      }
    }

    // ── 3. Uniqueness validation in the SAME session ─────────────────────────
    console.log(`\n🔎 Validating ${Object.keys(locators).length} selector(s) (matchCount) ...`);
    await validateUniqueness(page, locators);
    const missing = Object.values(locators).filter(e => e.status === 'missing').length;
    const ambiguous = Object.values(locators).filter(e => (e.matchCount ?? 0) > 1).length;
    console.log(`   captured=${Object.keys(locators).length - missing}  missing=${missing}  ambiguous(>1)=${ambiguous}`);

    // ── 4a. Raw audit snapshot (overwrite-safe) ──────────────────────────────
    const rawPath = path.join('features', feature, 'locators', `extract_${feature}_auto.json`);
    let rawExisting = {};
    if (fs.existsSync(rawPath)) { try { rawExisting = JSON.parse(fs.readFileSync(rawPath, 'utf8')); } catch { rawExisting = {}; } }
    const rawOut = {
      metadata: { ...(rawExisting.metadata || {}), feature, dateGenerated: new Date().toISOString().split('T')[0], source: 'auto_locator_extractor.js (single-session)', baseUrl },
      ...rawExisting,
      [pageName]: locators,
    };
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    fs.writeFileSync(rawPath, JSON.stringify(rawOut, null, 2));

    // ── 4b. Final merge-preserving locators file ─────────────────────────────
    let finalExisting = {};
    if (fs.existsSync(finalPath)) { try { finalExisting = JSON.parse(fs.readFileSync(finalPath, 'utf8')); } catch { finalExisting = {}; } }
    const mergedPage = mergePage(finalExisting[pageName], locators);
    const finalOut = {
      ...finalExisting,
      metadata: {
        ...(finalExisting.metadata || {}),
        feature,
        dateGenerated: new Date().toISOString().split('T')[0],
        autoExtractorSource: rawPath,
      },
      [pageName]: mergedPage,
    };
    fs.writeFileSync(finalPath, JSON.stringify(finalOut, null, 2));

    // ── Update cache ─────────────────────────────────────────────────────────
    cache[pageName] = { domHash, dateGenerated: new Date().toISOString().split('T')[0] };
    writeCache(feature, cache);

    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  Extraction Complete');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  Final locators : ${finalPath}`);
    console.log(`  Raw snapshot   : ${rawPath}`);
    console.log('');
    console.log('  Agent 2 next: assign acRefs from spec; review missing/ambiguous; only run');
    console.log('  `npx playwright codegen` for elements no interaction step could reach.');
    console.log('══════════════════════════════════════════════════════════\n');

  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message || err);
  process.exit(1);
});
