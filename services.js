import { PATH_COLORS } from './config.js';

// 将 Slot 级别的 Location ID 截断到 Shelf/Bay 级别
// 例如: ID1111-2550-33 -> ID1111-2550
export function truncateToBayLevel(locationId) {
  if (!locationId) return '';
  const parts = String(locationId).split('-');
  // 保留前两部分（ID+Zone-Aisle+Bay），去除 Slot Number
  if (parts.length >= 2) {
    return parts.slice(0, 2).join('-');
  }
  return locationId;
}

export function parseLocationData(data) {
  return data.map((row) => ({
    aisle: row.aisle,
    bay: row.bay,
    aisleBay: row['aisle+bay'],
    row: row.row,
    column: row.column,
    zone: row.zone,
    location: row.location,
    x: parseFloat(row.coord_x_val || 0),
    y: parseFloat(row.coord_y_val || 0),
    isOnRoute: false,
    isCurrent: false,
    visitCount: 0,
    highlighted: false,
  }));
}

export function detectAisles(shelves) {
  const xPositions = [...new Set(shelves.map((s) => s.x))].sort((a, b) => a - b);
  const yPositions = [...new Set(shelves.map((s) => s.y))].sort((a, b) => a - b);

  const verticalAisles = [];
  const horizontalAisles = [];

  for (let i = 0; i < xPositions.length - 1; i++) {
    const gap = xPositions[i + 1] - xPositions[i];
    if (gap > 60) verticalAisles.push((xPositions[i] + xPositions[i + 1]) / 2);
  }
  for (let i = 0; i < yPositions.length - 1; i++) {
    const gap = yPositions[i + 1] - yPositions[i];
    if (gap >= 320) horizontalAisles.push((yPositions[i] + yPositions[i + 1]) / 2);
  }

  if (xPositions.length > 0) {
    verticalAisles.unshift(xPositions[0] - 100);
    verticalAisles.push(xPositions[xPositions.length - 1] + 100);
  }
  if (yPositions.length > 0) {
    horizontalAisles.unshift(yPositions[0] - 200);
    horizontalAisles.push(yPositions[yPositions.length - 1] + 200);
  }

  return { verticalAisles, horizontalAisles };
}

export function findNearestAisle(pos, aisles) {
  if (aisles.length === 0) return pos;
  let nearest = aisles[0];
  let minDist = Math.abs(pos - nearest);
  for (const aisle of aisles) {
    const dist = Math.abs(pos - aisle);
    if (dist < minDist) {
      minDist = dist;
      nearest = aisle;
    }
  }
  return nearest;
}

// 选择与货架相邻且中间无其他货架阻挡的通道；若无可用则回退到最近通道
function findAccessibleAisle(shelf, verticalAisles, shelves) {
  if (!verticalAisles || verticalAisles.length === 0) return shelf.x;
  let best = null;
  let bestDist = Infinity;
  for (const aisle of verticalAisles) {
    const minX = Math.min(aisle, shelf.x);
    const maxX = Math.max(aisle, shelf.x);
    const blocked = shelves.some((s) => s !== shelf && s.x > minX && s.x < maxX);
    if (blocked) continue;
    const dist = Math.abs(aisle - shelf.x);
    if (dist < bestDist) {
      best = aisle;
      bestDist = dist;
    }
  }
  return best !== null ? best : findNearestAisle(shelf.x, verticalAisles);
}

export function findBestHorizontalAisle(startY, endY, horizontalAisles) {
  if (horizontalAisles.length === 0) return (startY + endY) / 2;
  const midY = (startY + endY) / 2;
  const minY = Math.min(startY, endY);
  const maxY = Math.max(startY, endY);
  for (const aisle of horizontalAisles) {
    if (aisle >= minY && aisle <= maxY) return aisle;
  }
  return findNearestAisle(midY, horizontalAisles);
}

