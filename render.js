import { getHeatmapColor, getPathColor, findAislePath } from './services.js';

export function initCanvas(state, handlers) {
  state.canvas = document.getElementById('mapCanvas');
  if (!state.canvas) {
    console.error('mapCanvas element not found');
    return false;
  }
  state.ctx = state.canvas.getContext?.('2d');
  if (!state.ctx) {
    console.error('Canvas context not available');
    return false;
  }
  state.canvas.width = state.canvas.parentElement.clientWidth;
  state.canvas.height = 700;

  state.canvas.addEventListener('mousemove', handlers.handleMouseMove);
  state.canvas.addEventListener('click', handlers.handleClick);
  state.canvas.addEventListener('mousedown', handlers.startDrag);
  state.canvas.addEventListener('mouseup', handlers.endDrag);
  state.canvas.addEventListener('mouseleave', handlers.endDrag);
  state.canvas.addEventListener('wheel', handlers.handleWheel, { passive: false });
  return true;
}

/**
 * Draw semi-transparent colored backgrounds for each zone
 */
function drawZoneBackgrounds(ctx, filteredShelves, canvas, padding, minX, minY, baseScale, offsetX, offsetY) {
  // Group shelves by zone
  const zoneGroups = {};
  filteredShelves.forEach((shelf) => {
    if (!shelf.zone) return;
    if (!zoneGroups[shelf.zone]) zoneGroups[shelf.zone] = [];
    zoneGroups[shelf.zone].push(shelf);
  });

  // Color palette for zones (semi-transparent)
  const zonePalette = [
    'rgba(31, 119, 180, 0.5)',   // Blue
    'rgba(255, 127, 14, 0.5)',   // Orange
    'rgba(44, 160, 44, 0.5)',    // Green
    'rgba(214, 39, 40, 0.5)',    // Red
    'rgba(148, 103, 189, 0.5)',  // Purple
    'rgba(140, 86, 75, 0.5)',    // Brown
    'rgba(227, 119, 194, 0.5)',  // Pink
    'rgba(127, 127, 127, 0.5)',  // Gray
    'rgba(188, 189, 34, 0.5)',   // Olive
    'rgba(23, 190, 207, 0.5)',   // Cyan
  ];

  // Draw each zone's background
  Object.entries(zoneGroups).forEach(([zone, shelves], idx) => {
    // Calculate zone bounding box
    const zoneXs = shelves.map((s) => s.x);
    const zoneYs = shelves.map((s) => s.y);
    const zoneMinX = Math.min(...zoneXs);
    const zoneMaxX = Math.max(...zoneXs);
    const zoneMinY = Math.min(...zoneYs);
    const zoneMaxY = Math.max(...zoneYs);

    // Add padding around zone
    const zonePadding = 30 * baseScale;

    // Convert to screen coordinates
    const screenX1 = canvas.width - padding - (zoneMaxX - minX) * baseScale + offsetX - zonePadding;
    const screenY1 = padding + (zoneMinY - minY) * baseScale + offsetY - zonePadding;
    const screenX2 = canvas.width - padding - (zoneMinX - minX) * baseScale + offsetX + zonePadding;
    const screenY2 = padding + (zoneMaxY - minY) * baseScale + offsetY + zonePadding;

    const rectX = Math.min(screenX1, screenX2);
    const rectY = Math.min(screenY1, screenY2);
    const rectW = Math.abs(screenX2 - screenX1);
    const rectH = Math.abs(screenY2 - screenY1);

    // Draw background rectangle
    ctx.fillStyle = zonePalette[idx % zonePalette.length];
    ctx.fillRect(rectX, rectY, rectW, rectH);

    // Draw zone label (optional - can be enabled if needed)
    ctx.font = `${14 * Math.min(baseScale, 1.5)}px Arial`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`Zone: ${zone}`, rectX + rectW / 2, rectY + 10);
  });
}

