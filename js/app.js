document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

let state = {
    settings: { apiKey: '', apiBase: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    resumes: [
        { id: 'resume_a', name: '简历版本 A (例如：策略/运营方向)', content: '' },
        { id: 'resume_b', name: '简历版本 B (例如：产品/产品运营方向)', content: '' },
        { id: 'resume_c', name: '简历版本 C (例如：数据分析方向)', content: '' }
    ],
    applications: [], 
    events: [], // 🌟 新增：秋招日程数组 { id, appId, title, date, startTime, endTime, type, notes }
    activeSession: { companyName: '', region: 'Singapore', roleTitle: '', language: 'bilingual', jd: '', results: {} },
    activeAppId: null, // 🌟 新增：标记当前工作台会话绑定的看板记录 id（null 表示自由模式，不挂载到任何投递记录）
    calendarViewDate: new Date(), // 🌟 新增：日历当前展示的月份/周（用于翻页）
    calendarViewMode: 'month' // 🌟 新增：'month' 或 'week'，控制日历主视图展示模式
};

function initApp() {
    const savedSettings = localStorage.getItem('interview_prep_settings');
    if (savedSettings) state.settings = JSON.parse(savedSettings);
    const savedResumes = localStorage.getItem('interview_prep_resumes');
    if (savedResumes) state.resumes = JSON.parse(savedResumes);
    
    const savedApps = localStorage.getItem('interview_prep_apps');
    if (savedApps) state.applications = JSON.parse(savedApps);

    const savedEvents = localStorage.getItem('interview_prep_events');
    if (savedEvents) state.events = JSON.parse(savedEvents);

    // 🌟 新增：恢复上一次生成的备战会话（公司/岗位/JD/五份报告）
    const savedSession = localStorage.getItem('interview_prep_active_session');
    if (savedSession) {
        try {
            state.activeSession = JSON.parse(savedSession);
        } catch (e) {
            console.warn('恢复上次会话失败:', e);
        }
    }
    const savedActiveAppId = localStorage.getItem('interview_prep_active_app_id');
    if (savedActiveAppId) state.activeAppId = JSON.parse(savedActiveAppId);

    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('track-date');
    if (dateInput) dateInput.value = today;

    // 配置 pdf.js worker（CDN 版本需手动指定 worker 路径，否则解析时会报错）
    if (window['pdfjsLib']) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    renderResumeBankInputs();
    renderApplications(); 
    setupEventListeners();
    checkApiKeyStatus();
    restoreActiveSessionToUI(); // 🌟 新增：把恢复的工作台会话渲染回页面
    restoreDebriefSessionToUI(); // 🌟 新增：把恢复的录音复盘会话渲染回页面
    renderCalendarView(); // 🌟 新增：渲染日历（月视图或周视图，取决于当前模式）
    renderUpcomingEvents(); // 🌟 新增：渲染近期日程列表
}

// 🌟 新增：把上次的录音复盘结果渲染回界面
function restoreDebriefSessionToUI() {
    const saved = localStorage.getItem('interview_prep_debrief_session');
    if (!saved) return;
    try {
        const session = JSON.parse(saved);
        if (!session.report) return;

        if (session.company) document.getElementById('debrief-company').value = session.company;
        if (session.role) document.getElementById('debrief-role').value = session.role;
        if (session.jd) document.getElementById('debrief-jd').value = session.jd;
        if (session.transcript) document.getElementById('debrief-transcript').value = session.transcript;

        document.getElementById('debrief-initial-state').classList.add('hidden');
        const reportRawNode = document.getElementById('debrief-report-raw');
        if (window.marked && window.marked.parse) {
            reportRawNode.innerHTML = window.marked.parse(session.report);
        } else {
            reportRawNode.innerText = session.report;
        }
    } catch (e) {
        console.warn('恢复复盘会话失败:', e);
    }
}

// 🌟 新增：把 state.activeSession 中保存的结果渲染回工作台界面
function restoreActiveSessionToUI() {
    const session = state.activeSession;
    if (!session || !session.results || Object.keys(session.results).length === 0) return;

    // 回填左侧输入框
    if (session.companyName) document.getElementById('in-company').value = session.companyName;
    if (session.roleTitle) document.getElementById('in-role').value = session.roleTitle;
    if (session.jd) document.getElementById('in-jd').value = session.jd;
    if (session.region) document.getElementById('in-region').value = session.region;
    if (session.language) document.getElementById('in-lang').value = session.language;

    // 回填五个 tab 面板
    const tabKeyToPanel = {
        match: 'tab-panel-match-raw',
        business: 'tab-panel-business-raw',
        intro: 'tab-panel-intro-raw',
        star: 'tab-panel-star-raw',
        qa: 'tab-panel-qa-raw'
    };
    Object.entries(tabKeyToPanel).forEach(([key, panelId]) => {
        if (session.results[key]) renderMarkdown(panelId, session.results[key]);
    });

    // 隐藏初始空状态，默认展示第一个 tab
    const initialState = document.getElementById('initial-state');
    if (initialState) initialState.classList.add('hidden');
    const firstTabBtn = document.querySelector('.tab-btn[data-tab="match"]');
    if (firstTabBtn) firstTabBtn.click();
}

// 🌟 新增：清空当前工作台的生成结果（保留输入框内容，仅清空 AI 报告，并解除与看板记录的绑定）
window.clearActiveSessionResults = () => {
    if (!confirm('确定要清空当前工作台的全部生成结果吗？此操作不可恢复。')) return;
    state.activeSession.results = {};
    localStorage.removeItem('interview_prep_active_session');

    // 如果当前会话绑定了某条看板记录，同步清空该记录的 prepResults
    if (state.activeAppId) {
        state.applications = state.applications.map(a => a.id === state.activeAppId ? { ...a, prepResults: {} } : a);
        localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
        renderApplications();
    }
    state.activeAppId = null;
    localStorage.removeItem('interview_prep_active_app_id');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('border-zinc-900', 'text-zinc-900'));
    const initialState = document.getElementById('initial-state');
    if (initialState) initialState.classList.remove('hidden');
};

// 🌟 新增：清空录音复盘报告
window.clearDebriefResults = () => {
    if (!confirm('确定要清空当前复盘报告吗？此操作不可恢复。')) return;
    localStorage.removeItem('interview_prep_debrief_session');

    const reportRawNode = document.getElementById('debrief-report-raw');
    if (reportRawNode) reportRawNode.innerHTML = '';
    const initialState = document.getElementById('debrief-initial-state');
    if (initialState) initialState.classList.remove('hidden');
};

