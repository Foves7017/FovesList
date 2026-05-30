/**
 * FovesList — 待办事项象限图
 * 
 * 从后端 /events/list 获取事件数据，
 * 以 importence（重要程度）为 X 轴、urgency（紧急程度）为 Y 轴，
 * 将每个事件绘制在 [-1, 1] × [-1, 1] 的坐标平面上。
 */

// ==================== 配置 ====================

const API_BASE_URL = 'http://localhost:23535';
const REFRESH_INTERVAL_MS = 30_000;  // 自动刷新间隔（毫秒），0 表示禁用

// ==================== DOM 引用 ====================

const canvas = document.getElementById('quadrantChart');
const ctx = canvas.getContext('2d');
const statusDot = document.getElementById('statusIndicator');
const refreshBtn = document.getElementById('refreshBtn');
const eventCountEl = document.getElementById('eventCount');
const detailPanel = document.getElementById('detailPanel');
const dpTitle = document.getElementById('dpTitle');
const dpImportence = document.getElementById('dpImportence');
const dpUrgency = document.getElementById('dpUrgency');
const dpQuadrant = document.getElementById('dpQuadrant');
const dpDescription = document.getElementById('dpDescription');
const dpSubEvents = document.getElementById('dpSubEvents');
const dpAddSub = document.getElementById('dpAddSub');
const dpClose = document.getElementById('dpClose');

// ==================== 状态 ====================

let events = [];                     // 从后端获取的原始事件列表
let eventPositions = [];             // 每个事件在 canvas 上的绘制坐标 { x, y, event }
let hoveredIndex = -1;               // 当前悬停的事件索引，-1 表示无
let selectedIndex = -1;              // 当前点选的事件索引，-1 表示无
let selectedEvent = null;            // 当前选中的完整事件对象（用于编辑）
let dpr = window.devicePixelRatio || 1;

// 拖拽状态
let draggingIndex = -1;              // 正在拖拽的点索引，-1 表示无
let isDragging = false;              // 是否已经进入拖拽模式
let dragStartCanvasX = 0;            // 拖拽起始 Canvas X
let dragStartCanvasY = 0;            // 拖拽起始 Canvas Y
let dragStartImportence = 0;         // 拖拽起始重要程度
let dragStartUrgency = 0;            // 拖拽起始紧急程度
const DRAG_THRESHOLD = 4;            // 移动超过此像素数才进入拖拽模式
let chartColors = {};                // 从 CSS 变量读取的 Canvas 配色，随主题切换更新

// 卫星动画
let satelliteAngles = {};            // { title: { angles[], dists[], speed } }
let labelAlphas = {};                // { title: currentAlpha } — 标签透明度动画
const LABEL_ALPHA_IDLE = 0.5;        // 非悬停标签透明度
const LABEL_ALPHA_HOVER = 1.0;       // 悬停标签透明度
const LABEL_ALPHA_SPEED = 3.0;       // 过渡速度（每秒变化量）
let lastFrameTime = 0;

// ==================== 工具函数 ====================

/** 将 importence / urgency 映射到 canvas 像素坐标 */
function toCanvasCoord(value, min, max) {
    const clamped = Math.max(-1, Math.min(1, value));
    return min + (clamped + 1) / 2 * (max - min);
}

/** 判断某个象限 */
function getQuadrant(importence, urgency) {
    if (importence >= 0 && urgency >= 0) return 1;  // 重要且紧急
    if (importence <  0 && urgency >= 0) return 2;  // 紧急不重要
    if (importence <  0 && urgency <  0) return 3;  // 不重要不紧急
    return 4;                                        // 重要不紧急
}

/** 获取象限对应的点颜色 */
function getDotColor(quadrant) {
    const map = {
        1: '#ff6b6b',
        2: '#ffb84d',
        3: '#9696aa',
        4: '#4da6ff',
    };
    return map[quadrant] || '#ccc';
}

/** 格式化浮点数 */
function fmt(v) {
    return Number(v).toFixed(2);
}

/** 简单字符串哈希 → 稳定伪随机种子 */
function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
    }
    return h;
}

/** 基于种子的伪随机数（0~1），给定相同 seed 始终返回相同值 */
function seededRand(seed) {
    const x = Math.sin(seed) * 43758.5453;
    return x - Math.floor(x);
}

// ==================== 数据获取 ====================

async function fetchEvents() {
    try {
        setStatus('loading');
        const resp = await fetch(`${API_BASE_URL}/events/list`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        events = Array.isArray(data) ? data : [];
        setStatus('online');
        return true;
    } catch (err) {
        console.warn('获取事件失败:', err.message);
        setStatus('offline');
        return false;
    }
}

function setStatus(state) {
    statusDot.className = 'status-dot ' + state;
}

// ==================== 绘制 ====================

function setupCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    return { w, h };
}

