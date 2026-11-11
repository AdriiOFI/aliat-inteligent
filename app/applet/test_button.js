const pw = require('/usr/local/share/bun-global/node_modules/playwright-core');

(async () => {
  const browser = await pw.chromium.launch({
    executablePath: '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message, err.stack));

  // Set auth token in localStorage so we bypass login
  await page.goto('http://localhost:3000');
  await page.evaluate(() => {
    localStorage.setItem('aliat_token', 'test-token');
    localStorage.setItem('aliat_user', JSON.stringify({ name: 'Test User', email: 'test@example.com' }));
  });
  await page.reload();
  await page.waitForTimeout(1000);

  console.log('Page loaded. Checking #chat-plus-btn...');
  const plusBtn = await page.$('#chat-plus-btn');
  console.log('plusBtn exists?', !!plusBtn);

  if (plusBtn) {
    await plusBtn.click();
    await page.waitForTimeout(300);
    const plusMenuVisible = await page.$eval('#plus-menu', el => !el.classList.contains('hidden'));
    console.log('Plus menu visible?', plusMenuVisible);

    console.log('Now clicking #plus-analyze-session-btn...');
    const analyzeBtn = await page.$('#plus-analyze-session-btn');
    console.log('analyzeBtn exists?', !!analyzeBtn);

    if (analyzeBtn) {
      await analyzeBtn.click();
      await page.waitForTimeout(1000);

      const modalState = await page.$eval('#mindmap-modal', el => {
        const style = window.getComputedStyle(el);
        return {
          id: el.id,
          classList: Array.from(el.classList),
          display: style.display,
          opacity: style.opacity,
          visibility: style.visibility,
          zIndex: style.zIndex,
          offsetWidth: el.offsetWidth,
          offsetHeight: el.offsetHeight,
          childrenCount: el.children.length
        };
      });
      console.log('Modal state after click:', JSON.stringify(modalState, null, 2));

      const svgContainerState = await page.$eval('#mindmap-svg-container', el => {
        return {
          offsetWidth: el.offsetWidth,
          offsetHeight: el.offsetHeight,
          svgChildren: el.querySelectorAll('svg').length,
          nodeItems: el.querySelectorAll('.node-item').length
        };
      });
      console.log('SVG container state:', JSON.stringify(svgContainerState, null, 2));
    }
  }

  console.log('Console logs from browser (first 20):');
  consoleMessages.slice(0, 20).forEach(m => console.log(`[${m.type}] ${m.text}`));

  await browser.close();
})();