function checkApiKeyStatus() {
    const banner = document.getElementById('api-warning-banner');
    if (!state.settings.apiKey) banner.classList.remove('hidden');
    else banner.classList.add('hidden');
}

function renderResumeBankInputs() {
    const container = document.getElementById('resume-bank-settings-container');
    if (!container) return;
    
    container.innerHTML = state.resumes.map(r => `
        <div class="mb-4 p-3 border border-zinc-200 rounded-lg bg-zinc-50">
            <div class="flex items-center justify-between mb-1 gap-2">
                <label class="block text-xs font-semibold text-zinc-600 flex-1">
                    <input type="text" value="${r.name}" onchange="updateResumeName('${r.id}', this.value)" class="bg-transparent border-b border-transparent hover:border-zinc-300 font-bold focus:outline-none text-zinc-800 w-full">
                </label>
                <label class="shrink-0 px-2.5 py-1 bg-zinc-900 text-white rounded text-[10px] font-bold cursor-pointer hover:bg-zinc-700 transition">
                    📄 上传 PDF
                    <input type="file" accept="application/pdf" class="hidden" onchange="handleResumePdfUpload('${r.id}', this)">
                </label>
            </div>
            <p id="pdf-status-${r.id}" class="text-[10px] text-zinc-400 mb-1 min-h-[14px]"></p>
            <textarea rows="4" placeholder="粘贴该版本的简历文本内容，或点击右上角上传 PDF 自动填入..." onchange="updateResumeContent('${r.id}', this.value)" class="w-full mt-1 p-2 border border-zinc-200 rounded text-xs focus:outline-none font-mono">${r.content || ''}</textarea>
        </div>
    `).join('');

    const selectionContainer = document.getElementById('resume-selectors');
    if (!selectionContainer) return;
    selectionContainer.innerHTML = state.resumes.map(r => `
        <label class="flex items-start gap-2 p-2.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 cursor-pointer text-xs">
            <input type="checkbox" name="selected_resumes" value="${r.id}" class="mt-0.5 rounded">
            <div>
                <span class="font-medium text-zinc-800 block">${r.name}</span>
                <span class="text-[10px] text-zinc-400">${r.content ? '已填入内容 (' + r.content.length + '字)' : '未填入内容'}</span>
            </div>
        </label>
    `).join('');
}

window.updateResumeName = (id, newName) => {
    state.resumes = state.resumes.map(r => r.id === id ? { ...r, name: newName } : r);
    localStorage.setItem('interview_prep_resumes', JSON.stringify(state.resumes));
    renderResumeBankInputs();
};

window.updateResumeContent = (id, content) => {
    state.resumes = state.resumes.map(r => r.id === id ? { ...r, content: content } : r);
    localStorage.setItem('interview_prep_resumes', JSON.stringify(state.resumes));
    renderResumeBankInputs();
};

// 🌟 新增：处理简历 PDF 上传，浏览器端用 pdf.js 提取文字并自动填入对应文本框
window.handleResumePdfUpload = async (resumeId, inputEl) => {
    const file = inputEl.files[0];
    if (!file) return;

    const statusEl = document.getElementById(`pdf-status-${resumeId}`);

    if (!window['pdfjsLib']) {
        if (statusEl) statusEl.innerText = `❌ PDF 解析库未加载成功，请检查网络后刷新页面重试。`;
        return;
    }

    if (statusEl) statusEl.innerText = `⏳ 正在解析「${file.name}」...`;

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n\n';
        }

        fullText = fullText.trim();

        if (!fullText) {
            if (statusEl) statusEl.innerText = `⚠️ 未能提取到文字，该 PDF 可能是图片扫描版，请手动粘贴文本。`;
            return;
        }

        state.resumes = state.resumes.map(r => r.id === resumeId ? { ...r, content: fullText } : r);
        localStorage.setItem('interview_prep_resumes', JSON.stringify(state.resumes));

        renderResumeBankInputs();
        // renderResumeBankInputs 会重新生成 DOM，重新取一次状态提示节点再写入最终结果
        const refreshedStatusEl = document.getElementById(`pdf-status-${resumeId}`);
        if (refreshedStatusEl) refreshedStatusEl.innerText = `✅ 已从「${file.name}」提取 ${fullText.length} 字，可在下方文本框校对编辑`;

    } catch (err) {
        console.error('PDF解析失败:', err);
        if (statusEl) statusEl.innerText = `❌ 解析失败: ${err.message}`;
    }
};

