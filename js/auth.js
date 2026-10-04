// ============================================================
// 账号模块：基于 Supabase Auth（邮箱 + 密码）
// 未配置 Supabase 时自动退化为「游客模式」
// ============================================================
(function () {
    const cfg = window.APP_CONFIG || {};
    const GUEST_FLAG = 'ip:guest_mode';

    const Auth = {
        client: null,
        enabled: false,

        init() {
            this.enabled = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient);
            if (this.enabled && !this.client) {
                this.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
                    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
                });
            }
            return this;
        },

        guestAllowed() {
            return !this.enabled || cfg.ALLOW_GUEST !== false;
        },

        isGuest() {
            try { return localStorage.getItem(GUEST_FLAG) === '1'; } catch (e) { return false; }
        },

        enterGuest() {
            try { localStorage.setItem(GUEST_FLAG, '1'); } catch (e) { /* ignore */ }
        },

        leaveGuest() {
            try { localStorage.removeItem(GUEST_FLAG); } catch (e) { /* ignore */ }
        },

        async getUser() {
            if (!this.enabled) return null;
            const { data } = await this.client.auth.getSession();
            return data && data.session ? data.session.user : null;
        },

        // 页面守卫：已登录 → 返回 user；游客 → 返回 { guest: true }；否则跳转登录页
        async requireAuth() {
            this.init();
            const user = await this.getUser();
            if (user) {
                this.leaveGuest();
                return { user, guest: false };
            }
            if (this.isGuest() && this.guestAllowed()) return { user: null, guest: true };
            window.location.replace('login.html');
            return new Promise(() => {}); // 阻断后续初始化
        },

        appUrl(page) {
            const base = window.location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, '');
            return base + page;
        },

        async signIn(email, password) {
            const { data, error } = await this.client.auth.signInWithPassword({ email, password });
            if (error) throw error;
            return data;
        },

        async signUp(email, password, nickname) {
            const { data, error } = await this.client.auth.signUp({
                email, password,
                options: { data: { nickname: nickname || '' }, emailRedirectTo: this.appUrl('index.html') }
            });
            if (error) throw error;
            return data; // data.session 为空表示需要邮箱验证
        },

        async sendResetEmail(email) {
            const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo: this.appUrl('login.html?mode=reset') });
            if (error) throw error;
        },

        async updatePassword(password) {
            const { error } = await this.client.auth.updateUser({ password });
            if (error) throw error;
        },

        async signOut() {
            this.leaveGuest();
            if (this.enabled) await this.client.auth.signOut();
            window.location.replace('login.html');
        },

        displayName(user) {
            if (!user) return '游客';
            const meta = user.user_metadata || {};
            return meta.nickname || (user.email ? user.email.split('@')[0] : '用户');
        },

        // 把 Supabase 英文报错翻译成中文
        friendlyError(err) {
            const msg = (err && err.message) || String(err);
            const map = [
                [/Invalid login credentials/i, '邮箱或密码不正确'],
                [/Email not confirmed/i, '邮箱还未验证，请先点击验证邮件中的链接'],
                [/User already registered/i, '该邮箱已注册，请直接登录'],
                [/Password should be at least/i, '密码至少需要 6 位'],
                [/rate limit|too many/i, '操作太频繁了，请稍后再试'],
                [/Unable to validate email|invalid email/i, '邮箱格式不正确'],
                [/Failed to fetch|NetworkError/i, '网络连接失败，请检查网络']
            ];
            for (const [re, zh] of map) if (re.test(msg)) return zh;
            return msg;
        }
    };

    window.Auth = Auth;
})();
