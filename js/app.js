// ============================================================
// Offer Copilot — 主应用逻辑
// 依赖：config.js / auth.js / store.js / prompts.js / resume.js
// ============================================================

// ---------------- 工具函数 ----------------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function toast(text, type = 'ok', ms = 2600) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = text;
    $('toasts').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
}

function md(text) {
    return window.marked && window.marked.parse ? window.marked.parse(text || '') : esc(text).replace(/\n/g, '<br>');
}

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

function formatDateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------- 全局状态 ----------------
const cfg = window.APP_CONFIG || {};
const state = {
    user: null,
    guest: true,
    llm: { apiKey: '', apiBase: cfg.DEFAULT_API_BASE || 'https://api.deepseek.com/v1', model: cfg.DEFAULT_MODEL || 'deepseek-chat' },
    resumes: [],
    applications: [],
    events: [],
    activeSession: { companyName: '', region: 'Singapore', roleTitle: '', language: 'bilingual', jd: '', results: {} },
    activeAppId: null,
    debriefAppId: null,
    activeTab: 'match',
    view: 'workspace',
    calDate: new Date(),
    calMode: 'month'
};

const STATUSES = [
    { v: '待投递', label: '待投递', cls: 'st-wish' },
    { v: '已投递', label: '已投递', cls: 'st-applied' },
    { v: '笔试中', label: '笔试/测评', cls: 'st-oa' },
    { v: '面试中', label: '面试中', cls: 'st-interview' },
    { v: '已拿Offer', label: '🎉 Offer', cls: 'st-offer' },
    { v: '流程终止', label: '已结束', cls: 'st-end' }
];
const statusCls = (v) => (STATUSES.find(s => s.v === v) || STATUSES[0]).cls;

const TAB_KEYS = ['match', 'business', 'intro', 'star', 'qa'];
const TAB_LABELS = { match: '简历匹配', business: '商业拆解', intro: '自我介绍', star: 'STAR 故事', qa: '案例与反问' };

// ---------------- 持久化 ----------------
const save = {
    resumes: () => Store.set('resumes', state.resumes),
    apps: () => Store.set('applications', state.applications),
    events: () => Store.set('events', state.events),
    session: () => Store.set('activeSession', state.activeSession),
    activeApp: () => Store.set('activeAppId', state.activeAppId),
    llm: () => Store.set('llm', state.llm)
};

function loadState() {
    const llm = Store.get('llm', null);
    if (llm) state.llm = { ...state.llm, ...llm };

    state.resumes = (Store.get('resumes', null) || []).map(Resume.normalize);
    state.applications = (Store.get('applications', []) || []).map(a => ({ ...a, status: a.status === '未投递' ? '待投递' : (a.status || '待投递') }));
    state.events = Store.get('events', []) || [];
    const s = Store.get('activeSession', null);
    if (s) state.activeSession = { ...state.activeSession, ...s, results: s.results || {} };
    state.activeAppId = Store.get('activeAppId', null);
    const ui = Store.get('ui', {});
    if (ui.view) state.view = ui.view;
    if (ui.calMode) state.calMode = ui.calMode;
}

// ---------------- 启动 ----------------
document.addEventListener('DOMContentLoaded', boot);

async function boot() {
    const { user, guest } = await Auth.requireAuth();
    state.user = user;
    state.guest = guest;
    $('boot-text').textContent = user ? '正在同步云端数据...' : '正在加载本地数据...';
    await Store.init({ user });

    loadState();
    if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    renderUser();
    bindGlobal();
    bindWorkspace();
    bindTracker();
    bindCalendar();
    bindDebrief();
    Resume.init();

    restoreWorkspace();
    restoreDebrief();
    renderResumePicks();
    renderTracker();
    renderCalendar();
    renderUpcoming();
    updateBadges();
    checkApiKey();
    switchView(state.view);

    Store.onStatus(renderSync);
    $('boot').style.transition = 'opacity .3s';
    $('boot').style.opacity = '0';
    setTimeout(() => $('boot').remove(), 300);
}

function renderUser() {
    const name = Auth.displayName(state.user);
    const initial = (name || '?').slice(0, 1).toUpperCase();
    $('user-name').textContent = name;
    $('user-avatar').textContent = initial;
    $('settings-avatar').textContent = initial;
    $('settings-name').textContent = name;
    $('settings-email').textContent = state.user ? state.user.email : '游客模式 · 数据仅保存在本浏览器';
    $('btn-logout').textContent = state.user ? '退出登录' : '去登录 / 注册';
    $('hello-name').textContent = name;
    $('btn-sync-now').classList.toggle('hidden', !state.user);
}

function renderSync(status) {
    const text = { local: '仅本地', syncing: '同步中...', synced: '已同步', error: '同步失败', offline: '离线' }[status] || status;
    ['sync-pill', 'sync-pill-m'].forEach(id => { const el = $(id); if (el) { el.dataset.status = status; el.title = Store.lastError || text; } });
    $('sync-text').textContent = state.user ? text : '游客 · 仅本地';
}

function updateBadges() {
    $('badge-resumes').textContent = state.resumes.length;
    $('badge-apps').textContent = state.applications.length;
    const today = formatDateKey(new Date());
    const soon = state.events.filter(e => e.date >= today && e.date <= formatDateKey(new Date(Date.now() + 7 * 864e5))).length;
    $('badge-events').textContent = soon;
    $('badge-events').classList.toggle('hidden', soon === 0);
}

function checkApiKey() {
    $('api-banner').classList.toggle('hidden', !!state.llm.apiKey);
}

function requireApiKey() {
    if (state.llm.apiKey) return true;
    toast('请先配置大模型 API Key', 'err');
    openSettings();
    return false;
}

