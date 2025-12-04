import { DEFAULT_PICKER_STEP_DURATION, MIN_ZOOM, MAX_ZOOM } from './config.js';
import { state, setShelves, resetRouteState } from './state.js';
import {
  parseLocationData,
  detectAisles,
  buildWaveRoutes,
  updateWaveVisits,
  processStep,
  exportMetrics,
  exportImage,
  getPathColor,
  formatTime,
  calculateWaveMetrics,
  calculateEnhancedMetrics,
  calculateIdealDistance,
} from './services.js';
import {
  initCanvas,
  drawMap,
  showTooltip,
  hideTooltip,
  showInfoPanel,
  closeInfoPanel,
  showDetailModal,
  closeModal,
  updateLegend,
} from './render.js?v=3';

// Expose modal close for inline onclick
window.closeModal = closeModal;
window.closeInfoPanel = closeInfoPanel;

// Track file uploads so we can hide the upload section once both are loaded
let locationFileUploaded = false;
let routeFileUploaded = false;

// ===== Initialization =====
document.getElementById('locationUploadBox').addEventListener('click', () => document.getElementById('fileInput').click());
document.getElementById('routeUploadBox').addEventListener('click', () => document.getElementById('routeFileInput').click());
document.getElementById('fileInput').addEventListener('change', (e) => e.target.files[0] && handleLocationFile(e.target.files[0]));
document.getElementById('routeFileInput').addEventListener('change', (e) => e.target.files[0] && handleRouteFile(e.target.files[0]));

['locationUploadBox', 'routeUploadBox'].forEach((id) => {
  const box = document.getElementById(id);
  box.addEventListener('dragover', (e) => {
    e.preventDefault();
    box.classList.add('dragover');
  });
  box.addEventListener('dragleave', () => box.classList.remove('dragover'));
});

document.getElementById('locationUploadBox').addEventListener('drop', (e) => {
  e.preventDefault();
  document.getElementById('locationUploadBox').classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleLocationFile(e.dataTransfer.files[0]);
});
document.getElementById('routeUploadBox').addEventListener('drop', (e) => {
  e.preventDefault();
  document.getElementById('routeUploadBox').classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleRouteFile(e.dataTransfer.files[0]);
});

// Playback & controls
document.getElementById('confirmMappingBtn').addEventListener('click', processRouteDataWithMapping);
document.getElementById('playBtn').addEventListener('click', playAnimation);
document.getElementById('pauseBtn').addEventListener('click', pauseAnimation);
document.getElementById('stopBtn').addEventListener('click', stopAnimation);
document.getElementById('progressSlider').addEventListener('input', seekAnimation);
document.getElementById('speedSlider').addEventListener('input', (e) => {
  state.pickerStepDuration = parseInt(e.target.value, 10);
  document.getElementById('speedValue').textContent = `${e.target.value}ms`;
});

document.getElementById('multiSelectBtn').addEventListener('click', toggleDropdown);
document.addEventListener('click', (e) => {
  if (!e.target.closest('.multi-select-wrapper')) document.getElementById('multiSelectDropdown').classList.remove('show');
});
document.getElementById('selectAllWavesBtn').addEventListener('click', selectAllWaves);
document.getElementById('clearWavesBtn').addEventListener('click', clearAllWaves);

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.displayMode = btn.dataset.mode;
    updateLegend(state.displayMode, state.selectedWaves);
    drawMap(state);
  });
});

document.getElementById('locationCrossCard').addEventListener('click', () =>
  showDetailModal('location', state.locationCrossDetails, state.aisleCrossDetails),
);
document.getElementById('locationCrossBayCard').addEventListener('click', () =>
  showDetailModal('locationBay', state.locationCrossBayDetails, state.aisleCrossDetails),
);
document.getElementById('aisleCrossCard').addEventListener('click', () => showDetailModal('aisle', state.locationCrossDetails, state.aisleCrossDetails));

document.getElementById('exportImageBtn').addEventListener('click', () => exportImage(state.canvas));
document.getElementById('exportExcelBtn').addEventListener('click', () =>
  exportMetrics(state.routeMetrics, state.locationCrossDetails, state.locationCrossBayDetails, state.aisleCrossDetails, state.maxRouteSteps, state.selectedWaves),
);
document.getElementById('exportTableBtn').addEventListener('click', exportComparisonTable);

document.getElementById('searchInput').addEventListener('input', handleSearch);
document.getElementById('zoneFilter').addEventListener('change', handleZoneFilter);
document.getElementById('zoomSlider').addEventListener('input', handleZoom);
document.getElementById('shortcutsBtn').addEventListener('click', showKeyboardShortcutsHelp);
document.getElementById('toggleZonesBtn').addEventListener('click', handleToggleZones);
document.getElementById('skuToggleBtn').addEventListener('click', handleSkuToggle);

function handleLocationFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
    const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    const shelves = parseLocationData(jsonData);
    setShelves(shelves);
    resetRouteState();
    state.waveRoutes = {};
    state.allWaveIds = [];
    state.selectedWaves = [];
    const aisles = detectAisles(shelves);
    state.verticalAisles = aisles.verticalAisles;
    state.horizontalAisles = aisles.horizontalAisles;
    populateZones();
    document.getElementById('controls').style.display = 'flex';
    document.getElementById('mapContainer').style.display = 'block';
    document.getElementById('exportImageBtn').style.display = 'inline-block';
    updateStats();
    if (!state.canvas) {
      const ok = initCanvas(state, mouseHandlers);
      if (!ok) {
        alert('Canvas not available. Please check the page markup.');
        return;
      }
    }
    drawMap(state);
    locationFileUploaded = true;
    maybeHideUploadSection();
  };
  reader.readAsArrayBuffer(file);
  document.getElementById('locationUploadBox').classList.add('uploaded');
  document.getElementById('locationUploadBox').querySelector('.upload-card-title').textContent = '✓ Loaded';
}

function handleRouteFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
    state.rawRouteData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    if (state.rawRouteData.length === 0) {
      alert('Empty file!');
      return;
    }
    document.getElementById('routeUploadBox').classList.add('uploaded');
    document.getElementById('routeUploadBox').querySelector('.upload-card-title').textContent = '✓ Loaded';
    showColumnMapping(state.rawRouteData);
    routeFileUploaded = true;
    maybeHideUploadSection();
  };
  reader.readAsArrayBuffer(file);
}

function populateZones() {
  const zones = [...new Set(state.shelves.map((s) => s.zone))].sort();
  const zoneFilter = document.getElementById('zoneFilter');
  zoneFilter.innerHTML = '<option value="">All</option>';
  zones.forEach((z) => {
    const opt = document.createElement('option');
    opt.value = z;
    opt.textContent = z;
    zoneFilter.appendChild(opt);
  });
}

function showColumnMapping(data) {
  const cols = Object.keys(data[0]);
  ['colWave', 'colTime', 'colLocation', 'colAisle', 'colSku'].forEach((id) => {
    const sel = document.getElementById(id);
    sel.innerHTML = (id === 'colLocation' || id === 'colSku') ? '<option value="">-- Select --</option>' : '<option value="">-- None --</option>';
    cols.forEach((c) => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      sel.appendChild(o);
    });
  });
  document.getElementById('colWave').value = cols.find((c) => /wave|picker|path/i.test(c)) || '';
  document.getElementById('colTime').value = cols.find((c) => /time|date|seq/i.test(c)) || '';
  document.getElementById('colLocation').value = cols.find((c) => /location|loc/i.test(c)) || '';
  document.getElementById('colAisle').value = cols.find((c) => /aisle/i.test(c)) || '';
  document.getElementById('colSku').value = cols.find((c) => /sku/i.test(c)) || '';

  document.getElementById('columnMappingSection').style.display = 'block';

  let html = '<table><tr>' + cols.map((c) => `<th>${c}</th>`).join('') + '</tr>';
  data.slice(0, 5).forEach((row) => {
    html += '<tr>' + cols.map((c) => `<td>${row[c] ?? ''}</td>`).join('') + '</tr>';
  });
  html += '</table>';
  document.getElementById('previewTable').innerHTML = html;
  document.getElementById('previewSection').style.display = 'block';
  document.getElementById('mappingStatus').textContent = `${data.length} rows loaded`;
}

function maybeHideUploadSection() {
  if (locationFileUploaded && routeFileUploaded) {
    const uploadSection = document.querySelector('.upload-section');
    if (uploadSection) uploadSection.style.display = 'none';
  }
}

function processRouteDataWithMapping() {
  const waveCol = document.getElementById('colWave').value;
  const timeCol = document.getElementById('colTime').value;
  const locationCol = document.getElementById('colLocation').value;
  const aisleCol = document.getElementById('colAisle').value;
  const skuCol = document.getElementById('colSku').value;
  if (!locationCol) {
    alert('Select Location column!');
    return;
  }
  if (!skuCol) {
    alert('Select SKU column! SKU column is required.');
    return;
  }
  if (state.shelves.length === 0) {
    alert('Upload location file first!');
    return;
  }
  const { waveRoutes, matched, allWaveIds } = buildWaveRoutes(state.rawRouteData, { waveCol, timeCol, locationCol, aisleCol, skuCol }, state.shelves);
  if (Object.keys(waveRoutes).length === 0) {
    alert('No valid routes!');
    return;
  }
  state.waveRoutes = waveRoutes;
  state.allWaveIds = allWaveIds;
  updateMultiSelect(allWaveIds);
  document.getElementById('waveControls').style.display = 'flex';
  document.getElementById('columnMappingSection').style.display = 'none';
  document.getElementById('exportExcelBtn').style.display = 'inline-block';
  alert(`✅ ${allWaveIds.length} wave paths found, ${matched} steps matched`);
}

function updateMultiSelect(waveIds) {
  const dropdown = document.getElementById('multiSelectDropdown');
  dropdown.innerHTML = '';
  waveIds.forEach((id, idx) => {
    const item = document.createElement('div');
    item.className = 'multi-select-item';
    item.innerHTML = `
        <input type="checkbox" value="${id}" id="wave_${idx}">
        <span class="color-dot" style="background:${getPathColor(idx)}"></span>
        <label for="wave_${idx}">${id} (${state.waveRoutes[id].length})</label>
    `;
    const checkbox = item.querySelector('input');
    checkbox.checked = state.selectedWaves.includes(id);
    checkbox.addEventListener('change', handleWaveSelection);
    dropdown.appendChild(item);
  });
}

function toggleDropdown() {
  document.getElementById('multiSelectDropdown').classList.toggle('show');
}

