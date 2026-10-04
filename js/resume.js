// ============================================================
// 简历库：PDF 上传 → 文本提取（pdf.js，按坐标还原行）→ AI 结构化解析 → 可编辑卡片
// ============================================================
const Resume = (() => {
    let selectedId = null;
    let editing = false;
    let detailTab = 'parsed'; // parsed | raw
    let secIndex = 0;         // 结构化详情的当前页
    let lastPages = [];       // 最近一次渲染的分页结构
    const LIST_PAGE_SIZE = 5;   // 左侧简历列表每页条数
    const ENTRIES_PER_PAGE = 3; // 每页最多几段经历 / 项目
    const MAX_MB = 10;

    const EMPTY = () => ({
        basics: { name: '', title: '', email: '', phone: '', location: '', links: [] },
        summary: '', education: [], experience: [], projects: [], skills: [], awards: [], languages: [], tags: []
    });

    function normalize(r) {
        return {
            id: r.id || uid('res'), name: r.name || '未命名简历', content: r.content || '',
            structured: r.structured || null, fileName: r.fileName || '', thumb: r.thumb || '', pages: r.pages || 0,
            parseStatus: r.parseStatus === 'parsing' ? 'idle' : (r.parseStatus || (r.structured ? 'done' : 'idle')),
            parseError: r.parseError || '', updatedAt: r.updatedAt || Date.now()
        };
    }

    // 补全 AI 返回的 JSON，防止缺字段导致渲染报错
    function sanitize(s) {
        const base = EMPTY();
        const arr = (v) => Array.isArray(v) ? v : (v ? [v] : []);
        const str = (v) => (v == null ? '' : String(v));
        const out = { ...base, ...(s || {}) };
        out.basics = { ...base.basics, ...(s?.basics || {}) };
        Object.keys(base.basics).forEach(k => { if (k !== 'links') out.basics[k] = str(out.basics[k]); });
        out.basics.links = arr(out.basics.links).map(str).filter(Boolean);
        out.summary = str(out.summary);
        out.education = arr(out.education).map(e => ({ school: str(e.school), degree: str(e.degree), major: str(e.major), start: str(e.start), end: str(e.end), gpa: str(e.gpa), highlights: arr(e.highlights).map(str).filter(Boolean) }));
        out.experience = arr(out.experience).map(e => ({ company: str(e.company), role: str(e.role), location: str(e.location), start: str(e.start), end: str(e.end), bullets: arr(e.bullets).map(str).filter(Boolean) }));
        out.projects = arr(out.projects).map(e => ({ name: str(e.name), role: str(e.role), start: str(e.start), end: str(e.end), bullets: arr(e.bullets).map(str).filter(Boolean) }));
        out.skills = arr(out.skills).map(g => typeof g === 'string' ? { category: '', items: [g] } : { category: str(g.category), items: arr(g.items).map(str).filter(Boolean) });
        ['awards', 'languages', 'tags'].forEach(k => { out[k] = arr(out[k]).map(str).filter(Boolean); });
        return out;
    }

    // 结构化 → 纯文本（供备战 Prompt 使用，更干净）
    function toText(s) {
        if (!s) return '';
        const L = [];
        const b = s.basics || {};
        L.push([b.name, b.title].filter(Boolean).join(' | '));
        const contact = [b.email, b.phone, b.location, ...(b.links || [])].filter(Boolean).join(' | ');
        if (contact) L.push(contact);
        if (s.summary) L.push('', '【个人简介】', s.summary);
        const range = (x) => [x.start, x.end].filter(Boolean).join(' - ');
        if (s.education?.length) {
            L.push('', '【教育背景】');
            s.education.forEach(e => {
                L.push([e.school, [e.degree, e.major].filter(Boolean).join(' '), range(e), e.gpa && `GPA ${e.gpa}`].filter(Boolean).join(' | '));
                (e.highlights || []).forEach(h => L.push(`- ${h}`));
            });
        }
        if (s.experience?.length) {
            L.push('', '【工作/实习经历】');
            s.experience.forEach(e => {
                L.push([e.company, e.role, e.location, range(e)].filter(Boolean).join(' | '));
                (e.bullets || []).forEach(x => L.push(`- ${x}`));
            });
        }
        if (s.projects?.length) {
            L.push('', '【项目经历】');
            s.projects.forEach(p => {
                L.push([p.name, p.role, range(p)].filter(Boolean).join(' | '));
                (p.bullets || []).forEach(x => L.push(`- ${x}`));
            });
        }
        if (s.skills?.length) {
            L.push('', '【技能】');
            s.skills.forEach(g => L.push(`${g.category ? g.category + '：' : ''}${(g.items || []).join('、')}`));
        }
        if (s.awards?.length) { L.push('', '【奖项荣誉】'); s.awards.forEach(a => L.push(`- ${a}`)); }
        if (s.languages?.length) L.push('', `【语言】${s.languages.join('、')}`);
        return L.join('\n').trim();
    }

    const textOf = (r) => (r.structured ? toText(r.structured) : (r.content || '')).trim();
    const find = (id) => state.resumes.find(r => r.id === id);
    const current = () => find(selectedId);

    function update(id, patch) {
        state.resumes = state.resumes.map(r => r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r);
        if (!save.resumes()) toast('浏览器存储空间不足，简历可能未保存', 'err');
    }

    // ---------------- PDF 提取 ----------------
    // 中文 PDF（尤其是 LaTeX/ctex、Word 导出的 Adobe-GB1 字体）必须加载 CMap 才能还原汉字，
    // 否则所有中文都会丢失，只剩英文和数字。这里准备多个 CDN，依次探测，哪个能用就用哪个。
    const PDFJS_VERSION = '3.11.174';
    const CMAP_SOURCES = [
        `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`,
        `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/`,
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/`
    ];
    let cmapBase = null;

    async function pickCmapBase() {
        if (cmapBase) return cmapBase;
        for (const base of CMAP_SOURCES) {
            try {
                const res = await fetch(base + 'cmaps/Adobe-GB1-UCS2.bcmap', { cache: 'force-cache' });
                if (res.ok && (await res.arrayBuffer()).byteLength > 100) { cmapBase = base; return base; }
            } catch (e) { /* 换下一个源 */ }
        }
        return null;
    }

    async function readPdf(data, base) {
        const opts = { data };
        if (base) Object.assign(opts, { cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/' });
        return pdfjsLib.getDocument(opts).promise;
    }

    // 中文简历却几乎没有汉字、大量只剩符号的行 → 判定为字体映射缺失导致的乱码
    function looksBroken(text) {
        const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        const lines = text.split('\n').filter(Boolean);
        const hollow = lines.filter(l => !/[A-Za-z\u4e00-\u9fff]{2,}/.test(l)).length;
        return cjk < 5 && lines.length > 8 && hollow / lines.length > 0.35;
    }

    async function extract(file, onProgress) {
        if (!window.pdfjsLib) throw new Error('PDF 解析库未加载，请检查网络后刷新');
        const buf = await file.arrayBuffer();
        const base = await pickCmapBase();
        const pdf = await readPdf(new Uint8Array(buf.slice(0)), base);
        const pageTexts = [];
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const tc = await page.getTextContent();
            pageTexts.push(rebuildLines(tc.items));
            onProgress && onProgress(p / pdf.numPages);
        }
        let thumb = '';
        try { thumb = await renderThumb(await pdf.getPage(1)); } catch (e) { /* 缩略图失败不影响主流程 */ }
        const text = pageTexts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
        return { text, pages: pdf.numPages, thumb, broken: looksBroken(text), cmapOk: !!base };
    }

    // 按 y 坐标把文本块归并成行，再按 x 排序拼接，比直接 join(' ') 更接近原排版
    function rebuildLines(items) {
        const lines = [];
        items.forEach(it => {
            if (!it.str || !it.str.trim()) return;
            const x = it.transform[4], y = it.transform[5];
            const h = Math.abs(it.transform[3]) || it.height || 10;
            let line = lines.find(l => Math.abs(l.y - y) < Math.max(l.h, h) * 0.5);
            if (!line) { line = { y, h, parts: [] }; lines.push(line); }
            line.parts.push({ x, w: it.width || 0, s: it.str });
        });
        lines.sort((a, b) => b.y - a.y);
        return lines.map(l => {
            l.parts.sort((a, b) => a.x - b.x);
            let out = '', end = null;
            l.parts.forEach(p => {
                if (end != null && p.x - end > l.h * 0.25 && !/\s$/.test(out)) out += ' ';
                out += p.s;
                end = p.x + p.w;
            });
            return out.replace(/\s+/g, ' ').trim();
        }).filter(Boolean).join('\n');
    }

    async function renderThumb(page) {
        const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 220 / vp0.width });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        return canvas.toDataURL('image/jpeg', 0.7);
    }

    // ---------------- AI 解析 ----------------
    function parseJSON(text) {
        let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        const a = t.indexOf('{'), b = t.lastIndexOf('}');
        if (a >= 0 && b > a) t = t.slice(a, b + 1);
        return JSON.parse(t);
    }

    async function aiParse(id) {
        const r = find(id);
        if (!r || !r.content.trim()) return toast('原文为空，无法解析', 'err');
        if (!state.llm.apiKey) {
            update(id, { parseStatus: 'idle' });
            renderAll();
            toast('已提取文字。配置 API Key 后可一键 AI 结构化解析', 'err', 3500);
            return;
        }
        update(id, { parseStatus: 'parsing', parseError: '' });
        renderAll();
        try {
            const raw = await callLLM(window.PromptTemplates.resumeParse(r.content.slice(0, 15000)), { json: true, temperature: 0.1, timeoutMs: 120000 });
            const structured = sanitize(parseJSON(raw));
            const patch = { structured, parseStatus: 'done' };
            // 用默认文件名的简历，自动改成「姓名 · 定位」
            const cur = find(id);
            if (cur && cur.fileName && cur.name === cur.fileName.replace(/\.pdf$/i, '')) {
                const label = [structured.basics.name, structured.tags[0]].filter(Boolean).join(' · ');
                if (label) patch.name = label;
            }
            update(id, patch);
            toast('AI 解析完成 ✨');
        } catch (err) {
            console.error(err);
            update(id, { parseStatus: 'error', parseError: err instanceof SyntaxError ? 'AI 返回的格式无法识别，请重试' : err.message });
            toast('解析失败：' + (err instanceof SyntaxError ? '格式错误，请重试' : err.message), 'err', 4000);
        }
        renderAll();
    }

    // ---------------- 上传 ----------------
    function setProgress(label, pct) {
        const box = $('upload-progress');
        if (pct == null) { box.classList.add('hidden'); return; }
        box.classList.remove('hidden');
        $('upload-label').textContent = label;
        $('upload-pct').textContent = `${Math.round(pct * 100)}%`;
        $('upload-bar').style.width = `${pct * 100}%`;
    }

    async function handleFile(file) {
        if (!file) return;
        if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return toast('只支持 PDF 文件', 'err');
        if (file.size > MAX_MB * 1024 * 1024) return toast(`文件超过 ${MAX_MB}MB`, 'err');
        try {
            setProgress(`正在读取「${file.name}」`, 0.05);
            const { text, pages, thumb, broken, cmapOk } = await extract(file, p => setProgress(`正在提取文字 · 第 ${Math.ceil(p * 100)}%`, 0.05 + p * 0.85));
            if (!text) {
                setProgress(null);
                return toast('这份 PDF 是图片扫描版，提取不到文字。请在「手动新建」中粘贴文本', 'err', 5000);
            }
            if (broken) {
                setProgress(null);
                toast(cmapOk
                    ? '这份 PDF 的中文字体无法识别，请在「原文」里粘贴简历文字后再解析'
                    : '中文字体映射文件加载失败（网络问题），请刷新页面后重新上传', 'err', 6000);
                if (!cmapOk) return;
            }
            setProgress('提取完成', 1);
            const r = normalize({ name: file.name.replace(/\.pdf$/i, ''), fileName: file.name, content: text, pages, thumb });
            state.resumes.unshift(r);
            save.resumes();
            selectedId = r.id;
            editing = false;
            detailTab = broken ? 'raw' : 'parsed';
            secIndex = 0;
            Pager.reset('resumes');
            setTimeout(() => setProgress(null), 600);
            renderAll();
            if (!broken) aiParse(r.id); // 乱码就不浪费 AI 调用，先让用户在原文里修正
        } catch (err) {
            console.error(err);
            setProgress(null);
            toast('PDF 读取失败：' + err.message, 'err', 4000);
        }
    }

    // ---------------- 渲染：列表 ----------------
    function renderList() {
        const box = $('resume-list');
        if (!state.resumes.length) {
            box.innerHTML = `<div style="padding:18px 10px;text-align:center;font-size:13px;color:var(--muted);">还没有简历，上传一份 PDF 试试 👆</div>`;
            $('resume-pager').innerHTML = '';
            return;
        }
        const pg = Pager.slice('resumes', state.resumes, LIST_PAGE_SIZE);
        $('resume-pager').innerHTML = Pager.bar('resumes', pg, { compact: true, unit: '份' });
        box.innerHTML = pg.items.map(r => {
            const st = r.parseStatus === 'parsing' ? '<span class="chip chip-sun">解析中…</span>'
                : r.structured ? '<span class="chip chip-mint">已解析</span>'
                : r.parseStatus === 'error' ? '<span class="chip chip-pink">解析失败</span>'
                : '<span class="chip chip-gray">仅原文</span>';
            return `<div class="resume-item ${r.id === selectedId ? 'active' : ''}" data-id="${r.id}">
                <div class="resume-thumb">${r.thumb ? `<img src="${r.thumb}" alt="">` : '📝'}</div>
                <div style="min-width:0;flex:1;">
                    <div style="font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.name)}</div>
                    <div class="flex items-center gap-1.5" style="margin-top:5px;">${st}<span style="font-size:11px;color:var(--muted);">${textOf(r).length} 字</span></div>
                </div>
            </div>`;
        }).join('');
    }

    // ---------------- 渲染：详情 ----------------
    const ed = (path, val, ph, tag = 'span', extra = '') =>
        (editing || val) ? `<${tag} data-edit="${path}" data-ph="${esc(ph)}" ${editing ? 'contenteditable="true"' : ''} ${extra}>${esc(val)}</${tag}>` : '';

    function sectionHtml(title, key, items, renderItem, addLabel, start = 0, showAdd = true) {
        if (!editing && !items.length) return '';
        return `<div class="rv-section">
            <div class="rv-section-title">${title}</div>
            ${items.map((it, j) => { const i = start + j; return `<div class="rv-entry">${editing ? `<button class="icon-btn danger rv-del" data-del="${key}.${i}" title="删除">✕</button>` : ''}${renderItem(it, i)}</div>`; }).join('')}
            ${editing && showAdd ? `<button class="btn btn-ghost btn-xs" data-add="${key}">＋ ${addLabel}</button>` : ''}
        </div>`;
    }

    // 把条目数组按 ENTRIES_PER_PAGE 切块；编辑态下空数组也保留一页，方便新增
    function chunks(list) {
        if (!list.length) return editing ? [{ start: 0, items: [] }] : [];
        const out = [];
        for (let i = 0; i < list.length; i += ENTRIES_PER_PAGE) out.push({ start: i, items: list.slice(i, i + ENTRIES_PER_PAGE) });
        return out;
    }

    function bulletsHtml(path, list) {
        if (!editing && !list.length) return '';
        return `<ul class="rv-bullets">${list.map((b, j) => `<li>${ed(`${path}.${j}`, b, '描述要点')}</li>`).join('')}</ul>
            ${editing ? `<button class="btn btn-danger-text btn-xs" style="margin-top:4px;color:var(--violet);" data-add-bullet="${path}">＋ 要点</button>` : ''}`;
    }

    // 结构化简历按模块分页：概览（基本信息+简介+教育）/ 经历 / 项目 / 技能与其他
    function structuredPages(s) {
        const b = s.basics;
        const range = (p, x) => (editing || x.start || x.end) ? `<span class="rv-meta">${ed(`${p}.start`, x.start, '开始')}${(editing || (x.start && x.end)) ? ' – ' : ''}${ed(`${p}.end`, x.end, '结束')}</span>` : '';
        const contacts = [['email', '✉️', '邮箱'], ['phone', '📱', '电话'], ['location', '📍', '城市']]
            .filter(([k]) => editing || b[k]).map(([k, i, ph]) => `<span>${i} ${ed(`basics.${k}`, b[k], ph)}</span>`).join('');
        const tags = (editing || s.tags.length) ? `<div class="flex flex-wrap gap-1.5" style="margin-top:12px;">${editing
            ? `<span class="chip" style="background:#fff;">🏷️ ${ed('tags', s.tags.join('、'), '定位标签，用顿号分隔', 'span', 'data-type="list"')}</span>`
            : s.tags.map(t => `<span class="chip" style="background:#fff;">${esc(t)}</span>`).join('')}</div>` : '';

        const eduItem = (e, i) => `
            <div class="rv-row"><span class="rv-title">${ed(`education.${i}.school`, e.school, '学校')}</span>${range(`education.${i}`, e)}</div>
            <div class="rv-sub">${ed(`education.${i}.degree`, e.degree, '学位')} ${ed(`education.${i}.major`, e.major, '专业')} ${(editing || e.gpa) ? `<span class="chip chip-sky" style="margin-left:4px;">GPA ${ed(`education.${i}.gpa`, e.gpa, '—')}</span>` : ''}</div>
            ${bulletsHtml(`education.${i}.highlights`, e.highlights)}`;
        const expItem = (e, i) => `
            <div class="rv-row"><span class="rv-title">${ed(`experience.${i}.company`, e.company, '公司')}</span>${range(`experience.${i}`, e)}</div>
            <div class="rv-sub">${ed(`experience.${i}.role`, e.role, '职位')}${(editing || e.location) ? ` · ${ed(`experience.${i}.location`, e.location, '地点')}` : ''}</div>
            ${bulletsHtml(`experience.${i}.bullets`, e.bullets)}`;
        const projItem = (p, i) => `
            <div class="rv-row"><span class="rv-title">${ed(`projects.${i}.name`, p.name, '项目名')}</span>${range(`projects.${i}`, p)}</div>
            ${(editing || p.role) ? `<div class="rv-sub">${ed(`projects.${i}.role`, p.role, '角色')}</div>` : ''}
            ${bulletsHtml(`projects.${i}.bullets`, p.bullets)}`;
        const skillItem = (g, i) => `
            ${(editing || g.category) ? `<div class="rv-title" style="font-size:13px;margin-bottom:8px;">${ed(`skills.${i}.category`, g.category, '分类，如：数据分析')}</div>` : ''}
            ${editing ? ed(`skills.${i}.items`, g.items.join('、'), '技能，用顿号分隔', 'div', 'data-type="list" style="font-size:13px;"')
                : `<div class="flex flex-wrap gap-1.5">${g.items.map(t => `<span class="chip chip-coral">${esc(t)}</span>`).join('')}</div>`}`;

        const pages = [];
        pages.push({
            key: 'overview', label: '👤 概览',
            html: `
            <div class="rv-hero">
                <div class="rv-name">${ed('basics.name', b.name, '姓名') || '<span style="color:var(--muted)">（未识别到姓名）</span>'}</div>
                ${(editing || b.title) ? `<div class="rv-sub" style="margin-top:2px;">${ed('basics.title', b.title, '求职意向 / 头衔')}</div>` : ''}
                <div class="rv-contacts">${contacts}${(b.links || []).map(l => `<span>🔗 ${esc(l)}</span>`).join('')}</div>
                ${tags}
            </div>
            ${(editing || s.summary) ? `<div class="rv-section"><div class="rv-section-title">个人简介</div><div style="font-size:13px;line-height:1.75;color:var(--ink-2);">${ed('summary', s.summary, '一句话介绍自己', 'div')}</div></div>` : ''}
            ${sectionHtml('🎓 教育背景', 'education', s.education, eduItem, '教育经历')}`
        });

        const addChunked = (key, label, title, list, item, addLabel) => {
            const cs = chunks(list);
            cs.forEach((c, n) => pages.push({
                key, label: cs.length > 1 ? `${label} ${n + 1}/${cs.length}` : label, last: n === cs.length - 1,
                html: sectionHtml(cs.length > 1 ? `${title}（${c.start + 1}-${c.start + c.items.length} / ${list.length}）` : title, key, c.items, item, addLabel, c.start, n === cs.length - 1)
            }));
        };
        addChunked('experience', '💼 经历', '💼 实习 / 工作经历', s.experience, expItem, '工作经历');
        addChunked('projects', '🧪 项目', '🧪 项目经历', s.projects, projItem, '项目');

        const otherHtml = `
            ${sectionHtml('🛠️ 技能', 'skills', s.skills, skillItem, '技能分组')}
            ${(editing || s.awards.length) ? `<div class="rv-section"><div class="rv-section-title">🏆 奖项荣誉</div><div class="rv-entry" style="padding:6px 16px;">${bulletsHtml('awards', s.awards)}</div></div>` : ''}
            ${(editing || s.languages.length) ? `<div class="rv-section"><div class="rv-section-title">🌏 语言</div>${editing
                ? ed('languages', s.languages.join('、'), '如：英语（流利）、普通话', 'div', 'data-type="list" style="font-size:13px;"')
                : `<div class="flex flex-wrap gap-1.5">${s.languages.map(t => `<span class="chip chip-sky">${esc(t)}</span>`).join('')}</div>`}</div>` : ''}`;
        if (otherHtml.trim()) pages.push({ key: 'skills', label: '🛠️ 技能与其他', last: true, html: otherHtml });
        return pages;
    }

    function pagedStructuredHtml(s) {
        const pages = structuredPages(s);
        lastPages = pages;
        secIndex = Math.min(Math.max(secIndex, 0), pages.length - 1);
        const p = pages[secIndex];
        if (pages.length === 1) return p.html;
        const toc = pages.map((x, i) => `<button class="toc-chip ${i === secIndex ? 'active' : ''}" data-sec="${i}"><b>${i + 1}</b>${x.label}</button>`).join('');
        return `<div class="toc">${toc}</div>
            <div class="fade-in">${p.html}</div>
            <div class="report-nav">
                <button class="btn btn-ghost btn-sm" data-sec="${secIndex - 1}" ${secIndex === 0 ? 'disabled' : ''}>‹ 上一页</button>
                <span class="pager-info">${secIndex + 1} / ${pages.length}</span>
                <button class="btn ${secIndex === pages.length - 1 ? 'btn-ghost' : 'btn-primary'} btn-sm" data-sec="${secIndex + 1}" ${secIndex === pages.length - 1 ? 'disabled' : ''}>下一页 ›</button>
            </div>`;
    }

    function skeleton() {
        const bar = (w, h = 12) => `<div style="height:${h}px;width:${w};border-radius:8px;background:linear-gradient(90deg,#F4EEFF,#FFE9F1,#F4EEFF);background-size:200% 100%;animation:shimmer 1.2s linear infinite;margin-bottom:10px;"></div>`;
        return `<div class="rv-hero">${bar('40%', 24)}${bar('60%')}${bar('30%')}</div>
            <div style="text-align:center;font-size:13px;font-weight:700;color:var(--violet);margin:-6px 0 18px;">🤖 AI 正在识别你的教育、经历和技能…</div>
            ${[1, 2, 3].map(() => `<div class="rv-entry">${bar('35%', 14)}${bar('90%')}${bar('80%')}${bar('70%')}</div>`).join('')}`;
    }

    function renderDetail() {
        const box = $('resume-detail');
        const r = current();
        if (!r) {
            box.innerHTML = `<div class="empty" style="padding:110px 20px;"><div class="empty-art">📄</div><h3>${state.resumes.length ? '选择左侧一份简历查看' : '上传你的第一份简历'}</h3><p>支持 PDF。AI 会把它拆成教育、经历、项目、技能卡片，你可以逐条校对修改。</p></div>`;
            return;
        }

        let body;
        if (detailTab === 'raw') {
            body = `<div style="font-size:12px;color:var(--muted);margin-bottom:10px;">这里是 PDF 提取的原始文字${r.structured ? '。修改后可点击「按原文重新解析」更新结构化结果' : '，备战时会直接使用这段文字'}。</div>
                <textarea class="textarea" id="raw-text" rows="22" style="font-size:12.5px;" placeholder="在这里粘贴简历文字...">${esc(r.content)}</textarea>
                <div class="flex justify-end gap-2" style="margin-top:12px;"><button class="btn btn-soft btn-sm" id="btn-reparse-raw">🤖 按原文重新解析</button></div>`;
        } else if (r.parseStatus === 'parsing') {
            body = skeleton();
        } else if (r.structured) {
            body = `<div class="${editing ? 'editing' : ''}" id="structured-root">${pagedStructuredHtml(r.structured)}</div>`;
        } else {
            body = `<div class="empty" style="padding:60px 20px;">
                <div class="empty-art">${r.parseStatus === 'error' ? '😵' : '🤖'}</div>
                <h3>${r.parseStatus === 'error' ? 'AI 解析失败' : '还没有结构化解析'}</h3>
                <p>${r.parseStatus === 'error' ? esc(r.parseError) : '让 AI 把这份简历拆成清晰的模块卡片，备战时效果更好。'}</p>
                <div class="flex gap-2" style="margin-top:16px;">
                    <button class="btn btn-primary btn-sm" data-act="parse">✨ AI 解析</button>
                    <button class="btn btn-ghost btn-sm" data-act="manual">手动填写</button>
                </div></div>`;
        }

        box.innerHTML = `
            <div style="padding:18px 22px;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;">
                <div style="flex:1;min-width:220px;">
                    <input class="input" id="resume-name" value="${esc(r.name)}" style="font-weight:800;font-size:16px;background:transparent;border-color:transparent;padding:6px 8px;margin-left:-8px;" title="点击修改版本名称">
                    <div style="font-size:12px;color:var(--muted);font-weight:600;padding-left:2px;">${r.fileName ? `📎 ${esc(r.fileName)} · ${r.pages} 页 · ` : ''}更新于 ${new Date(r.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <div class="flex flex-wrap gap-2">
                    ${r.structured && detailTab === 'parsed' && r.parseStatus !== 'parsing' ? `<button class="btn ${editing ? 'btn-dark' : 'btn-ghost'} btn-sm" data-act="edit">${editing ? '✓ 完成编辑' : '✏️ 编辑'}</button>` : ''}
                    ${r.content && r.parseStatus !== 'parsing' ? `<button class="btn btn-soft btn-sm" data-act="parse">🔄 重新解析</button>` : ''}
                    <button class="btn btn-primary btn-sm" data-act="use">🚀 用它备战</button>
                    <button class="icon-btn danger" data-act="delete" title="删除">🗑️</button>
                </div>
            </div>
            <div style="padding:14px 22px 0;"><div class="tabs" style="display:inline-flex;">
                <button class="tab-btn ${detailTab === 'parsed' ? 'active' : ''}" data-dtab="parsed">🧩 结构化</button>
                <button class="tab-btn ${detailTab === 'raw' ? 'active' : ''}" data-dtab="raw">📃 原文</button>
            </div></div>
            <div style="padding:20px 22px 26px;" class="fade-in">${body}</div>`;

        bindDetail(r);
    }

    function setPath(obj, path, val) {
        const keys = path.split('.');
        let o = obj;
        for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
        o[keys[keys.length - 1]] = val;
    }

    // 把可编辑字段写回结构化数据
    function collect() {
        const r = current();
        const root = $('structured-root');
        if (!r || !r.structured || !root) return;
        const s = JSON.parse(JSON.stringify(r.structured));
        root.querySelectorAll('[data-edit]').forEach(el => {
            const v = el.innerText.replace(/ /g, ' ').trim();
            setPath(s, el.dataset.edit, el.dataset.type === 'list' ? v.split(/[、,，;；\n]/).map(x => x.trim()).filter(Boolean) : v);
        });
        update(r.id, { structured: s });
    }

    function cleanEmpty(s) {
        const c = sanitize(s);
        c.education = c.education.filter(e => e.school || e.degree || e.major);
        c.experience = c.experience.filter(e => e.company || e.role || e.bullets.length);
        c.projects = c.projects.filter(p => p.name || p.bullets.length);
        c.skills = c.skills.filter(g => g.category || g.items.length);
        return c;
    }

    function bindDetail(r) {
        const box = $('resume-detail');
        $('resume-name').addEventListener('change', e => {
            update(r.id, { name: e.target.value.trim() || '未命名简历' });
            renderList(); renderResumePicks();
        });
        box.querySelectorAll('[data-dtab]').forEach(b => b.onclick = () => {
            if (editing) { collect(); editing = false; }
            detailTab = b.dataset.dtab;
            renderDetail();
        });
        const raw = $('raw-text');
        if (raw) raw.addEventListener('change', () => { update(r.id, { content: raw.value }); renderList(); renderResumePicks(); });
        const rp = $('btn-reparse-raw');
        if (rp) rp.onclick = () => { if (raw) update(r.id, { content: raw.value }); detailTab = 'parsed'; aiParse(r.id); };

        box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
            const act = b.dataset.act;
            if (act === 'edit') {
                if (editing) {
                    collect();
                    update(r.id, { structured: cleanEmpty(current().structured) });
                    editing = false;
                    toast('简历已保存');
                    renderResumePicks();
                } else editing = true;
                renderDetail(); renderList();
            }
            if (act === 'parse') {
                if (r.structured && !confirm('重新解析会覆盖你对结构化内容的修改，确定吗？')) return;
                editing = false; detailTab = 'parsed';
                aiParse(r.id);
            }
            if (act === 'manual') { update(r.id, { structured: EMPTY(), parseStatus: 'done' }); editing = true; renderAll(); }
            if (act === 'delete') {
                if (!confirm(`确定删除「${r.name}」吗？`)) return;
                state.resumes = state.resumes.filter(x => x.id !== r.id);
                save.resumes();
                selectedId = state.resumes[0]?.id || null;
                editing = false;
                secIndex = 0;
                renderAll();
            }
            if (act === 'use') {
                if (editing) { collect(); editing = false; }
                if (!textOf(current())) return toast('这份简历还是空的', 'err');
                switchView('workspace');
                selectOnlyResume(r.id);
                toast(`已选中「${r.name}」`);
            }
        });

        const root = $('structured-root');
        if (root) root.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => {
            const i = Number(b.dataset.sec);
            if (b.disabled || i < 0 || i >= lastPages.length) return;
            if (editing) collect();
            secIndex = i;
            renderDetail();
            $('resume-detail').scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
        if (!root || !editing) return;
        root.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.target.matches('span[data-edit]')) { e.preventDefault(); e.target.blur(); }
        });
        root.addEventListener('focusout', e => { if (e.target.matches('[data-edit]')) collect(); });
        root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
            collect();
            const [key, idx] = b.dataset.del.split('.');
            const s = current().structured;
            s[key].splice(Number(idx), 1);
            update(r.id, { structured: s });
            renderDetail();
        });
        root.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
            collect();
            const key = b.dataset.add;
            const s = current().structured;
            const blank = {
                education: { school: '', degree: '', major: '', start: '', end: '', gpa: '', highlights: [] },
                experience: { company: '', role: '', location: '', start: '', end: '', bullets: [''] },
                projects: { name: '', role: '', start: '', end: '', bullets: [''] },
                skills: { category: '', items: [] }
            }[key];
            s[key].push(blank);
            update(r.id, { structured: s });
            // 跳到该模块的最后一页（新条目所在页）
            structuredPages(current().structured).forEach((pg, i) => { if (pg.key === key) secIndex = i; });
            renderDetail();
        });
        root.querySelectorAll('[data-add-bullet]').forEach(b => b.onclick = () => {
            collect();
            const s = current().structured;
            const keys = b.dataset.addBullet.split('.');
            let o = s;
            keys.forEach(k => { o = o[k]; });
            o.push('');
            update(r.id, { structured: s });
            renderDetail();
            const items = $('structured-root').querySelectorAll(`[data-edit^="${b.dataset.addBullet}."]`);
            items[items.length - 1]?.focus();
        });
    }

    function renderAll() {
        renderList();
        renderDetail();
        renderResumePicks();
        updateBadges();
    }

    function init() {
        state.resumes = state.resumes.filter(r => r.content || r.structured);
        selectedId = state.resumes[0]?.id || null;
        Pager.register('resumes', renderList);

        const dz = $('dropzone');
        $('pdf-input').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
        ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
        ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
        dz.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));

        $('resume-list').addEventListener('click', e => {
            const it = e.target.closest('[data-id]');
            if (!it) return;
            if (editing) collect();
            selectedId = it.dataset.id;
            editing = false;
            detailTab = 'parsed';
            secIndex = 0;
            renderList(); renderDetail();
        });

        $('btn-new-blank-resume').addEventListener('click', () => {
            const r = normalize({ name: `简历 ${String.fromCharCode(65 + state.resumes.length % 26)}`, content: '' });
            state.resumes.unshift(r);
            save.resumes();
            selectedId = r.id;
            detailTab = 'raw';
            editing = false;
            secIndex = 0;
            Pager.reset('resumes');
            renderAll();
            setTimeout(() => $('raw-text')?.focus(), 50);
        });

        renderList();
        renderDetail();
    }

    return { init, normalize, textOf, toText, renderList, renderDetail, handleFile, sanitize, parseJSON, rebuildLines };
})();