// ---------------- 视图切换 ----------------
function switchView(view) {
    state.view = view;
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== `view-${view}`));
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    const viewEl = $(`view-${view}`);
    if (viewEl) { viewEl.classList.remove('fade-in'); void viewEl.offsetWidth; viewEl.classList.add('fade-in'); }
    if (view === 'calendar') { renderCalendar(); renderUpcoming(); }
    if (view === 'tracker') renderTracker();
    if (view === 'workspace') renderResumePicks();
    Store.set('ui', { ...Store.get('ui', {}), view });
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindGlobal() {
    document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
    document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.goto)));
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
    document.querySelectorAll('.modal-mask').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m && m.id !== 'loading') closeModal(m.id); }));
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') ['event-modal', 'settings-modal', 'track-modal'].forEach(closeModal);
    });

    [$('btn-open-settings'), $('btn-open-settings-m'), ...document.querySelectorAll('[data-open-settings]')].forEach(b => b && b.addEventListener('click', openSettings));
    $('btn-save-settings').addEventListener('click', () => {
        state.llm.apiKey = $('cfg-api-key').value.trim();
        state.llm.apiBase = $('cfg-api-base').value.trim() || cfg.DEFAULT_API_BASE;
        state.llm.model = $('cfg-model').value.trim() || cfg.DEFAULT_MODEL;
        save.llm();
        checkApiKey();
        closeModal('settings-modal');
        toast('设置已保存');
    });
    $('btn-logout').addEventListener('click', async () => {
        if (state.user) {
            if (!confirm('确定退出登录吗？')) return;
            await Store.flush();
        }
        Auth.signOut();
    });
    $('btn-sync-now').addEventListener('click', async () => { await Store.pull(); loadState(); rerenderAll(); toast('已与云端同步'); });
    $('btn-export').addEventListener('click', exportBackup);
    $('import-input').addEventListener('change', importBackup);
}

function openSettings() {
    $('cfg-api-key').value = state.llm.apiKey || '';
    $('cfg-api-base').value = state.llm.apiBase || '';
    $('cfg-model').value = state.llm.model || '';
    openModal('settings-modal');
}

function rerenderAll() {
    restoreWorkspace();
    restoreDebrief();
    Resume.renderList();
    Resume.renderDetail();
    renderResumePicks();
    renderTracker();
    renderCalendar();
    renderUpcoming();
    updateBadges();
}