async function selectAllWaves() {
  if (state.allWaveIds.length === 0) return;

  // 显示加载提示
  const btn = document.getElementById('selectAllWavesBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Loading...';

  state.selectedWaves = [...state.allWaveIds];
  document.querySelectorAll('#multiSelectDropdown input[type="checkbox"]').forEach((cb) => {
    cb.checked = true;
  });
  document.getElementById('multiSelectBtn').textContent = `Select Wave Paths (${state.selectedWaves.length})`;
  resetRouteState();

  // 使用 setTimeout 让UI有机会更新
  setTimeout(async () => {
    await prepareRoutes();
    btn.disabled = false;
    btn.textContent = originalText;
  }, 50);
}

function clearAllWaves() {
  state.selectedWaves = [];
  document.querySelectorAll('#multiSelectDropdown input[type="checkbox"]').forEach((cb) => {
    cb.checked = false;
  });
  document.getElementById('multiSelectBtn').textContent = 'Select Wave Paths (0)';
  resetRouteState();
  prepareRoutes();
}

function buildGlobalTimeline(selectedWaves, waveRoutes) {
  const timeline = [];
  selectedWaves.forEach((waveId) => {
    const route = waveRoutes[waveId];
    if (!route) return;
    route.forEach((step, idx) => {
      const ts = !Number.isNaN(step.timestamp) ? step.timestamp : idx;
      timeline.push({ waveId, routeIndex: idx, timestamp: ts });
    });
  });
  timeline.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    if (a.waveId !== b.waveId) return a.waveId.localeCompare(b.waveId);
    return a.routeIndex - b.routeIndex;
  });
  return timeline;
}

function handleWaveSelection() {
  const checkboxes = document.querySelectorAll('#multiSelectDropdown input:checked');
  state.selectedWaves = Array.from(checkboxes).map((cb) => cb.value);
  document.getElementById('multiSelectBtn').textContent = `Select Wave Paths (${state.selectedWaves.length})`;
  resetRouteState();
  prepareRoutes();
}

// 防抖变量
let prepareRoutesTimeout = null;

async function prepareRoutes() {
  // 清除之前的超时
  if (prepareRoutesTimeout) {
    clearTimeout(prepareRoutesTimeout);
  }

  if (state.selectedWaves.length === 0) {
    document.getElementById('metricsPanel').style.display = 'none';
    document.getElementById('comparisonTableSection').style.display = 'none';
    drawMap(state);
    return;
  }

  // 显示加载状态
  const metricsPanel = document.getElementById('metricsPanel');
  metricsPanel.style.display = 'block';

  // 快速更新基本信息
  state.maxRouteSteps = 0;
  state.selectedWaves.forEach((waveId) => {
    const route = state.waveRoutes[waveId];
    if (route.length > state.maxRouteSteps) state.maxRouteSteps = route.length;
    state.visitedPaths[waveId] = [];
  });

  // 异步累加热力图，避免一次性卡顿
  await updateWaveVisits(state.selectedWaves, state.waveRoutes, state.heatmapData);
  const visits = Object.values(state.heatmapData);
  const maxVisitsEl = document.getElementById('maxVisits');
  if (maxVisitsEl) {
    maxVisitsEl.textContent = visits.length ? Math.max(...visits) : 0;
  }

  // 构建全局时间线（按时间排序所有选中波次的步骤）
  state.globalTimeline = buildGlobalTimeline(state.selectedWaves, state.waveRoutes);
  state.maxRouteSteps = state.globalTimeline.length;

  document.getElementById('progressSlider').max = state.maxRouteSteps;
  document.getElementById('progressSlider').value = 0;
  document.getElementById('progressLabel').textContent = `0 / ${state.maxRouteSteps}`;
  document.getElementById('metricTotalUnits').textContent = `of ${state.maxRouteSteps} total`;

  // 更新图例和绘制地图（不等待理想距离）
  updateLegend(state.displayMode, state.selectedWaves);
  drawMap(state);

  // 异步更新对比表格（如有需要）
  prepareRoutesTimeout = setTimeout(() => {
    buildComparisonTable();
    updateAbnormalWaves();  // Update abnormal waves after analysis
  }, 100);
}

function playAnimation() {
  if (state.selectedWaves.length === 0) {
    alert('Select wave paths first!');
    return;
  }
  if (state.isPaused) {
    state.isPaused = false;
  } else {
    state.currentStep = 0;
    state.selectedWaves.forEach((id) => (state.visitedPaths[id] = []));
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
    state.visitedLocations = {};
    state.visitedBays = {};
    state.visitedAisles = {};
  }
  state.isPlaying = true;
  document.getElementById('playBtn').style.display = 'none';
  document.getElementById('pauseBtn').style.display = 'inline-block';
  lastAnimationTime = 0;
  animationLoop();
}

function pauseAnimation() {
  state.isPlaying = false;
  state.isPaused = true;
  document.getElementById('playBtn').style.display = 'inline-block';
  document.getElementById('pauseBtn').style.display = 'none';
  if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
}

function stopAnimation() {
  state.isPlaying = false;
  state.isPaused = false;
  if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
  document.getElementById('playBtn').style.display = 'inline-block';
  document.getElementById('pauseBtn').style.display = 'none';
  drawMap(state);
  updateAbnormalWaves();
}

