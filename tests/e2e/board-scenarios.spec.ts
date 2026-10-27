import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Agent } from '@doks/agent';

async function openBoard(page: Page) {
  if (await page.locator('.board-container').isVisible({ timeout: 1000 }).catch(() => false)) {
    return;
  }
  const welcomeBtn = page.locator('.empty-view-placeholder button:has-text("Новая доска"), .empty-view-placeholder button:has-text("Создать доску")').first();
  if (await welcomeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await welcomeBtn.click();
  } else {
    await page.click('button[title*="Доски"]');
    const newBoardBtn = page.locator('.miro-popover-header button[title="Новая доска"]');
    if (await newBoardBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await newBoardBtn.click();
    } else {
      await page.click('.tree-board-item, .tree-item-row');
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

    // Drag sticky by dragging its surface/header
    await page.mouse.move(box1!.x + 60, box1!.y + 10);
    await page.mouse.down();
    await page.mouse.move(box1!.x + 160, box1!.y + 80);
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

  test('Scenario 7: Scope Switcher & Cross-Scope Bridge Promotion', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port1}`);

    // Verify scope switcher pill exists
    const soloBtn = page.locator('.scope-pill-btn:has-text("Соло")');
    const teamBtn = page.locator('.scope-pill-btn:has-text("Команда")');
    await expect(soloBtn).toBeVisible();
    await expect(teamBtn).toBeVisible();

    // Switch to Solo
    await soloBtn.click();
    await expect(soloBtn).toHaveClass(/active/);

    // Open board in Solo
    await openBoard(page);

    // Create a sticky note
    await page.click('button[title*="Стикер"]');
    const canvas = page.locator('.board-container');
    await canvas.click({ position: { x: 350, y: 250 } });

    const textarea = page.locator('.node-inline-textarea').first();
    await expect(textarea).toBeVisible();
    await textarea.fill('Приватная идея для переноса');
    
    // Click on node box to select and show context inspector
    const nodeBox = page.locator('.board-node-box').first();
    await nodeBox.click();

    // Verify "В команду" promotion button is visible in toolbox
    const transferBtn = page.locator('[data-testid="scope-transfer-btn"]');
    await expect(transferBtn).toBeVisible();
    await transferBtn.click();

    // Transfer Modal opens
    const modal = page.locator('.transfer-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Опубликовать в Команду');

    // Submit transfer
    const submitBtn = modal.locator('button.btn-primary');
    await submitBtn.click();

    // Modal closes and active scope becomes Team
    await expect(modal).not.toBeVisible({ timeout: 5000 });
    await expect(teamBtn).toHaveClass(/active/);
  });

  test('Scenario 8: Auto-return to Select tool after creating a node', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port1}`);
    await openBoard(page);

    const selectToolBtn = page.locator('button[data-tool="select"]');
    const stickyToolBtn = page.locator('button[data-tool="sticky"]');

    // Click on Sticky tool
    await stickyToolBtn.click();
    await expect(stickyToolBtn).toHaveClass(/active/);

    // Click canvas to place sticky
    const canvas = page.locator('.board-container');
    await canvas.click({ position: { x: 320, y: 220 } });

    // Verify tool auto-returned to Select tool immediately
    await expect(selectToolBtn).toHaveClass(/active/);
    await expect(stickyToolBtn).not.toHaveClass(/active/);
  });

  test('Scenario 9: Frame container parenting moves contained children', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port1}`);
    await openBoard(page);

    // 1. Create a frame
    const frameToolBtn = page.locator('button[data-tool="frame"]');
    await frameToolBtn.click();
    const canvas = page.locator('.board-container');
    await canvas.click({ position: { x: 400, y: 300 } });

    // Wait for frame node to render
    const frameNode = page.locator('.board-node-box.type-frame').first();
    await expect(frameNode).toBeVisible();
    const frameBox = await frameNode.boundingBox();
    expect(frameBox).not.toBeNull();

    // 2. Create a sticky inside the frame bounds
    const stickyToolBtn = page.locator('button[data-tool="sticky"]');
    await stickyToolBtn.click();
    await canvas.click({ position: { x: frameBox!.x + 80, y: frameBox!.y + 80 } });

    const stickyNode = page.locator('.board-node-box.type-sticky').first();
    await expect(stickyNode).toBeVisible();
    const stickyInitialBox = await stickyNode.boundingBox();
    expect(stickyInitialBox).not.toBeNull();

    // 3. Drag the frame by its header/label area
    await page.mouse.move(frameBox!.x + 40, frameBox!.y + 16);
    await page.mouse.down();
    await page.mouse.move(frameBox!.x + 140, frameBox!.y + 116);
    await page.mouse.up();

    // Verify both frame and child sticky moved by delta (~100px)
    await page.waitForTimeout(200);
    const stickyNewBox = await stickyNode.boundingBox();
    expect(stickyNewBox).not.toBeNull();
    expect(stickyNewBox!.x).toBeGreaterThan(stickyInitialBox!.x + 40);
  });

  test('Scenario 10: Single Screen Notes Drawer toggle button opens notes overlay', async ({ page }) => {
    page.on('console', msg => console.log('[Scenario10 Console]', msg.type(), msg.text()));
    page.on('pageerror', err => console.error('[Scenario10 PageError]', err));
    await page.goto(`http://127.0.0.1:${port1}`);
    await openBoard(page);

    // Verify single notes drawer toggle button exists in top-right HUD bar
    const notesBtn = page.locator('[data-testid="notes-drawer-toggle-btn"]');
    await expect(notesBtn).toBeVisible();

    // Click to open Notes Drawer
    await notesBtn.click();
    await expect(notesBtn).toHaveClass(/active/);
    const drawer = page.locator('.miro-notes-drawer');
    await expect(drawer).toBeVisible();

    // Click again to close drawer
    await notesBtn.click();
    await expect(notesBtn).not.toHaveClass(/active/);
    await expect(drawer).not.toBeVisible();
  });

  test('Scenario 11: Magnetic Port Connection creates persistent SVG edge and inspects label', async ({ page }) => {
    page.on('console', msg => console.log('[Scenario11 Console]', msg.type(), msg.text()));
    await page.goto(`http://127.0.0.1:${port1}`);
    await openBoard(page);

    // Place Sticky A
    await page.click('button[title*="Стикер"]');
    const canvas = page.locator('.board-container');
    await canvas.click({ position: { x: 250, y: 250 } });

    // Place Sticky B
    await page.click('button[title*="Стикер"]');
    await canvas.click({ position: { x: 550, y: 250 } });

    const nodes = page.locator('.board-node-box');
    await expect(nodes).toHaveCount(2);

    const firstNode = nodes.first();
    const secondNode = nodes.nth(1);

    // Hover on first node to reveal magnetic ports
    await firstNode.hover();
    const rightPort = firstNode.locator('.port-right');
    await expect(rightPort).toBeVisible();

    const rightBox = await rightPort.boundingBox();
    const secondBox = await secondNode.boundingBox();
    expect(rightBox).not.toBeNull();
    expect(secondBox).not.toBeNull();

    // Drag from right port of Node A to center-left of Node B
    await page.mouse.move(rightBox!.x + rightBox!.width / 2, rightBox!.y + rightBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBox!.x + 10, secondBox!.y + secondBox!.height / 2, { steps: 5 });
    await page.mouse.up();

    // Assert SVG edge is created and attached
    const edgePath = page.locator('.canvas-edge-path');
    await expect(edgePath).toBeAttached({ timeout: 5000 });
    await expect(edgePath).toHaveAttribute('d', /^M/);

    // Click edge hit area to reveal floating edge inspector
    const edgeHitArea = page.locator('.canvas-edge-hit-area');
    await edgeHitArea.click({ force: true });
    await expect(page.locator('.floating-edge-pill')).toBeVisible();

    // Type a label for the connection
    const labelInput = page.locator('.edge-label-input');
    await labelInput.fill('API Flow');
    await expect(page.locator('.edge-text-label')).toHaveText('API Flow');
  });

  test('Scenario 12: Undo & Redo HUD controls', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port1}`);
    await openBoard(page);

    // Place a sticky
    await page.click('button[title*="Стикер"]');
    const canvas = page.locator('.board-container');
    await canvas.click({ position: { x: 300, y: 300 } });

    const nodes = page.locator('.board-node-box');
    await expect(nodes).toHaveCount(1);

    // Click Undo in the HUD
    const undoBtn = page.locator('button[title*="Отменить действие"]');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    // Expect node to be undone
    await expect(nodes).toHaveCount(0);

    // Click Redo in the HUD
    const redoBtn = page.locator('button[title*="Повторить действие"]');
    await expect(redoBtn).toBeVisible();
    await redoBtn.click();

    // Expect node to be restored
    await expect(nodes).toHaveCount(1);
  });

  test('Scenario 13: Pure Ink Layer isolation and instant text editing', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port1}`);
    await openBoard(page);

    const canvas = page.locator('.board-container');

    // 1. Activate Draw tool (P) and draw a stroke
    const drawBtn = page.locator('button[data-tool="draw"]');
    await drawBtn.click();

    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Canvas box not found');

    const startX = canvasBox.x + 350;
    const startY = canvasBox.y + 250;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY + 40, { steps: 5 });
    await page.mouse.move(startX + 120, startY + 20, { steps: 5 });
    await page.mouse.up();

    // Wait for stroke commit
    await page.waitForTimeout(300);

    // Verify drawing stroke rendered in .miro-ink-layer
    const inkPaths = page.locator('.miro-ink-layer path');
    await expect(inkPaths).toHaveCount(1);

    // Verify drawing is NOT rendered as a selectable .board-node-box
    const drawingBoxes = page.locator('.board-node-box.type-drawing');
    await expect(drawingBoxes).toHaveCount(0);

    // Verify no resize handles exist on the canvas
    const handles = page.locator('.node-resize-handles-layer');
    await expect(handles).toHaveCount(0);

    // 2. Instant Text Editing: Click Text (T), place on canvas, and type immediately
    const textBtn = page.locator('button[data-tool="text"]');
    await textBtn.click();
    await canvas.click({ position: { x: 500, y: 300 } });

    // Node must be created and textarea immediately focused for typing
    const textNode = page.locator('.board-node-box.type-text');
    await expect(textNode).toHaveCount(1);

    const textarea = textNode.locator('textarea');
    await expect(textarea).toBeFocused();

    // Type text immediately without any extra clicks
    await page.keyboard.type('Hello Doks Pure Ink');
    await expect(textarea).toHaveValue('Hello Doks Pure Ink');
  });

  test('Scenario 14: Clipboard Screenshot paste creates responsive image card on canvas', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port1}`);
    await openBoard(page);

    // Simulate pasting a screenshot image from clipboard onto the canvas
    await page.evaluate(() => {
      const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const binary = atob(base64Png);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'image/png' });
      const file = new File([blob], 'screenshot.png', { type: 'image/png' });

      const dt = new DataTransfer();
      dt.items.add(file);
      const pasteEvt = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true
      });
      window.dispatchEvent(pasteEvt);
    });

    // Verify image node rendered on canvas
    const imageNode = page.locator('.board-node-box.type-image').first();
    await expect(imageNode).toBeVisible({ timeout: 5000 });

    // Verify img tag inside rendered with object-fit contain and correct alt
    const img = imageNode.locator('img.node-rendered-img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', 'screenshot.png');

    // Verify node is selected and has 8 resize handles
    await expect(imageNode).toHaveClass(/selected/);
    const resizeHandles = imageNode.locator('.resize-handle');
    await expect(resizeHandles).toHaveCount(8);

    // Verify 4 magnetic connector ports exist on image card
    await expect(imageNode.locator('.port-top')).toBeAttached();
    await expect(imageNode.locator('.port-right')).toBeAttached();
    await expect(imageNode.locator('.port-bottom')).toBeAttached();
    await expect(imageNode.locator('.port-left')).toBeAttached();

    // Add a sticky note to connect with the screenshot
    await page.click('button[title*="Стикер"]');
    const boardArea = page.locator('.board-container');
    await boardArea.click({ position: { x: 780, y: 320 } });
    const stickyNode = page.locator('.board-node-box.type-sticky').first();
    await expect(stickyNode).toBeVisible();

    // Hover over image node and verify right port is visible
    await imageNode.hover();
    const rightPort = imageNode.locator('.port-right');
    await expect(rightPort).toBeVisible();

    const rightBox = await rightPort.boundingBox();
    const stickyBox = await stickyNode.boundingBox();
    expect(rightBox).not.toBeNull();
    expect(stickyBox).not.toBeNull();

    // Drag connector arrow from screenshot right port to sticky note
    await page.mouse.move(rightBox!.x + rightBox!.width / 2, rightBox!.y + rightBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(stickyBox!.x + 15, stickyBox!.y + stickyBox!.height / 2, { steps: 5 });
    await page.mouse.up();

    // Verify SVG edge path is drawn between screenshot and sticky note
    const edgePath = page.locator('.canvas-edge-path');
    await expect(edgePath).toBeAttached({ timeout: 5000 });
    await expect(edgePath).toHaveAttribute('d', /^M/);
  });
});
