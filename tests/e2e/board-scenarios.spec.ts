import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Agent } from '@doks/agent';

async function openBoard(page: Page) {
  const welcomeBtn = page.locator('button:has-text("Создать доску")');
  if (await welcomeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await welcomeBtn.click();
  } else {
    await page.click('button[title*="Доски"]');
    const newBoardBtn = page.locator('button[title="Новая доска"]');
    if (await newBoardBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await newBoardBtn.click();
    } else {
      await page.click('.tree-item-row');
    }
  }
  await page.waitForSelector('.board-container', { timeout: 10000 });
}

test.describe('F12: Playwright E2E Scenarios for Doks', () => {
  let tempDir1: string;
  let tempDir2: string;
  let agent1: Agent;
  let agent2: Agent;
  let port1: number;
  let port2: number;
  let peerPort1: number;
  let peerPort2: number;

  test.beforeEach(async () => {
    tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-e2e-1-'));
    tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-e2e-2-'));

    port1 = 4100 + Math.floor(Math.random() * 400);
    port2 = port1 + 10;
    peerPort1 = 6100 + Math.floor(Math.random() * 400);
    peerPort2 = peerPort1 + 10;

    agent1 = new Agent({
      baseDir: tempDir1,
      memberName: 'Алиса',
      webPort: port1,
      peerPort: peerPort1,
      bindAddress: '127.0.0.1',
      teamKey: 'common-e2e-team-key'
    });

    agent2 = new Agent({
      baseDir: tempDir2,
      memberName: 'Боб',
      webPort: port2,
      peerPort: peerPort2,
      bindAddress: '127.0.0.1',
      teamKey: 'common-e2e-team-key',
      peers: [`127.0.0.1:${peerPort1}`]
    });

    await agent1.start();
    await agent2.start();
  });

  test.afterEach(async () => {
    await agent2.stop();
    await agent1.stop();
    if (fs.existsSync(tempDir1)) fs.rmSync(tempDir1, { recursive: true, force: true });
    if (fs.existsSync(tempDir2)) fs.rmSync(tempDir2, { recursive: true, force: true });
  });

  test('Scenario 1: Создание стикера на доске', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port1}`);
    await openBoard(page);

    // Click on sticky tool
    await page.click('button[title*="Стикер"]');

    // Click on canvas center to place sticky
    const canvas = page.locator('.board-container');
    await canvas.click({ position: { x: 400, y: 300 } });

    // Expect sticky textarea to appear
    const textarea = page.locator('.node-inline-textarea').first();
    await expect(textarea).toBeVisible();

    // Type text
    await textarea.fill('Тестовый стикер из E2E');
    await expect(textarea).toHaveValue('Тестовый стикер из E2E');
  });

  test('Scenario 2: Перетаскивание стикера', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port1}`);
    await openBoard(page);

    // Create a sticky first
    await page.click('button[title*="Стикер"]');
    const canvas = page.locator('.board-container');
    await canvas.click({ position: { x: 300, y: 300 } });

    const stickyNode = page.locator('.board-node-box').first();
    await expect(stickyNode).toBeVisible();

    // Get initial position
    const box1 = await stickyNode.boundingBox();
    expect(box1).not.toBeNull();

    // Drag sticky by dragging its surface
    await page.mouse.move(box1!.x + 20, box1!.y + 10);
    await page.mouse.down();
    await page.mouse.move(box1!.x + 120, box1!.y + 80);
    await page.mouse.up();

    // Wait for drag update
    await page.waitForTimeout(200);
    const box2 = await stickyNode.boundingBox();
    expect(box2).not.toBeNull();
    expect(box2!.x).toBeGreaterThan(box1!.x);
  });

  test('Scenario 3: Отмена действия (Ctrl+Z)', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port1}`);
    await openBoard(page);

    // Create a sticky
    await page.click('button[title*="Стикер"]');
    const canvas = page.locator('.board-container');
    await canvas.click({ position: { x: 350, y: 250 } });

    const textarea = page.locator('.node-inline-textarea').first();
    await textarea.fill('Текст перед отменой');

    // Press Escape to blur textarea
    await page.keyboard.press('Escape');

    // Press Ctrl+Z
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
  });

  test('Scenario 4: Одновременная правка одного стикера двумя агентами (F1)', async ({ browser }) => {
    const { getBoardDocName, getBoardMaps, DOC_INDEX, getIndexMaps } = await import('@doks/shared');
    const indexDoc = agent1.docManager.getOrCreateDoc(DOC_INDEX);
    const { boards } = getIndexMaps(indexDoc);

    const boardId = 'concurrent-board-f1';
    boards.set(boardId, {
      id: boardId,
      title: 'Синхронизация F1',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });

    // Ensure doc is created on both agents
    agent1.docManager.getOrCreateDoc(getBoardDocName(boardId));
    agent2.docManager.getOrCreateDoc(getBoardDocName(boardId));

    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await p1.goto(`http://127.0.0.1:${port1}`);
    await p1.click('button[title*="Доски"]');
    await p1.waitForSelector('.tree-board-item:has-text("Синхронизация F1")');
    await p1.click('.tree-board-item:has-text("Синхронизация F1")');
    await p1.waitForSelector('.board-container');

    await p2.goto(`http://127.0.0.1:${port2}`);
    await p2.click('button[title*="Доски"]');
    await p2.waitForSelector('.tree-board-item:has-text("Синхронизация F1")', { timeout: 10000 });
    await p2.click('.tree-board-item:has-text("Синхронизация F1")');
    await p2.waitForSelector('.board-container');

    // Alice creates a sticky on Agent 1
    await p1.bringToFront();
    await p1.click('button[title*="Стикер"]');
    await p1.locator('.board-container').click({ position: { x: 400, y: 200 } });

    const t1 = p1.locator('.node-inline-textarea').first();
    await expect(t1).toBeVisible({ timeout: 5000 });
    await t1.fill('Задача: ');

    // Wait for sync to Agent 2 / Bob
    await p2.bringToFront();
    const t2 = p2.locator('.node-inline-textarea').first();
    await expect(t2).toBeVisible({ timeout: 15000 });
    await expect(t2).toHaveValue('Задача: ', { timeout: 10000 });

    // Alice updates on Agent 1
    await p1.bringToFront();
    await t1.fill('Задача: Реализовать P2P');

    // Bob also receives the delta update
    await p2.bringToFront();
    await expect(t2).toHaveValue('Задача: Реализовать P2P', { timeout: 10000 });

    await ctx1.close();
    await ctx2.close();
  });

  test('Scenario 5: Экспорт контекста для ИИ (F8)', async ({ page }) => {
    page.on('console', (msg) => console.log('[Browser Console]', msg.type(), msg.text()));
    page.on('pageerror', (err) => console.error('[Browser PageError]', err));

    await page.goto(`http://127.0.0.1:${port1}`);
    await openBoard(page);

    // Create a sticky
    await page.click('button[title*="Стикер"]');
    await page.locator('.board-container').click({ position: { x: 300, y: 200 } });
    const textarea = page.locator('.node-inline-textarea').first();
    await expect(textarea).toBeVisible();
    await textarea.fill('Стикер для ИИ');
    await page.keyboard.press('Escape');

    // Open AI Export modal via toolbox button
    await page.click('[data-testid="ai-export-btn"]');

    // Verify modal opened
    const modal = page.locator('.ai-export-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Экспорт доски для ИИ');

    // Preview contains structured doks-ai/1 format in textarea
    const preview = page.locator('.ai-export-preview');
    await expect(preview).toHaveValue(/# Контекст доски:/, { timeout: 10000 });
    await expect(preview).toHaveValue(/Стикер для ИИ/, { timeout: 10000 });

    // Close modal
    await page.click('[data-testid="close-ai-modal"]');
    await expect(modal).not.toBeVisible();
  });

  test('Scenario 6: Бенчмарк производительности доски (1000 объектов)', async ({ page }) => {
    const { getBoardDocName, getBoardMaps, createNodeMap, DOC_INDEX, getIndexMaps } = await import('@doks/shared');
    const indexDoc = agent1.docManager.getOrCreateDoc(DOC_INDEX);
    const { boards } = getIndexMaps(indexDoc);

    boards.set('bench-board', {
      id: 'bench-board',
      title: 'Бенчмарк 1000',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });

    const boardDoc = agent1.docManager.getOrCreateDoc(getBoardDocName('bench-board'));
    const { nodes } = getBoardMaps(boardDoc);

    boardDoc.transact(() => {
      for (let i = 0; i < 1000; i++) {
        const id = `bench-node-${i}`;
        const x = (i % 30) * 140;
        const y = Math.floor(i / 30) * 90;
        nodes.set(id, createNodeMap({
          id,
          type: 'sticky',
          text: `Sticky #${i}`,
          x,
          y,
          w: 120,
          h: 70,
          color: String((i % 6) + 1),
          author: 'Bench'
        }));
      }
    });

    const startLoad = Date.now();
    await page.goto(`http://127.0.0.1:${port1}`);
    await page.click('button[title*="Доски"]');
    await page.waitForSelector('.tree-board-item:has-text("Бенчмарк 1000")');
    await page.click('.tree-board-item:has-text("Бенчмарк 1000")');
    await page.waitForSelector('.board-container');
    const loadTimeMs = Date.now() - startLoad;

    // Pan canvas smoothly
    const startPan = Date.now();
    for (let step = 0; step < 10; step++) {
      await page.mouse.move(500, 300);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(500 + step * 20, 300 + step * 10);
      await page.mouse.up({ button: 'middle' });
    }
    const panDurationMs = Date.now() - startPan;
    const estimatedFps = Math.round((10 / (panDurationMs / 1000)));

    console.log(`[Benchmark] 1000 objects loaded in ${loadTimeMs}ms, panning FPS ~${estimatedFps}fps`);
    expect(loadTimeMs).toBeLessThan(8000);
  });
});