function seekAnimation(e) {
  const targetStep = parseInt(e.target.value, 10);
  state.selectedWaves.forEach((id) => (state.visitedPaths[id] = []));
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
  state.visitedLocations = {};
  state.visitedBays = {};
  state.visitedAisles = {};
  state.shelves.forEach((s) => (s.isCurrent = false));
  for (let i = 0; i <= targetStep && i < state.maxRouteSteps; i++) {
    const entry = state.globalTimeline[i];
    if (!entry) break;
    state.waveIdOverride = entry.waveId;
    state.routeIndexOverride = entry.routeIndex;
    processStep(entry.routeIndex, state, { verticalAisles: state.verticalAisles, horizontalAisles: state.horizontalAisles });
  }
  state.waveIdOverride = null;
  state.routeIndexOverride = null;
  state.currentStep = targetStep;
  updateMetricsDisplay();
  drawMap(state);
  updateAbnormalWaves();
}

let lastAnimationTime = 0;
function animationLoop(timestamp) {
  if (!state.isPlaying) return;
  if (!lastAnimationTime) lastAnimationTime = timestamp;
  const elapsed = timestamp - lastAnimationTime;
  if (elapsed >= state.pickerStepDuration) {
    lastAnimationTime = timestamp;
    if (state.currentStep >= state.maxRouteSteps) {
      stopAnimation();
      return;
    }
    const entry = state.globalTimeline[state.currentStep];
    if (entry) {
      state.waveIdOverride = entry.waveId;
      state.routeIndexOverride = entry.routeIndex;
      processStep(entry.routeIndex, state, { verticalAisles: state.verticalAisles, horizontalAisles: state.horizontalAisles });
      state.waveIdOverride = null;
      state.routeIndexOverride = null;
    }
    state.currentStep += 1;
    updateMetricsDisplay();
    drawMap(state);
  }
  state.animationFrameId = requestAnimationFrame(animationLoop);
}

function updateSkuDisplay() {
  const skuCount = Object.keys(state.skuPickCounts).length;
  document.getElementById('skuCount').textContent = `${skuCount} SKU${skuCount !== 1 ? 's' : ''}`;

  if (skuCount === 0) {
    document.getElementById('skuStatsList').innerHTML = '<div class="sku-stats-empty">No SKU data available</div>';
    return;
  }

  // 按拣货次数降序排序所有 SKU
  const sortedSkus = Object.entries(state.skuPickCounts)
    .sort((a, b) => b[1] - a[1]);

  let html = '<div class="sku-stats-table">';
  html += '<div class="sku-stats-row sku-stats-header-row">';
  html += '<div class="sku-stats-cell">SKU</div>';
  html += '<div class="sku-stats-cell">Pick Count</div>';
  html += '<div class="sku-stats-cell">Waves</div>';
  html += '</div>';

  sortedSkus.forEach(([sku, count]) => {
    const waveCount = state.skuWaveCounts[sku] ? state.skuWaveCounts[sku].size : 0;
    html += '<div class="sku-stats-row">';
    html += `<div class="sku-stats-cell sku-name">${sku}</div>`;
    html += `<div class="sku-stats-cell sku-count-value">${count}</div>`;
    html += `<div class="sku-stats-cell sku-wave-count">${waveCount}</div>`;
    html += '</div>';
  });

  html += '</div>';
  document.getElementById('skuStatsList').innerHTML = html;
}

function updateMetricsDisplay() {
  // 基础指标
  document.getElementById('metricLocationCrosses').textContent = state.routeMetrics.locationCrosses;
  document.getElementById('metricLocationCrossesBay').textContent = state.routeMetrics.locationCrossesBay;
  document.getElementById('metricAisleCrosses').textContent = state.routeMetrics.aisleCrosses;
  document.getElementById('metricCurrentUnit').textContent = state.currentStep;
  document.getElementById('metricDistance').textContent = `${state.routeMetrics.totalDistance.toFixed(1)} m`;

  // 更新时间指标
  document.getElementById('metricTotalTime').textContent = formatTime(state.routeMetrics.totalTimeSeconds || 0);

  const pickTimes = state.routeMetrics.pickTimes || [];
  const avgTime = pickTimes.length > 0
    ? pickTimes.reduce((a, b) => a + b, 0) / pickTimes.length
    : 0;
  document.getElementById('metricAvgTime').textContent = avgTime > 0 ? `${avgTime.toFixed(1)}s` : '0s';

  const pickSpeed = (state.routeMetrics.totalTimeSeconds || 0) > 0
    ? (state.currentStep / state.routeMetrics.totalTimeSeconds) * 60
    : 0;
  document.getElementById('metricPickSpeed').textContent = pickSpeed > 0 ? pickSpeed.toFixed(2) : '0';

  document.getElementById('progressLabel').textContent = `${state.currentStep} / ${state.maxRouteSteps}`;
  document.getElementById('progressSlider').value = state.currentStep;

  // 计算增强指标 (P0 + P1)
  const totalUnits = state.currentStep;
  const optimalDistance = calculateIdealDistance(
    state.selectedWaves,
    state.waveRoutes,
    { verticalAisles: state.verticalAisles, horizontalAisles: state.horizontalAisles },
    state.shelves
  );

  const enhanced = calculateEnhancedMetrics(state.routeMetrics, totalUnits, optimalDistance);

  // P0: Core Efficiency Metrics
  document.getElementById('metricPickRate').textContent = enhanced.pickRate.toFixed(1);
  document.getElementById('metricDistancePerUnit').textContent = enhanced.distancePerUnit.toFixed(2);
  document.getElementById('metricPathEfficiency').textContent = `${enhanced.pathEfficiency.toFixed(1)}%`;

  // P1: Quality Metrics
  document.getElementById('metricTravelSpeed').textContent = enhanced.travelSpeed.toFixed(1);
  document.getElementById('metricWastedDistance').textContent = `${enhanced.wastedDistance.toFixed(1)} m`;
  document.getElementById('metricRevisitRate').textContent = `${enhanced.revisitRate.toFixed(1)}%`;

  // 更新 SKU 显示
  updateSkuDisplay();
}

