// ============================================================
// 翻页组件
//   1. 列表分页：Pager.slice() + Pager.bar()，点击由全局事件委托处理
//   2. 报告分页：Pager.renderReport() 按 Markdown 标题把长报告切成多页
// ============================================================
const Pager = (() => {
    const pages = {};      // 列表当前页：key -> 页码（从 1 开始）
    const renderers = {};  // 列表 key -> 重新渲染函数
    const reports = {};    // 报告 key -> { sections, index }

    // ---------------- 列表分页 ----------------
    function register(key, render) { renderers[key] = render; }
    function get(key) { return pages[key] || 1; }
    function set(key, n) { pages[key] = n; }
    function reset(key) { pages[key] = 1; }

    function slice(key, list, size) {
        const total = list.length;
        const count = Math.max(1, Math.ceil(total / size));
        const page = Math.min(Math.max(get(key), 1), count);
        pages[key] = page;
        return { items: list.slice((page - 1) * size, page * size), page, count, total, from: total ? (page - 1) * size + 1 : 0, to: Math.min(page * size, total) };
    }

    // 页码序列：1 … 4 5 6 … 12
    function numbers(page, count) {
        if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
        const set = new Set([1, count, page - 1, page, page + 1]);
        if (page <= 3) [2, 3, 4].forEach(n => set.add(n));
        if (page >= count - 2) [count - 3, count - 2, count - 1].forEach(n => set.add(n));
        const arr = [...set].filter(n => n >= 1 && n <= count).sort((a, b) => a - b);
        const out = [];
        arr.forEach((n, i) => { if (i && n - arr[i - 1] > 1) out.push('…'); out.push(n); });
        return out;
    }

    function bar(key, r, { unit = '条', compact = false } = {}) {
        if (r.count <= 1) return r.total ? `<div class="pager"><span class="pager-info">共 ${r.total} ${unit}</span></div>` : '';
        const btn = (n, label, extra = '') => `<button class="pager-btn ${extra}" data-pager="${key}" data-page="${n}" ${n < 1 || n > r.count ? 'disabled' : ''}>${label}</button>`;
        const nums = compact
            ? `<span class="pager-info" style="padding:0 6px;">${r.page} / ${r.count}</span>`
            : numbers(r.page, r.count).map(n => n === '…' ? '<span class="pager-gap">…</span>' : btn(n, n, n === r.page ? 'active' : '')).join('');
        return `<div class="pager">
            <span class="pager-info">${compact ? `共 ${r.total} ${unit}` : `第 ${r.from}-${r.to} ${unit}，共 ${r.total} ${unit}`}</span>
            <div class="pager-btns">${btn(r.page - 1, '‹', 'arrow')}${nums}${btn(r.page + 1, '›', 'arrow')}</div>
        </div>`;
    }

    // ---------------- 报告分页 ----------------
    // 选一个能把报告切成 ≥2 段的标题层级（优先 ##，其次 #、###），代码块内的 # 不算
    function splitMarkdown(text) {
        const lines = String(text || '').split('\n');
        const inCode = [];
        let fence = false;
        lines.forEach((l, i) => { if (/^\s*```/.test(l)) fence = !fence; inCode[i] = fence; });

        const cut = (level) => {
            const re = new RegExp(`^#{${level}}\\s+(.+)`);
            const secs = [];
            let cur = { title: '', lines: [] };
            lines.forEach((l, i) => {
                const m = !inCode[i] && l.match(re);
                if (m) {
                    if (cur.lines.join('').trim()) secs.push(cur);
                    cur = { title: m[1].replace(/[*_`#]/g, '').trim(), lines: [l] };
                } else cur.lines.push(l);
            });
            if (cur.lines.join('').trim()) secs.push(cur);
            return secs.map(s => ({ title: s.title, body: s.lines.join('\n').trim() }));
        };

        let secs = null;
        for (const lv of [2, 1, 3]) {
            const s = cut(lv);
            if (s.length >= 2) { secs = s; break; }
        }
        if (!secs) secs = [{ title: '', body: String(text || '').trim() }];

        // 开头没有标题的短引言并入下一页
        if (secs.length > 1 && !secs[0].title && secs[0].body.length < 400) {
            secs[1].body = secs[0].body + '\n\n' + secs[1].body;
            secs.shift();
        }
        // 过短的相邻章节合并，过长的章节按段落再切
        const merged = [];
        secs.forEach(s => {
            const last = merged[merged.length - 1];
            if (last && last.body.length + s.body.length < 450) { last.body += '\n\n' + s.body; last.title = last.title || s.title; }
            else merged.push({ ...s });
        });
        const out = [];
        merged.forEach(s => {
            if (s.body.length <= 3200) return out.push(s);
            const paras = s.body.split(/\n{2,}/);
            let buf = [], len = 0, part = 1;
            paras.forEach(p => {
                if (len + p.length > 2600 && buf.length) {
                    out.push({ title: `${s.title || '内容'}（${part++}）`, body: buf.join('\n\n') });
                    buf = []; len = 0;
                }
                buf.push(p); len += p.length;
            });
            if (buf.length) out.push({ title: part > 1 ? `${s.title || '内容'}（${part}）` : s.title, body: buf.join('\n\n') });
        });
        out.forEach((s, i) => { if (!s.title) s.title = `第 ${i + 1} 部分`; });
        return out;
    }

    function renderReport(elId, text, { reset = false } = {}) {
        const el = document.getElementById(elId);
        if (!el) return;
        if (!text) { el.innerHTML = ''; delete reports[elId]; return; }
        const prev = reports[elId];
        const sections = splitMarkdown(text);
        const index = reset || !prev ? 0 : Math.min(prev.index, sections.length - 1);
        reports[elId] = { sections, index };
        drawReport(elId);
    }

    function drawReport(elId) {
        const el = document.getElementById(elId);
        const r = reports[elId];
        if (!el || !r) return;
        const { sections, index } = r;
        const s = sections[index];
        if (sections.length === 1) { el.innerHTML = md(s.body); return; }
        const toc = sections.map((x, i) => `<button class="toc-chip ${i === index ? 'active' : ''}" data-rpage="${elId}" data-index="${i}" title="${esc(x.title)}"><b>${i + 1}</b>${esc(x.title.length > 14 ? x.title.slice(0, 14) + '…' : x.title)}</button>`).join('');
        el.innerHTML = `
            <div class="toc">${toc}</div>
            <div class="fade-in">${md(s.body)}</div>
            <div class="report-nav">
                <button class="btn btn-ghost btn-sm" data-rpage="${elId}" data-index="${index - 1}" ${index === 0 ? 'disabled' : ''}>‹ 上一节</button>
                <span class="pager-info">${index + 1} / ${sections.length}</span>
                <button class="btn ${index === sections.length - 1 ? 'btn-ghost' : 'btn-primary'} btn-sm" data-rpage="${elId}" data-index="${index + 1}" ${index === sections.length - 1 ? 'disabled' : ''}>下一节 ›</button>
            </div>`;
        const active = el.querySelector('.toc-chip.active');
        if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
    }

    function scrollTopOf(el) {
        let p = el.parentElement;
        while (p && p !== document.body) {
            if (p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) { p.scrollTop = 0; break; }
            p = p.parentElement;
        }
        const top = el.getBoundingClientRect().top;
        if (top < 0) window.scrollBy({ top: top - 90, behavior: 'smooth' });
    }

    // ---------------- 全局点击委托 ----------------
    document.addEventListener('click', e => {
        const lb = e.target.closest('[data-pager]');
        if (lb && !lb.disabled) {
            const key = lb.dataset.pager;
            pages[key] = Number(lb.dataset.page);
            renderers[key] && renderers[key]();
            return;
        }
        const rb = e.target.closest('[data-rpage]');
        if (rb && !rb.disabled) {
            const id = rb.dataset.rpage;
            const r = reports[id];
            const i = Number(rb.dataset.index);
            if (!r || i < 0 || i >= r.sections.length) return;
            r.index = i;
            drawReport(id);
            scrollTopOf(document.getElementById(id));
        }
    });

    // 键盘 ← → 翻报告（仅在当前可见的报告上生效，输入框中不触发）
    document.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        const id = Object.keys(reports).find(k => { const el = document.getElementById(k); return el && el.offsetParent !== null && reports[k].sections.length > 1; });
        if (!id) return;
        const r = reports[id];
        const i = r.index + (e.key === 'ArrowRight' ? 1 : -1);
        if (i < 0 || i >= r.sections.length) return;
        r.index = i;
        drawReport(id);
        scrollTopOf(document.getElementById(id));
    });

    return { register, get, set, reset, slice, bar, renderReport, splitMarkdown };
})();
