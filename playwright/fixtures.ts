import { test as baseTest, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export * from '@playwright/test';

const { users } = JSON.parse(fs.readFileSync(path.join(__dirname, '.auth/users.json'), 'utf-8'));

export const test = baseTest.extend<{}, { workerStorageState: string }>({
  // Use the same storage state for all tests in this worker.
  storageState: ({ workerStorageState }, use) => use(workerStorageState),

  // Authenticate once per worker with a worker-scoped fixture.
  workerStorageState: [async ({ browser }, use) => {
    // Use parallelIndex as a unique identifier for each worker.
    const testInfo = test.info();
    const id = testInfo.parallelIndex;
    const fileName = path.resolve(test.info().project.outputDir, `.auth/${id}.json`);

    if (fs.existsSync(fileName)) {
      // Reuse existing authentication state if any.
      await use(fileName);
      return;
    }

    // Important: make sure we authenticate in a clean environment by unsetting storage state.
    const page = await browser.newPage({ storageState: undefined });
    
    await page.goto(testInfo.project.use.baseURL || 'https://demo.tienganhk12.com');
    await page.getByText('Đăng nhập').first().click();
    await page.getByRole('textbox', { name: 'Username or email' }).click();
    await page.getByRole('textbox', { name: 'Username or email' }).fill(users[id].username);
    await page.getByRole('textbox', { name: 'Password' }).click();
    await page.getByRole('textbox', { name: 'Password' }).fill(users[id].password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    
    if (testInfo.project.name === 'webkit') {
      await page.waitForTimeout(7000);
    } else {
      await page.waitForTimeout(2500);
    }

    // End of authentication steps.

    await page.context().storageState({ path: fileName });
    await page.close();
    await use(fileName);
  }, { scope: 'worker' }],
});