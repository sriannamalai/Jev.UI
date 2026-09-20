// One end-to-end smoke test: the real built stack (`jev serve`, from
// apps/cli/dist/bin.js) driven through a real Chromium page, talking to a
// stubbed upstream (never the real TypeSafe API — see fixtures.ts and
// stub-upstream.mjs). `workers: 1` and the worker-scoped `serveHandle`
// fixture mean the server is already up and listening on the configured
// baseURL by the time this test runs.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConsoleMessage, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const TICKET_STATE =
  'Customer: the checkout API keeps returning 500 errors on retry and I am about to cancel my plan.';

const BASE_FRUSTRATION_LEVELS = [
  'Calm, just stating facts',
  'Frustrated but civil',
  'Very angry, strong language',
];

const FOUR_FRUSTRATION_LEVELS = [...BASE_FRUSTRATION_LEVELS, 'Threatening to leave'];

interface BuildRequestOptions {
  state: string;
  frustrationLevels: string[];
}

/** The support-triage question set (jev/support-triage.json), as a `Request` body. */
function buildRequestJson(opts: BuildRequestOptions): string {
  const { state, frustrationLevels } = opts;
  return JSON.stringify(
    {
      state,
      questions: {
        department: {
          type: 'choice',
          instructions: 'Which team should handle this',
          criteria: {
            billing: 'Payment or subscription issues',
            technical: 'Bugs or integration problems',
            sales: 'Pricing or account questions',
          },
        },
        frustration: {
          type: 'score',
          instructions: 'How frustrated the customer appears',
          criteria: frustrationLevels,
        },
        is_urgent: {
          type: 'noul',
          instructions: 'The message conveys urgency or time-sensitivity',
        },
      },
    },
    null,
    2,
  );
}

/** Replace the whole CodeMirror document via select-all + insertText. */
async function replaceJsonPane(page: Page, text: string): Promise<void> {
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
  // Blur so the pane header reports "in sync" rather than the focused state
  // (Tab is bound to indent-with-tab inside the editor, so it can't be used
  // to move focus away — click the pane's own, non-editable header instead).
  await page.locator('.col-json .col-head').click();
}

/** Read back the code the Export menu produced, whichever path it took. */
async function readExportedCode(page: Page): Promise<string> {
  const copiedStatus = page.getByText('Copied', { exact: true });
  const dialog = page.getByRole('dialog', { name: 'Exported code' });
  await Promise.race([
    copiedStatus.waitFor({ state: 'visible', timeout: 5000 }),
    dialog.waitFor({ state: 'visible', timeout: 5000 }),
  ]);

  if (await dialog.isVisible()) {
    const value = await dialog.locator('textarea').inputValue();
    await dialog.getByRole('button', { name: 'Close' }).click();
    return value;
  }

  return page.evaluate(() => navigator.clipboard.readText());
}

