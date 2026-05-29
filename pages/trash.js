const API_BASE_URL = '/events/deleted';

let deletedEvents = [];

// ── 时间格式化 ──
function fmtTime(ts) {
    const d = new Date(ts * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── 加载列表 ──
async function loadDeleted() {
    try {
        const resp = await fetch(`${API_BASE_URL}/list`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        deletedEvents = await resp.json();
        render();
    } catch (err) {
        console.error('加载回收站失败:', err);
    }
}

// ── 渲染 ──
function render() {
    const list = document.getElementById('trashList');
    const empty = document.getElementById('trashEmpty');
    const count = document.getElementById('trashCount');

    count.textContent = `共 ${deletedEvents.length} 个归档事件`;

    if (deletedEvents.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    list.innerHTML = deletedEvents.map(ev => {
        const qName = quadrantName(ev.importence, ev.urgency);
        const qClass = quadrantClass(ev.importence, ev.urgency);
        const subCount = ev.sub_event && ev.sub_event.length ? `　${ev.sub_event.length} 个子任务` : '';
        const desc = ev.description || '';
        return `
            <li class="trash-item" data-q="${qClass}">
                <div class="trash-item-info">
                    <div class="trash-item-title">${escapeHtml(ev.title)}</div>
                    <div class="trash-item-meta">
                        <span>⚡ 重要 ${fmtNum(ev.importence)}</span>
                        <span>🔥 紧急 ${fmtNum(ev.urgency)}</span>
                        <span>📂 ${qName}${subCount}</span>
                        <span>🕒 ${fmtTime(ev.timestamp)}</span>
                    </div>
                    ${desc ? `<div class="trash-item-desc">${escapeHtml(desc)}</div>` : ''}
                </div>
                <button class="btn-restore" data-title="${escapeHtml(ev.title)}">恢复</button>
            </li>
        `;
    }).join('');

    // 绑定恢复按钮
    list.querySelectorAll('.btn-restore').forEach(btn => {
        btn.addEventListener('click', async () => {
            const title = btn.dataset.title;
            btn.disabled = true;
            btn.textContent = '...';

            try {
                const params = new URLSearchParams();
                params.append('title', title);
                const resp = await fetch(`${API_BASE_URL}/restore`, {
                    method: 'POST',
                    body: params,
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                // 从列表中移除
                deletedEvents = deletedEvents.filter(e => e.title !== title);
                render();
            } catch (err) {
                console.error('恢复失败:', err);
                btn.disabled = false;
                btn.textContent = '恢复';
                alert('恢复失败：' + err.message);
            }
        });
    });
}

function quadrantName(imp, urg) {
    if (imp >= 0 && urg >= 0) return '重要且紧急';
    if (imp < 0 && urg >= 0)  return '紧急不重要';
    if (imp < 0 && urg < 0)   return '不重要不紧急';
    return '重要不紧急';
}

function quadrantClass(imp, urg) {
    if (imp >= 0 && urg >= 0) return 'q1';
    if (imp < 0 && urg >= 0)  return 'q2';
    if (imp < 0 && urg < 0)   return 'q3';
    return 'q4';
}

function fmtNum(v) {
    return (v >= 0 ? '+' : '') + v.toFixed(2);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── 启动 ──
loadDeleted();