function draw() {
    const { w, h } = setupCanvas();
    const padding = 70;                   // 四周留白
    const axisExtend = 16;                // 坐标轴超出量
    const plotLeft = padding;
    const plotRight = w - padding;
    const plotTop = padding;
    const plotBottom = h - padding;
    const plotW = plotRight - plotLeft;
    const plotH = plotBottom - plotTop;
    const cx = (plotLeft + plotRight) / 2;  // 原点（canvas 坐标）
    const cy = (plotTop + plotBottom) / 2;

    // 坐标轴延伸后的端点
    const axisLeft  = plotLeft - axisExtend;
    const axisRight = plotRight + axisExtend;
    const axisTop   = plotTop - axisExtend;
    const axisBottom = plotBottom + axisExtend;

    ctx.clearRect(0, 0, w, h);

    // 从 CSS 变量读取当前主题的 Canvas 配色
    const style = getComputedStyle(document.documentElement);
    const isDark = !window.matchMedia('(prefers-color-scheme: light)').matches;

    // fallback：如果 CSS 变量读取失败，用硬编码兜底
    function readColor(varName, darkFallback, lightFallback) {
        const val = style.getPropertyValue(varName).trim();
        if (val && val !== '') return val;
        return isDark ? darkFallback : lightFallback;
    }

    chartColors = {
        grid:          readColor('--chart-grid',           'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.06)'),
        axis:          readColor('--chart-axis',           'rgba(255,255,255,0.35)', 'rgba(0,0,0,0.25)'),
        tick:          readColor('--chart-tick',           'rgba(255,255,255,0.2)',  'rgba(0,0,0,0.15)'),
        label:         readColor('--chart-label',          'rgba(255,255,255,0.5)',  'rgba(0,0,0,0.45)'),
        quadrantLabel: readColor('--chart-quadrant-label', 'rgba(255,255,255,0.22)', 'rgba(0,0,0,0.18)'),
        dotStroke:     readColor('--chart-dot-stroke',     'rgba(255,255,255,0.5)',  'rgba(0,0,0,0.3)'),
        titleText:     readColor('--chart-title-text',     'rgba(255,255,255,0.85)', 'rgba(0,0,0,0.8)'),
        titleBg:       readColor('--chart-title-bg',       'rgba(15,15,26,0.75)',    'rgba(255,255,250,0.85)'),
        titleFilled:   readColor('--chart-title-filled',   'rgba(255,255,255,0.9)',  'rgba(0,0,0,0.85)'),
        hoverRing:     readColor('--chart-hover-ring',     '#fff',                   '#333'),
        quadrantBgAlpha: parseFloat(style.getPropertyValue('--chart-quadrant-bg-alpha').trim()) || (isDark ? 0.10 : 0.07),
    };

    // --- 象限背景（模糊边缘） ---
    drawQuadrantBackgrounds(cx, cy, plotLeft, plotRight, plotTop, plotBottom);

    // --- 网格线 ---
    drawGrid(cx, cy, plotLeft, plotRight, plotTop, plotBottom);

    // --- 坐标轴（延伸） ---
    drawAxes(cx, cy, axisLeft, axisRight, axisTop, axisBottom);

    // --- 刻度（仅短线，无数字） ---
    drawTicks(cx, cy, plotLeft, plotRight, plotTop, plotBottom);

    // --- 象限文字 & 方向箭头 ---
    drawQuadrantLabels(cx, cy, plotLeft, plotRight, plotTop, plotBottom, axisLeft, axisRight, axisTop, axisBottom);

    // --- 事件点 ---
    eventPositions = [];
    for (const ev of events) {
        const imp = ev._dragImportence !== undefined ? ev._dragImportence : ev.importence;
        const urg = ev._dragUrgency   !== undefined ? ev._dragUrgency   : ev.urgency;
        const ex = toCanvasCoord(imp, plotLeft, plotRight);
        const ey = toCanvasCoord(urg, plotBottom, plotTop); // Y 翻转：urgency 高 → 上方
        eventPositions.push({ x: ex, y: ey, event: ev });
        drawEventPoint(ex, ey, ev, isDark);
    }

    // --- 悬停高亮 ---
    if (hoveredIndex >= 0 && hoveredIndex < eventPositions.length) {
        const hp = eventPositions[hoveredIndex];
        drawHoverRing(hp.x, hp.y);
    }

    // --- 选中高亮 ---
    if (selectedIndex >= 0 && selectedIndex < eventPositions.length) {
        const sp = eventPositions[selectedIndex];
        drawSelectedRing(sp.x, sp.y);
    }

    // --- 拖拽高亮 ---
    if (isDragging && draggingIndex >= 0 && draggingIndex < eventPositions.length) {
        const dp = eventPositions[draggingIndex];
        drawDragRing(dp.x, dp.y);
    }
}

