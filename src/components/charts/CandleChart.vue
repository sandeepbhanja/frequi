<script setup lang="ts">
import type { ChartSliderPosition, PairHistory, PlotConfig, Trade } from '@/types';
import {
  subscribeBinanceCandles,
  type binanceCandleMarket,
  type CandleConnection,
} from '@/utils/charts/binanceCandles';
import abcd from '@klinecharts/extension/overlays/abcd';
import arrow from '@klinecharts/extension/overlays/arrow';
import circle from '@klinecharts/extension/overlays/circle';
import eightWaves from '@klinecharts/extension/overlays/eightWaves';
import fibonacciCircle from '@klinecharts/extension/overlays/fibonacciCircle';
import fibonacciExtension from '@klinecharts/extension/overlays/fibonacciExtension';
import fibonacciSegment from '@klinecharts/extension/overlays/fibonacciSegment';
import fibonacciSpeedResistanceFan from '@klinecharts/extension/overlays/fibonacciSpeedResistanceFan';
import fibonacciSpiral from '@klinecharts/extension/overlays/fibonacciSpiral';
import fiveWaves from '@klinecharts/extension/overlays/fiveWaves';
import gannBox from '@klinecharts/extension/overlays/gannBox';
import measure from '@klinecharts/extension/overlays/measure';
import rect from '@klinecharts/extension/overlays/rect';
import threeWaves from '@klinecharts/extension/overlays/threeWaves';
import triangle from '@klinecharts/extension/overlays/triangle';
import xabcd from '@klinecharts/extension/overlays/xabcd';
import {
  dispose,
  init,
  registerIndicator,
  registerOverlay,
  type CandleType,
  type Chart,
  type KLineData,
  type IndicatorTemplate,
  type Overlay,
  type OverlayMode,
  type Period,
  type Point,
} from 'klinecharts';

[
  abcd,
  arrow,
  circle,
  eightWaves,
  fibonacciCircle,
  fibonacciExtension,
  fibonacciSegment,
  fibonacciSpeedResistanceFan,
  fibonacciSpiral,
  fiveWaves,
  gannBox,
  measure,
  rect,
  threeWaves,
  triangle,
  xabcd,
].forEach((overlay) => registerOverlay(overlay));

const props = defineProps<{
  trades: Trade[];
  dataset: PairHistory;
  liveMarket?: ReturnType<typeof binanceCandleMarket>;
  heikinAshi: boolean;
  showMarkArea: boolean;
  useUTC: boolean;
  plotConfig: PlotConfig;
  theme: 'dark' | 'light';
  sliderPosition?: ChartSliderPosition;
  colorUp: string;
  colorDown: string;
  labelSide: 'left' | 'right';
  startCandleCount: number;
}>();

type PriceChartType = CandleType | 'line' | 'heikin_ashi';
type SavedDrawing = { name: string; points: Array<Partial<Point>>; extendData?: unknown };

const chartHost = useTemplateRef<HTMLElement>('chartHost');
const chartShell = useTemplateRef<HTMLElement>('chartShell');
const chart = shallowRef<Chart | null>(null);
const liveEnabled = ref(true);
const connection = ref<CandleConnection>('Connecting');
const marketBars = new Map<number, KLineData>();
let lastRawBar: KLineData | undefined;
let pushBar: ((bar: KLineData) => void) | undefined;
const resizeObserver = shallowRef<ResizeObserver | null>(null);
const isFullscreen = ref(false);
const drawingsLocked = ref(false);
const overlayMode = ref<OverlayMode>('weak_magnet');
const selectedDrawing = ref('segment');
const selectedIndicator = ref('MACD');
const activeIndicators = ref<string[]>(['MA', 'VOL']);
const chartType = ref<PriceChartType>(props.heikinAshi ? 'heikin_ashi' : 'candle_solid');