function handleSearch(e) {
  const q = e.target.value.toLowerCase();
  state.shelves.forEach((s) => {
    s.highlighted =
      q &&
      ((s.aisleBay && s.aisleBay.toLowerCase().includes(q)) || (s.location && s.location.toLowerCase().includes(q)) || (s.zone && s.zone.toLowerCase().includes(q)));
  });
  drawMap(state);
}

function handleZoneFilter(e) {
  const zone = e.target.value;
  state.filteredShelves = zone ? state.shelves.filter((s) => s.zone === zone) : [...state.shelves];
  updateStats();
  drawMap(state);
}

function handleZoom(e) {
  state.scale = parseFloat(e.target.value);
  drawMap(state);
}

function handleToggleZones() {
  state.showZones = !state.showZones;
  const btn = document.getElementById('toggleZonesBtn');
  if (state.showZones) {
    btn.classList.add('active');
    btn.style.backgroundColor = '#48bb78';
    btn.style.color = '#fff';
  } else {
    btn.classList.remove('active');
    btn.style.backgroundColor = '';
    btn.style.color = '';
  }
  drawMap(state);
}

function handleSkuToggle() {
  const btn = document.getElementById('skuToggleBtn');
  const list = document.getElementById('skuStatsList');
  const icon = btn.querySelector('.toggle-icon');

  if (list.classList.contains('collapsed')) {
    list.classList.remove('collapsed');
    btn.classList.add('expanded');
    btn.innerHTML = '<span class="toggle-icon">▼</span> Collapse';
  } else {
    list.classList.add('collapsed');
    btn.classList.remove('expanded');
    btn.innerHTML = '<span class="toggle-icon">▼</span> Expand';
  }
}

function updateStats() {
  document.getElementById('totalShelves').textContent = state.filteredShelves.length;
}

const mouseHandlers = {
  handleMouseMove: (e) => {
    const rect = state.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (state.isDragging) {
      state.offsetX = e.clientX - state.dragStartX;
      state.offsetY = e.clientY - state.dragStartY;
      drawMap(state);
      return;
    }
    state.hoveredShelf = null;
    for (const shelf of state.filteredShelves) {
      if (x >= shelf.rectX && x <= shelf.rectX + shelf.rectW && y >= shelf.rectY && y <= shelf.rectY + shelf.rectH) {
        state.hoveredShelf = shelf;
        showTooltip(e.clientX, e.clientY, shelf, state.displayMode, state.heatmapData);
        break;
      }
    }
    if (!state.hoveredShelf) hideTooltip();
    drawMap(state);
  },
  handleClick: () => {
    if (state.hoveredShelf) {
      state.selectedShelf = state.hoveredShelf;
      showInfoPanel(state.selectedShelf);
      drawMap(state);
    }
  },
  startDrag: (e) => {
    state.isDragging = true;
    state.dragStartX = e.clientX - state.offsetX;
    state.dragStartY = e.clientY - state.offsetY;
    state.canvas.style.cursor = 'grabbing';
  },
  endDrag: () => {
    state.isDragging = false;
    state.canvas.style.cursor = 'grab';
  },
  handleWheel: (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    state.scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.scale + delta));
    document.getElementById('zoomSlider').value = state.scale;
    drawMap(state);
  },
};

// ===== Comparison Table Functions =====
let tableSortKey = 'waveId';
let tableSortAsc = true;
let cachedTableMetrics = {}; // 缓存波次指标，避免重复计算

function buildComparisonTable() {
  if (state.selectedWaves.length === 0) {
    document.getElementById('comparisonTableSection').style.display = 'none';
    return;
  }

  document.getElementById('comparisonTableSection').style.display = 'block';

  // 使用批处理方式计算指标，减少主线程阻塞
  const tableData = [];
  let processed = 0;

  const processBatch = () => {
    const batchSize = 5; // 每批处理5个波次
    const end = Math.min(processed + batchSize, state.selectedWaves.length);

    for (let i = processed; i < end; i++) {
      const waveId = state.selectedWaves[i];

      // 检查缓存
      if (!cachedTableMetrics[waveId]) {
        cachedTableMetrics[waveId] = calculateWaveMetrics(
          waveId,
          state.waveRoutes,
          { verticalAisles: state.verticalAisles, horizontalAisles: state.horizontalAisles },
          state.shelves
        );
      }

      const metrics = cachedTableMetrics[waveId];
      tableData.push({
        waveId,
        colorIndex: i,
        ...metrics,
        totalRevisits: metrics.locationCrosses + metrics.locationCrossesBay + metrics.aisleCrosses
      });
    }

    processed = end;

    if (processed < state.selectedWaves.length) {
      // 继续处理下一批
      setTimeout(processBatch, 0);
    } else {
      // 全部完成，渲染表格
      renderComparisonTable(tableData);
    }
  };

  processBatch();
}