/** 四个象限的半透明纯色背景 */
function drawQuadrantBackgrounds(cx, cy, l, r, t, b) {
    const qDefs = [
        null,
        { color: [255,107,107], from: [cx, cy], to: [r, t]   },  // Q1 右上
        { color: [255,184,77],  from: [cx, cy], to: [l, t]   },  // Q2 左上
        { color: [150,150,170], from: [cx, cy], to: [l, b]   },  // Q3 左下
        { color: [77,166,255],  from: [cx, cy], to: [r, b]   },  // Q4 右下
    ];

    for (let q = 1; q <= 4; q++) {
        const d = qDefs[q];
        const [cr, cg, cb] = d.color;

        // 纯色象限背景
        const color = `rgba(${cr},${cg},${cb},${chartColors.quadrantBgAlpha})`;

        // 确定象限矩形范围
        const x = (q === 2 || q === 3) ? l : cx;
        const y = (q === 1 || q === 2) ? t : cy;
        const qw = (q === 2 || q === 3) ? cx - l : r - cx;
        const qh = (q === 1 || q === 2) ? cy - t : b - cy;

        ctx.fillStyle = color;
        ctx.fillRect(x, y, qw, qh);
    }
}

/** 虚线网格 */
function drawGrid(cx, cy, l, r, t, b) {
    ctx.strokeStyle = chartColors.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 10]);
    const steps = [-1, -0.5, 0, 0.5, 1];
    for (const s of steps) {
        const x = toCanvasCoord(s, l, r);
        const y = toCanvasCoord(s, b, t);
        ctx.beginPath();
        ctx.moveTo(x, t);
        ctx.lineTo(x, b);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(l, y);
        ctx.lineTo(r, y);
        ctx.stroke();
    }
    ctx.setLineDash([]);
}

/** 主轴 — 比绘图区域略长 */
function drawAxes(cx, cy, l, r, t, b) {
    ctx.strokeStyle = chartColors.axis;
    ctx.lineWidth = 1.5;

    // X 轴
    ctx.beginPath();
    ctx.moveTo(l, cy);
    ctx.lineTo(r, cy);
    ctx.stroke();
    drawArrow(r - 4, cy, 0);

    // Y 轴
    ctx.beginPath();
    ctx.moveTo(cx, b);
    ctx.lineTo(cx, t);
    ctx.stroke();
    drawArrow(cx, t + 4, -Math.PI / 2);
}