export function findAislePath(fromShelf, toShelf, aisles, shelves = []) {
  const { verticalAisles, horizontalAisles } = aisles;
  const path = [];
  const startX = fromShelf.x;
  const startY = fromShelf.y;
  const endX = toShelf.x;
  const endY = toShelf.y;
  if (Math.abs(startX - endX) < 1 && Math.abs(startY - endY) < 1) return [];

  const nearestStartAisleX = findAccessibleAisle(fromShelf, verticalAisles, shelves);
  const nearestEndAisleX = findAccessibleAisle(toShelf, verticalAisles, shelves);
  const crossingAisleY = findBestHorizontalAisle(startY, endY, horizontalAisles);

  // 同一通道侧：仅在最近的通道相同才走简化路线
  if (nearestStartAisleX === nearestEndAisleX) {
    // 步骤 1: 从起始货架水平移动到通道口
    path.push({ x: nearestStartAisleX, y: startY });
    // 步骤 2: 沿通道垂直移动到目标 Y 位置
    path.push({ x: nearestStartAisleX, y: endY });
    // 步骤 3: 从通道口水平移动到目标货架
    // （这一步在 render.js 中从最后一个路径点到 toShelf 自动连接）
  } else {
    // 跨 Aisle 移动
    // 步骤 1: 从起始货架水平移动到起始 Aisle 通道
    path.push({ x: nearestStartAisleX, y: startY });
    // 步骤 2: 沿起始 Aisle 垂直移动到横向通道
    path.push({ x: nearestStartAisleX, y: crossingAisleY });
    // 步骤 3: 沿横向通道水平移动到目标 Aisle
    path.push({ x: nearestEndAisleX, y: crossingAisleY });
    // 步骤 4: 沿目标 Aisle 垂直移动到目标 Y 位置
    path.push({ x: nearestEndAisleX, y: endY });
    // 步骤 5: 从通道口水平移动到目标货架
    // （这一步在 render.js 中从最后一个路径点到 toShelf 自动连接）
  }

  return path;
}

export function calculateIdealDistance(selectedWaves, waveRoutes, aisles, shelves = []) {
  if (selectedWaves.length === 0) return 0;
  const routeShelves = [];
  selectedWaves.forEach((waveId) => {
    waveRoutes[waveId].forEach((step) => {
      if (!routeShelves.find((s) => s.location === step.location)) routeShelves.push(step.shelf);
    });
  });
  if (routeShelves.length < 2) return 0;

  const visited = [routeShelves[0]];
  const remaining = routeShelves.slice(1);
  let distanceMeters = 0;

  while (remaining.length > 0) {
    const current = visited[visited.length - 1];
    let nearestIdx = 0;
    let nearestDist = Infinity; // cm

    remaining.forEach((shelf, idx) => {
      const aislePath = findAislePath(current, shelf, aisles, shelves);
      let d = 0; // cm
      let lastPoint = { x: current.x, y: current.y };
      for (const waypoint of aislePath) {
        d += Math.abs(waypoint.x - lastPoint.x) + Math.abs(waypoint.y - lastPoint.y);
        lastPoint = waypoint;
      }
      d += Math.abs(shelf.x - lastPoint.x) + Math.abs(shelf.y - lastPoint.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = idx;
      }
    });

    distanceMeters += nearestDist / 100; // cm -> m
    visited.push(remaining[nearestIdx]);
    remaining.splice(nearestIdx, 1);
  }

  return distanceMeters;
}

export function getHeatmapColor(count, heatmapData) {
  const maxCount = Math.max(1, ...Object.values(heatmapData));
  const ratio = Math.min(count / maxCount, 1);
  // 单色系渐变：浅黄 (#fff4b8) → 橘色 (#f4a261) → 红色 (#e74c3c)
  const start = { r: 255, g: 244, b: 184 };
  const mid = { r: 244, g: 162, b: 97 };
  const end = { r: 231, g: 76, b: 60 };

  if (ratio <= 0.5) {
    const t = ratio * 2;
    const r = Math.round(start.r + (mid.r - start.r) * t);
    const g = Math.round(start.g + (mid.g - start.g) * t);
    const b = Math.round(start.b + (mid.b - start.b) * t);
    return `rgb(${r},${g},${b})`;
  }

  const t = (ratio - 0.5) * 2;
  const r = Math.round(mid.r + (end.r - mid.r) * t);
  const g = Math.round(mid.g + (end.g - mid.g) * t);
  const b = Math.round(mid.b + (end.b - mid.b) * t);
  return `rgb(${r},${g},${b})`;
}

