// Hourly Performance Chart Rendering

let chartCanvas = null;
let chartCtx = null;

export function initChart() {
  chartCanvas = document.getElementById('hourlyChart');
  if (!chartCanvas) return;

  chartCtx = chartCanvas.getContext('2d');

  // Set canvas size based on container
  const container = chartCanvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();

  chartCanvas.width = rect.width * dpr;
  chartCanvas.height = rect.height * dpr;
  chartCanvas.style.width = rect.width + 'px';
  chartCanvas.style.height = rect.height + 'px';

  chartCtx.scale(dpr, dpr);
}

// 绘制平滑曲线图
export function drawHourlyChart(hourlyData, startHour, endHour) {
  if (!chartCtx || !chartCanvas) return;

  const container = chartCanvas.parentElement;
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Clear canvas
  chartCtx.clearRect(0, 0, width, height);

  // Filter data based on time range
  const filteredData = hourlyData.slice(startHour, endHour + 1);
  const maxValue = Math.max(...filteredData, 1);

  // Calculate average
  const sum = filteredData.reduce((a, b) => a + b, 0);
  const avg = filteredData.length > 0 ? sum / filteredData.length : 0;

  // Chart dimensions
  const padding = { top: 20, right: 30, bottom: 40, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Draw background grid
  drawGrid(chartCtx, padding, chartWidth, chartHeight, maxValue);

  // Draw average line
  const avgY = padding.top + chartHeight - (avg / maxValue) * chartHeight;
  chartCtx.strokeStyle = 'rgba(241, 196, 15, 0.6)';
  chartCtx.lineWidth = 2;
  chartCtx.setLineDash([5, 5]);
  chartCtx.beginPath();
  chartCtx.moveTo(padding.left, avgY);
  chartCtx.lineTo(padding.left + chartWidth, avgY);
  chartCtx.stroke();
  chartCtx.setLineDash([]);

  // Draw average label
  chartCtx.fillStyle = 'rgba(241, 196, 15, 0.9)';
  chartCtx.font = '11px sans-serif';
  chartCtx.fillText(`Avg: ${avg.toFixed(1)}`, padding.left + chartWidth + 5, avgY + 4);

  // Draw smooth curve
  drawSmoothCurve(chartCtx, filteredData, padding, chartWidth, chartHeight, maxValue, startHour);

  // Draw axes labels
  drawAxesLabels(chartCtx, padding, chartWidth, chartHeight, startHour, endHour, maxValue);

  return avg;
}

function drawGrid(ctx, padding, chartWidth, chartHeight, maxValue) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;

  // Horizontal grid lines
  const horizontalLines = 5;
  for (let i = 0; i <= horizontalLines; i++) {
    const y = padding.top + (chartHeight / horizontalLines) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartWidth, y);
    ctx.stroke();
  }

  // Vertical grid lines (every 2 hours)
  const verticalLines = 12;
  for (let i = 0; i <= verticalLines; i++) {
    const x = padding.left + (chartWidth / verticalLines) * i;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.stroke();
  }
}

function drawSmoothCurve(ctx, data, padding, chartWidth, chartHeight, maxValue, startHour) {
  if (data.length === 0) return;

  const stepX = chartWidth / Math.max(data.length - 1, 1);

  // Create control points for smooth curve
  const points = data.map((value, index) => ({
    x: padding.left + index * stepX,
    y: padding.top + chartHeight - (value / maxValue) * chartHeight
  }));

  // Draw gradient fill
  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
  gradient.addColorStop(0, 'rgba(102, 126, 234, 0.3)');
  gradient.addColorStop(1, 'rgba(102, 126, 234, 0.05)');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(points[0].x, padding.top + chartHeight);
  ctx.lineTo(points[0].x, points[0].y);

  // Draw smooth curve using cardinal spline
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }

  ctx.lineTo(points[points.length - 1].x, padding.top + chartHeight);
  ctx.closePath();
  ctx.fill();

  // Draw line stroke
  ctx.strokeStyle = '#667eea';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }

  ctx.stroke();

  // Draw data points
  ctx.fillStyle = '#667eea';
  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawAxesLabels(ctx, padding, chartWidth, chartHeight, startHour, endHour, maxValue) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';

  // X-axis labels (hours)
  const hourRange = endHour - startHour + 1;
  const labelStep = Math.ceil(hourRange / 12); // Show ~12 labels

  for (let i = 0; i <= hourRange; i += labelStep) {
    const hour = startHour + i;
    if (hour > endHour) break;

    const x = padding.left + (i / Math.max(hourRange - 1, 1)) * chartWidth;
    const label = `${hour.toString().padStart(2, '0')}:00`;
    ctx.fillText(label, x, padding.top + chartHeight + 20);
  }

  // Y-axis labels (pick counts)
  ctx.textAlign = 'right';
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const value = (maxValue / ySteps) * (ySteps - i);
    const y = padding.top + (chartHeight / ySteps) * i;
    ctx.fillText(Math.round(value).toString(), padding.left - 10, y + 4);
  }

  // Axis titles
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Hour of Day', padding.left + chartWidth / 2, padding.top + chartHeight + 35);

  ctx.save();
  ctx.translate(15, padding.top + chartHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Pick Count', 0, 0);
  ctx.restore();
}

export function resizeChart() {
  if (chartCanvas) {
    initChart();
  }
}