const chartTypeOptions: Array<{ label: string; value: PriceChartType }> = [
  { label: 'Candles', value: 'candle_solid' },
  { label: 'Hollow candles', value: 'candle_stroke' },
  { label: 'Hollow up', value: 'candle_up_stroke' },
  { label: 'OHLC bars', value: 'ohlc' },
  { label: 'Heikin Ashi', value: 'heikin_ashi' },
  { label: 'Area', value: 'area' },
  { label: 'Line', value: 'line' },
];

const mainPaneIndicators = new Set(['MA', 'EMA', 'SMA', 'BOLL', 'SAR', 'BBI', 'AVP']);
const indicatorOptions = [
  'MA',
  'EMA',
  'SMA',
  'BOLL',
  'SAR',
  'BBI',
  'AVP',
  'VOL',
  'MACD',
  'RSI',
  'KDJ',
  'DMI',
  'CCI',
  'AO',
  'BIAS',
  'BRAR',
  'CR',
  'DMA',
  'EMV',
  'MTM',
  'OBV',
  'PVT',
  'PSY',
  'ROC',
  'TRIX',
  'VR',
];

const drawingGroups = [
  {
    label: 'Lines',
    items: [
      ['Trend line', 'segment'],
      ['Ray', 'rayLine'],
      ['Extended line', 'straightLine'],
      ['Horizontal line', 'horizontalStraightLine'],
      ['Horizontal ray', 'horizontalRayLine'],
      ['Vertical line', 'verticalStraightLine'],
      ['Parallel channel', 'priceChannelLine'],
      ['Parallel lines', 'parallelStraightLine'],
      ['Price line', 'priceLine'],
    ],
  },
  {
    label: 'Fibonacci',
    items: [
      ['Fib retracement', 'fibonacciLine'],
      ['Fib extension', 'fibonacciExtension'],
      ['Fib segment', 'fibonacciSegment'],
      ['Fib fan', 'fibonacciSpeedResistanceFan'],
      ['Fib circle', 'fibonacciCircle'],
      ['Fib spiral', 'fibonacciSpiral'],
    ],
  },
  {
    label: 'Shapes & analysis',
    items: [
      ['Brush', 'brush'],
      ['Rectangle', 'rect'],
      ['Circle', 'circle'],
      ['Triangle', 'triangle'],
      ['Arrow', 'arrow'],
      ['Measure', 'measure'],
      ['Gann box', 'gannBox'],
      ['ABCD pattern', 'abcd'],
      ['XABCD pattern', 'xabcd'],
      ['3 waves', 'threeWaves'],
      ['5 waves', 'fiveWaves'],
      ['8 waves', 'eightWaves'],
    ],
  },
];

const chartStateKey = 'frequi-pro-chart-state';
const drawingStorageKey = computed(() => `frequi-chart-drawings:${props.dataset.pair}`);

function timeframeToPeriod(timeframe: string): Period {
  const match = timeframe.match(/^(\d+)([smhdwM])$/);
  if (!match) return { span: 1, type: 'minute' };
  const span = Number(match[1]);
  const unit = match[2];
  const type =
    unit === 's'
      ? 'second'
      : unit === 'm'
        ? 'minute'
        : unit === 'h'
          ? 'hour'
          : unit === 'd'
            ? 'day'
            : unit === 'w'
              ? 'week'
              : 'month';
  return { span, type };
}

function column(name: string) {
  return props.dataset.columns.findIndex((item) => item === name);
}