export function exportMetrics(routeMetrics, locationCrossDetails, locationCrossBayDetails, aisleCrossDetails, maxRouteSteps, selectedWaves) {
  const data = [
    ['Metric', 'Value'],
    ['Total Distance (m)', routeMetrics.totalDistance.toFixed(2)],
    ['Location Crosses (Slot Level) - Revisits', routeMetrics.locationCrosses],
    ['Location Crosses (Shelf/Bay Level) - Revisits', routeMetrics.locationCrossesBay],
    ['Aisle Crosses - Revisits', routeMetrics.aisleCrosses],
    ['Total Steps', maxRouteSteps],
    ['Selected Waves', selectedWaves.join(', ')],
    [],
    ['Location Cross Details (Slot Level) - Revisit Detection'],
    ['Revisit Step', 'Wave', 'Location', 'First Visit Step'],
    ...locationCrossDetails.map((d) => [d.revisit, d.wave, d.location, d.firstVisit]),
    [],
    ['Location Cross Details (Shelf/Bay Level) - Revisit Detection'],
    ['Revisit Step', 'Wave', 'Shelf Location', 'First Visit Step'],
    ...locationCrossBayDetails.map((d) => [d.revisit, d.wave, d.bayLocation, d.firstVisit]),
    [],
    ['Aisle Cross Details - Revisit Detection'],
    ['Revisit Step', 'Wave', 'Aisle', 'First Visit Step'],
    ...aisleCrossDetails.map((d) => [d.revisit, d.wave, d.aisle, d.firstVisit]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Metrics');
  XLSX.writeFile(wb, 'route_metrics.xlsx');
}

export function exportImage(canvas) {
  const link = document.createElement('a');
  link.download = 'warehouse_map.png';
  link.href = canvas.toDataURL();
  link.click();
}

export function buildWaveRoutes(rawRouteData, mapping, shelves) {
  const { waveCol, timeCol, locationCol, aisleCol, skuCol } = mapping;
  const waveRoutes = {};
  let matched = 0;

  const parseTimeValue = (timeVal, fallback) => {
    const t = new Date(timeVal).getTime();
    return Number.isNaN(t) ? fallback : t;
  };

  rawRouteData.forEach((row, idx) => {
    const waveId = waveCol ? String(row[waveCol] || 'Wave1').trim() : 'Wave1';
    const location = String(row[locationCol] || '').trim();
    const time = timeCol ? row[timeCol] : idx;
    const timestamp = parseTimeValue(time, idx);
    const aisle = aisleCol ? row[aisleCol] : '';
    const sku = skuCol ? String(row[skuCol] || '').trim() : '';
    if (!location) return;

    // 将 Slot 级别的 location 截断到 Shelf/Bay 级别进行匹配
    const bayLevelLocation = truncateToBayLevel(location);

    const shelf = shelves.find(
      (s) =>
        s.location === location ||
        s.location === bayLevelLocation ||
        s.aisleBay === location ||
        s.aisleBay === bayLevelLocation ||
        (s.location && s.location.toLowerCase() === location.toLowerCase()) ||
        (s.location && s.location.toLowerCase() === bayLevelLocation.toLowerCase()) ||
        (s.aisleBay && s.aisleBay.toLowerCase() === location.toLowerCase()) ||
        (s.aisleBay && s.aisleBay.toLowerCase() === bayLevelLocation.toLowerCase()),
    );
    if (!shelf) return;
    matched++;
    if (!waveRoutes[waveId]) waveRoutes[waveId] = [];
    waveRoutes[waveId].push({
      time,
      timestamp,
      location,  // 保留原始 Slot 级别的 location
      bayLocation: bayLevelLocation,  // 新增 Shelf/Bay 级别的 location
      shelf,
      aisle: aisle || shelf.aisle || '',
      sku  // 新增 SKU 字段
    });
  });

  Object.keys(waveRoutes).forEach((id) => {
    waveRoutes[id].sort((a, b) => {
      const ta = new Date(a.time).getTime();
      const tb = new Date(b.time).getTime();
      return !Number.isNaN(ta) && !Number.isNaN(tb) ? ta - tb : String(a.time).localeCompare(String(b.time));
    });
  });

  const allWaveIds = Object.keys(waveRoutes).sort();
  return { waveRoutes, matched, allWaveIds };
}

export function processStep(step, state, aisles) {
  state.shelves.forEach((s) => (s.isCurrent = false));
  // 当按全局时间线播放时，传入单个波次及其具体索引；否则默认所有选中波次按步序处理
  const wavesToProcess = state.waveIdOverride ? [state.waveIdOverride] : state.selectedWaves;

  wavesToProcess.forEach((waveId) => {
    const route = state.waveRoutes[waveId];
    const routeIdx = state.routeIndexOverride !== undefined ? state.routeIndexOverride : step;
    if (!route || routeIdx >= route.length) return;
    const currentRouteStep = route[routeIdx];
    const shelf = currentRouteStep.shelf;
    shelf.isCurrent = true;
    state.visitedPaths[waveId].push(shelf);

    // 初始化历史追踪数组
    if (!state.visitedLocations[waveId]) state.visitedLocations[waveId] = [];
    if (!state.visitedBays[waveId]) state.visitedBays[waveId] = [];
    if (!state.visitedAisles[waveId]) state.visitedAisles[waveId] = [];

    // 获取当前位置信息
    const currentLoc = currentRouteStep.location;
    const currentBayLoc = currentRouteStep.bayLocation || truncateToBayLevel(currentLoc);
    const currentAisle = currentRouteStep.aisle;
    const currentSku = currentRouteStep.sku;

    // === SKU 统计 ===
    if (currentSku) {
      state.skuPickCounts[currentSku] = (state.skuPickCounts[currentSku] || 0) + 1;
      if (!state.skuWaveCounts[currentSku]) {
        state.skuWaveCounts[currentSku] = new Set();
      }
      state.skuWaveCounts[currentSku].add(waveId);
    }

    // === 距离计算 ===
    if (routeIdx > 0) {
      const prevStep = route[routeIdx - 1];
      const aislePath = findAislePath(prevStep.shelf, shelf, aisles, state.shelves);
      let segmentDistanceCm = 0;
      let lastPoint = { x: prevStep.shelf.x, y: prevStep.shelf.y };
      for (const waypoint of aislePath) {
        segmentDistanceCm += Math.abs(waypoint.x - lastPoint.x) + Math.abs(waypoint.y - lastPoint.y);
        lastPoint = waypoint;
      }
      segmentDistanceCm += Math.abs(shelf.x - lastPoint.x) + Math.abs(shelf.y - lastPoint.y);
      state.routeMetrics.totalDistance += segmentDistanceCm / 100; // cm -> m

      // === 时间计算 ===
      const currentTime = new Date(currentRouteStep.time);
      const prevTime = new Date(prevStep.time);
      if (!isNaN(currentTime.getTime()) && !isNaN(prevTime.getTime())) {
        const timeDiffSeconds = (currentTime - prevTime) / 1000;
        if (timeDiffSeconds > 0 && timeDiffSeconds < 3600) { // 合理范围：1小时内
          state.routeMetrics.totalTimeSeconds += timeDiffSeconds;
          state.routeMetrics.pickTimes.push(timeDiffSeconds);

          // 记录最慢货位
          if (timeDiffSeconds > state.routeMetrics.slowestPickTime) {
            state.routeMetrics.slowestPickTime = timeDiffSeconds;
            state.routeMetrics.slowestPickLocation = currentLoc;
          }

          // 记录最快货位
          if (timeDiffSeconds < state.routeMetrics.fastestPickTime) {
            state.routeMetrics.fastestPickTime = timeDiffSeconds;
            state.routeMetrics.fastestPickLocation = currentLoc;
          }
        }
      }
    }

    // === "回头草"检测 - Slot 级别（离开后再回来才计数） ===
    if (currentLoc) {
      const lastLoc =
        state.visitedLocations[waveId].length > 0
          ? state.visitedLocations[waveId][state.visitedLocations[waveId].length - 1]
          : null;

      if (currentLoc !== lastLoc) {
        const previousLocIndex = state.visitedLocations[waveId].indexOf(currentLoc);
        if (previousLocIndex !== -1) {
          state.routeMetrics.locationCrosses += 1;
          state.locationCrossDetails.push({
            step: step + 1,
            wave: waveId,
            location: currentLoc,
            firstVisit: previousLocIndex + 1,
            revisit: step + 1,
          });
        }
      }
      state.visitedLocations[waveId].push(currentLoc);
    }

    // === "回头草"检测 - Shelf/Bay 级别 ===
    // 只有当 Shelf/Bay 与上一个不同时才记录（避免连续访问同一 Shelf/Bay）
    const lastBay = state.visitedBays[waveId].length > 0
      ? state.visitedBays[waveId][state.visitedBays[waveId].length - 1]
      : null;

    if (currentBayLoc !== lastBay) {
      // 检查是否回到之前访问过的 Bay
      const previousBayIndex = state.visitedBays[waveId].indexOf(currentBayLoc);
      if (previousBayIndex !== -1) {
        state.routeMetrics.locationCrossesBay += 1;
        state.locationCrossBayDetails.push({
          step: step + 1,
          wave: waveId,
          bayLocation: currentBayLoc,
          firstVisit: previousBayIndex + 1,
          revisit: step + 1,
        });
      }
      state.visitedBays[waveId].push(currentBayLoc);
    }

    // === "回头草"检测 - Aisle 级别 ===
    if (currentAisle) {
      const lastAisle = state.visitedAisles[waveId].length > 0
        ? state.visitedAisles[waveId][state.visitedAisles[waveId].length - 1]
        : null;

      if (currentAisle !== lastAisle) {
        // 检查是否回到之前访问过的 Aisle
        const previousAisleIndex = state.visitedAisles[waveId].indexOf(currentAisle);
        if (previousAisleIndex !== -1) {
          state.routeMetrics.aisleCrosses += 1;
          state.aisleCrossDetails.push({
            step: step + 1,
            wave: waveId,
            aisle: currentAisle,
            firstVisit: previousAisleIndex + 1,
            revisit: step + 1,
          });
        }
        state.visitedAisles[waveId].push(currentAisle);
      }
    }
  });
}

// Incrementally accumulate visit counts for heatmap to avoid blocking UI on large selections
export async function updateWaveVisits(selectedWaves, waveRoutes, heatmapData, chunkSize = 800) {
  let waveIdx = 0;
  let stepIdx = 0;

  return new Promise((resolve) => {
    function processChunk() {
      let processed = 0;
      while (waveIdx < selectedWaves.length && processed < chunkSize) {
        const waveId = selectedWaves[waveIdx];
        const route = waveRoutes[waveId];
        if (!route || route.length === 0) {
          waveIdx += 1;
          stepIdx = 0;
          continue;
        }

        const step = route[stepIdx];
        heatmapData[step.location] = (heatmapData[step.location] || 0) + 1;
        step.shelf.visitCount = heatmapData[step.location];
        step.shelf.isOnRoute = true;

        processed += 1;
        stepIdx += 1;
        if (stepIdx >= route.length) {
          waveIdx += 1;
          stepIdx = 0;
        }
      }

      if (waveIdx < selectedWaves.length) {
        setTimeout(processChunk, 0);
      } else {
        resolve();
      }
    }

    processChunk();
  });
}

export function getPathColor(idx) {
  return PATH_COLORS[idx % PATH_COLORS.length];
}

// 格式化时间（秒 -> 分:秒 或 时:分:秒）
export function formatTime(seconds) {
  if (!seconds || seconds === 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

// 计算单个波次的所有指标
export function calculateWaveMetrics(waveId, waveRoutes, aisles, shelves) {
  const route = waveRoutes[waveId];
  if (!route || route.length === 0) {
    return {
      waveId,
      units: 0,
      totalDistance: 0,
      totalTimeSeconds: 0,
      locationCrosses: 0,
      locationCrossesBay: 0,
      aisleCrosses: 0,
      avgTimePerUnit: 0,
      pickSpeed: 0
    };
  }

  let totalDistance = 0;
  let totalTimeSeconds = 0;
  let locationCrosses = 0;
  let locationCrossesBay = 0;
  let aisleCrosses = 0;

  const visitedLocations = [];
  const visitedBays = [];
  const visitedAisles = [];

  for (let i = 0; i < route.length; i++) {
    const currentStep = route[i];
    const currentLoc = currentStep.location;
    const currentBayLoc = currentStep.bayLocation || truncateToBayLevel(currentLoc);
    const currentAisle = currentStep.aisle;

    // 距离计算
    if (i > 0) {
      const prevStep = route[i - 1];
      const aislePath = findAislePath(prevStep.shelf, currentStep.shelf, aisles, shelves);
      let segmentDistanceCm = 0;
      let lastPoint = { x: prevStep.shelf.x, y: prevStep.shelf.y };
      for (const waypoint of aislePath) {
        segmentDistanceCm += Math.abs(waypoint.x - lastPoint.x) + Math.abs(waypoint.y - lastPoint.y);
        lastPoint = waypoint;
      }
      segmentDistanceCm += Math.abs(currentStep.shelf.x - lastPoint.x) + Math.abs(currentStep.shelf.y - lastPoint.y);
      totalDistance += segmentDistanceCm / 100;

      // 时间计算
      const currentTime = new Date(currentStep.time);
      const prevTime = new Date(prevStep.time);
      if (!isNaN(currentTime.getTime()) && !isNaN(prevTime.getTime())) {
        const timeDiff = (currentTime - prevTime) / 1000;
        if (timeDiff > 0 && timeDiff < 3600) {
          totalTimeSeconds += timeDiff;
        }
      }
    }

    // Slot级别回头草
    if (currentLoc) {
      const lastLoc = visitedLocations.length > 0 ? visitedLocations[visitedLocations.length - 1] : null;
      if (currentLoc !== lastLoc) {
        if (visitedLocations.includes(currentLoc)) {
          locationCrosses++;
        }
      }
      visitedLocations.push(currentLoc);
    }

    // Shelf/Bay级别回头草
    const lastBay = visitedBays.length > 0 ? visitedBays[visitedBays.length - 1] : null;
    if (currentBayLoc !== lastBay) {
      if (visitedBays.includes(currentBayLoc)) {
        locationCrossesBay++;
      }
      visitedBays.push(currentBayLoc);
    }

    // Aisle级别回头草
    if (currentAisle) {
      const lastAisle = visitedAisles.length > 0 ? visitedAisles[visitedAisles.length - 1] : null;
      if (currentAisle !== lastAisle) {
        if (visitedAisles.includes(currentAisle)) {
          aisleCrosses++;
        }
        visitedAisles.push(currentAisle);
      }
    }
  }

  const avgTimePerUnit = totalTimeSeconds > 0 ? totalTimeSeconds / route.length : 0;
  const pickSpeed = totalTimeSeconds > 0 ? (route.length / totalTimeSeconds) * 60 : 0;

  return {
    waveId,
    units: route.length,
    totalDistance,
    totalTimeSeconds,
    locationCrosses,
    locationCrossesBay,
    aisleCrosses,
    avgTimePerUnit,
    pickSpeed
  };
}

// 计算增强指标（P0 + P1）
export function calculateEnhancedMetrics(routeMetrics, totalUnits, optimalDistance = 0) {
  const totalTimeHours = routeMetrics.totalTimeSeconds / 3600;
  const totalTimeMinutes = routeMetrics.totalTimeSeconds / 60;

  // P0: Core Efficiency Metrics
  const pickRate = totalTimeHours > 0 ? (totalUnits / totalTimeHours) : 0;
  const distancePerUnit = totalUnits > 0 ? (routeMetrics.totalDistance / totalUnits) : 0;
  const pathEfficiency = optimalDistance > 0 && routeMetrics.totalDistance > 0
    ? ((optimalDistance / routeMetrics.totalDistance) * 100)
    : 0;

  // P1: Quality Metrics
  const travelSpeed = totalTimeMinutes > 0 ? (routeMetrics.totalDistance / totalTimeMinutes) : 0;
  const wastedDistance = Math.max(0, routeMetrics.totalDistance - optimalDistance);
  const totalRevisits = (routeMetrics.locationCrosses || 0) +
                        (routeMetrics.locationCrossesBay || 0) +
                        (routeMetrics.aisleCrosses || 0);
  const revisitRate = totalUnits > 0 ? (totalRevisits / totalUnits * 100) : 0;

  return {
    // P0
    pickRate,
    distancePerUnit,
    pathEfficiency,
    // P1
    travelSpeed,
    wastedDistance,
    revisitRate,
    // 内部使用
    optimalDistance
  };
}

// 计算24小时分时段pick数据
export function calculateHourlyPickData(selectedWaves, waveRoutes) {
  const hourlyData = Array(24).fill(0); // 0-23小时

  selectedWaves.forEach((waveId) => {
    const route = waveRoutes[waveId];
    if (!route) return;

    route.forEach((step) => {
      if (step.timestamp) {
        const date = new Date(step.timestamp);
        const hour = date.getHours();
        if (hour >= 0 && hour < 24) {
          hourlyData[hour]++;
        }
      }
    });
  });

  return hourlyData;
}