test('workbench end to end', async ({ page, context, stub, serveHandle }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const requestUrls: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('request', (req) => requestUrls.push(req.url()));
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // --- 2. Open the app; confirm the key indicator and the support-triage set load. ---
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'API key detected' })).toBeVisible();

  await page.getByLabel('Set', { exact: true }).selectOption('support-triage');
  await expect(page.locator('[role="group"][aria-label^="Question "]')).toHaveCount(3);

  // Reload to a fresh, unsaved document: the point above (a set picker load
  // showing three question cards) is proven; a document that was loaded
  // under a name always saves back to that same name (SaveButton.tsx), so
  // reaching the "save under a brand-new name" scenario below needs a
  // document that was never loaded/saved under one.
  await page.reload();
  await expect(page.getByRole('img', { name: 'API key detected' })).toBeVisible();

  // Ensure Split mode so the JSON pane is present alongside the Build form.
  const splitButton = page.getByRole('button', { name: 'Split', exact: true });
  if ((await splitButton.getAttribute('aria-pressed')) !== 'true') {
    await splitButton.click();
  }

  await replaceJsonPane(
    page,
    buildRequestJson({ state: '', frustrationLevels: BASE_FRUSTRATION_LEVELS }),
  );
  await expect(page.locator('.col-json .r')).toHaveText('● valid · in sync');

  // --- 3. Type a ticket into the State editor; JSON pane re-syncs. ---
  await page.getByLabel('State', { exact: true }).fill(TICKET_STATE);
  await expect(page.locator('.col-json .r')).toHaveText('● valid · in sync');

  // --- 4. Add a fourth frustration level via the JSON pane. ---
  await replaceJsonPane(
    page,
    buildRequestJson({ state: TICKET_STATE, frustrationLevels: FOUR_FRUSTRATION_LEVELS }),
  );
  await expect(page.locator('.col-json .r')).toHaveText('● valid · in sync');

  const frustrationCard = page.locator('[role="group"][aria-label="Question frustration"]');
  await frustrationCard.locator('.q-toggle').click();
  await expect(frustrationCard.locator('.row.lvl')).toHaveCount(4);

  // --- 5. Break the JSON, then restore it. ---
  const fullJson = buildRequestJson({
    state: TICKET_STATE,
    frustrationLevels: FOUR_FRUSTRATION_LEVELS,
  });
  const runButton = page.getByRole('button', { name: /^Run/ });

  await replaceJsonPane(page, fullJson.slice(0, fullJson.length - 40));
  await expect(page.locator('.col-json .r')).toHaveText(/^✕ line \d+/);
  await expect(runButton).toBeDisabled();

  await replaceJsonPane(page, fullJson);
  await expect(page.locator('.col-json .r')).toHaveText('● valid · in sync');
  await expect(runButton).toBeEnabled();

  // --- 6. Run, and check the results, status bar, and the upstream request. ---
  await runButton.click();

  const departmentResult = page.locator('.res', { hasText: 'department' });
  await expect(departmentResult.locator('.answer')).toHaveText('technical');

  const frustrationResult = page.locator('.res', { hasText: 'frustration' });
  await expect(frustrationResult.locator('.tag')).toHaveText('score');

  const urgentResult = page.locator('.res', { hasText: 'is_urgent' });
  await expect(urgentResult.locator('.answer')).toContainText('0.99');

  const statusBar = page.locator('footer.status');
  await expect(statusBar).toContainText('jev-1.13.0');
  await expect(statusBar).toContainText('425 tok');

  expect(await page.content()).not.toContain('test-key');

  expect(stub.requests).toHaveLength(1);
  const upstreamRequest = stub.requests[0] as {
    state?: unknown;
    questions?: { frustration?: { criteria?: unknown[] } };
  };
  expect(upstreamRequest.state).toBe(TICKET_STATE);
  expect(upstreamRequest.questions?.frustration?.criteria).toHaveLength(4);
  expect(stub.badAuth).toBe(0);

  // --- 7. Edit the state again; results go stale. ---
  await page.getByLabel('State', { exact: true }).fill(`${TICKET_STATE} Update: still broken.`);
  await expect(page.locator('.col-results .stale-chip')).toHaveText('stale — request changed');

  // --- 8. Save under a new name. ---
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Set name', { exact: true }).fill('e2e-smoke');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const savedSet = await page.evaluate(async () => {
    const res = await fetch('/api/sets/e2e-smoke');
    return res.json();
  });
  expect(savedSet.name).toBe('e2e-smoke');
  expect(savedSet.questions.frustration.criteria).toHaveLength(4);

  const savedFile = path.join(serveHandle.setsDir, 'e2e-smoke.json');
  const savedFileContents = JSON.parse(await readFile(savedFile, 'utf8'));
  expect(savedFileContents.name).toBe('e2e-smoke');
  expect(savedFileContents.questions.frustration.criteria).toHaveLength(4);

  await expect(
    page.getByLabel('Set', { exact: true }).locator('option[value="e2e-smoke"]'),
  ).toHaveCount(1);

  // --- 9. Export as cURL: the API key is never inlined. ---
  await page.getByRole('button', { name: 'Export code', exact: true }).click();
  await page.getByRole('menuitem', { name: 'cURL' }).click();
  const exported = await readExportedCode(page);
  expect(exported).toContain('$TYPESAFE_API_KEY');
  expect(exported).not.toContain('test-key');

  // --- 10. Final assertions: same-origin only, key never rendered, no console/page errors. ---
  const origin = new URL(page.url()).origin;
  for (const url of requestUrls) {
    expect(new URL(url).origin).toBe(origin);
  }
  expect(await page.content()).not.toContain('test-key');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