function rawData(): KLineData[] {
  const indexes = {
    timestamp: column('__date_ts'),
    open: column('open'),
    high: column('high'),
    low: column('low'),
    close: column('close'),
    volume: column('volume'),
  };
  return props.dataset.data
    .map((row) => {
      const item: KLineData = {
        timestamp: Number(row[indexes.timestamp]),
        open: Number(row[indexes.open]),
        high: Number(row[indexes.high]),
        low: Number(row[indexes.low]),
        close: Number(row[indexes.close]),
        volume: Number(row[indexes.volume] ?? 0),
      };
      props.dataset.columns.forEach((key, index) => {
        item[key] = row[index];
      });
      return item;
    })
    .filter((item) => Number.isFinite(item.timestamp) && Number.isFinite(item.close))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function convertHeikinAshi(data: KLineData[]): KLineData[] {
  let previousOpen: number | undefined;
  let previousClose: number | undefined;
  return data.map((item) => {
    const close = (item.open + item.high + item.low + item.close) / 4;
    const open =
      previousOpen === undefined || previousClose === undefined
        ? (item.open + item.close) / 2
        : (previousOpen + previousClose) / 2;
    previousOpen = open;
    previousClose = close;
    return {
      ...item,
      open,
      close,
      high: Math.max(item.high, open, close),
      low: Math.min(item.low, open, close),
    };
  });
}

function currentData() {
  const snapshot = rawData();
  const latestSnapshot = snapshot.at(-1)?.timestamp ?? 0;
  const byTime = new Map(snapshot.map((bar) => [bar.timestamp, bar]));
  for (const [timestamp, bar] of marketBars) {
    if (timestamp < latestSnapshot && byTime.has(timestamp)) {
      marketBars.delete(timestamp);
    } else {
      byTime.set(timestamp, { ...byTime.get(timestamp), ...bar });
    }
  }
  const data = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
  lastRawBar = data.at(-1);
  return chartType.value === 'heikin_ashi' ? convertHeikinAshi(data) : data;
}

function updateLiveBar(bar: KLineData) {
  if (!pushBar || (lastRawBar && bar.timestamp < lastRawBar.timestamp)) return;
  const replacing = bar.timestamp === lastRawBar?.timestamp;
  marketBars.set(bar.timestamp, bar);
  lastRawBar = replacing ? { ...lastRawBar, ...bar } : bar;
  if (chartType.value !== 'heikin_ashi') {
    pushBar(lastRawBar);
    return;
  }
  const displayed = chart.value?.getDataList();
  const previous = displayed?.at(replacing ? -2 : -1);
  const { open, high, low, close } = lastRawBar;
  const haOpen = previous ? (previous.open + previous.close) / 2 : (open + close) / 2;
  const haClose = (open + high + low + close) / 4;
  pushBar({
    ...lastRawBar,
    open: haOpen,
    close: haClose,
    high: Math.max(high, haOpen, haClose),
    low: Math.min(low, haOpen, haClose),
  });
}

watch(
  [() => props.liveMarket?.socket, liveEnabled],
  ([socket, enabled], _previous, onCleanup) => {
    const market = props.liveMarket;
    if (!socket || !market || !enabled || props.dataset.timeframe_ms <= 0) return;
    onCleanup(
      subscribeBinanceCandles(
        market,
        props.dataset.timeframe_ms,
        () => lastRawBar?.timestamp,
        updateLiveBar,
        (state) => {
          connection.value = state;
        },
      ),
    );
  },
  { immediate: true, flush: 'post' },
);

function pricePrecision(data: KLineData[]) {
  return Math.min(
    12,
    Math.max(
      2,
      ...data.slice(-100).map((item) => {
        const fraction = item.close.toString().split('.')[1];
        return fraction?.length ?? 0;
      }),
    ),
  );
}

function candleType(): CandleType {
  if (chartType.value === 'heikin_ashi') return 'candle_solid';
  if (chartType.value === 'line') return 'area';
  return chartType.value;
}

function styles() {
  const dark = props.theme === 'dark';
  const text = dark ? '#a7b1bc' : '#5e6673';
  const grid = dark ? '#1f2933' : '#e6e8eb';
  return {
    backgroundColor: dark ? '#0b0e11' : '#ffffff',
    grid: {
      horizontal: { color: grid, style: 'dashed' as const },
      vertical: { color: grid, style: 'dashed' as const },
    },
    candle: {
      type: candleType(),
      bar: {
        upColor: props.colorUp,
        downColor: props.colorDown,
        noChangeColor: text,
        upBorderColor: props.colorUp,
        downBorderColor: props.colorDown,
        noChangeBorderColor: text,
        upWickColor: props.colorUp,
        downWickColor: props.colorDown,
        noChangeWickColor: text,
      },
      area: {
        lineColor: props.colorUp,
        lineSize: 2,
        smooth: false,
        backgroundColor:
          chartType.value === 'line'
            ? [{ offset: 0, color: 'rgba(0,0,0,0)' }]
            : [
                { offset: 0, color: `${props.colorUp}55` },
                { offset: 1, color: `${props.colorUp}05` },
              ],
      },
      tooltip: { showRule: 'always' as const, showType: 'standard' as const },
    },
    indicator: {
      tooltip: { showRule: 'always' as const, showType: 'standard' as const },
      lastValueMark: { show: true },
    },
    xAxis: { tickText: { color: text }, axisLine: { color: grid } },
    yAxis: { tickText: { color: text }, axisLine: { color: grid } },
    separator: { color: grid, activeBackgroundColor: dark ? '#202934' : '#eef0f2' },
    crosshair: {
      horizontal: { line: { color: text }, text: { backgroundColor: '#2b3139' } },
      vertical: { line: { color: text }, text: { backgroundColor: '#2b3139' } },
    },
  };
}

function persistState() {
  localStorage.setItem(
    chartStateKey,
    JSON.stringify({
      chartType: chartType.value,
      indicators: activeIndicators.value,
      overlayMode: overlayMode.value,
    }),
  );
}

function restoreState() {
  try {
    const state = JSON.parse(localStorage.getItem(chartStateKey) ?? '{}') as {
      chartType?: PriceChartType;
      indicators?: string[];
      overlayMode?: OverlayMode;
    };
    if (chartTypeOptions.some((option) => option.value === state.chartType))
      chartType.value = state.chartType!;
    if (Array.isArray(state.indicators)) {
      activeIndicators.value = state.indicators.filter((name) => indicatorOptions.includes(name));
    }
    if (state.overlayMode) overlayMode.value = state.overlayMode;
  } catch {
    /* Ignore invalid preferences. */
  }
}

function createIndicator(name: string) {
  if (!chart.value) return;
  if (mainPaneIndicators.has(name)) {
    chart.value.createIndicator(
      { name, paneId: 'candle_pane', ...(name === 'MA' ? { calcParams: [7, 25, 99] } : {}) },
      true,
    );
  } else chart.value.createIndicator(name, true);
}

function strategyIndicatorName(label: string, columns: string[]) {
  const signature = `${label}:${columns.join(',')}`;
  let hash = 0;
  for (const character of signature) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `FREQ_${Math.abs(hash)}`;
}

function createStrategyIndicator(
  label: string,
  definitions: Record<string, { color?: string; type?: string }>,
  mainPane: boolean,
) {
  if (!chart.value) return;
  const columns = Object.keys(definitions).filter((key) => props.dataset.columns.includes(key));
  if (columns.length === 0) return;
  const colors = ['#2962ff', '#ff6d00', '#ab47bc', '#26a69a', '#ef5350', '#f0b90b'];
  const name = strategyIndicatorName(label, columns);
  const template: IndicatorTemplate<Record<string, number | null>> = {
    name,
    shortName: label,
    series: mainPane ? 'price' : 'normal',
    precision: pricePrecision(rawData()),
    shouldOhlc: false,
    calc: (dataList) =>
      dataList.map((item) =>
        Object.fromEntries(
          columns.map((key) => {
            const value = Number(item[key]);
            return [key, Number.isFinite(value) ? value : null];
          }),
        ),
      ),
    figures: columns.map((key, index) => ({
      key,
      title: key,
      type: definitions[key]?.type === 'scatter' ? 'circle' : 'line',
      styles: () => ({
        color: definitions[key]?.color ?? colors[index % colors.length],
        size: definitions[key]?.type === 'bar' ? 2 : 1,
        style: 'solid',
      }),
    })),
  };
  registerIndicator(template);
  chart.value.createIndicator(mainPane ? { name, paneId: 'candle_pane' } : { name }, true);
}

function createStrategyIndicators() {
  createStrategyIndicator('Strategy', props.plotConfig.main_plot, true);
  Object.entries(props.plotConfig.subplots).forEach(([label, definitions]) =>
    createStrategyIndicator(label, definitions, false),
  );
}

function addIndicator(name = selectedIndicator.value) {
  if (!chart.value || activeIndicators.value.includes(name)) return;
  activeIndicators.value.push(name);
  createIndicator(name);
  persistState();
}

function removeIndicator(name: string) {
  chart.value?.removeIndicator({ name });
  activeIndicators.value = activeIndicators.value.filter((item) => item !== name);
  persistState();
}

function createTradeMarkers() {
  if (!chart.value) return;
  chart.value.removeOverlay({ groupId: 'trade-markers' });
  props.trades
    .filter((trade) => trade.pair === props.dataset.pair)
    .forEach((trade) => {
      chart.value?.createOverlay({
        name: 'simpleAnnotation',
        groupId: 'trade-markers',
        lock: true,
        points: [{ timestamp: trade.open_timestamp, value: trade.open_rate }],
        extendData: `${trade.is_short ? 'Short' : 'Long'} entry`,
      });
      if (trade.close_timestamp && trade.close_rate)
        chart.value?.createOverlay({
          name: 'simpleAnnotation',
          groupId: 'trade-markers',
          lock: true,
          points: [{ timestamp: trade.close_timestamp, value: trade.close_rate }],
          extendData: `Exit ${trade.profit_pct == null ? '' : `${trade.profit_pct.toFixed(2)}%`}`,
        });
    });
}

function persistDrawings() {
  const drawings: SavedDrawing[] = (
    chart.value?.getOverlays({ groupId: 'user-drawings' }) ?? []
  ).map((overlay: Overlay) => ({
    name: overlay.name,
    points: overlay.points,
    extendData: overlay.extendData,
  }));
  localStorage.setItem(drawingStorageKey.value, JSON.stringify(drawings));
}

function drawingOptions(drawing: SavedDrawing) {
  return {
    ...drawing,
    groupId: 'user-drawings',
    lock: drawingsLocked.value,
    mode: overlayMode.value,
    onDrawEnd: persistDrawings,
    onPressedMoveEnd: persistDrawings,
    onRemoved: persistDrawings,
  };
}

function restoreDrawings() {
  try {
    const drawings = JSON.parse(
      localStorage.getItem(drawingStorageKey.value) ?? '[]',
    ) as SavedDrawing[];
    drawings.forEach((drawing) => chart.value?.createOverlay(drawingOptions(drawing)));
  } catch {
    /* Ignore invalid saved drawings. */
  }
}

function startDrawing() {
  chart.value?.createOverlay(drawingOptions({ name: selectedDrawing.value, points: [] }));
}

function undoDrawing() {
  const drawings = chart.value?.getOverlays({ groupId: 'user-drawings' }) ?? [];
  const last = drawings.at(-1);
  if (last) chart.value?.removeOverlay({ id: last.id });
  persistDrawings();
}

function clearDrawings() {
  chart.value?.removeOverlay({ groupId: 'user-drawings' });
  persistDrawings();
}

function toggleDrawingLock() {
  drawingsLocked.value = !drawingsLocked.value;
  chart.value?.overrideOverlay({ groupId: 'user-drawings', lock: drawingsLocked.value });
}

function resetView() {
  if (!chart.value || !chartHost.value) return;
  const visibleBars = Math.min(Math.max(props.startCandleCount, 100), 180);
  chart.value.setBarSpace(Math.max(4, Math.min(10, chartHost.value.clientWidth / visibleBars)));
  chart.value.scrollToRealTime(250);
}

function downloadImage() {
  if (!chart.value) return;
  const link = document.createElement('a');
  link.href = chart.value.getConvertPictureUrl(true, 'png');
  link.download = `${props.dataset.pair.replaceAll('/', '-')}-${props.dataset.timeframe}.png`;
  link.click();
}

async function toggleFullscreen() {
  if (!chartShell.value) return;
  if (document.fullscreenElement) await document.exitFullscreen();
  else await chartShell.value.requestFullscreen();
}

function onFullscreenChange() {
  isFullscreen.value = document.fullscreenElement === chartShell.value;
  nextTick(() => chart.value?.resize());
}

function initializeChart() {
  if (!chartHost.value) return;
  if (chart.value) dispose(chart.value);
  pushBar = undefined;
  chart.value = init(chartHost.value, {
    timezone: props.useUTC ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone,
    styles: styles(),
    zoomAnchor: 'cursor',
    layout: {
      barSpaceLimit: { min: 3, max: 14 },
      pane: { minHeight: 70, dragEnabled: true },
    },
  });
  if (!chart.value) return;
  chart.value.setDataLoader({
    getBars: ({ callback }) => callback(currentData(), false),
    subscribeBar: ({ callback }) => {
      pushBar = callback;
    },
    unsubscribeBar: () => {
      pushBar = undefined;
    },
  });
  chart.value.setSymbol({
    ticker: props.dataset.pair,
    pricePrecision: pricePrecision(rawData()),
    volumePrecision: 2,
  });
  chart.value.setPeriod(timeframeToPeriod(props.dataset.timeframe));
  chart.value.setOffsetRightDistance(70);
  chart.value.setLeftMinVisibleBarCount(20);
  chart.value.setRightMinVisibleBarCount(2);
  activeIndicators.value.forEach(createIndicator);
  createStrategyIndicators();
  createTradeMarkers();
  restoreDrawings();
  nextTick(resetView);
}

onMounted(() => {
  restoreState();
  initializeChart();
  resizeObserver.value = new ResizeObserver(() => chart.value?.resize());
  if (chartHost.value) resizeObserver.value.observe(chartHost.value);
  document.addEventListener('fullscreenchange', onFullscreenChange);
});

onBeforeUnmount(() => {
  resizeObserver.value?.disconnect();
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  if (chart.value) dispose(chart.value);
});

watch(
  () => props.dataset,
  () => {
    const instance = chart.value;
    if (!instance) return;
    const bars = instance.getDataList();
    const { to } = instance.getVisibleRange();
    const right = to < bars.length ? bars[to - 1]?.timestamp : undefined;
    instance.resetData();
    if (right !== undefined) instance.scrollToTimestamp(right);
  },
);
watch(() => props.trades, createTradeMarkers);
watch(
  () => props.plotConfig,
  () => nextTick(initializeChart),
  { deep: true },
);
watch([() => props.theme, () => props.colorUp, () => props.colorDown], () =>
  chart.value?.setStyles(styles()),
);
watch(chartType, () => {
  persistState();
  nextTick(initializeChart);
});
watch(overlayMode, persistState);
watch(
  () => props.heikinAshi,
  (enabled) => {
    if (enabled !== (chartType.value === 'heikin_ashi'))
      chartType.value = enabled ? 'heikin_ashi' : 'candle_solid';
  },
);
</script>

<template>
  <div
    ref="chartShell"
    class="pro-chart-shell h-full w-full"
    :class="theme === 'dark' ? 'chart-dark' : 'chart-light'"
  >
    <div class="chart-toolbar" role="toolbar" aria-label="Professional chart controls">
      <button
        v-if="liveMarket"
        type="button"
        :aria-pressed="liveEnabled"
        :title="liveMarket.label"
        @click="liveEnabled = !liveEnabled"
      >
        {{ liveEnabled ? connection : 'Live paused' }}
      </button>
      <select v-model="chartType" title="Chart type" aria-label="Chart type">
        <option v-for="option in chartTypeOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <div class="toolbar-group">
        <select v-model="selectedIndicator" title="Technical indicator" aria-label="Indicator">
          <option v-for="indicator in indicatorOptions" :key="indicator" :value="indicator">
            {{ indicator }}
          </option>
        </select>
        <button type="button" title="Add indicator" @click="addIndicator()">+ Indicator</button>
      </div>
      <div class="toolbar-group">
        <select v-model="selectedDrawing" title="Drawing tool" aria-label="Drawing tool">
          <optgroup v-for="group in drawingGroups" :key="group.label" :label="group.label">
            <option v-for="item in group.items" :key="item[1]" :value="item[1]">
              {{ item[0] }}
            </option>
          </optgroup>
        </select>
        <button type="button" title="Start drawing" @click="startDrawing">Draw</button>
      </div>
      <select v-model="overlayMode" title="Drawing magnet mode" aria-label="Magnet mode">
        <option value="normal">Magnet off</option>
        <option value="weak_magnet">Weak magnet</option>
        <option value="strong_magnet">Strong magnet</option>
      </select>
      <div class="toolbar-actions">
        <button type="button" title="Undo last drawing" @click="undoDrawing">Undo</button>
        <button type="button" :class="{ active: drawingsLocked }" @click="toggleDrawingLock">
          {{ drawingsLocked ? 'Unlock' : 'Lock' }}
        </button>
        <button type="button" title="Clear drawings" @click="clearDrawings">Clear</button>
        <button type="button" title="Reset zoom and scroll" @click="resetView">Reset</button>
        <button type="button" title="Download chart image" @click="downloadImage">Snapshot</button>
        <button type="button" title="Toggle full screen" @click="toggleFullscreen">
          {{ isFullscreen ? 'Exit' : 'Full screen' }}
        </button>
      </div>
    </div>
    <div v-if="activeIndicators.length" class="active-indicators" aria-label="Active indicators">
      <span v-for="indicator in activeIndicators" :key="indicator" class="indicator-chip">
        {{ indicator }}
        <button
          type="button"
          :aria-label="`Remove ${indicator}`"
          @click="removeIndicator(indicator)"
        >
          ×
        </button>
      </span>
    </div>
    <div ref="chartHost" class="chart-host" />
  </div>
</template>

<style scoped>
.pro-chart-shell {
  display: flex;
  min-height: 360px;
  flex-direction: column;
  overflow: hidden;
  color: #5e6673;
  background: #fff;
}
.pro-chart-shell.chart-dark {
  color: #a7b1bc;
  background: #0b0e11;
}
.pro-chart-shell:fullscreen {
  padding: 8px;
}
.chart-toolbar {
  z-index: 3;
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  overflow-x: auto;
}
.toolbar-group,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 3px;
}
.toolbar-actions {
  margin-left: auto;
}
.chart-toolbar select,
.chart-toolbar button,
.indicator-chip {
  height: 30px;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  border-radius: 4px;
  color: inherit;
  background: color-mix(in srgb, currentColor 5%, transparent);
  font-size: 12px;
  white-space: nowrap;
}
.chart-toolbar select {
  min-width: 105px;
  padding: 0 24px 0 8px;
}
.chart-toolbar button {
  padding: 0 9px;
  cursor: pointer;
}
.chart-toolbar button:hover,
.chart-toolbar button.active {
  color: #f0b90b;
  border-color: #f0b90b;
  background: color-mix(in srgb, #f0b90b 12%, transparent);
}
.active-indicators {
  z-index: 2;
  display: flex;
  min-height: 30px;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  overflow-x: auto;
  border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
}
.indicator-chip {
  display: inline-flex;
  height: 23px;
  align-items: center;
  gap: 5px;
  padding-left: 7px;
}
.indicator-chip button {
  height: 21px;
  padding: 0 6px;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.chart-host {
  min-width: 0;
  min-height: 280px;
  flex: 1 1 auto;
}
@media (max-width: 768px) {
  .chart-toolbar {
    align-items: flex-start;
  }
  .toolbar-actions {
    margin-left: 0;
  }
}
</style>
