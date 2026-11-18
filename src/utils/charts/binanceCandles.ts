import type { KLineData } from 'klinecharts';

const intervals = new Set([
  '1s',
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
  '3d',
  '1w',
  '1M',
]);

export function binanceCandleMarket(
  exchange: string,
  pair: string,
  interval: string,
  mode?: string,
) {
  if (exchange.toLowerCase() !== 'binance' || !intervals.has(interval)) return;
  const match = /^([A-Z0-9]+)\/([A-Z0-9]+)(?::([A-Z0-9]+))?$/.exec(pair);
  if (!match) return;
  const [, base, quote, settle] = match;
  const futures = mode === 'futures';
  if (futures ? settle !== quote || interval === '1s' : !!settle) return;
  if (mode && !['futures', 'spot', 'margin'].includes(mode)) return;
  const symbol = `${base}${quote}`;
  const stream = `${symbol.toLowerCase()}@kline_${interval}`;
  return {
    symbol,
    interval,
    label: futures ? 'Binance USDⓈ-M Futures' : 'Binance Spot',
    socket: futures
      ? `wss://fstream.binance.com/market/ws/${stream}`
      : `wss://data-stream.binance.vision/ws/${stream}`,
    rest: futures
      ? 'https://fapi.binance.com/fapi/v1/klines'
      : 'https://data-api.binance.vision/api/v3/klines',
  };
}

type Market = NonNullable<ReturnType<typeof binanceCandleMarket>>;
export type CandleConnection = 'Connecting' | 'Live' | 'Reconnecting';

function parseBar(values: unknown[]): KLineData | undefined {
  if (
    values.length !== 6 ||
    values.some(
      (value) => typeof value !== 'number' && (typeof value !== 'string' || !value.trim()),
    )
  )
    return;
  const [timestamp, open, high, low, close, volume] = values.map(Number);
  if (![timestamp, open, high, low, close, volume].every(Number.isFinite)) return;
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    low <= 0 ||
    low > Math.min(open, close) ||
    high < Math.max(open, close) ||
    volume < 0
  )
    return;
  return { timestamp, open, high, low, close, volume };
}

export function nextCandleOpen(timestamp: number, interval: string, duration: number) {
  if (interval !== '1M') return timestamp + duration;
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

export function subscribeBinanceCandles(
  market: Market,
  duration: number,
  latestTimestamp: () => number | undefined,
  update: (bar: KLineData) => void,
  status: (value: CandleConnection) => void,
) {
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | undefined;
  let cancelConnection: (() => void) | undefined;
  let attempts = 0;

  function connect() {
    const connection = new WebSocket(market.socket);
    socket = connection;
    const controller = new AbortController();
    const pending = new Map<number, KLineData>();
    let watchdog: ReturnType<typeof setTimeout>;
    let processing = false;
    let firstUpdate = true;
    const active = () => !stopped && socket === connection && !controller.signal.aborted;

    function armWatchdog() {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => connection.close(), 20_000);
    }
    function cancel() {
      clearTimeout(watchdog);
      controller.abort();
    }
    cancelConnection = cancel;
    armWatchdog();

    async function drain() {
      if (processing) return;
      processing = true;
      try {
        while (active() && pending.size) {
          const bar = pending.values().next().value!;
          const previous = latestTimestamp();
          const hasGap =
            previous !== undefined &&
            bar.timestamp > nextCandleOpen(previous, market.interval, duration);
          if (previous !== undefined && (hasGap || (firstUpdate && bar.timestamp > previous))) {
            status('Reconnecting');
            const query = new URLSearchParams({
              symbol: market.symbol,
              interval: market.interval,
              startTime: String(previous),
              endTime: String(bar.timestamp - 1),
              limit: '500',
            });
            const response = await fetch(`${market.rest}?${query}`, {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
              credentials: 'omit',
            });
            if (!active()) return;
            if (!response.ok) throw new Error('Candle backfill failed');
            const rows: unknown = await response.json();
            if (!active()) return;
            if (!Array.isArray(rows)) throw new Error('Invalid candle history');
            firstUpdate = false;
            for (const row of rows) {
              const candle = Array.isArray(row) && parseBar(row.slice(0, 6));
              if (!candle || candle.timestamp >= bar.timestamp) continue;
              const last = latestTimestamp();
              if (
                last !== undefined &&
                candle.timestamp > nextCandleOpen(last, market.interval, duration)
              ) {
                throw new Error('Candle history contains a gap');
              }
              update(candle);
            }
            if (hasGap && (latestTimestamp() ?? previous) <= previous)
              throw new Error('Missing candle history');
            continue;
          }
          pending.delete(bar.timestamp);
          if (previous !== undefined && bar.timestamp < previous) continue;
          update(bar);
          firstUpdate = false;
          attempts = 0;
          status('Live');
        }
      } catch {
        if (active()) connection.close();
      } finally {
        processing = false;
      }
    }

    connection.onmessage = ({ data }) => {
      if (!active() || typeof data !== 'string') return;
      try {
        const message = JSON.parse(data);
        const candle = message?.k;
        if (message?.e !== 'kline' || candle?.s !== market.symbol || candle?.i !== market.interval)
          return;
        const bar = parseBar([candle.t, candle.o, candle.h, candle.l, candle.c, candle.v]);
        if (!bar) return;
        armWatchdog();
        pending.set(bar.timestamp, bar);
        if (pending.size > 500) connection.close();
        else void drain();
      } catch {
        // Ignore malformed market messages.
      }
    };
    connection.onerror = () => connection.close();
    connection.onclose = () => {
      cancel();
      if (stopped || socket !== connection) return;
      status('Reconnecting');
      const delay = Math.min(30_000, 1_000 * 2 ** attempts++) + Math.random() * 500;
      retry = setTimeout(connect, delay);
    };
  }

  status('Connecting');
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    cancelConnection?.();
    socket?.close();
  };
}