// 看板逻辑
// 看板逻辑（已加入实时筛选与搜索功能）
function renderApplications() {
    const tbody = document.getElementById('tracker-table-body');
    const statsContainer = document.getElementById('tracker-stats');
    if (!tbody) return;

    if (state.applications.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-zinc-400 italic">暂无投递记录，快在左侧添加你的第一个秋招意向吧！</td></tr>`;
        if (statsContainer) statsContainer.innerHTML = "总计: 0";
        return;
    }

    // 1. 获取当前用户输入的筛选和搜索关键词
    const keywordInput = document.getElementById('search-track-keyword');
    const statusSelect = document.getElementById('filter-track-status');
    
    const keyword = keywordInput ? keywordInput.value.trim().toLowerCase() : '';
    const statusFilter = statusSelect ? statusSelect.value : '全部';

    // 2. 执行双重条件过滤
    const filteredApps = state.applications.filter(app => {
        // 关键词过滤（同时匹配公司名称和岗位名称）
        const matchesKeyword = !keyword || 
            (app.company && app.company.toLowerCase().includes(keyword)) || 
            (app.role && app.role.toLowerCase().includes(keyword));
            
        // 状态过滤
        const matchesStatus = statusFilter === '全部' || app.status === statusFilter;
        
        return matchesKeyword && matchesStatus;
    });

    // 根据日期从新到旧排序
    const sortedApps = [...filteredApps].sort((a, b) => new Date(b.date) - new Date(a.date));

    // 3. 如果过滤后没有匹配结果
    if (sortedApps.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-zinc-400 italic">没有找到符合筛选条件的投递记录 ☕</td></tr>`;
    } else {
        // 渲染过滤后的表格行
        tbody.innerHTML = sortedApps.map(app => {
            const linkCell = app.link
                ? `<a href="${app.link}" target="_blank" rel="noopener noreferrer" class="text-rose-500 hover:text-rose-700 transition" title="${app.link}">🔗</a>`
                : `<span class="text-stone-300">—</span>`;

            const hasPrep = app.prepResults && Object.keys(app.prepResults).length > 0;
            const prepBtn = hasPrep
                ? `<button onclick="activateAppForPrep('${app.id}')" class="px-2 py-1 bg-rose-50 text-rose-600 border border-rose-200 rounded text-[11px] font-bold hover:bg-rose-100 transition cursor-pointer">📂 查看备战内容</button>`
                : `<button onclick="activateAppForPrep('${app.id}')" class="px-2 py-1 bg-zinc-950 text-white rounded text-[11px] font-bold hover:bg-zinc-800 transition cursor-pointer">🚀 备战面试</button>`;

            return `
                <tr class="border-b border-zinc-100 hover:bg-zinc-50/50 transition">
                    <td class="p-3 font-mono text-[11px] text-zinc-400">${app.date}</td>
                    <td class="p-3 font-bold text-zinc-800">${app.company}</td>
                    <td class="p-3 text-zinc-600">${app.role}</td>
                    <td class="p-3 text-center">${linkCell}</td>
                    <td class="p-3">
                        <select onchange="updateAppStatus('${app.id}', this.value)" class="text-[11px] px-2 py-1 rounded border border-zinc-200 bg-white font-medium ${getStatusColorClass(app.status)}">
                            <option value="已投递" ${app.status === '已投递' ? 'selected' : ''}>已投递</option>
                            <option value="笔试中" ${app.status === '笔试中' ? 'selected' : ''}>笔试/测评</option>
                            <option value="面试中" ${app.status === '面试中' ? 'selected' : ''}>面试中 ⚡</option>
                            <option value="已拿Offer" ${app.status === '已拿Offer' ? 'selected' : ''}>🎉 收到Offer</option>
                            <option value="流程终止" ${app.status === '流程终止' ? 'selected' : ''}>流程终止</option>
                        </select>
                    </td>
                    <td class="p-3 text-center flex items-center justify-center gap-2">
                        ${prepBtn}
                        <button onclick="openEventModalForApp('${app.id}')" class="text-stone-400 hover:text-rose-600 text-xs p-1 cursor-pointer" title="为这条记录添加日程">📅</button>
                        <!-- 🎙️ 新增：一键直达录音复盘 -->
                        <button onclick="startAudioReviewFromBoard('${app.id}')" class="text-stone-400 hover:text-amber-600 text-xs p-1 cursor-pointer" title="快速为此岗位创建录音复盘">🎙️</button>
                        <button onclick="deleteApp('${app.id}')" class="text-zinc-400 hover:text-red-500 text-xs p-1 cursor-pointer">🗑️</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // 4. 统计状态（仍基于全量数据统计，方便纵览全局漏斗情况）
    const total = state.applications.length;
    const interviewing = state.applications.filter(a => a.status === '面试中').length;
    const offers = state.applications.filter(a => a.status === '已拿Offer').length;
    if (statsContainer) {
        statsContainer.innerHTML = `<span>总投放: <strong class="text-zinc-800">${total}</strong></span> | <span class="text-amber-600 font-bold">面试中: ${interviewing}</span> | <span class="text-green-600 font-bold">Offers: ${offers}</span>`;
    }
}
function getStatusColorClass(status) {
    if (status === '面试中') return 'text-amber-700 bg-amber-50 border-amber-200 font-bold';
    if (status === '已拿Offer') return 'text-green-700 bg-green-50 border-green-200 font-bold';
    if (status === '流程终止') return 'text-zinc-400 bg-zinc-100';
    if (status === '笔试中') return 'text-blue-700 bg-blue-50 border-blue-200';
    return 'text-zinc-600 bg-white';
}

window.updateAppStatus = (id, newStatus) => {
    state.applications = state.applications.map(a => a.id === id ? { ...a, status: newStatus } : a);
    localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
    renderApplications();
};

window.deleteApp = (id) => {
    if (!confirm('确定要删除这条投递记录吗？')) return;
    state.applications = state.applications.filter(a => a.id !== id);
    localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));

    // 解除该记录关联的所有日程（日程本身保留，只是不再关联到已删除的投递记录）
    state.events = state.events.map(e => e.appId === id ? { ...e, appId: '' } : e);
    saveEvents();

    renderApplications();
    renderCalendarView();
    renderUpcomingEvents();
};

window.activateAppForPrep = (id) => {
    const app = state.applications.find(a => a.id === id);
    if (!app) return;

    // 🌟 把当前工作台会话绑定到这条投递记录上，后续生成结果会存进这条记录的 prepResults
    state.activeAppId = id;
    localStorage.setItem('interview_prep_active_app_id', JSON.stringify(id));

    switchView('workspace');
    document.getElementById('in-company').value = app.company;
    document.getElementById('in-role').value = app.role;
    document.getElementById('in-jd').value = app.jd || '';

    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('border-zinc-900', 'text-zinc-900'));

    const hasPrep = app.prepResults && Object.keys(app.prepResults).length > 0;

    if (hasPrep) {
        // 已经备战过：直接回填 5 个 tab，不需要重新调用 AI
        state.activeSession = {
            companyName: app.company,
            region: app.region || 'Singapore',
            roleTitle: app.role,
            language: app.language || 'bilingual',
            jd: app.jd || '',
            results: app.prepResults
        };
        document.getElementById('initial-state').classList.add('hidden');

        const tabKeyToPanel = {
            match: 'tab-panel-match-raw', business: 'tab-panel-business-raw',
            intro: 'tab-panel-intro-raw', star: 'tab-panel-star-raw', qa: 'tab-panel-qa-raw'
        };
        Object.entries(tabKeyToPanel).forEach(([key, panelId]) => {
            if (app.prepResults[key]) renderMarkdown(panelId, app.prepResults[key]);
        });
        document.querySelector('.tab-btn[data-tab="match"]').click();
    } else {
        // 还没备战过：清空工作台输出区，等待用户点击生成
        state.activeSession = { companyName: app.company, region: 'Singapore', roleTitle: app.role, language: 'bilingual', jd: app.jd || '', results: {} };
        document.getElementById('initial-state').classList.remove('hidden');
    }
};

// ================= 四视图核心切换开关 =================
function switchView(viewName) {
    const wsNav = document.getElementById('nav-workspace');
    const trNav = document.getElementById('nav-tracker');
    const calNav = document.getElementById('nav-calendar');
    const dbNav = document.getElementById('nav-debrief');

    const wsView = document.getElementById('view-workspace');
    const trView = document.getElementById('view-tracker');
    const calView = document.getElementById('view-calendar');
    const dbView = document.getElementById('view-debrief');

    // 清洗类名
    const activeClass = "px-4 py-1.5 rounded-md text-xs font-bold transition bg-white text-zinc-950 shadow-xs cursor-pointer";
    const inactiveClass = "px-4 py-1.5 rounded-md text-xs font-medium text-zinc-500 hover:text-zinc-900 transition cursor-pointer";

    wsView.classList.add('hidden');
    trView.classList.add('hidden');
    calView.classList.add('hidden');
    dbView.classList.add('hidden');

    wsNav.className = inactiveClass;
    trNav.className = inactiveClass;
    calNav.className = inactiveClass;
    dbNav.className = inactiveClass;

    if (viewName === 'workspace') {
        wsView.classList.remove('hidden');
        wsNav.className = activeClass;
    } else if (viewName === 'tracker') {
        trView.classList.remove('hidden');
        trNav.className = activeClass;
        renderApplications();
    } else if (viewName === 'calendar') {
        calView.classList.remove('hidden');
        calNav.className = activeClass;
        renderCalendarView();
        renderUpcomingEvents();
    } else if (viewName === 'debrief') {
        dbView.classList.remove('hidden');
        dbNav.className = activeClass;
    }
}

// ================= 🌟 新增：秋招日程日历模块 =================

const EVENT_TYPE_CLASS = { '面试': 'type-interview', '笔试': 'type-oa', '其他': 'type-other' };
const EVENT_TYPE_ICON = { '面试': '🎙️', '笔试': '📝', '其他': '📌' };

function saveEvents() {
    localStorage.setItem('interview_prep_events', JSON.stringify(state.events));
}

function formatDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// 判断两个时间段是否重叠（同一天内）。没有填开始时间的日程不参与冲突检测。
function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
    if (!aStart || !bStart) return false;
    const aS = aStart, aE = aEnd && aEnd > aStart ? aEnd : aStart;
    const bS = bStart, bE = bEnd && bEnd > bStart ? bEnd : bStart;
    return aS < bE && bS < aE;
}

// 找出某一天里互相冲突的事件 id 集合
function getConflictingEventIdsForDate(dateKey) {
    const dayEvents = state.events.filter(e => e.date === dateKey);
    const conflictIds = new Set();
    for (let i = 0; i < dayEvents.length; i++) {
        for (let j = i + 1; j < dayEvents.length; j++) {
            const a = dayEvents[i], b = dayEvents[j];
            if (timeRangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
                conflictIds.add(a.id);
                conflictIds.add(b.id);
            }
        }
    }
    return conflictIds;
}

// 根据当前 calendarViewMode 渲染对应视图（月视图 / 周时间轴视图）
function renderCalendarView() {
    if (state.calendarViewMode === 'week') {
        document.getElementById('cal-month-view').classList.add('hidden');
        document.getElementById('cal-week-view').classList.remove('hidden');
        renderWeekView();
    } else {
        document.getElementById('cal-week-view').classList.add('hidden');
        document.getElementById('cal-month-view').classList.remove('hidden');
        renderCalendar();
    }
    updateViewModeButtonStyles();
}

function updateViewModeButtonStyles() {
    const monthBtn = document.getElementById('btn-view-mode-month');
    const weekBtn = document.getElementById('btn-view-mode-week');
    if (!monthBtn || !weekBtn) return;
    monthBtn.classList.toggle('view-mode-active', state.calendarViewMode === 'month');
    weekBtn.classList.toggle('view-mode-active', state.calendarViewMode === 'week');
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const label = document.getElementById('cal-month-label');
    if (!grid || !label) return;

    const viewDate = state.calendarViewDate;
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth(); // 0-indexed

    label.innerText = `${year} 年 ${month + 1} 月`;

    const firstOfMonth = new Date(year, month, 1);
    // JS getDay(): 0=周日...6=周六。我们的表头是 一二三四五六日，所以要把周一作为第一列
    const firstWeekdayMon0 = (firstOfMonth.getDay() + 6) % 7; // 0=周一
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const today = new Date();
    const todayKey = formatDateKey(today);

    let cells = [];

    // 上月填充格
    for (let i = 0; i < firstWeekdayMon0; i++) {
        const dayNum = daysInPrevMonth - firstWeekdayMon0 + i + 1;
        cells.push({ dayNum, otherMonth: true });
    }
    // 本月格
    for (let d = 1; d <= daysInMonth; d++) {
        cells.push({ dayNum: d, otherMonth: false, dateObj: new Date(year, month, d) });
    }
    // 下月填充格，补齐到 7 的整数倍
    while (cells.length % 7 !== 0) {
        const dayNum = cells.length - (firstWeekdayMon0 + daysInMonth) + 1;
        cells.push({ dayNum, otherMonth: true });
    }

    grid.innerHTML = cells.map(cell => {
        if (cell.otherMonth) {
            return `<div class="cal-day cal-day-other-month"><span class="cal-day-number" style="color:#d6d3d1;">${cell.dayNum}</span></div>`;
        }
        const dateKey = formatDateKey(cell.dateObj);
        const isToday = dateKey === todayKey;
        const dayEvents = state.events.filter(e => e.date === dateKey)
            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
        const conflictIds = getConflictingEventIdsForDate(dateKey);

        const pillsHtml = dayEvents.slice(0, 3).map(e => {
            const typeClass = EVENT_TYPE_CLASS[e.type] || 'type-other';
            const conflictClass = conflictIds.has(e.id) ? 'has-conflict' : '';
            const timeLabel = e.startTime ? e.startTime : '';
            return `<div class="cal-event-pill ${typeClass} ${conflictClass}" onclick="openEventModal('${e.id}')" title="${e.title}${conflictIds.has(e.id) ? ' ⚠️ 时间冲突' : ''}">${timeLabel ? timeLabel + ' ' : ''}${EVENT_TYPE_ICON[e.type] || ''} ${e.title}</div>`;
        }).join('');
        const moreLabel = dayEvents.length > 3 ? `<div class="text-[9px] text-stone-400 px-1">+${dayEvents.length - 3} 更多</div>` : '';

        return `
            <div class="cal-day ${isToday ? 'cal-day-today' : 'cal-day-current'}">
                <span class="cal-day-number">${cell.dayNum}</span>
                ${pillsHtml}
                ${moreLabel}
            </div>
        `;
    }).join('');
}

// 给一个 "HH:MM" 时间字符串加一小时，用于点击时间轴格子时给结束时间一个合理默认值
function addOneHour(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const newH = (h + 1) % 24;
    return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 获取本周（周一为起点）的 7 个 Date 对象，基于 state.calendarViewDate
function getWeekDates(refDate) {
    const d = new Date(refDate);
    const weekdayMon0 = (d.getDay() + 6) % 7; // 0=周一
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - weekdayMon0);
    const days = [];
    for (let i = 0; i < 7; i++) {
        days.push(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
    }
    return days;
}

const WEEK_DOW_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const WEEK_ROW_HEIGHT = 48; // 与 .week-hour-row / .week-hour-cell 的 CSS 高度保持一致

function renderWeekView() {
    const header = document.getElementById('cal-week-header');
    const gridContainer = document.getElementById('cal-week-grid');
    const label = document.getElementById('cal-month-label');
    if (!header || !gridContainer || !label) return;

    const weekDates = getWeekDates(state.calendarViewDate);
    const todayKey = formatDateKey(new Date());
    const firstDay = weekDates[0], lastDay = weekDates[6];

    // 顶部标签：跨月显示 "6月22日 - 6月28日"，跨年显示年份避免歧义
    const sameMonth = firstDay.getMonth() === lastDay.getMonth();
    const rangeLabel = sameMonth
        ? `${firstDay.getFullYear()}年 ${firstDay.getMonth() + 1}月${firstDay.getDate()}日 - ${lastDay.getDate()}日`
        : `${firstDay.getMonth() + 1}月${firstDay.getDate()}日 - ${lastDay.getMonth() + 1}月${lastDay.getDate()}日`;
    label.innerText = rangeLabel;

    // 渲染顶部 7 天表头（第一列留空对齐时间刻度列）
    header.innerHTML = `<div></div>` + weekDates.map(d => {
        const dateKey = formatDateKey(d);
        const isToday = dateKey === todayKey;
        return `<div class="week-day-header-cell ${isToday ? 'is-today' : ''}">
            <div class="week-day-header-dow">${WEEK_DOW_LABELS[(d.getDay() + 6) % 7]}</div>
            <div class="week-day-header-num">${d.getDate()}</div>
        </div>`;
    }).join('');

    // 渲染主体：左侧时间刻度列 + 7 个可点击的日列
    let bodyHtml = '';

    // 时间刻度列（24 小时）
    bodyHtml += `<div>` + Array.from({ length: 24 }, (_, h) =>
        `<div class="week-hour-row"><div class="week-time-label">${String(h).padStart(2, '0')}:00</div></div>`
    ).join('') + `</div>`;

    // 7 个日列
    weekDates.forEach(d => {
        const dateKey = formatDateKey(d);
        const isToday = dateKey === todayKey;
        const dayEvents = state.events.filter(e => e.date === dateKey);
        const conflictIds = getConflictingEventIdsForDate(dateKey);

        let colHtml = `<div class="week-day-col ${isToday ? 'week-day-col-today' : ''}" style="height:${24 * WEEK_ROW_HEIGHT}px;">`;

        // 24 个可点击空白小时格
        for (let h = 0; h < 24; h++) {
            colHtml += `<div class="week-hour-cell" onclick="openEventModal(null, '${dateKey}', '${String(h).padStart(2, '0')}:00')"></div>`;
        }

        // 当前时间红线（仅今天显示）
        if (isToday) {
            const now = new Date();
            const minutesFromMidnight = now.getHours() * 60 + now.getMinutes();
            const topPx = (minutesFromMidnight / 60) * WEEK_ROW_HEIGHT;
            colHtml += `<div class="week-current-time-line" style="top:${topPx}px;"></div>`;
        }

        // 事件方块（绝对定位叠加在空白格之上）
        dayEvents.forEach(e => {
            if (!e.startTime) return; // 没有具体时间的日程不在周时间轴上定位显示，只会出现在左侧近期列表
            const [sh, sm] = e.startTime.split(':').map(Number);
            const startMinutes = sh * 60 + sm;
            let endMinutes = startMinutes + 60; // 默认 1 小时高度
            if (e.endTime) {
                const [eh, em] = e.endTime.split(':').map(Number);
                const candidateEnd = eh * 60 + em;
                if (candidateEnd > startMinutes) endMinutes = candidateEnd;
            }
            const topPx = (startMinutes / 60) * WEEK_ROW_HEIGHT;
            const heightPx = Math.max(((endMinutes - startMinutes) / 60) * WEEK_ROW_HEIGHT, 22);
            const typeClass = EVENT_TYPE_CLASS[e.type] || 'type-other';
            const conflictClass = conflictIds.has(e.id) ? 'has-conflict' : '';

            colHtml += `<div class="week-event-block ${typeClass} ${conflictClass}"
                style="top:${topPx}px; height:${heightPx}px;"
                onclick="event.stopPropagation(); openEventModal('${e.id}')"
                title="${e.title}${conflictIds.has(e.id) ? ' ⚠️ 时间冲突' : ''}">
                ${EVENT_TYPE_ICON[e.type] || ''} ${e.title}${e.endTime ? `<br>${e.startTime}-${e.endTime}` : `<br>${e.startTime}`}
            </div>`;
        });

        colHtml += `</div>`;
        bodyHtml += colHtml;
    });

    gridContainer.innerHTML = bodyHtml;

    // 首次渲染时自动滚动到当前时间附近（提前 2 小时，避免红线贴在最顶部）
    const scrollContainer = document.getElementById('cal-week-scroll-container');
    if (scrollContainer && !scrollContainer.dataset.scrolledOnce) {
        const now = new Date();
        const scrollToPx = Math.max(((now.getHours() - 2) * WEEK_ROW_HEIGHT), 0);
        scrollContainer.scrollTop = scrollToPx;
        scrollContainer.dataset.scrolledOnce = 'true';
    }
}

function renderUpcomingEvents() {
    const container = document.getElementById('upcoming-events-list');
    if (!container) return;

    const todayKey = formatDateKey(new Date());
    const upcoming = [...state.events]
        .filter(e => e.date >= todayKey)
        .sort((a, b) => (a.date + (a.startTime || '00:00')).localeCompare(b.date + (b.startTime || '00:00')));

    if (upcoming.length === 0) {
        container.innerHTML = `<p class="text-xs text-stone-400 italic text-center py-6">暂无即将到来的日程，点击上方按钮添加吧！</p>`;
        return;
    }

    container.innerHTML = upcoming.map(e => {
        const conflictIds = getConflictingEventIdsForDate(e.date);
        const isConflict = conflictIds.has(e.id);
        const linkedApp = e.appId ? state.applications.find(a => a.id === e.appId) : null;
        const timeRange = e.startTime ? (e.endTime ? `${e.startTime} - ${e.endTime}` : e.startTime) : '时间未定';

        return `
            <div class="upcoming-event-card ${isConflict ? 'has-conflict' : ''} cursor-pointer" onclick="openEventModal('${e.id}')">
                <div class="flex justify-between items-start gap-2">
                    <span class="text-xs font-bold text-stone-800">${EVENT_TYPE_ICON[e.type] || ''} ${e.title}</span>
                    ${isConflict ? '<span class="text-[10px] text-red-600 font-bold shrink-0">⚠️ 时间冲突</span>' : ''}
                </div>
                <div class="text-[10px] text-stone-500 mt-1 font-mono">${e.date} · ${timeRange}</div>
                ${linkedApp ? `<div class="text-[10px] text-rose-500 mt-1 font-semibold">🔗 关联: ${linkedApp.company} - ${linkedApp.role}</div>` : ''}
            </div>
        `;
    }).join('');
}

// 填充"关联看板投递记录"下拉框选项
function populateEventAppLinkOptions(selectedAppId) {
    const select = document.getElementById('event-app-link');
    if (!select) return;
    const options = ['<option value="">— 不关联任何记录 —</option>']
        .concat(state.applications.map(a => `<option value="${a.id}" ${a.id === selectedAppId ? 'selected' : ''}>${a.company} - ${a.role}</option>`));
    select.innerHTML = options.join('');
}

// 🌟 新增：从看板某条记录跳转到日历，打开新增日程弹窗并预先关联该记录
window.openEventModalForApp = (appId) => {
    switchView('calendar');
    openEventModal(null);
    const select = document.getElementById('event-app-link');
    if (select) select.value = appId;
    const app = state.applications.find(a => a.id === appId);
    if (app) document.getElementById('event-title').value = `${app.company} - ${app.role}`;
};

// 打开新增日程弹窗（不传 eventId）或编辑已有日程（传 eventId）
window.openEventModal = (eventId, prefillDate, prefillStartTime) => {
    const modal = document.getElementById('event-modal');
    const titleEl = document.getElementById('event-modal-title');
    const deleteBtn = document.getElementById('btn-delete-event');

    if (eventId) {
        const ev = state.events.find(e => e.id === eventId);
        if (!ev) return;
        titleEl.innerText = '✏️ 编辑日程';
        document.getElementById('event-edit-id').value = ev.id;
        document.getElementById('event-title').value = ev.title || '';
        document.getElementById('event-date').value = ev.date || '';
        document.getElementById('event-type').value = ev.type || '面试';
        document.getElementById('event-start-time').value = ev.startTime || '';
        document.getElementById('event-end-time').value = ev.endTime || '';
        document.getElementById('event-notes').value = ev.notes || '';
        populateEventAppLinkOptions(ev.appId || '');
        deleteBtn.classList.remove('hidden');
    } else {
        titleEl.innerText = '📅 新增面试/笔试日程';
        document.getElementById('event-edit-id').value = '';
        document.getElementById('event-title').value = '';
        document.getElementById('event-date').value = prefillDate || formatDateKey(new Date());
        document.getElementById('event-type').value = '面试';
        document.getElementById('event-start-time').value = prefillStartTime || '';
        // 默认给一个 1 小时的结束时间，方便直接保存（用户仍可自行修改）
        document.getElementById('event-end-time').value = prefillStartTime ? addOneHour(prefillStartTime) : '';
        document.getElementById('event-notes').value = '';
        populateEventAppLinkOptions('');
        deleteBtn.classList.add('hidden');
    }
    modal.classList.remove('hidden');
};

window.closeEventModal = () => {
    document.getElementById('event-modal').classList.add('hidden');
};

window.saveEventFromModal = () => {
    const id = document.getElementById('event-edit-id').value;
    const title = document.getElementById('event-title').value.trim();
    const date = document.getElementById('event-date').value;
    const type = document.getElementById('event-type').value;
    const startTime = document.getElementById('event-start-time').value;
    const endTime = document.getElementById('event-end-time').value;
    const appId = document.getElementById('event-app-link').value;
    const notes = document.getElementById('event-notes').value.trim();

    if (!title || !date) {
        alert('请至少填写日程标题和日期！');
        return;
    }

    if (id) {
        state.events = state.events.map(e => e.id === id ? { ...e, title, date, type, startTime, endTime, appId, notes } : e);
    } else {
        state.events.push({ id: 'evt_' + Date.now(), title, date, type, startTime, endTime, appId, notes });
    }
    saveEvents();
    closeEventModal();
    renderCalendarView();
    renderUpcomingEvents();
};

window.deleteEventFromModal = () => {
    const id = document.getElementById('event-edit-id').value;
    if (!id) return;
    if (!confirm('确定要删除这条日程吗？')) return;
    state.events = state.events.filter(e => e.id !== id);
    saveEvents();
    closeEventModal();
    renderCalendarView();
    renderUpcomingEvents();
};

function changeCalendarMonth(offset) {
    const d = state.calendarViewDate;
    if (state.calendarViewMode === 'week') {
        state.calendarViewDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset * 7);
    } else {
        state.calendarViewDate = new Date(d.getFullYear(), d.getMonth() + offset, 1);
    }
    renderCalendarView();
}

// 🌟 新增：跳转到"今天"所在的月/周
function goToToday() {
    state.calendarViewDate = new Date();
    renderCalendarView();
}

// 🌟 新增：切换日历主视图模式（月视图 / 周时间轴视图）
function setCalendarViewMode(mode) {
    state.calendarViewMode = mode;
    // 切换到周视图时重置"已自动滚动"标记，确保每次进入周视图都自动定位到当前时间附近
    const scrollContainer = document.getElementById('cal-week-scroll-container');
    if (scrollContainer) delete scrollContainer.dataset.scrolledOnce;
    renderCalendarView();
}

// ================= 秋招日程日历模块结束 =================

// 🌟 新增：执行面试录音复盘大模型调用流程
async function runDebriefPipeline() {
    if (!state.settings.apiKey) {
        alert('请先配置大模型 API 密钥！');
        document.getElementById('settings-modal').classList.remove('hidden');
        return;
    }

    const company = document.getElementById('debrief-company').value.trim();
    const role = document.getElementById('debrief-role').value.trim();
    const jd = document.getElementById('debrief-jd').value.trim();
    const transcript = document.getElementById('debrief-transcript').value.trim();

    if (!company || !role || !transcript) {
        alert('请完整填写复盘的公司名称、目标岗位，并粘贴面试录音文本！');
        return;
    }

    const overlay = document.getElementById('loading-overlay');
    const logNode = document.getElementById('loading-logs');
    overlay.classList.remove('hidden');
    logNode.innerHTML = "";

    const addLog = (text) => {
        const p = document.createElement('p');
        p.className = "text-zinc-600 mb-1";
        p.innerText = `[${new Date().toLocaleTimeString()}] ${text}`;
        logNode.appendChild(p);
        logNode.scrollTop = logNode.scrollHeight;
    };

    try {
        addLog(`▶ 正在启动针对【${company}-${role}】的首席面试官扫描算法...`);
        addLog("▶ 正在审阅长文本录音稿并映射核心商业提问点...");
        
        const finalPrompt = window.PromptTemplates.interviewDebrief(company, role, jd, transcript);
        const reportResult = await callLLM(finalPrompt);
        
        // 渲染 Markdown
        document.getElementById('debrief-initial-state').classList.add('hidden');
        const reportRawNode = document.getElementById('debrief-report-raw');
        if (window.marked && window.marked.parse) {
            reportRawNode.innerHTML = window.marked.parse(reportResult);
        } else {
            reportRawNode.innerText = reportResult;
        }

        // 🌟 新增：持久化保存本次复盘报告，防止刷新后丢失
        const debriefSession = { company, role, jd, transcript, report: reportResult };
        localStorage.setItem('interview_prep_debrief_session', JSON.stringify(debriefSession));

        addLog("✔ 复盘分析完成！已为您输出高管级全盘诊断报告。");
        setTimeout(() => overlay.classList.add('hidden'), 800);
    } catch (error) {
        addLog(`❌ 复盘失败: ${error.message}`);
        alert(`流水线突发阻碍: ${error.message}`);
        setTimeout(() => overlay.classList.add('hidden'), 2000);
    }
}

// 事件绑定
function setupEventListeners() {
    document.getElementById('nav-workspace').addEventListener('click', () => switchView('workspace'));
    document.getElementById('nav-tracker').addEventListener('click', () => switchView('tracker'));
    document.getElementById('nav-calendar').addEventListener('click', () => switchView('calendar')); // 新增
    document.getElementById('nav-debrief').addEventListener('click', () => switchView('debrief')); // 新增

    document.getElementById('btn-run-debrief').addEventListener('click', runDebriefPipeline); // 新增

    // 🌟 新增：日程日历相关事件绑定
    document.getElementById('btn-cal-prev').addEventListener('click', () => changeCalendarMonth(-1));
    document.getElementById('btn-cal-next').addEventListener('click', () => changeCalendarMonth(1));
    document.getElementById('btn-cal-today').addEventListener('click', goToToday);
    document.getElementById('btn-view-mode-month').addEventListener('click', () => setCalendarViewMode('month'));
    document.getElementById('btn-view-mode-week').addEventListener('click', () => setCalendarViewMode('week'));
    document.getElementById('btn-add-event').addEventListener('click', () => openEventModal(null));
    document.getElementById('btn-close-event-modal').addEventListener('click', closeEventModal);
    document.getElementById('btn-save-event').addEventListener('click', saveEventFromModal);
    document.getElementById('btn-delete-event').addEventListener('click', deleteEventFromModal);

    // 看板录入
    document.getElementById('btn-add-track').addEventListener('click', () => {
        const company = document.getElementById('track-company').value.trim();
        const role = document.getElementById('track-role').value.trim();
        const link = document.getElementById('track-link').value.trim();
        const date = document.getElementById('track-date').value;
        const status = document.getElementById('track-status').value;
        const jd = document.getElementById('track-jd').value.trim();

        if (!company || !role || !date) {
            alert('请完整填写公司名称、岗位名称和投递日期！');
            return;
        }

        const newApp = { id: 'app_' + Date.now(), company, role, link, date, status, jd };
        state.applications.push(newApp);
        localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));

        document.getElementById('track-company').value = '';
        document.getElementById('track-role').value = '';
        document.getElementById('track-link').value = '';
        document.getElementById('track-jd').value = '';
        
        renderApplications();
        alert('成功记入秋招漏斗看板！');
    });

    document.getElementById('btn-open-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.remove('hidden');
        document.getElementById('cfg-api-key').value = state.settings.apiKey || '';
        document.getElementById('cfg-api-base').value = state.settings.apiBase || '';
        document.getElementById('cfg-model').value = state.settings.model || '';
    });
    
    document.getElementById('btn-close-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('hidden');
    });

    document.getElementById('btn-save-settings').addEventListener('click', () => {
        state.settings.apiKey = document.getElementById('cfg-api-key').value.trim();
        state.settings.apiBase = document.getElementById('cfg-api-base').value.trim();
        state.settings.model = document.getElementById('cfg-model').value.trim();
        localStorage.setItem('interview_prep_settings', JSON.stringify(state.settings));
        document.getElementById('settings-modal').classList.add('hidden');
        checkApiKeyStatus();
        alert('配置已成功保存！');
    });

    document.getElementById('btn-run-pipeline').addEventListener('click', runFullPipeline);

    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('border-zinc-900', 'text-zinc-900'));
            tab.classList.add('border-zinc-900', 'text-zinc-900');

            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            const target = document.getElementById(`tab-panel-${tab.dataset.tab}`);
            target.classList.remove('hidden');

            // 重置动画，保证重复点击同一个 tab 也能重新触发渐显效果
            target.style.animation = 'none';
            void target.offsetWidth; // 强制触发重排
            target.style.animation = '';
        });
    });
}

window.copyTabContent = (panelId) => {
    const el = document.getElementById(panelId);
    if (!el) return;
    navigator.clipboard.writeText(el.innerText).then(() => alert('内容已成功复制！'));
};

// 🌟 新增：保存某一步生成结果，同时写入 activeSession（全局临时态）和绑定的看板记录（持久态）
function persistPipelineResult(key, value) {
    state.activeSession.results[key] = value;
    localStorage.setItem('interview_prep_active_session', JSON.stringify(state.activeSession));

    if (state.activeAppId) {
        state.applications = state.applications.map(a => {
            if (a.id !== state.activeAppId) return a;
            const prepResults = { ...(a.prepResults || {}), [key]: value };
            return { ...a, prepResults };
        });
        localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
    }
}

async function runFullPipeline() {
    if (!state.settings.apiKey) {
        alert('请先配置大模型 API 密钥！');
        document.getElementById('settings-modal').classList.remove('hidden');
        return;
    }

    const companyName = document.getElementById('in-company').value.trim();
    const roleTitle = document.getElementById('in-role').value.trim();
    const region = document.getElementById('in-region').value;
    const language = document.getElementById('in-lang').value;
    const jd = document.getElementById('in-jd').value.trim();

    if (!companyName || !roleTitle || !jd) {
        alert('请完整填写公司名称、岗位名称以及岗位 JD！');
        return;
    }

    const checkedBoxes = document.querySelectorAll('input[name="selected_resumes"]:checked');
    let resumeTextForAI = "";
    checkedBoxes.forEach(cb => {
        const res = state.resumes.find(r => r.id === cb.value);
        if (res && res.content) resumeTextForAI += `=== 简历版本: ${res.name} ===\n${res.content}\n\n`;
    });

    if (!resumeTextForAI) {
        state.resumes.filter(r => r.content).forEach(res => {
            resumeTextForAI += `=== 简历版本: ${res.name} ===\n${res.content}\n\n`;
        });
    }

    state.activeSession = { companyName, region, roleTitle, language, jd, results: {} };
    const overlay = document.getElementById('loading-overlay');
    const logNode = document.getElementById('loading-logs');
    overlay.classList.remove('hidden');
    logNode.innerHTML = "";

    const addLog = (text) => {
        const p = document.createElement('p');
        p.className = "text-zinc-600 mb-1";
        p.innerText = `[${new Date().toLocaleTimeString()}] ${text}`;
        logNode.appendChild(p);
        logNode.scrollTop = logNode.scrollHeight;
    };

    try {
        addLog("▶ 正在启动 Step 1: 智能评测候选简历匹配度...");
        const res1 = await callLLM(window.PromptTemplates.resumeSelection(resumeTextForAI, jd, region, language));
        renderMarkdown('tab-panel-match-raw', res1);
        persistPipelineResult('match', res1);

        addLog("▶ 正在启动 Step 2: 拆解公司商业大盘、岗位坐标...");
        const res2 = await callLLM(window.PromptTemplates.businessContext(companyName, jd, region));
        renderMarkdown('tab-panel-business-raw', res2);
        persistPipelineResult('business', res2);

        addLog("▶ 正在启动 Step 3: 重构纯口语 30s/1min/2min 自述...");
        const res3 = await callLLM(window.PromptTemplates.selfIntroduction(resumeTextForAI, jd, language, region));
        renderMarkdown('tab-panel-intro-raw', res3);
        persistPipelineResult('intro', res3);

        addLog("▶ 正在启动 Step 4: 锻造口语作答的 STAR 故事金句...");
        const res4 = await callLLM(window.PromptTemplates.starStories(resumeTextForAI, jd, language, region));
        renderMarkdown('tab-panel-star-raw', res4);
        persistPipelineResult('star', res4);

        addLog("▶ 正在启动 Step 5: 建模突发场景问答及神仙反问策略...");
        const res5 = await callLLM(window.PromptTemplates.businessPrepAndQuestions(companyName, jd, language));
        renderMarkdown('tab-panel-qa-raw', res5);
        persistPipelineResult('qa', res5);

        addLog("✔ 管道流完整完整处理完成！");
        setTimeout(() => {
            overlay.classList.add('hidden');
            document.querySelector('.tab-btn[data-tab="match"]').click();
        }, 800);
    } catch (error) {
        addLog(`❌ 出错了: ${error.message}`);
        alert(`流水线阻碍: ${error.message}`);
        setTimeout(() => overlay.classList.add('hidden'), 3000);
    }
}

async function callLLM(prompt) {
    const url = `${state.settings.apiBase.replace(/\/$/, '')}/chat/completions`;
    const body = JSON.stringify({
        model: state.settings.model,
        messages: [
            { role: 'system', content: 'You are an elite all-in-one career platform backend assistant.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.3
    });
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.settings.apiKey}` }, body });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return data.choices[0].message.content;
}