export function drawMap(state) {
  const { ctx, canvas, filteredShelves, offsetX, offsetY, displayMode } = state;
  if (!ctx || !canvas) return;

  // Background changes with zone toggle
  const backgroundColor = state.showZones ? '#ffffff' : '#0d0d1a';
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Keep wrapper in sync with canvas background
  if (canvas.parentElement) {
    canvas.parentElement.style.background = backgroundColor;
  }

  if (filteredShelves.length === 0) return;

  const xs = filteredShelves.map((s) => s.x);
  const ys = filteredShelves.map((s) => s.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const padding = 40;
  const scaleX = (canvas.width - padding * 2) / rangeX;
  const scaleY = (canvas.height - padding * 2) / rangeY;
  const baseScale = Math.min(scaleX, scaleY) * state.scale;

  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const x = padding + ((canvas.width - padding * 2) * i) / 10;
    const y = padding + ((canvas.height - padding * 2) * i) / 10;
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, canvas.height - padding);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(canvas.width - padding, y);
    ctx.stroke();
  }

  filteredShelves.forEach((shelf) => {
    shelf.screenX = canvas.width - padding - (shelf.x - minX) * baseScale + offsetX;
    shelf.screenY = padding + (shelf.y - minY) * baseScale + offsetY;
    const w = 50 * baseScale;
    const h = 160 * baseScale;
    shelf.rectX = shelf.screenX - w / 2;
    shelf.rectY = shelf.screenY - h / 2;
    shelf.rectW = w;
    shelf.rectH = h;
  });

  // Draw zone backgrounds if enabled
  if (state.showZones) {
    drawZoneBackgrounds(ctx, filteredShelves, canvas, padding, minX, minY, baseScale, offsetX, offsetY);
  }

  if (displayMode === 'route') {
    const minXVal = Math.min(...filteredShelves.map((s) => s.x));
    const minYVal = Math.min(...filteredShelves.map((s) => s.y));
    state.selectedWaves.forEach((waveId, idx) => {
      const path = state.visitedPaths[waveId];
      if (!path || path.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = getPathColor(idx);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.8;
      // 从第一个货架中心开始
      let lastX = path[0].x;
      let lastY = path[0].y;
      ctx.moveTo(path[0].screenX, path[0].screenY);

      for (let i = 1; i < path.length; i++) {
        const prev = path[i - 1];
        const curr = path[i];
        const aislePath = findAislePath(
          prev,
          curr,
          {
            verticalAisles: state.verticalAisles,
            horizontalAisles: state.horizontalAisles,
          },
          state.shelves,
        );

        // 绘制通道路径
        for (const waypoint of aislePath) {
          const screenPos = {
            screenX: canvas.width - padding - (waypoint.x - minXVal) * baseScale + offsetX,
            screenY: padding + (waypoint.y - minYVal) * baseScale + offsetY,
          };
          ctx.lineTo(screenPos.screenX, screenPos.screenY);
          lastX = waypoint.x;
          lastY = waypoint.y;
        }

        // 从最后一个通道点到货架：先水平再垂直（L形），避免穿过货架
        if (aislePath.length > 0) {
          // 先保持 Y 不变，水平移动到货架的 X 坐标
          const horizontalPoint = {
            screenX: canvas.width - padding - (curr.x - minXVal) * baseScale + offsetX,
            screenY: padding + (lastY - minYVal) * baseScale + offsetY,
          };
          ctx.lineTo(horizontalPoint.screenX, horizontalPoint.screenY);
        }

        // 最后垂直移动到货架中心
        ctx.lineTo(curr.screenX, curr.screenY);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  filteredShelves.forEach((shelf) => {
    let color = '#667eea';
    if (displayMode === 'heatmap' && shelf.visitCount > 0) color = getHeatmapColor(shelf.visitCount, state.heatmapData);
    else if (displayMode === 'route') {
      if (shelf.isOnRoute) color = '#ff6b6b';
      if (shelf.highlighted) color = '#2ecc71';
      if (shelf.isCurrent) color = '#00bcd4';
    }
    if (shelf === state.selectedShelf) color = '#ffd700';
    else if (shelf === state.hoveredShelf) color = '#9b59b6';

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.rect(shelf.rectX, shelf.rectY, shelf.rectW, shelf.rectH);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  if (displayMode === 'route') {
    // 绘制回头草标记
    state.selectedWaves.forEach((waveId, idx) => {
      const path = state.visitedPaths[waveId];
      if (!path || path.length === 0) return;

      // 绘制Slot级别回头草（红色）
      const slotRevisits = state.locationCrossDetails.filter(d => d.wave === waveId);
      slotRevisits.forEach(revisit => {
        const shelf = filteredShelves.find(s => s.location === revisit.location || s.aisleBay === revisit.location);
        if (shelf && shelf.screenX) {
          drawRevisitMarker(ctx, shelf.screenX, shelf.screenY, '#e74c3c', 'S');

          // 绘制虚线连接：首次访问 → 回访
          const firstVisitShelf = path[revisit.firstVisit - 1];
          if (firstVisitShelf && firstVisitShelf.screenX) {
            drawDashedArc(ctx, firstVisitShelf.screenX, firstVisitShelf.screenY, shelf.screenX, shelf.screenY, '#e74c3c');
          }
        }
      });

      // 绘制Shelf（Bay-level）回头草（橙色）
      const bayRevisits = state.locationCrossBayDetails.filter(d => d.wave === waveId);
      bayRevisits.forEach(revisit => {
        const shelf = filteredShelves.find(s => {
          const bayLoc = s.location ? s.location.split('-').slice(0, 2).join('-') : s.aisleBay;
          return bayLoc === revisit.bayLocation;
        });
        if (shelf && shelf.screenX) {
          drawRevisitMarker(ctx, shelf.screenX, shelf.screenY + 18, '#e67e22', 'B');

          const firstVisitShelf = path[revisit.firstVisit - 1];
          if (firstVisitShelf && firstVisitShelf.screenX) {
            drawDashedArc(ctx, firstVisitShelf.screenX, firstVisitShelf.screenY, shelf.screenX, shelf.screenY + 18, '#e67e22');
          }
        }
      });

      // 绘制Aisle级别回头草（黄色）
      const aisleRevisits = state.aisleCrossDetails.filter(d => d.wave === waveId);
      aisleRevisits.forEach(revisit => {
        const shelf = filteredShelves.find(s => String(s.aisle) === String(revisit.aisle));
        if (shelf && shelf.screenX) {
          drawRevisitMarker(ctx, shelf.screenX, shelf.screenY - 18, '#f1c40f', 'A');

          const firstVisitShelf = path[revisit.firstVisit - 1];
          if (firstVisitShelf && firstVisitShelf.screenX) {
            drawDashedArc(ctx, firstVisitShelf.screenX, firstVisitShelf.screenY, shelf.screenX, shelf.screenY - 18, '#f1c40f');
          }
        }
      });
    });

    // 绘制拣货员图标
    state.selectedWaves.forEach((waveId, idx) => {
      const path = state.visitedPaths[waveId];
      if (!path || path.length === 0) return;
      const shelf = path[path.length - 1];
      if (!shelf) return;
      drawPicker(ctx, shelf.screenX, shelf.screenY, getPathColor(idx), waveId);
    });
  }
}

export function drawPicker(ctx, x, y, color, label) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y - 18, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - 11);
  ctx.lineTo(x, y + 3);
  ctx.moveTo(x - 8, y - 4);
  ctx.lineTo(x + 8, y - 4);
  ctx.moveTo(x, y + 3);
  ctx.lineTo(x - 6, y + 16);
  ctx.moveTo(x, y + 3);
  ctx.lineTo(x + 6, y + 16);
  ctx.stroke();
  ctx.font = 'bold 10px "Segoe UI"';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(label.substring(0, 10), x, y - 28);
}

// 绘制回头草标记
export function drawRevisitMarker(ctx, x, y, color, label) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;

  // 绘制圆形标记
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 绘制字母标签
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);

  ctx.restore();
}

// 绘制虚线弧线连接
export function drawDashedArc(ctx, x1, y1, x2, y2, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.globalAlpha = 0.5;

  // 计算控制点（让弧线向上弯曲）
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2 - 40;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(midX, midY, x2, y2);
  ctx.stroke();

  ctx.restore();
}

export function showTooltip(x, y, shelf, displayMode, heatmapData) {
  const tooltip = document.getElementById('tooltip');
  tooltip.innerHTML = `
    <div class="tooltip-title">${shelf.aisleBay || shelf.location || 'N/A'}</div>
    <div class="tooltip-row"><span class="tooltip-label">Aisle:</span><span class="tooltip-value">${shelf.aisle || '-'}</span></div>
    <div class="tooltip-row"><span class="tooltip-label">Zone:</span><span class="tooltip-value">${shelf.zone || '-'}</span></div>
    ${
      displayMode === 'heatmap' && shelf.visitCount > 0
        ? `<div class="tooltip-row"><span class="tooltip-label">Visits:</span><span class="tooltip-value" style="color:#e74c3c;">${shelf.visitCount}</span></div>`
        : ''
    }
  `;
  tooltip.style.left = x + 10 + 'px';
  tooltip.style.top = y + 10 + 'px';
  tooltip.style.display = 'block';
}

export function hideTooltip() {
  document.getElementById('tooltip').style.display = 'none';
}

export function showInfoPanel(shelf) {
  const panel = document.getElementById('infoPanel');
  document.getElementById('infoContent').innerHTML = `
    <div class="info-section">
        <h3>Basic Info</h3>
        <div class="info-row"><span class="info-label">Aisle:</span><span class="info-value">${shelf.aisle || '-'}</span></div>
        <div class="info-row"><span class="info-label">Bay:</span><span class="info-value">${shelf.bay || '-'}</span></div>
        <div class="info-row"><span class="info-label">Zone:</span><span class="info-value">${shelf.zone || '-'}</span></div>
        <div class="info-row"><span class="info-label">Location:</span><span class="info-value">${shelf.location || '-'}</span></div>
    </div>
    <div class="info-section">
        <h3>Position</h3>
        <div class="info-row"><span class="info-label">Row:</span><span class="info-value">${shelf.row}</span></div>
        <div class="info-row"><span class="info-label">Column:</span><span class="info-value">${shelf.column}</span></div>
        <div class="info-row"><span class="info-label">X:</span><span class="info-value">${shelf.x.toFixed(2)}</span></div>
        <div class="info-row"><span class="info-label">Y:</span><span class="info-value">${shelf.y.toFixed(2)}</span></div>
    </div>
    ${
      shelf.visitCount > 0
        ? `<div class="info-section"><h3>Statistics</h3><div class="info-row"><span class="info-label">Visit Count:</span><span class="info-value" style="color:#e74c3c;">${shelf.visitCount}</span></div></div>`
        : ''
    }
  `;
  panel.classList.add('active');
}

export function closeInfoPanel() {
  document.getElementById('infoPanel').classList.remove('active');
}

export function showDetailModal(type, locationCrossDetails, aisleCrossDetails) {
  const modal = document.getElementById('detailModal');
  const title = document.getElementById('modalTitle');
  const list = document.getElementById('detailList');

  if (type === 'location') {
    title.textContent = `Slot Revisit (${locationCrossDetails.length})`;
    list.innerHTML =
      locationCrossDetails.length === 0
        ? '<li class="detail-item"><span>No location crosses detected</span></li>'
        : locationCrossDetails
            .map(
              (d) => `
                <li class="detail-item">
                    <span class="detail-item-left">Step ${d.revisit}: ${d.wave}</span>
                    <span class="detail-item-right">🔁 ${d.location} (first visit: step ${d.firstVisit})</span>
                </li>
            `,
            )
            .join('');
  } else if (type === 'locationBay') {
    title.textContent = `Shelf Revisit (${locationCrossDetails.length})`;
    list.innerHTML =
      locationCrossDetails.length === 0
        ? '<li class="detail-item"><span>No shelf-level crosses detected</span></li>'
        : locationCrossDetails
            .map(
              (d) => `
                <li class="detail-item">
                    <span class="detail-item-left">Step ${d.revisit}: ${d.wave}</span>
                    <span class="detail-item-right">🔁 Shelf ${d.bayLocation} (first visit: step ${d.firstVisit})</span>
                </li>
            `,
            )
            .join('');
  } else {
    title.textContent = `Aisle Revisit (${aisleCrossDetails.length})`;
    list.innerHTML =
      aisleCrossDetails.length === 0
        ? '<li class="detail-item"><span>No aisle crosses detected</span></li>'
        : aisleCrossDetails
            .map(
              (d) => `
                <li class="detail-item">
                    <span class="detail-item-left">Step ${d.revisit}: ${d.wave}</span>
                    <span class="detail-item-right">🔁 Aisle ${d.aisle} (first visit: step ${d.firstVisit})</span>
                </li>
            `,
            )
            .join('');
  }
  modal.classList.add('show');
}

export function closeModal() {
  document.getElementById('detailModal').classList.remove('show');
}

export function updateLegend(displayMode, selectedWaves) {
  document.getElementById('routeLegend').style.display = displayMode === 'route' ? 'block' : 'none';
  document.getElementById('heatmapLegend').style.display = displayMode === 'heatmap' ? 'block' : 'none';
  if (displayMode === 'route' && selectedWaves.length > 0) {
    const legendItems = document.getElementById('legendItems');
    let html = `
      <div class="legend-item"><div class="legend-color" style="background:#667eea;"></div><span>Normal shelf</span></div>
      <div class="legend-item"><div class="legend-color" style="background:#ff6b6b;"></div><span>Route location</span></div>
      <div class="legend-item"><div class="legend-color" style="background:#2ecc71;"></div><span>Search match</span></div>
      <div class="legend-item"><div class="legend-color" style="background:#e74c3c;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:bold;">S</div><span>Slot Revisit</span></div>
      <div class="legend-item"><div class="legend-color" style="background:#e67e22;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:bold;">B</div><span>Shelf Revisit</span></div>
      <div class="legend-item"><div class="legend-color" style="background:#f1c40f;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:bold;">A</div><span>Aisle Revisit</span></div>
    `;
    selectedWaves.forEach((waveId, idx) => {
      html += `<div class="legend-item"><div class="legend-color" style="background:${getPathColor(idx)};"></div><span>${waveId}</span></div>`;
    });
    legendItems.innerHTML = html;
  }
}
