// ============================================================
// 站点配置：填入你自己的 Supabase 项目信息即可开启账号登录 + 云端同步
// 获取方式：Supabase 控制台 → Project Settings → API
//   - Project URL        → SUPABASE_URL
//   - anon public key    → SUPABASE_ANON_KEY（这是公开 key，可以放前端，安全由 RLS 保证）
// 留空时站点自动进入「游客模式」：数据只保存在当前浏览器。
// ============================================================
window.APP_CONFIG = {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',

    // 是否在登录页显示「游客模式」入口（未配置 Supabase 时总会显示）
    ALLOW_GUEST: true,

    // 大模型默认配置（用户可在「设置」里覆盖）
    DEFAULT_API_BASE: 'https://api.deepseek.com/v1',
    DEFAULT_MODEL: 'deepseek-chat'
};
