/**
 * 私有订阅网关 · Cloudflare Worker
 * ------------------------------------------------------------
 * 作用：把「私有 GitHub 仓库里的播放列表」通过带密钥的地址对外提供，
 *      密钥不对 / 浏览器直接打开 / 频率过高 一律 403，不返回任何内容。
 *
 * 需要在 Cloudflare Worker 的 Settings → Variables 里配置：
 *   KEYS         订阅密钥（可多个，英文逗号分隔，方便轮换）
 *   GH_TOKEN     只读该私有仓库的 GitHub Token（Fine-grained，Contents: Read）
 *   GH_REPO      私有仓库，如 ccm789/sub-private
 *   GH_PATH      文件路径，如 list.m3u
 *   GH_BRANCH    分支，默认 main（可不填）
 *   BLOCK_BROWSER 1 = 拦截浏览器直接打开（默认开启），0 = 关闭
 *
 * 订阅地址格式：
 *   https://<你的worker域名>/?k=<密钥>
 */

const RATE_LIMIT = 60;        // 每个 IP 每分钟最多请求次数
const RATE_WINDOW = 60000;    // 限流窗口（毫秒）
const buckets = new Map();    // 简易内存计数（isolate 重启会重置，够用）

function deny(status, msg) {
  // 不返回任何提示性内容，避免暴露是"订阅接口"
  return new Response(msg, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function rateLimited(ip) {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.start > RATE_WINDOW) {
    buckets.set(ip, { start: now, n: 1 });
    return false;
  }
  b.n++;
  return b.n > RATE_LIMIT;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ua = request.headers.get('User-Agent') || '';

    // 1) 密钥校验（不通过直接 403，且不区分"密钥错"和"没密钥"）
    const keys = (env.KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
    const k = url.searchParams.get('k') || '';
    if (!keys.length || !keys.includes(k)) return deny(403, 'forbidden');

    // 2) 浏览器拦截：浏览器 UA 且不像播放器 → 403
    if ((env.BLOCK_BROWSER || '1') === '1') {
      const player = /ExoPlayer|okhttp|Lavf|VLC|TiviMate|OTT ?Navigator|GSE|IPTV|Kodi|mpv|PotPlayer|MX ?Player|nPlayer|IINA|OPlayer|Televizo|Perfect ?Player/i.test(ua);
      const browser = /Mozilla|Chrome|Safari|Firefox|Edg\//i.test(ua);
      if (browser && !player) return deny(403, 'forbidden');
    }

    // 3) 简易限流（防被批量拉取/刷流量）
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return deny(429, 'too many requests');

    // 4) 从私有仓库读取列表（Token 只存在 Worker 环境变量里，不对外）
    if (!env.GH_TOKEN || !env.GH_REPO || !env.GH_PATH) return deny(500, 'not configured');
    const api = `https://api.github.com/repos/${env.GH_REPO}/contents/${env.GH_PATH}?ref=${env.GH_BRANCH || 'main'}`;
    let r;
    try {
      r = await fetch(api, {
        headers: {
          'Authorization': 'Bearer ' + env.GH_TOKEN,
          'Accept': 'application/vnd.github.raw',
          'User-Agent': 'sub-gateway',
        },
        cf: { cacheTtl: 60, cacheEverything: true },   // 边缘缓存 60 秒，省 API 额度
      });
    } catch (e) {
      return deny(502, 'upstream error');
    }
    if (!r.ok) return deny(502, 'upstream ' + r.status);

    const body = await r.text();

    // 5) 返回订阅内容（不缓存到客户端，避免中间层留存）
    return new Response(body, {
      headers: {
        'Content-Type': 'audio/x-mpegurl; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  },
};