function renderMarkdown(elementId, markdownText) {
    const target = document.getElementById(elementId);
    if (target && window.marked && window.marked.parse) target.innerHTML = window.marked.parse(markdownText);
}
/**
 * 从看板一键联动到录音复盘模块
 * @param {string} appId 投递记录ID
 */
function startAudioReviewFromBoard(appId) {
    // 1. 查找对应的投递记录
    const app = state.applications.find(a => a.id === appId);
    if (!app) {
        alert("未找到该投递岗位的相关信息");
        return;
    }

    // 2. 这里的 ID 需要和你在 index.html 中录音复盘表单的 input id 保持一致
    // 假设你的录音复盘模块中，“公司”和“岗位”的输入框 ID 分别是 'audio-company' 和 'audio-role'
    // (如果你的 HTML 里是其他名字，请将下面这俩 DOM ID 改成你实际的名字)
    const companyInput = document.getElementById('audio-company') || document.getElementById('voice-company') || document.getElementById('review-company');
    const roleInput = document.getElementById('audio-role') || document.getElementById('voice-role') || document.getElementById('review-role');
    
    if (companyInput && roleInput) {
        // 自动填入看板中已有的岗位数据
        companyInput.value = app.company || '';
        roleInput.value = app.role || '';
        
        // 可选：如果你的复盘模块还有“面试轮次”或“日期”输入框，也可以联动过去
        const dateInput = document.getElementById('audio-date') || document.getElementById('voice-date') || document.getElementById('review-date');
        if (dateInput) dateInput.value = app.date || '';

        // 3. 视觉反馈：平滑滚动到录音复盘模块所在的区域
        // 假设录音复盘的最外层容器 ID 是 'audio-review-section' 或 'voice-section'
        const targetSection = document.getElementById('audio-review-section') || document.getElementById('voice-section') || companyInput.closest('section') || companyInput.closest('.bg-white');
        
        if (targetSection) {
            targetSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // 让输入框高亮闪烁两下，提示用户“已自动填入”
            companyInput.classList.add('ring-2', 'ring-amber-400');
            roleInput.classList.add('ring-2', 'ring-amber-400');
            setTimeout(() => {
                companyInput.classList.remove('ring-2', 'ring-amber-400');
                roleInput.classList.remove('ring-2', 'ring-amber-400');
            }, 1500);
        }
    } else {
        // 保底提示：防止 DOM 的 ID 没对上
        console.warn("未找到录音复盘模块对应的输入框元素，请检查 HTML 中的 id 属性。");
        alert(`已为您复制岗位信息：${app.company} - ${app.role}。请直接去录音模块粘贴。`);
    }
}