function renderComparisonTable(tableData) {
  // 排序数据
  const sorted = [...tableData].sort((a, b) => {
    let valA = a[tableSortKey];
    let valB = b[tableSortKey];

    if (typeof valA === 'string') {
      return tableSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return tableSortAsc ? valA - valB : valB - valA;
  });

  // 找出最优和最差
  const bestDistance = Math.min(...tableData.map(d => d.totalDistance).filter(d => d > 0));
  const worstDistance = Math.max(...tableData.map(d => d.totalDistance));
  const bestRevisits = Math.min(...tableData.map(d => d.totalRevisits));
  const worstRevisits = Math.max(...tableData.map(d => d.totalRevisits));

  const tbody = document.getElementById('comparisonTableBody');
  tbody.innerHTML = sorted.map(data => {
    const isBest = data.totalDistance === bestDistance && data.totalRevisits === bestRevisits;
    const isWorst = data.totalDistance === worstDistance && data.totalRevisits === worstRevisits;
    const rowClass = isBest ? 'best-row' : isWorst ? 'worst-row' : '';

    return `
      <tr class="${rowClass}">
        <td>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${getPathColor(data.colorIndex)};margin-right:8px;"></span>
          ${data.waveId}
          ${isBest ? '<span class="table-badge best">BEST</span>' : ''}
          ${isWorst ? '<span class="table-badge worst">WORST</span>' : ''}
        </td>
        <td>${data.units}</td>
        <td>${data.totalDistance.toFixed(1)}</td>
        <td>${formatTime(data.totalTimeSeconds)}</td>
        <td>
          <span style="color:#f1c40f;">${data.locationCrosses}S</span> +
          <span style="color:#e67e22;">${data.locationCrossesBay}B</span> +
          <span style="color:#e74c3c;">${data.aisleCrosses}A</span>
          = ${data.totalRevisits}
        </td>
        <td>${data.pickSpeed.toFixed(2)}</td>
        <td>
          <button class="table-action-btn" onclick="focusOnWave('${data.waveId}')">👁️ View</button>
        </td>
      </tr>
    `;
  }).join('');

  // 添加排序指示器
  document.querySelectorAll('.comparison-table th.sortable').forEach(th => {
    const sortKey = th.dataset.sort;
    const indicator = sortKey === tableSortKey ? (tableSortAsc ? ' ▲' : ' ▼') : ' ▼';
    th.textContent = th.textContent.replace(/ [▲▼]/, '') + indicator;
  });
}

// 排序功能
document.querySelectorAll('.comparison-table th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const newSortKey = th.dataset.sort;
    if (newSortKey === tableSortKey) {
      tableSortAsc = !tableSortAsc;
    } else {
      tableSortKey = newSortKey;
      tableSortAsc = true;
    }
    buildComparisonTable();
  });
});

// 聚焦到某个波次
window.focusOnWave = (waveId) => {
  // 只选中这个波次
  state.selectedWaves = [waveId];
  document.querySelectorAll('#multiSelectDropdown input[type="checkbox"]').forEach(cb => {
    cb.checked = cb.value === waveId;
  });
  document.getElementById('multiSelectBtn').textContent = `Select Wave Paths (1)`;
  resetRouteState();
  prepareRoutes();
};

