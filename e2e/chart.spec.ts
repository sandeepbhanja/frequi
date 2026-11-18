import { test, expect, type WebSocketRoute } from '@playwright/test';
import { setLoginInfo, defaultMocks } from './helpers';

test.describe('Chart', () => {
  let stream: WebSocketRoute | undefined;

  test.beforeEach(async ({ page }) => {
    stream = undefined;
    await page.routeWebSocket('wss://data-stream.binance.vision/ws/btcusdt@kline_1m', (socket) => {
      stream = socket;
    });
    await defaultMocks(page);
    await setLoginInfo(page);
  });

  test('streams candles in place and backfills after reconnecting', async ({ page }) => {
    const lastOpen = 1683571560000; // Last opening timestamp in the pair candle fixture.
    const minute = 60_000;
    const kline = (t: number, close: string) =>
      JSON.stringify({
        e: 'kline',
        k: { s: 'BTCUSDT', i: '1m', t, o: '27500', h: '27600', l: '27400', c: close, v: '50' },
      });
    await page.route('https://data-api.binance.vision/api/v3/klines?*', (route) =>
      route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: [
          [lastOpen + minute, '27500', '27600', '27400', '27550', '50'],
          [lastOpen + 2 * minute, '27550', '27600', '27400', '27575', '55'],
        ],
      }),
    );

    await page.goto('/graph');
    const toolbar = page.getByRole('toolbar', { name: 'Professional chart controls' });
    await expect(toolbar.getByRole('button', { name: 'Connecting', exact: true })).toBeVisible();
    const canvas = await page.locator('.pro-chart-shell canvas').first().elementHandle();
    await expect.poll(() => Boolean(stream)).toBe(true);
    stream!.send(kline(lastOpen, '27510'));
    await expect(toolbar.getByRole('button', { name: 'Live', exact: true })).toBeVisible();
    stream!.send(kline(lastOpen + minute, '27530'));
    stream!.close();
    await expect(toolbar.getByRole('button', { name: 'Reconnecting', exact: true })).toBeVisible();
    const disconnected = stream;
    await expect.poll(() => stream !== disconnected).toBe(true);
    const backfill = page.waitForRequest('https://data-api.binance.vision/api/v3/klines?*');
    stream!.send(kline(lastOpen + 3 * minute, '27580'));
    expect(new URL((await backfill).url()).searchParams.get('startTime')).toBe(
      String(lastOpen + minute),
    );
    await expect(toolbar.getByRole('button', { name: 'Live', exact: true })).toBeVisible();
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
    await toolbar.getByRole('button', { name: 'Live', exact: true }).click();
    await expect(toolbar.getByRole('button', { name: 'Live paused' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
  test('Chart page', async ({ page }) => {
    await Promise.all([
      page.goto('/graph'),
      page.waitForResponse('**/whitelist'),
      page.waitForResponse('**/blacklist'),
      page.waitForResponse('**/pair_candles'),
    ]);

    // await page.waitForResponse('**/pair_candles');

    await page.getByRole('button', { name: 'Refresh chart' }).click();
    // await page.click('input[title="AutoRefresh"]');

    await page.waitForSelector('span:has-text("NoActionStrategyFut | 1m")');
    const heikinAshiCheck = page
      .locator('div')
      .filter({ hasText: /^Heikin Ashi$/ })
      .nth(1);
    await heikinAshiCheck.click();

    // Reload triggers a new request
    await Promise.all([
      page.getByRole('button', { name: 'Refresh chart' }).click(),

      page.waitForResponse('**/pair_candles'),
    ]);
    // Disable Heikin Ashi
    await heikinAshiCheck.click();
    // Default plotconfig exists

    await expect(page.locator('form').locator('#plotConfigSelect').nth(0)).toHaveText('default');
  });

  test('Plot configurator', async ({ page }) => {
    await Promise.all([
      page.goto('/graph'),
      page.waitForResponse('**/whitelist'),
      page.waitForResponse('**/blacklist'),
      page.waitForResponse('**/pair_candles'),
    ]);

    // Wait for the chart to load
    await page.waitForSelector('span:has-text("NoActionStrategyFut | 1m")');

    await page.getByRole('button', { name: 'Plot configurator' }).click();
    await page.getByRole('button', { name: 'From template' }).click();
    // Apply bollinger bands

    await page.getByRole('option', { name: 'BollingerBands' }).click();

    // await page.getByLabel('Select Templates').selectOption('BollingerBands');
    // Select template - Try to use
    await page.getByRole('button', { name: 'Use Template' }).click();
    // Accept remapping and close
    await page.getByRole('button', { name: 'Apply Template' }).click();
    await page.getByRole('button', { name: 'Save' }).click();

    const indicatorPanel = page.getByText('Indicators in this plotb');

    const options = await indicatorPanel.getByRole('option').allTextContents();
    await expect(options).toContain('bb_lowerband');
    await expect(options).toStrictEqual(['bb_upperband', 'bb_lowerband']);

    // indicatorPanel.selectOption('bb_lowerband');
    // Close Plot configurator
    await page.getByRole('button', { name: 'Close' }).click();

    const professionalChart = page.locator('.pro-chart-shell');
    await expect(professionalChart).toBeVisible();
    await expect(professionalChart.getByRole('button', { name: '+ Indicator' })).toBeVisible();
    await expect(professionalChart.locator('canvas')).not.toHaveCount(0);

    await page.getByRole('button', { name: 'Toggle Night Mode' }).click();
    await expect(professionalChart).toHaveClass(/chart-light/);
  });
});
