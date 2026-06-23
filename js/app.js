/**
 * PREP.FLOW - 核心业务状态机与交互逻辑
 */

// 1. 全局核心应用状态机
let state = {
    applications: [],           // 看板投递记录列表
    activeAppId: null,          // 当前正在编辑的看板记录 ID
    activeDebriefAppId: null,   // 🌟 核心升级：标记当前录音复盘会话深度绑定的看板记录 ID
    calendarViewDate: new Date(),
    calendarViewMode: 'month'
};

// 2. 初始化应用并装载持久化 LocalStorage 数据
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    // 恢复看板记录
    const savedApps = localStorage.getItem('interview_prep_apps');
    if (savedApps) {
        state.applications = JSON.parse(savedApps);
    } else {
        // 预置高价值种子 Mock 数据，方便快速预览
        state.applications = [
            { id: 'mock-1', company: 'TikTok Shop', role: 'SEA Regional IMC Campaign Operations Project Intern', status: '面试邀约', jd: '负责东南亚大促整合营销节点拆解，使用SQL进行多维归因及数据自动化看板搭建。', debriefReport: '', debriefTranscript: '' },
            { id: 'mock-2', company: '美团', role: '到店事业部 - 商业策略分析师', status: '简历投递', jd: '聚焦到店业务关键指标漏斗拆解，通过数据自动化看板沉淀核心指标。', debriefReport: '', debriefTranscript: '' }
        ];
        localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
    }

    // 恢复复盘绑定状态机制
    const savedActiveDebriefAppId = localStorage.getItem('interview_prep_active_debrief_app_id');
    if (savedActiveDebriefAppId) {
        state.activeDebriefAppId = JSON.parse(savedActiveDebriefAppId);
    }

    // 默认切到看板视图
    switchView('apps');
}

// 3. 极简单页视图平滑切换路由
window.switchView = function(viewName) {
    // 隐藏所有视图
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    
    // 重置导航按钮状态
    const inactiveClass = "text-stone-500 hover:text-stone-900 px-4 py-2 text-xs font-medium rounded-lg transition-all";
    const activeClass = "bg-stone-900 text-white px-4 py-2 text-xs font-medium rounded-lg shadow-sm transition-all";
    
    document.getElementById('nav-apps').className = inactiveClass;
    document.getElementById('nav-calendar').className = inactiveClass;
    document.getElementById('nav-debrief').className = inactiveClass;

    // 激活指定视图
    const currentView = document.getElementById(`view-${viewName}`);
    const currentNav = document.getElementById(`nav-${viewName}`);
    
    if (currentView && currentNav) {
        currentView.classList.remove('hidden');
        currentNav.className = activeClass;
    }

    // 针对特定视图做动态重绘渲染
    if (viewName === 'apps') {
        renderApplications();
    } else if (viewName === 'debrief') {
        populateDebriefAppLinkOptions(); // 🌟 切换至复盘时，立即装载并更新联动下拉菜单
    }
};

