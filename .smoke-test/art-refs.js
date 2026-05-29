module.exports = {
  description: 'Capture real in-game art references (arena + character) for AI key-art',
  players: 1,
  async run({ pages, screenshot, wait, waitFor }) {
    const p = pages[0];
    await p.setViewportSize({ width: 1280, height: 720 });
    await waitFor(p, '#btn-start', 12000);
    await wait(1200);

    // --- 1) Garderob: stor karaktärs-render (era gubbar) ---
    try {
      await p.click('#btn-wardrobe'); await wait(1400);
      await screenshot(p, 'ref-wardrobe');
      const close = p.locator('#btn-wardrobe-close');
      if (await close.count() > 0) { await close.click().catch(() => {}); }
      else { await p.keyboard.press('Escape').catch(() => {}); }
      await wait(800);
    } catch (e) {}

    // --- 2) Story-gameplay: riktig bana + fiender ---
    try {
      await waitFor(p, '#btn-start', 8000);
      await p.click('#btn-start'); await wait(2600);
      const tut = p.locator('#btn-tut-close');
      if (await tut.count() > 0 && await tut.isVisible()) { await tut.click().catch(() => {}); await wait(600); }
      // avfärda ev. story-dialog via canvas-koordinater
      const btn = await p.evaluate(() => {
        try { if (typeof storyDialogActive !== 'undefined' && storyDialogActive && storyDialogActive.btn) return storyDialogActive.btn; } catch (e) {}
        return null;
      });
      if (btn) {
        const box = await p.locator('#game').boundingBox();
        if (box) { await p.mouse.click(box.x + btn.x + btn.w / 2, box.y + btn.y + btn.h / 2); await wait(600); }
      }
      // SKIPPA intro + tutorial: varva canvas-tap (skippa dialog) med att stänga
      // tutorial-modalen (#btn-tut-close = "FATTAT") tills banan faktiskt syns.
      const box = await p.locator('#game').boundingBox();
      const cx = box ? box.x + box.width / 2 : 640;
      const cy = box ? box.y + box.height * 0.55 : 400;
      for (let i = 0; i < 16; i++) {
        const tb = p.locator('#btn-tut-close');
        if (await tb.count() > 0 && await tb.isVisible().catch(() => false)) { await tb.click().catch(() => {}); await wait(500); continue; }
        await p.mouse.click(cx, cy).catch(() => {});
        await wait(420);
      }
      // sista koll: stäng tutorial om den dök upp sist
      const tb2 = p.locator('#btn-tut-close');
      if (await tb2.count() > 0 && await tb2.isVisible().catch(() => false)) { await tb2.click().catch(() => {}); await wait(600); }
      await wait(2500);
      // skapa action: rör runt + sikta så fiender + arena syns
      await p.keyboard.down('d'); await wait(1000); await p.keyboard.up('d');
      await p.mouse.move(cx + 200, cy); await wait(300);
      await screenshot(p, 'ref-gameplay-1');
      await wait(2500);
      await p.keyboard.down('w'); await wait(800); await p.keyboard.up('w');
      await p.keyboard.down('a'); await wait(600); await p.keyboard.up('a');
      await screenshot(p, 'ref-gameplay-2');
    } catch (e) {}
  },
};
