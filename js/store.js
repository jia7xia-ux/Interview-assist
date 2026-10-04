// ============================================================
// 数据层：按用户隔离的本地存储 + Supabase 云端同步
//   - 本地 key 形如  ip:<userId|guest>:<name>
//   - SYNC_KEYS 中的数据会整体同步到 user_workspace 表
//   - llm（API Key 等）只保存在本机，不上传云端
// ============================================================
(function () {
    const SYNC_KEYS = ['resumes', 'applications', 'events', 'activeSession', 'activeAppId', 'debrief'];
    const LOCAL_ONLY_KEYS = ['llm', 'ui'];
    const TABLE = 'user_workspace';

    const LEGACY_MAP = {
        resumes: 'interview_prep_resumes',
        applications: 'interview_prep_apps',
        events: 'interview_prep_events',
        activeSession: 'interview_prep_active_session',
        activeAppId: 'interview_prep_active_app_id',
        debrief: 'interview_prep_debrief_session',
        llm: 'interview_prep_settings'
    };

    const Store = {
        ns: 'guest',
        user: null,
        status: 'local', // local | syncing | synced | error | offline
        lastError: '',
        _timer: null,
        _listeners: [],

        k(name) { return `ip:${this.ns}:${name}`; },

        get(name, fallback) {
            try {
                const raw = localStorage.getItem(this.k(name));
                return raw == null ? fallback : JSON.parse(raw);
            } catch (e) {
                return fallback;
            }
        },

        // 返回 false 表示本地存储写入失败（通常是配额满了）
        set(name, value, { silent = false } = {}) {
            let ok = true;
            try {
                localStorage.setItem(this.k(name), JSON.stringify(value));
            } catch (e) {
                console.warn('本地写入失败', name, e);
                ok = false;
            }
            if (SYNC_KEYS.includes(name) && !silent) {
                this._setMeta(Date.now());
                this.schedulePush();
            }
            return ok;
        },

        _meta() { return Number(localStorage.getItem(this.k('__updatedAt')) || 0); },
        _setMeta(ts) { try { localStorage.setItem(this.k('__updatedAt'), String(ts)); } catch (e) { /* ignore */ } },

        snapshot() {
            const out = {};
            SYNC_KEYS.forEach(n => { out[n] = this.get(n, null); });
            return out;
        },

        hasLocalData() {
            return SYNC_KEYS.some(n => localStorage.getItem(this.k(n)) != null);
        },

        onStatus(fn) { this._listeners.push(fn); fn(this.status); },
        _emit(status, err) {
            this.status = status;
            this.lastError = err || '';
            this._listeners.forEach(fn => { try { fn(status, err); } catch (e) { /* ignore */ } });
        },

        // 把旧版（未登录时代）的 localStorage 数据一次性复制到当前命名空间
        migrateLegacy() {
            if (localStorage.getItem(this.k('__migrated'))) return false;
            let moved = false;
            if (!this.hasLocalData()) {
                Object.entries(LEGACY_MAP).forEach(([name, legacyKey]) => {
                    const raw = localStorage.getItem(legacyKey);
                    if (raw == null) return;
                    try {
                        localStorage.setItem(this.k(name), raw);
                        moved = true;
                    } catch (e) { /* ignore */ }
                });
                // 旧数据的时间戳设为极小值：如果云端已有数据，以云端为准
                if (moved) this._setMeta(1);
            }
            try { localStorage.setItem(this.k('__migrated'), '1'); } catch (e) { /* ignore */ }
            return moved;
        },

        async init({ user }) {
            this.user = user || null;
            this.ns = user ? user.id : 'guest';
            this.migrateLegacy();
            if (!this.user || !window.Auth || !Auth.client) {
                this._emit('local');
                return;
            }
            await this.pull();
            window.addEventListener('online', () => this.schedulePush(0));
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden' && this._timer) this.flush();
            });
        },

        async pull() {
            this._emit('syncing');
            try {
                const { data, error } = await Auth.client
                    .from(TABLE).select('data, updated_at').eq('user_id', this.user.id).maybeSingle();
                if (error) throw error;

                const localTs = this._meta();
                const cloudTs = data ? new Date(data.updated_at).getTime() : 0;

                if (data && cloudTs >= localTs) {
                    const cloud = data.data || {};
                    SYNC_KEYS.forEach(n => {
                        if (cloud[n] === undefined || cloud[n] === null) localStorage.removeItem(this.k(n));
                        else this.set(n, cloud[n], { silent: true });
                    });
                    this._setMeta(cloudTs);
                    this._emit('synced');
                } else if (this.hasLocalData()) {
                    await this.push(); // 本地更新 / 云端还没有数据
                } else {
                    this._emit('synced');
                }
            } catch (e) {
                console.warn('云端拉取失败', e);
                this._emit(navigator.onLine ? 'error' : 'offline', e.message);
            }
        },

        schedulePush(delay = 1200) {
            if (!this.user) return;
            clearTimeout(this._timer);
            this._timer = setTimeout(() => this.push(), delay);
        },

        flush() {
            clearTimeout(this._timer);
            return this.push();
        },

        async push() {
            this._timer = null;
            if (!this.user || !Auth.client) return;
            if (!navigator.onLine) { this._emit('offline'); return; }
            this._emit('syncing');
            try {
                const ts = this._meta() || Date.now();
                const { error } = await Auth.client.from(TABLE).upsert({
                    user_id: this.user.id,
                    data: this.snapshot(),
                    updated_at: new Date(ts).toISOString()
                });
                if (error) throw error;
                this._emit('synced');
            } catch (e) {
                console.warn('云端同步失败', e);
                this._emit('error', e.message);
            }
        },

        LOCAL_ONLY_KEYS
    };

    window.Store = Store;
})();