// 导出表格为Excel
function exportComparisonTable() {
  if (state.selectedWaves.length === 0) {
    alert('No data to export!');
    return;
  }

  const tableData = state.selectedWaves.map(waveId => {
    const metrics = calculateWaveMetrics(
      waveId,
      state.waveRoutes,
      { verticalAisles: state.verticalAisles, horizontalAisles: state.horizontalAisles },
      state.shelves
    );
    return [
      waveId,
      metrics.units,
      metrics.totalDistance.toFixed(2),
      formatTime(metrics.totalTimeSeconds),
      metrics.locationCrosses,
      metrics.locationCrossesBay,
      metrics.aisleCrosses,
      metrics.locationCrosses + metrics.locationCrossesBay + metrics.aisleCrosses,
      metrics.pickSpeed.toFixed(2)
    ];
  });

  const data = [
    ['Wave ID', 'Units', 'Distance (m)', 'Duration', 'Slot Revisits', 'Shelf Revisits', 'Aisle Revisits', 'Total Revisits', 'Speed (u/min)'],
    ...tableData
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Wave Comparison');
  XLSX.writeFile(wb, 'wave_comparison.xlsx');
}

// ===== Legend, tooltip, info panel bindings =====
window.showDetailModal = (type) => showDetailModal(type, state.locationCrossDetails, state.aisleCrossDetails);

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
  // 如果在输入框中，只处理Esc键
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    if (e.key === 'Escape') {
      e.target.blur();
      closeModal();
      closeInfoPanel();
    }
    return;
  }

  switch (e.key) {
    case ' ': // Space - 播放/暂停
      e.preventDefault();
      if (state.selectedWaves.length === 0) return;
      if (state.isPlaying) {
        pauseAnimation();
      } else {
        playAnimation();
      }
      break;

    case 'r':
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+R - 停止并重置
        e.preventDefault();
        stopAnimation();
      } else {
        // R - 切换到Route模式
        const routeBtn = document.querySelector('.mode-btn[data-mode="route"]');
        if (routeBtn && !routeBtn.classList.contains('active')) {
          routeBtn.click();
        }
      }
      break;

    case 'h':
      // H - 切换到Heatmap模式
      const heatmapBtn = document.querySelector('.mode-btn[data-mode="heatmap"]');
      if (heatmapBtn && !heatmapBtn.classList.contains('active')) {
        heatmapBtn.click();
      }
      break;

    case 'ArrowRight':
      e.preventDefault();
      if (state.selectedWaves.length === 0) return;
      if (e.ctrlKey || e.metaKey) {
        seekSteps(10); // 快进10步
      } else {
        seekSteps(1); // 前进1步
      }
      break;

    case 'ArrowLeft':
      e.preventDefault();
      if (state.selectedWaves.length === 0) return;
      if (e.ctrlKey || e.metaKey) {
        seekSteps(-10); // 后退10步
      } else {
        seekSteps(-1); // 后退1步
      }
      break;

    case '+':
    case '=':
      // 放大
      state.scale = Math.min(MAX_ZOOM, state.scale + 0.1);
      document.getElementById('zoomSlider').value = state.scale;
      drawMap(state);
      break;

    case '-':
    case '_':
      // 缩小
      state.scale = Math.max(MIN_ZOOM, state.scale - 0.1);
      document.getElementById('zoomSlider').value = state.scale;
      drawMap(state);
      break;

    case '0':
      // 重置缩放
      state.scale = 1;
      state.offsetX = 0;
      state.offsetY = 0;
      document.getElementById('zoomSlider').value = 1;
      drawMap(state);
      break;

    case 'f':
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+F - 聚焦搜索框
        e.preventDefault();
        document.getElementById('searchInput').focus();
      }
      break;

    case 'e':
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+E - 导出报告
        e.preventDefault();
        const exportBtn = document.getElementById('exportExcelBtn');
        if (exportBtn.style.display !== 'none') {
          exportBtn.click();
        }
      }
      break;

    case 'Escape':
      // Esc - 关闭所有弹窗
      closeModal();
      closeInfoPanel();
      break;

    case '?':
      // ? - 显示快捷键帮助
      showKeyboardShortcutsHelp();
      break;
  }
});

// 步进函数
function seekSteps(steps) {
  const targetStep = Math.max(0, Math.min(state.maxRouteSteps, state.currentStep + steps));
  document.getElementById('progressSlider').value = targetStep;
  seekAnimation({ target: { value: targetStep } });
}

// 快捷键帮助弹窗
function showKeyboardShortcutsHelp() {
  showDetailModal('shortcuts', [], []);
  document.getElementById('modalTitle').textContent = '⌨️ Keyboard Shortcuts';
  document.getElementById('detailList').innerHTML = `
    <li class="detail-item">
      <span class="detail-item-left"><strong>Space</strong></span>
      <span class="detail-item-right">Play / Pause</span>
    </li>
    <li class="detail-item">
      <span class="detail-item-left"><strong>← / →</strong></span>
      <span class="detail-item-right">Step backward / forward</span>
    </li>
    <li class="detail-item">
      <span class="detail-item-left"><strong>Ctrl + ← / →</strong></span>
      <span class="detail-item-right">Jump ±10 steps</span>
    </li>
    <li class="detail-item">
      <span class="detail-item-left"><strong>Ctrl + R</strong></span>
      <span class="detail-item-right">Stop & Reset</span>
    </li>
    <li class="detail-item">
      <span class="detail-item-left"><strong>+ / -</strong></span>
      <span class="detail-item-right">Zoom in / out</span>
    </li>
    <li class="detail-item">
      <span class="detail-item-left"><strong>0</strong></span>
      <span class="detail-item-right">Reset zoom & position</span>
    </li>
    <li class="detail-item">
      <span class="detail-item-left"><strong>R / H</strong></span>
      <span class="detail-item-right">Switch to Route / Heatmap mode</span>
    </li>
    <li class="detail-item">
      <span class="detail-item-left"><strong>Ctrl + F</strong></span>
      <span class="detail-item-right">Focus search box</span>
    </li>
    <li class="detail-item">
      <span class="detail-item-left"><strong>Ctrl + E</strong></span>
      <span class="detail-item-right">Export metrics</span>
    </li>
    <li class="detail-item">
      <span class="detail-item-left"><strong>Esc</strong></span>
      <span class="detail-item-right">Close modals</span>
    </li>
    <li class="detail-item">
      <span class="detail-item-left"><strong>?</strong></span>
      <span class="detail-item-right">Show this help</span>
    </li>
  `;
}

// Ensure initial zoom slider matches default
document.getElementById('speedValue').textContent = `${DEFAULT_PICKER_STEP_DURATION}ms`;

// ==================== Abnormal Waves Functionality ====================

