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
    activeSession: { companyName: '', region: 'Singapore', roleTitle: '', language: 'bilingual', jd: '', results: {} }
};

function initApp() {
    const savedSettings = localStorage.getItem('interview_prep_settings');
    if (savedSettings) state.settings = JSON.parse(savedSettings);
    const savedResumes = localStorage.getItem('interview_prep_resumes');
    if (savedResumes) state.resumes = JSON.parse(savedResumes);
    
    const savedApps = localStorage.getItem('interview_prep_apps');
    if (savedApps) state.applications = JSON.parse(savedApps);

    // 🌟 新增：恢复上一次生成的备战会话（公司/岗位/JD/五份报告）
    const savedSession = localStorage.getItem('interview_prep_active_session');
    if (savedSession) {
        try {
            state.activeSession = JSON.parse(savedSession);
        } catch (e) {
            console.warn('恢复上次会话失败:', e);
        }
    }

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

// 🌟 新增：清空当前工作台的生成结果（保留输入框内容，仅清空 AI 报告）
window.clearActiveSessionResults = () => {
    if (!confirm('确定要清空当前工作台的全部生成结果吗？此操作不可恢复。')) return;
    state.activeSession.results = {};
    localStorage.removeItem('interview_prep_active_session');

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
function renderApplications() {
    const tbody = document.getElementById('tracker-table-body');
    const statsContainer = document.getElementById('tracker-stats');
    if (!tbody) return;

    if (state.applications.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-zinc-400 italic">暂无投递记录，快在左侧添加你的第一个秋招意向吧！</td></tr>`;
        if (statsContainer) statsContainer.innerHTML = "总计: 0";
        return;
    }

    const sortedApps = [...state.applications].sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = sortedApps.map(app => {
        return `
            <tr class="border-b border-zinc-100 hover:bg-zinc-50/50 transition">
                <td class="p-3 font-mono text-[11px] text-zinc-400">${app.date}</td>
                <td class="p-3 font-bold text-zinc-800">${app.company}</td>
                <td class="p-3 text-zinc-600">${app.role}</td>
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
                    <button onclick="activateAppForPrep('${app.id}')" class="px-2 py-1 bg-zinc-950 text-white rounded text-[11px] font-bold hover:bg-zinc-800 transition cursor-pointer">
                        🚀 备战面试
                    </button>
                    <button onclick="deleteApp('${app.id}')" class="text-zinc-400 hover:text-red-500 text-xs p-1 cursor-pointer">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');

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
    renderApplications();
};

window.activateAppForPrep = (id) => {
    const app = state.applications.find(a => a.id === id);
    if (!app) return;

    switchView('workspace');
    document.getElementById('in-company').value = app.company;
    document.getElementById('in-role').value = app.role;
    document.getElementById('in-jd').value = app.jd || '';

    document.getElementById('initial-state').classList.remove('hidden');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('border-zinc-900', 'text-zinc-900'));

    alert(`🎯 已同步【${app.company}】数据，请在右侧选择好对应的匹配简历后点击启动！`);
};

// ================= 三视图核心切换开关 =================
function switchView(viewName) {
    const wsNav = document.getElementById('nav-workspace');
    const trNav = document.getElementById('nav-tracker');
    const dbNav = document.getElementById('nav-debrief');

    const wsView = document.getElementById('view-workspace');
    const trView = document.getElementById('view-tracker');
    const dbView = document.getElementById('view-debrief');

    // 清洗类名
    const activeClass = "px-4 py-1.5 rounded-md text-xs font-bold transition bg-white text-zinc-950 shadow-xs cursor-pointer";
    const inactiveClass = "px-4 py-1.5 rounded-md text-xs font-medium text-zinc-500 hover:text-zinc-900 transition cursor-pointer";

    wsView.classList.add('hidden');
    trView.classList.add('hidden');
    dbView.classList.add('hidden');

    wsNav.className = inactiveClass;
    trNav.className = inactiveClass;
    dbNav.className = inactiveClass;

    if (viewName === 'workspace') {
        wsView.classList.remove('hidden');
        wsNav.className = activeClass;
    } else if (viewName === 'tracker') {
        trView.classList.remove('hidden');
        trNav.className = activeClass;
        renderApplications();
    } else if (viewName === 'debrief') {
        dbView.classList.remove('hidden');
        dbNav.className = activeClass;
    }
}

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
    document.getElementById('nav-debrief').addEventListener('click', () => switchView('debrief')); // 新增

    document.getElementById('btn-run-debrief').addEventListener('click', runDebriefPipeline); // 新增

    // 看板录入
    document.getElementById('btn-add-track').addEventListener('click', () => {
        const company = document.getElementById('track-company').value.trim();
        const role = document.getElementById('track-role').value.trim();
        const date = document.getElementById('track-date').value;
        const status = document.getElementById('track-status').value;
        const jd = document.getElementById('track-jd').value.trim();

        if (!company || !role || !date) {
            alert('请完整填写公司名称、岗位名称和投递日期！');
            return;
        }

        const newApp = { id: 'app_' + Date.now(), company, role, date, status, jd };
        state.applications.push(newApp);
        localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));

        document.getElementById('track-company').value = '';
        document.getElementById('track-role').value = '';
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
        state.activeSession.results.match = res1;
        localStorage.setItem('interview_prep_active_session', JSON.stringify(state.activeSession));

        addLog("▶ 正在启动 Step 2: 拆解公司商业大盘、岗位坐标...");
        const res2 = await callLLM(window.PromptTemplates.businessContext(companyName, jd, region));
        renderMarkdown('tab-panel-business-raw', res2);
        state.activeSession.results.business = res2;
        localStorage.setItem('interview_prep_active_session', JSON.stringify(state.activeSession));

        addLog("▶ 正在启动 Step 3: 重构纯口语 30s/1min/2min 自述...");
        const res3 = await callLLM(window.PromptTemplates.selfIntroduction(resumeTextForAI, jd, language, region));
        renderMarkdown('tab-panel-intro-raw', res3);
        state.activeSession.results.intro = res3;
        localStorage.setItem('interview_prep_active_session', JSON.stringify(state.activeSession));

        addLog("▶ 正在启动 Step 4: 锻造口语作答的 STAR 故事金句...");
        const res4 = await callLLM(window.PromptTemplates.starStories(resumeTextForAI, jd, language, region));
        renderMarkdown('tab-panel-star-raw', res4);
        state.activeSession.results.star = res4;
        localStorage.setItem('interview_prep_active_session', JSON.stringify(state.activeSession));

        addLog("▶ 正在启动 Step 5: 建模突发场景问答及神仙反问策略...");
        const res5 = await callLLM(window.PromptTemplates.businessPrepAndQuestions(companyName, jd, language));
        renderMarkdown('tab-panel-qa-raw', res5);
        state.activeSession.results.qa = res5;
        localStorage.setItem('interview_prep_active_session', JSON.stringify(state.activeSession));

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