function exportBackup() {
    const data = { app: 'offer-copilot', version: 2, exportedAt: new Date().toISOString(), ...Store.snapshot() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `offer-copilot-backup-${formatDateKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

async function importBackup(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        const data = JSON.parse(await file.text());
        if (!confirm('导入会覆盖当前的简历、看板、日程和备战结果，确定继续吗？')) return;
        ['resumes', 'applications', 'events', 'activeSession', 'activeAppId', 'debrief'].forEach(k => {
            if (data[k] !== undefined) Store.set(k, data[k]);
        });
        loadState();
        rerenderAll();
        toast('备份已导入');
    } catch (err) {
        toast('文件格式不正确', 'err');
    }
}

// ---------------- 大模型调用 ----------------
// 支持超时 + 指数退避重试；可重试：超时 / 网络错误 / 429 / 5xx
async function callLLM(prompt, { timeoutMs = 300000, retries = 2, json = false, temperature = 0.3, onRetry } = {}) {
    const url = `${state.llm.apiBase.replace(/\/$/, '')}/chat/completions`;
    const payload = {
        model: state.llm.model,
        messages: [
            { role: 'system', content: 'You are an elite all-in-one career platform backend assistant.' },
            { role: 'user', content: prompt }
        ],
        temperature
    };
    if (json) payload.response_format = { type: 'json_object' };
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${state.llm.apiKey}` };

    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let retry = false;
        try {
            const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
            if (!res.ok) {
                const detail = await res.text();
                lastErr = new Error(res.status === 401 ? 'API Key 无效（401）' : `HTTP ${res.status}: ${detail.slice(0, 200)}`);
                retry = res.status === 429 || res.status >= 500;
            } else {
                const data = await res.json();
                const content = data?.choices?.[0]?.message?.content;
                if (content == null) throw new Error('响应结构异常：缺少 choices[0].message');
                return content;
            }
        } catch (err) {
            if (err.name === 'AbortError') { lastErr = new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）`); retry = true; }
            else if (err instanceof TypeError) { lastErr = new Error('网络请求失败，请检查网络或 API 地址'); retry = true; }
            else { lastErr = err; retry = false; }
        } finally {
            clearTimeout(timer);
        }
        if (!retry || attempt >= retries) break;
        const delay = Math.min(1500 * 2 ** attempt, 6000) + Math.random() * 400;
        onRetry && onRetry(attempt + 1, Math.round(delay / 1000));
        await sleep(delay);
    }
    throw lastErr || new Error('大模型调用失败');
}
window.callLLM = callLLM;

// ---------------- 加载面板 ----------------
const Loader = {
    open(title, sub, steps) {
        $('loading-title').textContent = title;
        $('loading-sub').textContent = sub;
        $('loading-logs').innerHTML = '';
        $('loading-steps').innerHTML = (steps || []).map(s => `<div class="step" data-step="${s.key}"><div class="bar"></div>${esc(s.label)}</div>`).join('');
        $('loading-steps').classList.toggle('hidden', !steps || !steps.length);
        $('loading-steps').style.gridTemplateColumns = `repeat(${(steps || []).length || 1}, 1fr)`;
        openModal('loading');
    },
    step(key, st) {
        const el = document.querySelector(`#loading-steps [data-step="${key}"]`);
        if (el) el.className = `step ${st}`;
    },
    log(text) {
        const p = document.createElement('div');
        p.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
        $('loading-logs').appendChild(p);
        $('loading-logs').scrollTop = 1e9;
    },
    close(delay = 600) { setTimeout(() => closeModal('loading'), delay); }
};

// ================================================================
// 备战工作台
// ================================================================
function bindWorkspace() {
    Pager.register('picks', renderResumePicks);
    $('resume-picks').addEventListener('change', e => {
        if (e.target.name !== 'pick-resume') return;
        e.target.checked ? unpicked.delete(e.target.value) : unpicked.add(e.target.value);
        renderResumePicks();
    });
    document.querySelectorAll('#result-tabs .tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('btn-run-pipeline').addEventListener('click', runPipeline);
    $('btn-clear-results').addEventListener('click', clearResults);
    $('btn-copy-tab').addEventListener('click', () => {
        const text = state.activeSession.results[state.activeTab];
        if (!text) return toast('当前标签页还没有内容', 'err');
        navigator.clipboard.writeText(text).then(() => toast('已复制（Markdown 格式）'));
    });
}

function showTab(key) {
    state.activeTab = key;
    document.querySelectorAll('#result-tabs .tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === key);
        b.classList.toggle('has-result', !!state.activeSession.results[b.dataset.tab]);
    });
    const hasAny = TAB_KEYS.some(k => state.activeSession.results[k]);
    $('ws-empty').classList.toggle('hidden', hasAny);
    TAB_KEYS.forEach(k => {
        const panel = $(`tab-panel-${k}`);
        const show = hasAny && k === key;
        panel.classList.toggle('hidden', !show);
        if (show) {
            if (!state.activeSession.results[k]) panel.innerHTML = `<div class="empty"><div class="empty-art">⏳</div><h3>这一项还没有生成</h3><p>重新运行生成即可补齐。</p></div>`;
            panel.classList.remove('fade-in'); void panel.offsetWidth; panel.classList.add('fade-in');
        }
    });
}

function renderResultPanels() {
    TAB_KEYS.forEach(k => {
        const v = state.activeSession.results[k];
        Pager.renderReport(`tab-panel-${k}`, v, { reset: true });
    });
    showTab(state.activeTab);
}

function restoreWorkspace() {
    const s = state.activeSession;
    $('in-company').value = s.companyName || '';
    $('in-role').value = s.roleTitle || '';
    $('in-jd').value = s.jd || '';
    $('in-region').value = s.region || 'Singapore';
    $('in-lang').value = s.language || 'bilingual';
    renderResultPanels();
    renderBoundChip();
}

function renderBoundChip() {
    const app = state.activeAppId && state.applications.find(a => a.id === state.activeAppId);
    const el = $('bound-app-chip');
    if (!app) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `<span class="chip chip-pink" style="font-size:12px;padding:7px 8px 7px 12px;">🔗 结果将保存到：${esc(app.company)} · ${esc(app.role)}
        <button class="icon-btn" style="width:20px;height:20px;font-size:11px;" title="解除关联" id="btn-unbind">✕</button></span>`;
    $('btn-unbind').onclick = () => { state.activeAppId = null; save.activeApp(); renderBoundChip(); toast('已解除关联，进入自由模式'); };
}

// 勾选状态存在内存里（只记录被取消勾选的简历），这样翻页后勾选不会丢；新上传的简历默认勾选
const PICKS_PAGE_SIZE = 4;
const unpicked = new Set();

function renderResumePicks() {
    const box = $('resume-picks');
    const usable = state.resumes.filter(r => Resume.textOf(r));
    if (!usable.length) {
        box.innerHTML = `<div class="pick" style="cursor:pointer;border-style:dashed;justify-content:center;color:var(--muted);font-size:13px;font-weight:600;" data-goto-resumes>📄 还没有简历，去上传 PDF →</div>`;
        box.querySelector('[data-goto-resumes]').onclick = () => switchView('resumes');
        return;
    }
    const pg = Pager.slice('picks', usable, PICKS_PAGE_SIZE);
    const picked = usable.filter(r => !unpicked.has(r.id)).length;
    box.innerHTML = pg.items.map(r => {
        const tags = (r.structured?.tags || []).slice(0, 2).map(t => `<span class="chip" style="font-size:10px;padding:2px 7px;">${esc(t)}</span>`).join('');
        return `<label class="pick">
            <input type="checkbox" name="pick-resume" value="${r.id}" ${unpicked.has(r.id) ? '' : 'checked'}>
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.name)}</div>
                <div class="flex gap-1 items-center" style="margin-top:3px;">${tags}<span style="font-size:11px;color:var(--muted);">${Resume.textOf(r).length} 字</span></div>
            </div>
        </label>`;
    }).join('') + (pg.count > 1
        ? `<div class="flex items-center justify-between" style="margin-top:2px;"><span class="pager-info">已选 ${picked} / ${usable.length} 份</span><div class="pager-btns">
            <button class="pager-btn arrow" data-pager="picks" data-page="${pg.page - 1}" ${pg.page <= 1 ? 'disabled' : ''}>‹</button>
            <span class="pager-info" style="padding:0 6px;">${pg.page} / ${pg.count}</span>
            <button class="pager-btn arrow" data-pager="picks" data-page="${pg.page + 1}" ${pg.page >= pg.count ? 'disabled' : ''}>›</button></div></div>`
        : '');
}

function selectOnlyResume(id) {
    unpicked.clear();
    state.resumes.forEach(r => { if (r.id !== id) unpicked.add(r.id); });
    const usable = state.resumes.filter(r => Resume.textOf(r));
    const idx = usable.findIndex(r => r.id === id);
    Pager.set('picks', idx >= 0 ? Math.floor(idx / PICKS_PAGE_SIZE) + 1 : 1);
    renderResumePicks();
}

function getSelectedResumes() {
    const usable = state.resumes.filter(r => Resume.textOf(r));
    const list = usable.filter(r => !unpicked.has(r.id));
    return list.length ? list : usable;
}

const buildResumeText = (list) => list.map(r => `=== 简历版本: ${r.name} ===\n${Resume.textOf(r)}\n\n`).join('');

function normalizeName(s) {
    return String(s).replace(/^[\s#*`>-]+/, '').replace(/[\s#*`]+$/, '').trim().replace(/\s+/g, ' ');
}

function parseRecommendedResume(text, list) {
    const m = text.match(/RECOMMENDED_RESUME:\s*([^\n]+)/i);
    if (!m) return null;
    const raw = normalizeName(m[1]);
    const cands = [raw];
    const short = normalizeName(raw.split(/[（(]/)[0]);
    if (short && short !== raw) cands.push(short);
    for (const c of cands) {
        const hits = list.filter(r => {
            const full = r.name.trim();
            return full === c || normalizeName(full) === c || (c.length >= 4 && (full.includes(c) || c.includes(full)));
        });
        if (hits.length === 1) return hits;
    }
    return null;
}

const stripMarker = (t) => t.split('\n').filter(l => !/RECOMMENDED_RESUME/i.test(l)).join('\n').trim();

function persistResult(key, value) {
    state.activeSession.results[key] = value;
    let ok = save.session();
    if (state.activeAppId) {
        state.applications = state.applications.map(a => a.id === state.activeAppId ? { ...a, prepResults: { ...(a.prepResults || {}), [key]: value } } : a);
        ok = save.apps() && ok;
    }
    return ok;
}

async function runStep(key, buildPrompt, ctx) {
    Loader.step(key, 'run');
    try {
        const res = await callLLM(buildPrompt(), { onRetry: (n, s) => Loader.log(`⏳ ${TAB_LABELS[key]} 调用异常，${s} 秒后第 ${n} 次重试`) });
        const clean = stripMarker(res);
        if (!persistResult(key, clean)) Loader.log('⚠ 浏览器存储空间已满，本步结果刷新后可能丢失');
        Pager.renderReport(`tab-panel-${key}`, clean, { reset: true });
        if (ctx.first) { ctx.first = false; showTab(key); } else showTab(state.activeTab);
        Loader.step(key, 'done');
        Loader.log(`✔ ${TAB_LABELS[key]} 完成`);
        return { ok: true, result: res };
    } catch (err) {
        ctx.failed.push(TAB_LABELS[key]);
        Loader.step(key, 'fail');
        Loader.log(`✖ ${TAB_LABELS[key]} 失败：${err.message}`);
        return { ok: false };
    }
}

async function runPipeline() {
    if (!requireApiKey()) return;
    const companyName = $('in-company').value.trim();
    const roleTitle = $('in-role').value.trim();
    const region = $('in-region').value;
    const language = $('in-lang').value;
    const jd = $('in-jd').value.trim();
    if (!companyName || !roleTitle || !jd) return toast('请填写公司、岗位和 JD', 'err');

    const selected = getSelectedResumes();
    if (!selected.length) {
        toast('简历库还是空的，先上传一份简历吧', 'err');
        return switchView('resumes');
    }

    state.activeSession = { companyName, region, roleTitle, language, jd, results: {} };
    if (state.activeAppId) {
        state.applications = state.applications.map(a => a.id === state.activeAppId ? { ...a, prepResults: {}, region, language, jd: a.jd || jd } : a);
        save.apps();
    }
    save.session();
    renderResultPanels();

    Loader.open('AI 正在生成备战报告', '两批并行，约 40-120 秒，请不要刷新页面', TAB_KEYS.map(k => ({ key: k, label: TAB_LABELS[k] })));
    const ctx = { failed: [], first: true };
    const allText = buildResumeText(selected);
    const P = window.PromptTemplates;

    Loader.log('▶ 第一批（3 路并行）：简历匹配 / 商业拆解 / 案例与反问');
    const b1 = await Promise.all([
        sleep(Math.random() * 500).then(() => runStep('match', () => P.resumeSelection(allText, jd, region, language), ctx)),
        sleep(Math.random() * 500).then(() => runStep('business', () => P.businessContext(companyName, jd, region), ctx)),
        sleep(Math.random() * 500).then(() => runStep('qa', () => P.businessPrepAndQuestions(companyName, jd, language), ctx))
    ]);

    let forStory = selected;
    if (b1[0].ok) {
        const rec = parseRecommendedResume(b1[0].result, selected);
        if (rec) { forStory = rec; Loader.log(`✔ 推荐简历：「${rec[0].name}」，第二批只使用该版本`); }
        else Loader.log('⚠ 未识别到推荐简历，第二批使用全部所选简历');
    }

    Loader.log('▶ 第二批（2 路并行）：自我介绍 / STAR 故事');
    const storyText = buildResumeText(forStory);
    await Promise.all([
        runStep('intro', () => P.selfIntroduction(storyText, jd, language, region), ctx),
        runStep('star', () => P.starStories(storyText, jd, language, region), ctx)
    ]);

    renderTracker();
    if (!ctx.failed.length) {
        Loader.log('🎉 全部完成！');
        Loader.close(700);
        showTab('match');
        toast('五份备战报告已生成');
    } else {
        Loader.log(`⚠ 失败步骤：${ctx.failed.join('、')}。可重新生成。`);
        Loader.close(2200);
        toast(`部分失败：${ctx.failed.join('、')}`, 'err', 4000);
    }
}

function clearResults() {
    if (!TAB_KEYS.some(k => state.activeSession.results[k])) return;
    if (!confirm('确定清空当前生成结果吗？')) return;
    state.activeSession.results = {};
    save.session();
    if (state.activeAppId) {
        state.applications = state.applications.map(a => a.id === state.activeAppId ? { ...a, prepResults: {} } : a);
        save.apps();
    }
    renderResultPanels();
    renderTracker();
}

window.activateAppForPrep = (id) => {
    const app = state.applications.find(a => a.id === id);
    if (!app) return;
    state.activeAppId = id;
    save.activeApp();
    state.activeSession = {
        companyName: app.company, roleTitle: app.role, jd: app.jd || '',
        region: app.region || 'Singapore', language: app.language || 'bilingual',
        results: app.prepResults || {}
    };
    save.session();
    state.activeTab = 'match';
    restoreWorkspace();
    switchView('workspace');
};

// ================================================================
// 投递看板
// ================================================================
function bindTracker() {
    $('track-status').innerHTML = STATUSES.map(s => `<option value="${s.v}">${s.label}</option>`).join('');
    $('track-status').value = '已投递';
    $('filter-track').innerHTML = `<option value="all">全部状态</option>` + STATUSES.map(s => `<option value="${s.v}">${s.label}</option>`).join('');
    $('track-date').value = formatDateKey(new Date());
    Pager.register('tracker', renderTracker);
    $('search-track').addEventListener('input', () => { Pager.reset('tracker'); renderTracker(); });
    $('btn-open-track').addEventListener('click', () => {
        $('track-date').value = formatDateKey(new Date());
        openModal('track-modal');
        setTimeout(() => { if (document.activeElement === document.body) $('track-company').focus(); }, 50);
    });
    $('filter-track').addEventListener('change', () => { Pager.reset('tracker'); renderTracker(); });

    $('btn-add-track').addEventListener('click', () => {
        const v = (id) => $(id).value.trim();
        const app = {
            id: uid('app'), company: v('track-company'), role: v('track-role'), link: v('track-link'),
            date: $('track-date').value, status: $('track-status').value, jd: v('track-jd'),
            base: v('track-base'), priority: $('track-priority').value, salary: v('track-salary')
        };
        if (!app.company || !app.role || !app.date) return toast('请填写公司、岗位和投递日期', 'err');
        state.applications.push(app);
        save.apps();
        ['track-company', 'track-role', 'track-link', 'track-jd', 'track-base', 'track-salary'].forEach(id => $(id).value = '');
        $('track-priority').value = 'P1';
        closeModal('track-modal');
        Pager.reset('tracker');
        renderTracker();
        updateBadges();
        toast(`已添加：${app.company} · ${app.role}`);
    });

    // 事件委托：表格中的各种操作
    $('tracker-body').addEventListener('change', e => {
        const t = e.target;
        const id = t.closest('tr')?.dataset.id;
        if (!id) return;
        if (t.dataset.field) { updateApp(id, t.dataset.field, t.value); renderTracker(); }
    });
    $('tracker-body').addEventListener('focusout', e => {
        const t = e.target;
        if (!t.matches('[contenteditable][data-field]')) return;
        const id = t.closest('tr').dataset.id;
        let val = t.innerText.replace(/[\r\n]/g, '').trim();
        if (val === '—') val = '';
        updateApp(id, t.dataset.field, val);
    });
    $('tracker-body').addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.matches('[contenteditable]')) { e.preventDefault(); e.target.blur(); }
    });
    $('tracker-body').addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const id = b.closest('tr').dataset.id;
        const act = b.dataset.act;
        if (act === 'prep') activateAppForPrep(id);
        if (act === 'event') openEventModalForApp(id);
        if (act === 'debrief') startDebriefFromApp(id);
        if (act === 'delete') deleteApp(id);
        if (act === 'rename') {
            const app = state.applications.find(a => a.id === id);
            const n = prompt('修改岗位名称：', app.role);
            if (n && n.trim()) { updateApp(id, 'role', n.trim()); renderTracker(); }
        }
    });
}