// Update abnormal waves data based on all waves (use cached metrics if available)
function updateAbnormalWaves() {
  state.abnormalWaves = {};

  const waves = state.allWaveIds && state.allWaveIds.length ? state.allWaveIds : Object.keys(state.waveRoutes);

  waves.forEach((waveId) => {
    // 优先使用已缓存的表格指标，避免重复计算
    let metrics = cachedTableMetrics[waveId];
    if (!metrics) {
      metrics = calculateWaveMetrics(
        waveId,
        state.waveRoutes,
        { verticalAisles: state.verticalAisles, horizontalAisles: state.horizontalAisles },
        state.shelves,
      );
      cachedTableMetrics[waveId] = metrics;
    }

    const { locationCrosses = 0, locationCrossesBay = 0, aisleCrosses = 0 } = metrics;
    const total = locationCrosses + locationCrossesBay + aisleCrosses;

    if (total > 0) {
      state.abnormalWaves[waveId] = {
        slotRevisits: locationCrosses,
        shelfRevisits: locationCrossesBay,
        aisleRevisits: aisleCrosses,
        total,
      };
    }
  });

  updateAbnormalWavesUI();
}

// Update abnormal waves dropdown UI
function updateAbnormalWavesUI() {
  const filterSlot = document.getElementById('filterSlot').checked;
  const filterShelf = document.getElementById('filterShelf').checked;
  const filterAisle = document.getElementById('filterAisle').checked;

  const filteredWaves = Object.entries(state.abnormalWaves).filter(([waveId, data]) => {
    if (filterSlot && data.slotRevisits > 0) return true;
    if (filterShelf && data.shelfRevisits > 0) return true;
    if (filterAisle && data.aisleRevisits > 0) return true;
    return false;
  });

  document.getElementById('abnormalWavesBtn').textContent =
    `🚨 Check Abnormal Wave (${filteredWaves.length})`;

  const listContainer = document.getElementById('abnormalWavesList');

  if (filteredWaves.length === 0) {
    listContainer.innerHTML = '<div style="padding:15px;text-align:center;color:rgba(255,255,255,0.4);font-size:12px;">No abnormal waves found</div>';
    return;
  }

  listContainer.innerHTML = filteredWaves.map(([waveId, data]) => {
    const badges = [];
    if (data.slotRevisits > 0) {
      badges.push(`<span class="abnormal-badge slot">${data.slotRevisits}S</span>`);
    }
    if (data.shelfRevisits > 0) {
      badges.push(`<span class="abnormal-badge shelf">${data.shelfRevisits}B</span>`);
    }
    if (data.aisleRevisits > 0) {
      badges.push(`<span class="abnormal-badge aisle">${data.aisleRevisits}A</span>`);
    }

    return `
      <div class="abnormal-wave-item" data-wave-id="${waveId}">
        <div class="abnormal-wave-title">${waveId}</div>
        <div class="abnormal-wave-details">
          ${badges.join(' ')}
          <span style="margin-left:auto;color:rgba(255,255,255,0.3);">${data.total} total</span>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  document.querySelectorAll('.abnormal-wave-item').forEach(item => {
    item.addEventListener('click', () => {
      const waveId = item.dataset.waveId;
      selectAbnormalWave(waveId);
    });
  });
}

// Select an abnormal wave (replace current selection and auto-play)
async function selectAbnormalWave(waveId) {
  // Stop any current playback before switching wave
  stopAnimation();

  // Clear current selection
  state.selectedWaves = [waveId];

  // Update UI
  document.getElementById('multiSelectBtn').textContent = `Select Wave Paths (1)`;

  // Update checkboxes in main dropdown
  document.querySelectorAll('#multiSelectDropdown input[type="checkbox"]').forEach(cb => {
    cb.checked = (cb.value === waveId);
  });

  // Close abnormal dropdown
  document.getElementById('abnormalDropdown').classList.remove('show');

  // Refresh routes and auto-play the selected abnormal wave
  resetRouteState();
  await prepareRoutes();
  playAnimation();
}

// Toggle abnormal dropdown
function toggleAbnormalDropdown() {
  const dropdown = document.getElementById('abnormalDropdown');
  dropdown.classList.toggle('show');

  // Close main dropdown if open
  document.getElementById('multiSelectDropdown').classList.remove('show');
}

// Select all abnormal waves
function selectAllAbnormalWaves() {
  const abnormalWaveIds = Object.keys(state.abnormalWaves);

  if (abnormalWaveIds.length === 0) return;

  // Set selected waves to all abnormal waves
  state.selectedWaves = abnormalWaveIds;

  // Update UI
  document.getElementById('multiSelectBtn').textContent =
    `Select Wave Paths (${abnormalWaveIds.length})`;

  // Update checkboxes in main dropdown
  document.querySelectorAll('#multiSelectDropdown input[type="checkbox"]').forEach(cb => {
    cb.checked = abnormalWaveIds.includes(cb.value);
  });

  // Close abnormal dropdown
  document.getElementById('abnormalDropdown').classList.remove('show');

  // Refresh routes
  resetRouteState();
  prepareRoutes();
}

// Event listeners for abnormal waves
document.getElementById('abnormalWavesBtn').addEventListener('click', toggleAbnormalDropdown);
document.getElementById('selectAllAbnormalBtn').addEventListener('click', selectAllAbnormalWaves);
document.getElementById('filterSlot').addEventListener('change', updateAbnormalWavesUI);
document.getElementById('filterShelf').addEventListener('change', updateAbnormalWavesUI);
document.getElementById('filterAisle').addEventListener('change', updateAbnormalWavesUI);

// Close abnormal dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.multi-select-wrapper')) {
    document.getElementById('abnormalDropdown').classList.remove('show');
  }
});