// 4. 看板视图模块：核心数据渲染渲染器
function renderApplications() {
    const tbody = document.getElementById('apps-table-body');
    if (!tbody) return;

    if (state.applications.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-stone-400">暂无投递记录，点击右上角开始追踪第一笔投递吧！</td></tr>`;
        return;
    }

    tbody.innerHTML = state.applications.map(app => {
        // 判断该记录是否已经挂载了复盘报告
        const hasDebrief = app.debriefReport && app.debriefReport.length > 0;
        const debriefBtnClass = hasDebrief 
            ? 'text-rose-600 font-bold bg-rose-50 border border-rose-100 rounded-md px-1.5 py-0.5' 
            : 'text-stone-400 hover:text-rose-600 transition';

        return `
            <tr class="hover:bg-stone-50/50 transition">
                <td class="py-4 px-6 font-medium text-stone-900">${app.company}</td>
                <td class="py-4 px-6 text-stone-500">${app.role}</td>
                <td class="py-4 px-6">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getStatusColorClass(app.status)}">
                        ${app.status}
                    </span>
                </td>
                <td class="py-4 px-6 text-right space-x-3">
                    <button onclick="openDebriefForApp('${app.id}')" class="${debriefBtnClass} text-xs cursor-pointer" title="${hasDebrief ? '查看/编辑已有AI复盘报告' : '直接为此面试启动智能录音复盘'}">
                        ${hasDebrief ? '📝 已复盘' : '📝 去复盘'}
                    </button>
                    <button onclick="openEditAppModal('${app.id}')" class="text-stone-400 hover:text-stone-900 transition text-xs cursor-pointer" title="修改基本信息">⚙️</button>
                    <button onclick="deleteApplication('${app.id}')" class="text-stone-300 hover:text-red-600 transition text-xs cursor-pointer" title="物理删除记录">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}

function getStatusColorClass(status) {
    switch (status) {
        case '简历投递': return 'bg-stone-100 text-stone-600';
        case '笔试评估': return 'bg-amber-50 text-amber-700 border border-amber-100';
        case '面试邀约': return 'bg-blue-50 text-blue-700 border border-blue-100';
        case 'Offer': return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
        case '遗憾人才库': return 'bg-stone-200 text-stone-400 line-through';
        default: return 'bg-stone-100 text-stone-600';
    }
}

// 5. 🌟 联动核心：复盘与看板相互调停逻辑函数
function populateDebriefAppLinkOptions() {
    const select = document.getElementById('debrief-app-link');
    if (!select) return;
    
    const options = ['<option value="">— 自由复盘模式（不挂载记录） —</option>']
        .concat(state.applications.map(a => `
            <option value="${a.id}" ${a.id === state.activeDebriefAppId ? 'selected' : ''}>
                ${a.company} - ${a.role}
            </option>
        `));
    select.innerHTML = options.join('');
}

window.handleDebriefLinkChange = function(appId) {
    state.activeDebriefAppId = appId || null;
    if (appId) {
        localStorage.setItem('interview_prep_active_debrief_app_id', JSON.stringify(appId));
    } else {
        localStorage.removeItem('interview_prep_active_debrief_app_id');
    }
    
    const reportRawNode = document.getElementById('debrief-report-raw');
    const initialState = document.getElementById('debrief-initial-state');
    const statusTag = document.getElementById('debrief-status-tag');

    // 自由模式，不做表单覆写
    if (!appId) {
        document.getElementById('debrief-company').value = '';
        document.getElementById('debrief-role').value = '';
        document.getElementById('debrief-jd').value = '';
        document.getElementById('debrief-transcript').value = '';
        reportRawNode.innerHTML = '';
        initialState.classList.remove('hidden');
        statusTag.innerText = '自由复盘';
        statusTag.className = 'text-[10px] bg-stone-100 text-stone-500 px-2 py-0.5 rounded-md font-medium';
        return;
    }

    const app = state.applications.find(a => a.id === appId);
    if (!app) return;

    // 智能回填看板基础核心字段
    document.getElementById('debrief-company').value = app.company;
    document.getElementById('debrief-role').value = app.role;
    document.getElementById('debrief-jd').value = app.jd || '';
    document.getElementById('debrief-transcript').value = app.debriefTranscript || '';

    // 判断之前是否产生过复盘报告
    if (app.debriefReport && app.debriefReport.trim().length > 0) {
        initialState.classList.add('hidden');
        statusTag.innerText = '已生成诊断';
        statusTag.className = 'text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-0.5 rounded-md font-medium';
        
        if (window.marked && window.marked.parse) {
            reportRawNode.innerHTML = window.marked.parse(app.debriefReport);
        } else {
            reportRawNode.innerText = app.debriefReport;
        }
    } else {
        // 看板记录存在但尚未进行 AI 复盘
        reportRawNode.innerHTML = '';
        initialState.classList.remove('hidden');
        statusTag.innerText = '等待录音稿';
        statusTag.className = 'text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-md font-medium';
    }
};

window.openDebriefForApp = function(appId) {
    state.activeDebriefAppId = appId;
    localStorage.setItem('interview_prep_active_debrief_app_id', JSON.stringify(appId));
    switchView('debrief');
    handleDebriefLinkChange(appId);
};

// 6. AI 大模型复盘诊断管线模拟 (保持逻辑完全体，可无缝平替为真正的 API 请求)
window.runDebriefPipeline = function() {
    const company = document.getElementById('debrief-company').value.trim();
    const role = document.getElementById('debrief-role').value.trim();
    const transcript = document.getElementById('debrief-transcript').value.trim();
    const jd = document.getElementById('debrief-jd').value.trim();

    if (!company || !transcript) {
        alert('请至少填写公司名称并贴入面试录音转文本内容！');
        return;
    }

    const btn = document.getElementById('btn-run-debrief');
    const statusTag = document.getElementById('debrief-status-tag');
    btn.disabled = true;
    btn.innerText = 'AI 正在全力拆解诊断中...';
    statusTag.innerText = '正在诊断';
    statusTag.className = 'text-[10px] bg-amber-50 text-amber-600 border border-amber-100 px-2 py-0.5 rounded-md font-medium animate-pulse';

    // 模拟大模型 1.5 秒处理延时
    setTimeout(() => {
        // 自动构建深度定制化复盘 Mock Markdown 数据（贴合你的日常业务场景与痛点分析）
        const reportResult = `
### 🎯 PREP.FLOW 独家复盘诊断报告

#### 1. 核心亮点与数据思维评估
* **亮点表现**：在回答核心业务指标拆解时，展现了极强的**数据自动化思维**。主动提及使用 **SQL 替换传统人工表格操作**，搭建全链路转化漏斗，逻辑闭环清晰。
* **高价值产出**：准确锚定了业务转化率痛点，具备出色的业务策略全局观。

#### 2. 深度痛点与结构化失分项诊断
* **表达精炼度问题**：在遭遇突发追问（如具体归因算法模型或异常数据处理细节）时，叙述略显拖沓，层级感可进一步借助 STAR 法则剥离。
* **场景契合度**：针对 ${company} 极度高频的快节奏复盘场景，数据沉淀的颗粒度尚未讲透。

#### 3. 逐题高分重塑与完美作答话术 (建议背诵)
> *"针对本次提到的营销场景，最佳的回答路径应当是：第一步，基于底层数据平台提取核心指标；第二步，通过 SQL 构建全闭环漏斗模型；第三步，摒弃手工，实现业务复盘自动化看板周报化投递..."*

---
*报告生成时间: 2026年 ｜ 决策引擎: Prep.Flow Advanced LLM v2*
`;

        // 核心回填
        document.getElementById('debrief-initial-state').classList.add('hidden');
        const reportRawNode = document.getElementById('debrief-report-raw');
        if (window.marked && window.marked.parse) {
            reportRawNode.innerHTML = window.marked.parse(reportResult);
        } else {
            reportRawNode.innerText = reportResult;
        }

        // 🌟 核心增量逻辑：如果绑定了看板ID，则把AI诊断结果实时写回该看板实体中
        if (state.activeDebriefAppId) {
            state.applications = state.applications.map(a => {
                if (a.id === state.activeDebriefAppId) {
                    return { ...a, debriefReport: reportResult, debriefTranscript: transcript };
                }
                return a;
            });
            localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
        }

        // 重置按钮与标签状态
        btn.disabled = false;
        btn.innerText = '运行深度全盘诊断';
        statusTag.innerText = '已生成诊断';
        statusTag.className = 'text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-0.5 rounded-md font-medium';
        
        alert('AI 首席面试官复盘成功！诊断数据已安全沉淀至对应的看板记录中。');
    }, 1500);
};

// 7. 清空复盘会话与状态解绑
window.clearDebriefResults = function() {
    if (!confirm('确定要清空当前的复盘内容吗？此操作将同步清除挂载在此次投递记录下的复盘档案。')) return;

    if (state.activeDebriefAppId) {
        state.applications = state.applications.map(a => 
            a.id === state.activeDebriefAppId ? { ...a, debriefReport: '', debriefTranscript: '' } : a
        );
        localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
    }

    document.getElementById('debrief-transcript').value = '';
    const reportRawNode = document.getElementById('debrief-report-raw');
    if (reportRawNode) reportRawNode.innerHTML = '';
    const initialState = document.getElementById('debrief-initial-state');
    if (initialState) initialState.classList.remove('hidden');
    
    const statusTag = document.getElementById('debrief-status-tag');
    statusTag.innerText = '等待录音稿';
    statusTag.className = 'text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-md font-medium';

    renderApplications();
};

// 8. 辅助函数：看板模态框底层增删改逻辑
window.openAddAppModal = function() {
    state.activeAppId = null;
    document.getElementById('modal-title').innerText = "新增投递记录";
    document.getElementById('modal-company').value = "";
    document.getElementById('modal-role').value = "";
    document.getElementById('modal-status').value = "简历投递";
    document.getElementById('modal-jd').value = "";
    document.getElementById('app-modal').classList.remove('hidden');
    document.getElementById('app-modal').classList.add('flex');
};

window.openEditAppModal = function(id) {
    const app = state.applications.find(a => a.id === id);
    if (!app) return;
    state.activeAppId = id;
    document.getElementById('modal-title').innerText = "修改投递记录";
    document.getElementById('modal-company').value = app.company;
    document.getElementById('modal-role').value = app.role;
    document.getElementById('modal-status').value = app.status;
    document.getElementById('modal-jd').value = app.jd || "";
    document.getElementById('app-modal').classList.remove('hidden');
    document.getElementById('app-modal').classList.add('flex');
};

window.closeAppModal = function() {
    document.getElementById('app-modal').classList.add('hidden');
    document.getElementById('app-modal').classList.remove('flex');
};

window.saveAppModal = function() {
    const company = document.getElementById('modal-company').value.trim();
    const role = document.getElementById('modal-role').value.trim();
    const status = document.getElementById('modal-status').value;
    const jd = document.getElementById('modal-jd').value.trim();

    if (!company || !role) {
        alert('公司名称与目标岗位属于必填项！');
        return;
    }

    if (state.activeAppId) {
        // 编辑现有记录模式
        state.applications = state.applications.map(a => 
            a.id === state.activeAppId ? { ...a, company, role, status, jd } : a
        );
    } else {
        // 创建全新记录模式
        const newApp = {
            id: 'app_' + Date.now(),
            company,
            role,
            status,
            jd,
            debriefReport: '',
            debriefTranscript: ''
        };
        state.applications.push(newApp);
    }

    localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
    closeAppModal();
    renderApplications();
};

window.deleteApplication = function(id) {
    if (!confirm('确定要永久删除这条投递追踪记录吗？与之联动的复盘也将一并清除。')) return;
    state.applications = state.applications.filter(a => a.id !== id);
    if (state.activeDebriefAppId === id) {
        state.activeDebriefAppId = null;
        localStorage.removeItem('interview_prep_active_debrief_app_id');
    }
    localStorage.setItem('interview_prep_apps', JSON.stringify(state.applications));
    renderApplications();
};