function updateApp(id, field, value) {
    state.applications = state.applications.map(a => a.id === id ? { ...a, [field]: value } : a);
    save.apps();
    if (field === 'status' || field === 'priority') renderTrackerStats();
}

function deleteApp(id) {
    if (!confirm('确定删除这条投递记录吗？')) return;
    state.applications = state.applications.filter(a => a.id !== id);
    save.apps();
    state.events = state.events.map(e => e.appId === id ? { ...e, appId: '' } : e);
    save.events();
    if (state.activeAppId === id) { state.activeAppId = null; save.activeApp(); renderBoundChip(); }
    renderTracker();
    updateBadges();
}

function renderTrackerStats() {
    const apps = state.applications;
    const active = apps.filter(a => a.status === '笔试中' || a.status === '面试中').length;
    const offers = apps.filter(a => a.status === '已拿Offer').length;
    const today = formatDateKey(new Date());
    const week = state.events.filter(e => e.date >= today && e.date <= formatDateKey(new Date(Date.now() + 7 * 864e5))).length;
    const stat = (label, value, color) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value" style="${color ? `color:${color}` : ''}">${value}</div></div>`;
    $('tracker-stats').innerHTML =
        stat('总投递', apps.length) +
        stat('笔试 / 面试中', active, '#A76A00') +
        stat('Offer', offers, '#13843F') +
        stat('未来 7 天日程', week, '#D61F69');
}