function drawArrow(x, y, angle) {
    const size = 8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = chartColors.axis;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * 0.55);
    ctx.lineTo(-size, size * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

/** 刻度短线（无数字） */
function drawTicks(cx, cy, l, r, t, b) {
    const tickLen = 4;
    const steps = [-1, -0.5, 0.5, 1];

    ctx.strokeStyle = chartColors.tick;
    ctx.lineWidth = 1;

    for (const s of steps) {
        const x = toCanvasCoord(s, l, r);
        ctx.beginPath();
        ctx.moveTo(x, cy - tickLen);
        ctx.lineTo(x, cy + tickLen);
        ctx.stroke();

        const y = toCanvasCoord(s, b, t);
        ctx.beginPath();
        ctx.moveTo(cx - tickLen, y);
        ctx.lineTo(cx + tickLen, y);
        ctx.stroke();
    }
}

/** 象限标签 + 方向箭头（无轴标签文字） */
function drawQuadrantLabels(cx, cy, l, r, t, b, al, ar, at, ab) {
    // ── 各象限标签 ──
    ctx.font = '300 11px "Maple Mono NF CN","Segoe UI","PingFang SC","Microsoft YaHei",monospace';
    ctx.fillStyle = chartColors.quadrantLabel;
    const labels = [
        null,
        { text: '重要且紧急',   x: cx + 12, y: cy - 12, align: 'left',   base: 'bottom' },
        { text: '紧急不重要',   x: cx - 12, y: cy - 12, align: 'right',  base: 'bottom' },
        { text: '不重要不紧急', x: cx - 12, y: cy + 12, align: 'right',  base: 'top' },
        { text: '重要不紧急',   x: cx + 12, y: cy + 12, align: 'left',   base: 'top' },
    ];
    for (let q = 1; q <= 4; q++) {
        const lb = labels[q];
        ctx.textAlign = lb.align;
        ctx.textBaseline = lb.base;
        ctx.fillText(lb.text, lb.x, lb.y);
    }
}

/** 绘制单个事件点 */
function drawEventPoint(ex, ey, ev, isDark) {
    const q = getQuadrant(ev.importence, ev.urgency);
    const dotColor = getDotColor(q);
    const radius = 6;

    // 外发光 —— 暗色下渐变到 transparent，亮色下融入背景避免灰影
    const glow = ctx.createRadialGradient(ex, ey, radius * 0.3, ex, ey, radius * 2.5);
    glow.addColorStop(0, dotColor);
    glow.addColorStop(1, isDark ? 'transparent' : chartColors.titleBg); // 虽然这里逻辑看起来很怪，但如果只用 transparent 会导致亮色下出现灰影，只用 titleBg 会导致暗色下外发光有一圈黑边
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ex, ey, radius * 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 实心点
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(ex, ey, radius, 0, Math.PI * 2);
    ctx.fill();

    // 白边
    ctx.strokeStyle = chartColors.dotStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ── 子任务卫星 ──
    const activeSubs = ev.sub_event ? ev.sub_event.filter(s => !/^~.*~$/.test(s)) : [];
    const subCount = activeSubs.length;
    if (subCount > 0) {
        const subRadius = 2.5;
        const minDist = 14;
        const maxDist = 22;
        const baseSeed = hashString(ev.title);

        // 确保卫星轨道数据存在
        if (!satelliteAngles[ev.title]) {
            const angles = [];
            const dists = [];
            for (let i = 0; i < subCount; i++) {
                const seed = baseSeed + i * 7;
                angles.push((2 * Math.PI * i) / subCount + (seededRand(seed + 1) - 0.5) * 0.6);
                dists.push(minDist + seededRand(seed + 2) * (maxDist - minDist));
            }
            satelliteAngles[ev.title] = {
                angles,
                dists,
                speed: 0.3 + seededRand(baseSeed + 99) * 0.5   // 0.3~0.8 rad/s
            };
        }

        // 如果卫星数变了（拖拽编辑后），重建
        if (satelliteAngles[ev.title].angles.length !== subCount) {
            delete satelliteAngles[ev.title];
            // 下一帧会自动重建
        } else {
            const sat = satelliteAngles[ev.title];
            for (let i = 0; i < subCount; i++) {
                const sx = ex + Math.cos(sat.angles[i]) * sat.dists[i];
                const sy = ey + Math.sin(sat.angles[i]) * sat.dists[i];

                ctx.fillStyle = dotColor + '88';
                ctx.beginPath();
                ctx.arc(sx, sy, subRadius, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // 标题文字
    const labelOffsetX = (ev.importence >= 0 ? -1 : 1) * 12;
    const labelOffsetY = (ev.urgency >= 0 ? 1 : -1) * 12;
    const labelX = ex + labelOffsetX;
    const labelY = ey + labelOffsetY;

    ctx.fillStyle = chartColors.titleText;
    ctx.font = '500 12px "Maple Mono NF CN","Segoe UI","PingFang SC","Microsoft YaHei",monospace';
    ctx.textBaseline = 'middle';
    const align = ev.importence >= 0 ? 'right' : 'left';
    ctx.textAlign = align;

    // 截断过长标题
    const maxChars = 14;
    let displayTitle = ev.title.length > maxChars
        ? ev.title.slice(0, maxChars) + '…'
        : ev.title;

    // 文字背景
    const textMetrics = ctx.measureText(displayTitle);
    const textW = textMetrics.width;
    const textH = 16;
    const padX = 6;
    const padY = 3;
    const bgX = align === 'right' ? labelX - textW - padX : labelX - padX;
    const bgY = labelY - textH / 2 - padY;

    // 标签透明度动画（平滑过渡）
    const labelAlpha = labelAlphas[ev.title] !== undefined ? labelAlphas[ev.title] : LABEL_ALPHA_IDLE;
    ctx.save();
    ctx.globalAlpha = labelAlpha;

    ctx.fillStyle = chartColors.titleBg;
    ctx.beginPath();
    ctx.roundRect(bgX, bgY, textW + padX * 2, textH + padY * 2, 5);
    ctx.fill();

    ctx.fillStyle = chartColors.titleFilled;
    ctx.fillText(displayTitle, labelX, labelY);

    ctx.restore();
}

/** 悬停高亮环 */
function drawHoverRing(ex, ey) {
    ctx.strokeStyle = chartColors.hoverRing;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.arc(ex, ey, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
}

/** 选中实线环 */
function drawSelectedRing(ex, ey) {
    ctx.strokeStyle = chartColors.hoverRing;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(ex, ey, 14, 0, Math.PI * 2);
    ctx.stroke();
}

/** 拖拽虚线环 */
function drawDragRing(ex, ey) {
    ctx.strokeStyle = chartColors.hoverRing;
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.arc(ex, ey, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
}

// ==================== 交互 ====================

/** 查找鼠标位置附近最近的事件点，返回索引或 -1 */
function hitTest(mx, my, threshold = 20) {
    let found = -1;
    let minDist = Infinity;
    for (let i = 0; i < eventPositions.length; i++) {
        const p = eventPositions[i];
        const dx = mx - p.x;
        const dy = my - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < threshold && dist < minDist) {
            found = i;
            minDist = dist;
        }
    }
    return found;
}

// 悬停：显示高亮环 + 更新 cursor（仅在非拖拽时）
canvas.addEventListener('mousemove', (e) => {
    if (isDragging) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const found = hitTest(mx, my);

    if (found !== hoveredIndex) {
        hoveredIndex = found;
        canvas.className = found >= 0 ? 'grabbable' : '';
        draw();
    }
});

canvas.addEventListener('mouseleave', () => {
    if (isDragging) return;
    if (hoveredIndex !== -1) {
        hoveredIndex = -1;
        canvas.className = '';
        draw();
    }
});

// 鼠标按下 → 可能是拖拽或点击
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const found = hitTest(mx, my);

    if (found >= 0) {
        // 记录拖拽起始信息
        draggingIndex = found;
        dragStartCanvasX = mx;
        dragStartCanvasY = my;
        dragStartImportence = events[found].importence;
        dragStartUrgency = events[found].urgency;
        isDragging = false; // 还没开始拖，等待移动超过阈值
        e.preventDefault();
    } else {
        // 点击空白 — 关闭面板
        draggingIndex = -2; // 特殊标记：空白点击
        isDragging = false;
    }
});

// 右击事件点 → 删除
canvas.addEventListener('contextmenu', async (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const found = hitTest(mx, my);
    if (found < 0) return;

    e.preventDefault();
    const ev = events[found];

    // 检查未完成子任务
    const subs = ev.sub_event || [];
    const unfinished = subs.filter(s => !/^~.*~$/.test(s));

    if (unfinished.length > 0) {
        if (!confirm(`确定删除「${ev.title}」吗？仍有 ${unfinished.length} 个未完成的子任务：\n\n${unfinished.map(s => '• ' + s).join('\n')}`)) return;
    }

    // 如果删除的是当前选中的事件，先关面板
    if (selectedEvent === ev) hideDetailPanel();

    const params = new URLSearchParams();
    params.append('title', ev.title);

    try {
        const resp = await fetch(`${API_BASE_URL}/events/delete`, {
            method: 'POST',
            body: params,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        // 从本地列表移除
        events.splice(found, 1);
        await fetchEvents();  // 全量刷新确保同步
        updateFooter();
        draw();
    } catch (err) {
        console.error('删除事件失败:', err);
        alert('删除失败：' + err.message);
    }
});

// 双击空白处 → 新建事件
canvas.addEventListener('dblclick', async (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // 命中已有事件点 → 不新建
    if (hitTest(mx, my, 20) >= 0) return;

    // 映射到 importence / urgency
    const w = rect.width;
    const h = rect.height;
    const padding = 70;
    const plotLeft = padding;
    const plotRight = w - padding;
    const plotTop = padding;
    const plotBottom = h - padding;

    let imp = (mx - plotLeft) / (plotRight - plotLeft) * 2 - 1;
    let urg = 1 - (my - plotTop) / (plotBottom - plotTop) * 2;
    imp = Math.max(-1, Math.min(1, Math.round(imp * 100) / 100));
    urg = Math.max(-1, Math.min(1, Math.round(urg * 100) / 100));

    // 生成默认标题
    let maxN = 0;
    for (const ev of events) {
        const m = ev.title.match(/^新事件 (\d+)$/);
        if (m) maxN = Math.max(maxN, parseInt(m[1]));
    }
    const title = `新事件 ${maxN + 1}`;

    const now = new Date();
    const desc = `创建于 ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

    const params = new URLSearchParams();
    params.append('title', title);
    params.append('timestamp', String(Date.now() / 1000));
    params.append('description', desc);
    params.append('importence', String(imp));
    params.append('urgency', String(urg));
    params.append('sub_event', '[]');

    try {
        const resp = await fetch(`${API_BASE_URL}/events/add`, {
            method: 'POST',
            body: params,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        // 刷新列表
        await fetchEvents();
        updateFooter();
        draw();

        // 找到刚创建的事件并打开面板
        const newEv = events.find(e => e.title === title);
        if (newEv) {
            showDetailPanel(newEv);
        }
    } catch (err) {
        console.error('创建事件失败:', err);
        alert('创建失败：' + err.message);
    }
});

// 全局 mouseup → 结束拖拽 / 处理点击
window.addEventListener('mouseup', async (e) => {
    // 空白点击 → 关闭面板
    if (draggingIndex === -2) {
        draggingIndex = -1;
        hideDetailPanel();
        // draw();
        return;
    }

    if (draggingIndex < 0) return;

    const idx = draggingIndex;
    const wasDragging = isDragging;
    const ev = events[idx];

    // 快照拖拽结果
    const finalImp = ev._dragImportence !== undefined ? ev._dragImportence : ev.importence;
    const finalUrg = ev._dragUrgency !== undefined ? ev._dragUrgency : ev.urgency;
    const startImp = dragStartImportence;
    const startUrg = dragStartUrgency;

    draggingIndex = -1;
    isDragging = false;
    canvas.className = '';

    if (wasDragging) {
        // ⚠️ 不删 _drag* — 动画循环继续用它在拖拽位置渲染
        // 等两次 save 都完成后再清理

        const savePromises = [];
        for (const [prop, val] of [['importence', finalImp], ['urgency', finalUrg]]) {
            const params = new URLSearchParams();
            params.append('title', ev.title);
            params.append('prop_name', prop);
            params.append('new_value', String(val));
            savePromises.push(
                fetch(`${API_BASE_URL}/events/update`, { method: 'POST', body: params })
                    .then(resp => { if (resp.ok) ev[prop] = val; })
            );
        }

        // 全部保存完成后，删除临时坐标 → 无缝过渡
        Promise.all(savePromises).then(() => {
            delete ev._dragImportence;
            delete ev._dragUrgency;
            draw();
        }).catch(() => {
            // 失败 → 回滚
            ev.importence = startImp;
            ev.urgency = startUrg;
            delete ev._dragImportence;
            delete ev._dragUrgency;
            draw();
        });

        // 同步面板（立刻用拖拽值）
        if (selectedEvent === ev) {
            dpImportence.textContent = fmt(finalImp);
            dpUrgency.textContent = fmt(finalUrg);
            const q = getQuadrant(finalImp, finalUrg);
            const qNames = { 1: '重要且紧急', 2: '紧急不重要', 3: '不重要不紧急', 4: '重要不紧急' };
            dpQuadrant.textContent = qNames[q];
        }
    } else {
        // 普通点击 → 立刻清理 _drag*（如果有的话）
        delete ev._dragImportence;
        delete ev._dragUrgency;
        // 没有拖拽 → 这是点击
        selectedIndex = idx;
        showDetailPanel(ev);
    }

    draw();
});

// mousemove 全局监听（拖拽阈值检测 + 拖拽坐标更新）
window.addEventListener('mousemove', (e) => {
    if (draggingIndex < 0) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (!isDragging) {
        // 尚未进入拖拽模式 — 检测阈值
        const dx = mx - dragStartCanvasX;
        const dy = my - dragStartCanvasY;
        if (Math.sqrt(dx * dx + dy * dy) <= DRAG_THRESHOLD) return;

        isDragging = true;
        canvas.className = 'grabbing';
        hideDetailPanel();
    }

    // 拖拽中：映射坐标
    const w = rect.width;
    const h = rect.height;
    const padding = 70;
    const plotLeft = padding;
    const plotRight = w - padding;
    const plotTop = padding;
    const plotBottom = h - padding;

    let newImp = (mx - plotLeft) / (plotRight - plotLeft) * 2 - 1;
    let newUrg = 1 - (my - plotTop) / (plotBottom - plotTop) * 2;
    newImp = Math.max(-1, Math.min(1, newImp));
    newUrg = Math.max(-1, Math.min(1, newUrg));

    const ev = events[draggingIndex];
    ev._dragImportence = newImp;
    ev._dragUrgency = newUrg;
    draw();
});

// 关闭按钮
dpClose.addEventListener('click', (e) => {
    e.stopPropagation();
    hideDetailPanel();
});

// 点击页面任意空白处关闭面板（header、footer、容器留白等）
document.addEventListener('click', (e) => {
    if (!canvas.contains(e.target) && !detailPanel.contains(e.target)) {
        hideDetailPanel();
    }
});

// 子任务点击 → 切换完成状态
dpSubEvents.addEventListener('click', (e) => {
    const li = e.target.closest('.dp-sub-item');
    if (!li || !selectedEvent) return;
    const subIdx = Array.from(dpSubEvents.children).indexOf(li);
    if (subIdx < 0) return;
    toggleSubEvent(selectedEvent, subIdx);
});

// 子任务右击 → 删除
dpSubEvents.addEventListener('contextmenu', async (e) => {
    const li = e.target.closest('.dp-sub-item');
    if (!li || !selectedEvent) return;
    e.preventDefault();
    const subIdx = Array.from(dpSubEvents.children).indexOf(li);
    if (subIdx < 0) return;

    const subs = selectedEvent.sub_event || [];
    const target = subs[subIdx];
    const done = /^~.*~$/.test(target);
    const displayName = done ? target.slice(1, -1) : target;

    if (done) {
        // 已完成 → 直接删除
        await deleteSubEvent(selectedEvent, subIdx);
    } else {
        // 未完成 → 确认
        if (confirm(`确定删除未完成的子任务「${displayName}」吗？`)) {
            await deleteSubEvent(selectedEvent, subIdx);
        }
    }
});

// 添加子任务按钮
dpAddSub.addEventListener('click', () => {
    if (!selectedEvent || inlineEditorActive) return;
    startAddSubEvent();
});

function showDetailPanel(ev) {
    const q = getQuadrant(ev.importence, ev.urgency);
    const qNames = { 1: '重要且紧急', 2: '紧急不重要', 3: '不重要不紧急', 4: '重要不紧急' };

    selectedEvent = ev;
    dpTitle.textContent = ev.title;
    dpImportence.textContent = fmt(ev.importence);
    dpUrgency.textContent = fmt(ev.urgency);
    dpQuadrant.textContent = qNames[q];
    dpDescription.textContent = ev.description || '暂无描述';

    // 子任务
    dpSubEvents.innerHTML = '';
    const subEvents = ev.sub_event || [];
    for (const sub of subEvents) {
        const li = document.createElement('li');
        const done = /^~.*~$/.test(sub);
        li.className = 'dp-sub-item' + (done ? ' done' : '');
        li.textContent = done ? sub.slice(1, -1) : sub;
        dpSubEvents.appendChild(li);
    }
    dpAddSub.style.display = 'block';  // 始终显示

    document.body.classList.add('panel-open');
    selectedIndex = eventPositions.findIndex(p => p.event === ev);

    // 面板打开后重绘，适配新的画布宽度
    setTimeout(() => draw(), 50);
}

function hideDetailPanel() {
    document.body.classList.remove('panel-open');
    selectedIndex = -1;
    selectedEvent = null;
    destroyInlineEditors();

    // 面板关闭后重绘
    setTimeout(() => draw(), 50);
}

// ==================== 内联编辑 ====================

let inlineEditorActive = null;  // 'title' | 'description' | null

// 一次性绑定编辑触发（不依赖 setupInlineEdit 重复添加监听器）
dpTitle.addEventListener('click', () => {
    if (inlineEditorActive || !selectedEvent) return;
    startTitleEdit();
});

dpDescription.addEventListener('click', () => {
    if (inlineEditorActive || !selectedEvent) return;
    startDescriptionEdit();
});

function startTitleEdit() {
    inlineEditorActive = 'title';
    const oldText = dpTitle.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dp-edit-input';
    input.value = oldText;
    input.style.cssText = 'font-size:1.05rem;font-weight:500;';
    dpTitle.textContent = '';
    dpTitle.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
        const newTitle = input.value.trim();
        input.remove();
        dpTitle.textContent = newTitle || oldText;
        inlineEditorActive = null;

        if (newTitle && newTitle !== oldText) {
            saveEdit('title', newTitle);
        }
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') {
            input.value = oldText;
            input.blur();
        }
    });
}

function startDescriptionEdit() {
    inlineEditorActive = 'description';
    const oldText = dpDescription.textContent;
    const textarea = document.createElement('textarea');
    textarea.className = 'dp-edit-textarea';
    textarea.value = oldText === '暂无描述' ? '' : oldText;
    dpDescription.textContent = '';
    dpDescription.appendChild(textarea);
    textarea.focus();

    const commit = () => {
        const newDesc = textarea.value.trim();
        textarea.remove();
        dpDescription.textContent = newDesc || '暂无描述';
        inlineEditorActive = null;

        if (newDesc !== oldText && newDesc !== (oldText === '暂无描述' ? '' : oldText)) {
            saveEdit('description', newDesc);
        }
    };

    textarea.addEventListener('blur', commit);
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            textarea.value = oldText === '暂无描述' ? '' : oldText;
            textarea.blur();
        }
        // Enter 不提交（textarea 允许多行），Ctrl+Enter 提交
        if (e.key === 'Enter' && e.ctrlKey) {
            textarea.blur();
        }
    });
}

function destroyInlineEditors() {
    if (inlineEditorActive) {
        // 强制结束当前编辑
        const el = document.querySelector('.dp-edit-input, .dp-edit-textarea');
        if (el) el.blur();
    }
    inlineEditorActive = null;
}

async function saveEdit(field, newValue) {
    if (!selectedEvent) return;

    // 改标题时本地预检重名
    if (field === 'title') {
        const dup = events.find(e => e !== selectedEvent && e.title === newValue);
        if (dup) {
            alert(`事件「${newValue}」已存在，请使用其他名称`);
            // 恢复旧标题
            dpTitle.textContent = selectedEvent.title;
            return;
        }
    }

    const params = new URLSearchParams();
    params.append('title', selectedEvent.title);
    params.append('prop_name', field);
    params.append('new_value', String(newValue));

    try {
        const resp = await fetch(`${API_BASE_URL}/events/update`, {
            method: 'POST',
            body: params,
        });
        if (resp.status === 409) {
            const data = await resp.json();
            alert(data.message || '重名');
            if (field === 'title') dpTitle.textContent = selectedEvent.title;
            return;
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        // 更新本地状态
        const idx = events.findIndex(e => e === selectedEvent);
        if (idx >= 0) {
            events[idx][field] = newValue;
            if (field === 'title') {
                selectedEvent = events[idx];
                dpTitle.textContent = newValue;
            }
            if (field === 'description') {
                dpDescription.textContent = newValue || '暂无描述';
            }
        }

        draw();
    } catch (err) {
        console.error('保存失败:', err);
    }
}

// ==================== 子任务增删改 ====================

function startAddSubEvent() {
    inlineEditorActive = 'sub_event';
    // 隐藏按钮，插入输入框
    dpAddSub.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dp-edit-input';
    input.placeholder = '子任务名称';
    input.style.cssText = 'margin-top:4px;font-size:0.82rem;';
    dpSubEvents.parentElement.insertBefore(input, dpSubEvents.nextSibling);

    const commit = async () => {
        const name = input.value.trim();
        input.remove();
        dpAddSub.style.display = 'block';
        inlineEditorActive = null;

        if (!name || !selectedEvent) return;  // 面板已关闭则跳过

        const subs = [...(selectedEvent.sub_event || []), name];
        const params = new URLSearchParams();
        params.append('title', selectedEvent.title);
        params.append('prop_name', 'sub_event');
        params.append('new_value', JSON.stringify(subs));

        try {
            const resp = await fetch(`${API_BASE_URL}/events/update`, {
                method: 'POST',
                body: params,
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            selectedEvent.sub_event = subs;
            showDetailPanel(selectedEvent);
            draw();
        } catch (err) {
            console.error('添加子任务失败:', err);
            showDetailPanel(selectedEvent);
        }
    };

    input.focus();
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') { input.value = ''; input.blur(); }
    });
}

async function deleteSubEvent(parentEvent, subIndex) {
    const subs = [...(parentEvent.sub_event || [])];
    subs.splice(subIndex, 1);

    const params = new URLSearchParams();
    params.append('title', parentEvent.title);
    params.append('prop_name', 'sub_event');
    params.append('new_value', JSON.stringify(subs));

    try {
        const resp = await fetch(`${API_BASE_URL}/events/update`, {
            method: 'POST',
            body: params,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        parentEvent.sub_event = subs;
        showDetailPanel(parentEvent);
        draw();
    } catch (err) {
        console.error('删除子任务失败:', err);
    }
}

async function toggleSubEvent(parentEvent, subIndex) {
    const subs = [...parentEvent.sub_event];
    const old = subs[subIndex];
    const done = /^~.*~$/.test(old);
    const toggled = done ? old.slice(1, -1) : `~${old}~`;
    subs[subIndex] = toggled;

    const params = new URLSearchParams();
    params.append('title', parentEvent.title);
    params.append('prop_name', 'sub_event');
    params.append('new_value', JSON.stringify(subs));

    try {
        const resp = await fetch(`${API_BASE_URL}/events/update`, {
            method: 'POST',
            body: params,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        // 更新本地
        parentEvent.sub_event = subs;

        // 刷新面板（保持选中同一事件）
        showDetailPanel(parentEvent);
        draw();
    } catch (err) {
        console.error('切换子任务状态失败:', err);
    }
}

// ==================== 按钮 & 刷新 ====================

refreshBtn.addEventListener('click', async () => {
    refreshBtn.style.pointerEvents = 'none';
    const ok = await fetchEvents();
    refreshBtn.style.pointerEvents = '';
    if (ok) {
        updateFooter();
        draw();
    }
});

function updateFooter() {
    if (events.length === 0) {
        eventCountEl.textContent = '暂无待办事件';
    } else {
        eventCountEl.textContent = `共 ${events.length} 个待办事件`;
    }
}

// ==================== 窗口自适应 ====================

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => draw(), 100);
});

// ==================== 主题切换 ====================

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    draw();
});

// ==================== 卫星动画 ====================

function animateLoop(timestamp) {
    if (!lastFrameTime) lastFrameTime = timestamp;
    const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.1);  // 秒，上限防跳帧
    lastFrameTime = timestamp;

    // 旋转所有卫星
    for (const ev of events) {
        const sat = satelliteAngles[ev.title];
        if (!sat) continue;
        for (let i = 0; i < sat.angles.length; i++) {
            sat.angles[i] = (sat.angles[i] + sat.speed * dt) % (Math.PI * 2);
        }
    }

    // 标签透明度动画
    const hoveredTitle = (hoveredIndex >= 0 && hoveredIndex < eventPositions.length)
        ? eventPositions[hoveredIndex].event.title
        : null;
    for (const ev of events) {
        const target = (ev.title === hoveredTitle) ? LABEL_ALPHA_HOVER : LABEL_ALPHA_IDLE;
        const current = labelAlphas[ev.title] !== undefined ? labelAlphas[ev.title] : LABEL_ALPHA_IDLE;
        const diff = target - current;
        if (Math.abs(diff) < 0.005) {
            labelAlphas[ev.title] = target;
        } else {
            labelAlphas[ev.title] = current + Math.sign(diff) * Math.min(Math.abs(diff), LABEL_ALPHA_SPEED * dt);
        }
    }

    draw();
    requestAnimationFrame(animateLoop);
}

// ==================== 启动 ====================

async function init() {
    const ok = await fetchEvents();
    updateFooter();
    // 启动卫星动画循环（取代单次 draw）
    requestAnimationFrame(animateLoop);

    if (REFRESH_INTERVAL_MS > 0) {
        setInterval(async () => {
            await fetchEvents();
            updateFooter();
        }, REFRESH_INTERVAL_MS);
    }
}

init();
