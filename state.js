import { DEFAULT_PICKER_STEP_DURATION } from './config.js';

// Centralized app state to avoid scattered globals
export const state = {
  shelves: [],
  filteredShelves: [],
  canvas: null,
  ctx: null,
  // Overrides for global timeline playback
  waveIdOverride: null,
  routeIndexOverride: null,
  globalTimeline: [],
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  hoveredShelf: null,
  selectedShelf: null,
  animationFrameId: null,
  isPlaying: false,
  isPaused: false,
  pickerStepDuration: DEFAULT_PICKER_STEP_DURATION,
  currentStep: 0,
  maxRouteSteps: 0,
  rawRouteData: [],
  waveRoutes: {},
  allWaveIds: [],
  selectedWaves: [],
  displayMode: 'route',
  visitedPaths: {},
  routeMetrics: {
    locationCrosses: 0,           // Slot 级别：回到之前访问过的货位
    locationCrossesBay: 0,        // Shelf/Bay 级别：回到之前访问过的货架
    aisleCrosses: 0,              // Aisle 级别：回到之前访问过的通道
    totalDistance: 0,
    // 新增：时间相关指标
    totalTimeSeconds: 0,          // 总拣货时长（秒）
    pickTimes: [],                // 每个货位的拣货耗时数组
    slowestPickTime: 0,           // 最慢货位耗时
    slowestPickLocation: '',      // 最慢货位ID
    fastestPickTime: Infinity,    // 最快货位耗时
    fastestPickLocation: '',      // 最快货位ID
  },
  locationCrossDetails: [],       // Slot 级别详情
  locationCrossBayDetails: [],    // Shelf/Bay 级别详情
  aisleCrossDetails: [],          // Aisle 级别详情
  // 历史追踪（按波次存储，用于"回头草"检测）
  visitedLocations: {},           // { waveId: [location1, location2, ...] }
  visitedBays: {},                // { waveId: [bay1, bay2, ...] }
  visitedAisles: {},              // { waveId: [aisle1, aisle2, ...] }
  heatmapData: {},
  verticalAisles: [],
  horizontalAisles: [],
  // SKU 统计
  skuPickCounts: {},              // { sku: pickCount }
  skuWaveCounts: {},              // { sku: Set(waveIds) } - 每个SKU在哪些波次中出现
  // Zone 可视化
  showZones: false,               // 是否显示 zone 背景色
  // Abnormal waves tracking
  abnormalWaves: {},              // { waveId: { slotRevisits, shelfRevisits, aisleRevisits, total } }
};

export function setShelves(shelves) {
  state.shelves = shelves;
  state.filteredShelves = [...shelves];
}

export function resetRouteState() {
  state.isPlaying = false;
  state.isPaused = false;
  state.currentStep = 0;
  state.maxRouteSteps = 0;
  state.visitedPaths = {};
  state.globalTimeline = [];
  state.waveIdOverride = null;
  state.routeIndexOverride = null;
  state.routeMetrics = {
    locationCrosses: 0,
    locationCrossesBay: 0,
    aisleCrosses: 0,
    totalDistance: 0,
    totalTimeSeconds: 0,
    pickTimes: [],
    slowestPickTime: 0,
    slowestPickLocation: '',
    fastestPickTime: Infinity,
    fastestPickLocation: ''
  };
  state.locationCrossDetails = [];
  state.locationCrossBayDetails = [];
  state.aisleCrossDetails = [];
  // 重置历史追踪
  state.visitedLocations = {};
  state.visitedBays = {};
  state.visitedAisles = {};
  state.heatmapData = {};
  state.skuPickCounts = {};
  state.skuWaveCounts = {};
  state.shelves.forEach((s) => {
    s.isOnRoute = false;
    s.isCurrent = false;
    s.visitCount = 0;
    s.highlighted = false;
  });
}