const TRACKER_PAGE_SIZE = 8;
const UPCOMING_PAGE_SIZE = 5;

function renderTracker() {
    renderTrackerStats();
    const tbody = $('tracker-body');
    const kw = $('search-track').value.trim().toLowerCase();
    const st = $('filter-track').value;
    const list = state.applications
        .filter(a => (!kw || (a.company || '').toLowerCase().includes(kw) || (a.role || '').toLowerCase().includes(kw)) && (st === 'all' || a.status === st))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    if (!state.applications.length) {
        $('tracker-pager').innerHTML = '';
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty" style="padding:50px 20px;"><div class="empty-art">📮</div><h3>还没有投递记录</h3><p>点击右上角「新增投递」添加第一个意向岗位吧！</p></div></td></tr>`;
        return;
    }
    if (!list.length) {
        $('tracker-pager').innerHTML = '';
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:40px;">没有符合条件的记录</td></tr>`;
        return;
    }

    const pg = Pager.slice('tracker', list, TRACKER_PAGE_SIZE);
    $('tracker-pager').innerHTML = Pager.bar('tracker', pg);
    tbody.innerHTML = pg.items.map(a => {
        const hasPrep = a.prepResults && Object.values(a.prepResults).some(Boolean);
        const role = a.link
            ? `<div class="flex items-center gap-1"><a href="${esc(a.link)}" target="_blank" rel="noopener" style="color:var(--ink);font-weight:600;text-decoration:none;" onmouseover="this.style.color='var(--violet)'" onmouseout="this.style.color='var(--ink)'">${esc(a.role)} ↗</a><button class="icon-btn" style="width:22px;height:22px;font-size:11px;" data-act="rename" title="改名">✏️</button></div>`
            : `<div class="cell-edit" contenteditable="true" data-field="role" style="font-weight:600;">${esc(a.role)}</div>`;
        return `<tr data-id="${a.id}">
            <td style="font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap;">${esc(a.date)}</td>
            <td><div class="cell-edit" contenteditable="true" data-field="company" style="font-weight:800;">${esc(a.company)}</div></td>
            <td>${role}</td>
            <td><div class="cell-edit" contenteditable="true" data-field="base" style="color:var(--ink-2);">${esc(a.base || '—')}</div></td>
            <td><select class="pill-select pr-${esc(a.priority || 'P1')}" data-field="priority">${['P0', 'P1', 'P2'].map(p => `<option ${(a.priority || 'P1') === p ? 'selected' : ''}>${p}</option>`).join('')}</select></td>
            <td><div class="cell-edit" contenteditable="true" data-field="salary" style="font-size:12px;color:var(--ink-2);">${esc(a.salary || '—')}</div></td>
            <td><select class="pill-select ${statusCls(a.status)}" data-field="status">${STATUSES.map(s => `<option value="${s.v}" ${a.status === s.v ? 'selected' : ''}>${s.label}</option>`).join('')}</select></td>
            <td style="white-space:nowrap;text-align:right;">
                <button class="btn ${hasPrep ? 'btn-soft' : 'btn-primary'} btn-xs" data-act="prep">${hasPrep ? '📂 查看备战' : '🚀 备战'}</button>
                <button class="icon-btn" data-act="event" title="添加日程">📅</button>
                <button class="icon-btn" data-act="debrief" title="面试复盘">🎙️</button>
                <button class="icon-btn danger" data-act="delete" title="删除">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

// ================================================================
// 日程
// ================================================================
const EVENT_CLS = { '面试': 'type-interview', '笔试': 'type-oa', '其他': 'type-other' };
const EVENT_ICO = { '面试': '🎙️', '笔试': '📝', '其他': '📌' };
const DOW = ['一', '二', '三', '四', '五', '六', '日'];
const ROW_H = 52;

function bindCalendar() {
    $('btn-cal-prev').onclick = () => shiftCal(-1);
    $('btn-cal-next').onclick = () => shiftCal(1);
    $('btn-cal-today').onclick = () => { state.calDate = new Date(); renderCalendar(); };
    document.querySelectorAll('.seg [data-mode]').forEach(b => b.onclick = () => {
        state.calMode = b.dataset.mode;
        Store.set('ui', { ...Store.get('ui', {}), calMode: state.calMode });
        delete $('cal-week-scroll').dataset.scrolled;
        renderCalendar();
    });
    $('btn-add-event').onclick = () => openEventModal(null);
    Pager.register('upcoming', renderUpcoming);
    $('btn-save-event').onclick = saveEvent;
    $('btn-delete-event').onclick = deleteEvent;
    $('event-start').addEventListener('change', () => {
        if ($('event-start').value && !$('event-end').value) $('event-end').value = addHour($('event-start').value);
    });
}

function shiftCal(n) {
    const d = state.calDate;
    state.calDate = state.calMode === 'week' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + n * 7) : new Date(d.getFullYear(), d.getMonth() + n, 1);
    renderCalendar();
}

const addHour = (t) => { const [h, m] = t.split(':').map(Number); return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

function conflictsOn(dateKey) {
    const list = state.events.filter(e => e.date === dateKey && e.startTime);
    const ids = new Set();
    const end = (e) => (e.endTime && e.endTime > e.startTime ? e.endTime : addHour(e.startTime));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.startTime < end(b) && b.startTime < end(a)) { ids.add(a.id); ids.add(b.id); }
    }
    return ids;
}

function renderCalendar() {
    document.querySelectorAll('.seg [data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === state.calMode));
    $('cal-month').classList.toggle('hidden', state.calMode !== 'month');
    $('cal-week').classList.toggle('hidden', state.calMode !== 'week');
    state.calMode === 'week' ? renderWeek() : renderMonth();
}

function renderMonth() {
    const d = state.calDate, y = d.getFullYear(), m = d.getMonth();
    $('cal-label').textContent = `${y} 年 ${m + 1} 月`;
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();
    const today = formatDateKey(new Date());
    const cells = [];
    for (let i = 0; i < first; i++) cells.push({ n: prevDays - first + i + 1, other: true });
    for (let i = 1; i <= days; i++) cells.push({ n: i, key: formatDateKey(new Date(y, m, i)) });
    while (cells.length % 7) cells.push({ n: cells.length - first - days + 1, other: true });

    $('cal-grid').innerHTML = cells.map(c => {
        if (c.other) return `<div class="cal-day cal-day-other"><span class="cal-num">${c.n}</span></div>`;
        const evs = state.events.filter(e => e.date === c.key).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
        const cf = conflictsOn(c.key);
        const pills = evs.slice(0, 3).map(e => `<div class="ev-pill ${EVENT_CLS[e.type] || 'type-other'} ${cf.has(e.id) ? 'has-conflict' : ''}" data-ev="${e.id}" title="${esc(e.title)}${cf.has(e.id) ? ' ⚠ 时间冲突' : ''}">${e.startTime ? e.startTime + ' ' : ''}${esc(e.title)}</div>`).join('');
        const more = evs.length > 3 ? `<div style="font-size:10px;color:var(--muted);font-weight:700;padding:0 4px;">+${evs.length - 3}</div>` : '';
        return `<div class="cal-day ${c.key === today ? 'cal-day-today' : 'cal-day-current'}" data-date="${c.key}"><span class="cal-num">${c.n}</span>${pills}${more}</div>`;
    }).join('');

    $('cal-grid').onclick = (e) => {
        const ev = e.target.closest('[data-ev]');
        if (ev) return openEventModal(ev.dataset.ev);
        const day = e.target.closest('[data-date]');
        if (day) openEventModal(null, day.dataset.date);
    };
}

function weekDates(ref) {
    const d = new Date(ref), w = (d.getDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - w + i));
}

function renderWeek() {
    const days = weekDates(state.calDate);
    const today = formatDateKey(new Date());
    const [f, l] = [days[0], days[6]];
    $('cal-label').textContent = f.getMonth() === l.getMonth()
        ? `${f.getMonth() + 1}月${f.getDate()}日 – ${l.getDate()}日`
        : `${f.getMonth() + 1}月${f.getDate()}日 – ${l.getMonth() + 1}月${l.getDate()}日`;

    $('cal-week-head').innerHTML = '<div></div>' + days.map((d, i) => `<div class="week-head ${formatDateKey(d) === today ? 'today' : ''}"><div class="dow">周${DOW[i]}</div><div class="num">${d.getDate()}</div></div>`).join('');

    let html = '<div>' + Array.from({ length: 24 }, (_, h) => `<div class="week-hour-row" style="border-bottom-color:transparent;"><div class="week-time-label">${h ? String(h).padStart(2, '0') + ':00' : ''}</div></div>`).join('') + '</div>';
    days.forEach(d => {
        const key = formatDateKey(d);
        const cf = conflictsOn(key);
        let col = `<div class="week-day-col ${key === today ? 'today' : ''}" style="height:${24 * ROW_H}px;">`;
        for (let h = 0; h < 24; h++) col += `<div class="week-hour-cell" data-date="${key}" data-time="${String(h).padStart(2, '0')}:00"></div>`;
        if (key === today) {
            const now = new Date();
            col += `<div class="now-line" style="top:${(now.getHours() * 60 + now.getMinutes()) / 60 * ROW_H}px;"></div>`;
        }
        state.events.filter(e => e.date === key && e.startTime).forEach(e => {
            const [sh, sm] = e.startTime.split(':').map(Number);
            const s = sh * 60 + sm;
            let en = s + 60;
            if (e.endTime) { const [eh, em] = e.endTime.split(':').map(Number); if (eh * 60 + em > s) en = eh * 60 + em; }
            col += `<div class="week-ev ${EVENT_CLS[e.type] || 'type-other'} ${cf.has(e.id) ? 'has-conflict' : ''}" data-ev="${e.id}" style="top:${s / 60 * ROW_H}px;height:${Math.max((en - s) / 60 * ROW_H, 24)}px;">${EVENT_ICO[e.type] || ''} ${esc(e.title)}<br><span style="opacity:.75;font-weight:600;">${e.startTime}${e.endTime ? '–' + e.endTime : ''}</span></div>`;
        });
        html += col + '</div>';
    });
    $('cal-week-grid').innerHTML = html;
    $('cal-week-grid').onclick = (e) => {
        const ev = e.target.closest('[data-ev]');
        if (ev) return openEventModal(ev.dataset.ev);
        const c = e.target.closest('[data-time]');
        if (c) openEventModal(null, c.dataset.date, c.dataset.time);
    };
    const sc = $('cal-week-scroll');
    if (!sc.dataset.scrolled) { sc.scrollTop = Math.max((new Date().getHours() - 2) * ROW_H, 0); sc.dataset.scrolled = '1'; }
}

function renderUpcoming() {
    const today = formatDateKey(new Date());
    const list = state.events.filter(e => e.date >= today).sort((a, b) => (a.date + (a.startTime || '00:00')).localeCompare(b.date + (b.startTime || '00:00')));
    const box = $('upcoming-list');
    if (!list.length) {
        box.innerHTML = `<div class="empty" style="padding:40px 10px;"><div class="empty-art" style="width:64px;height:64px;font-size:28px;">🗓️</div><h3>暂无日程</h3><p>点击右上角或日历空白处新增。</p></div>`;
        $('upcoming-pager').innerHTML = '';
        return;
    }
    const pg = Pager.slice('upcoming', list, UPCOMING_PAGE_SIZE);
    $('upcoming-pager').innerHTML = Pager.bar('upcoming', pg, { compact: true, unit: '项' });
    box.innerHTML = pg.items.map(e => {
        const cf = conflictsOn(e.date).has(e.id);
        const app = e.appId && state.applications.find(a => a.id === e.appId);
        const [y, m, d] = e.date.split('-');
        return `<div class="upcoming ${cf ? 'has-conflict' : ''}" data-ev="${e.id}">
            <div class="date-badge"><div class="m">${Number(m)}月</div><div class="d">${Number(d)}</div></div>
            <div style="min-width:0;flex:1;">
                <div style="font-size:13px;font-weight:800;">${EVENT_ICO[e.type] || ''} ${esc(e.title)}</div>
                <div style="font-size:12px;color:var(--muted);font-weight:600;margin-top:2px;">${e.startTime ? e.startTime + (e.endTime ? ' – ' + e.endTime : '') : '时间待定'}${cf ? ' · <span style="color:#E11D48;">⚠ 时间冲突</span>' : ''}</div>
                ${app ? `<div style="margin-top:6px;"><span class="chip chip-pink" style="font-size:10px;">🔗 ${esc(app.company)} · ${esc(app.role)}</span></div>` : ''}
            </div>
        </div>`;
    }).join('');
    box.onclick = (ev) => { const c = ev.target.closest('[data-ev]'); if (c) openEventModal(c.dataset.ev); };
}

function fillEventAppOptions(sel) {
    $('event-app').innerHTML = '<option value="">不关联</option>' + state.applications.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.company)} · ${esc(a.role)}</option>`).join('');
}

function openEventModal(id, date, time) {
    const ev = id && state.events.find(e => e.id === id);
    $('event-modal-title').textContent = ev ? '编辑日程' : '新增日程';
    $('event-id').value = ev ? ev.id : '';
    $('event-title').value = ev ? ev.title : '';
    $('event-date').value = ev ? ev.date : (date || formatDateKey(new Date()));
    $('event-type').value = ev ? ev.type : '面试';
    $('event-start').value = ev ? (ev.startTime || '') : (time || '');
    $('event-end').value = ev ? (ev.endTime || '') : (time ? addHour(time) : '');
    $('event-notes').value = ev ? (ev.notes || '') : '';
    fillEventAppOptions(ev ? ev.appId : '');
    $('btn-delete-event').classList.toggle('hidden', !ev);
    openModal('event-modal');
    setTimeout(() => { if (document.activeElement === document.body) $('event-title').focus(); }, 50);
}

function openEventModalForApp(appId) {
    const app = state.applications.find(a => a.id === appId);
    switchView('calendar');
    openEventModal(null);
    $('event-app').value = appId;
    if (app) $('event-title').value = `${app.company} · ${app.role}`;
}

function saveEvent() {
    const ev = {
        id: $('event-id').value || uid('evt'),
        title: $('event-title').value.trim(), date: $('event-date').value, type: $('event-type').value,
        startTime: $('event-start').value, endTime: $('event-end').value, appId: $('event-app').value, notes: $('event-notes').value.trim()
    };
    if (!ev.title || !ev.date) return toast('请填写标题和日期', 'err');
    const i = state.events.findIndex(e => e.id === ev.id);
    if (i >= 0) state.events[i] = ev; else state.events.push(ev);
    save.events();
    closeModal('event-modal');
    renderCalendar(); renderUpcoming(); updateBadges(); renderTrackerStats();
    if (conflictsOn(ev.date).has(ev.id)) toast('已保存，但与其他日程时间冲突', 'err');
    else toast('日程已保存');
}

function deleteEvent() {
    const id = $('event-id').value;
    if (!id || !confirm('确定删除这条日程吗？')) return;
    state.events = state.events.filter(e => e.id !== id);
    save.events();
    closeModal('event-modal');
    renderCalendar(); renderUpcoming(); updateBadges(); renderTrackerStats();
}

// ================================================================
// 面试复盘
// ================================================================
function bindDebrief() {
    $('btn-run-debrief').addEventListener('click', runDebrief);
    $('btn-copy-debrief').addEventListener('click', () => {
        const d = Store.get('debrief', null);
        if (!d || !d.report) return toast('还没有复盘报告', 'err');
        navigator.clipboard.writeText(d.report).then(() => toast('已复制'));
    });
    $('btn-clear-debrief').addEventListener('click', () => {
        if (!confirm('确定清空当前复盘报告吗？')) return;
        Store.set('debrief', null);
        Pager.renderReport('debrief-report', '');
        $('debrief-empty').classList.remove('hidden');
    });
}

function restoreDebrief() {
    const d = Store.get('debrief', null);
    $('debrief-company').value = d?.company || '';
    $('debrief-role').value = d?.role || '';
    $('debrief-jd').value = d?.jd || '';
    $('debrief-transcript').value = d?.transcript || '';
    Pager.renderReport('debrief-report', d?.report || '', { reset: true });
    $('debrief-empty').classList.toggle('hidden', !!d?.report);
    state.debriefAppId = d?.appId || null;
}

async function runDebrief() {
    if (!requireApiKey()) return;
    const company = $('debrief-company').value.trim();
    const role = $('debrief-role').value.trim();
    const jd = $('debrief-jd').value.trim();
    const transcript = $('debrief-transcript').value.trim();
    if (!company || !role || !transcript) return toast('请填写公司、岗位，并贴入录音文本', 'err');

    Loader.open('AI 面试官正在复盘', '通常需要 30-90 秒', []);
    Loader.log(`▶ 开始复盘【${company} · ${role}】`);
    try {
        const report = await callLLM(window.PromptTemplates.interviewDebrief(company, role, jd, transcript), {
            onRetry: (n, s) => Loader.log(`⏳ 调用异常，${s} 秒后第 ${n} 次重试`)
        });
        const appId = state.debriefAppId;
        Store.set('debrief', { company, role, jd, transcript, report, appId });
        if (appId) {
            state.applications = state.applications.map(a => a.id === appId ? { ...a, debrief: { jd, transcript, report } } : a);
            save.apps();
        }
        $('debrief-empty').classList.add('hidden');
        Pager.renderReport('debrief-report', report, { reset: true });
        Loader.log('✔ 复盘完成');
        Loader.close();
        toast('复盘报告已生成');
    } catch (err) {
        Loader.log(`✖ 失败：${err.message}`);
        Loader.close(2200);
        toast(err.message, 'err', 4000);
    }
}

function startDebriefFromApp(appId) {
    const app = state.applications.find(a => a.id === appId);
    if (!app) return;
    state.debriefAppId = appId;
    const d = app.debrief || {
        jd: app.debriefJD, transcript: app.debriefTranscript, report: app.debriefReport // 兼容旧版字段
    };
    $('debrief-company').value = app.company || '';
    $('debrief-role').value = app.role || '';
    $('debrief-jd').value = d.jd || app.jd || '';
    $('debrief-transcript').value = d.transcript || '';
    Pager.renderReport('debrief-report', d.report || '', { reset: true });
    $('debrief-empty').classList.toggle('hidden', !!d.report);
    Store.set('debrief', { company: app.company, role: app.role, jd: d.jd || app.jd || '', transcript: d.transcript || '', report: d.report || '', appId });
    switchView('debrief');
}
