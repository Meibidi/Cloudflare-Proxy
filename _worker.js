/**
 * Cloudflare Workers 动态反向代理 v2.1
 * 高性能流媒体优化版 - 专为 Emby/Plex/Jellyfin 设计
 *
 * 格式：https://your-domain.com/target-domain.com/path
 *
 * v2.1 特性：
 * - 🎬 WebSocket 全双工支持（Emby 实时通信）
 * - 📺 流媒体智能直通（自动识别视频流，禁用缓存）
 * - 🖼️ 海报墙强缓存（图片资源 Edge Cache 加速）
 * - 🔄 Range 分片透传（拖拽进度无卡顿）
 * - ⏱️ 自适应超时（流媒体场景更长容忍）
 */

// ========== 默认配置 ==========
const DEFAULT_CONFIG = {
  authUser: '',
  defaultProtocol: 'https',
  maxRedirects: 5,
  requestTimeout: 30000,
  streamTimeout: 300000,       // 流媒体超时 5 分钟
  userAgent: '',

  // 缓存配置
  defaultCacheTTL: 3600,
  staticCacheTTL: 86400,
  dynamicCacheTTL: 300,
  imageCacheTTL: 604800,       // 图片缓存 7 天
  enableEdgeCache: true,

  // 静态资源扩展名
  staticExtensions: [
    '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
    '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip',
  ],

  // 流媒体路径关键词（自动识别并直通）
  streamPaths: [
    '/videos/', '/stream', '/audio/', '/playing', '/transcode',
    '/emby/videos/', '/emby/audio/',
    '/mediabrowser/videos/',
    '/library/parts/',           // Plex
  ],

  // 图片路径关键词（强缓存）
  imagePaths: [
    '/images/', '/items/', '/primary', '/backdrop', '/thumb',
    '/emby/items/', '/photo/',
  ],

  // 访问控制
  blockedDomains: [],
  allowedDomains: [],
  blockedIPs: [],
  allowedIPs: [],
  noCachePaths: [],

  // 功能开关
  enableWebSocket: true,
};

// ========== 配置合并 ==========
function getConfig(env = {}) {
  const config = { ...DEFAULT_CONFIG };
  const envMappings = {
    'AUTH_USER': { key: 'authUser', type: 'string' },
    'DEFAULT_PROTOCOL': { key: 'defaultProtocol', type: 'string' },
    'MAX_REDIRECTS': { key: 'maxRedirects', type: 'number' },
    'REQUEST_TIMEOUT': { key: 'requestTimeout', type: 'number' },
    'STREAM_TIMEOUT': { key: 'streamTimeout', type: 'number' },
    'USER_AGENT': { key: 'userAgent', type: 'string' },
    'DEFAULT_CACHE_TTL': { key: 'defaultCacheTTL', type: 'number' },
    'STATIC_CACHE_TTL': { key: 'staticCacheTTL', type: 'number' },
    'DYNAMIC_CACHE_TTL': { key: 'dynamicCacheTTL', type: 'number' },
    'IMAGE_CACHE_TTL': { key: 'imageCacheTTL', type: 'number' },
    'ENABLE_EDGE_CACHE': { key: 'enableEdgeCache', type: 'boolean' },
    'STREAM_PATHS': { key: 'streamPaths', type: 'array' },
    'IMAGE_PATHS': { key: 'imagePaths', type: 'array' },
    'BLOCKED_DOMAINS': { key: 'blockedDomains', type: 'array' },
    'ALLOWED_DOMAINS': { key: 'allowedDomains', type: 'array' },
    'BLOCKED_IPS': { key: 'blockedIPs', type: 'array' },
    'ALLOWED_IPS': { key: 'allowedIPs', type: 'array' },
    'NO_CACHE_PATHS': { key: 'noCachePaths', type: 'array' },
    'ENABLE_WEBSOCKET': { key: 'enableWebSocket', type: 'boolean' },
  };

  for (const [envKey, mapping] of Object.entries(envMappings)) {
    const val = env[envKey];
    if (val !== undefined && val !== null && val !== '') {
      switch (mapping.type) {
        case 'string': config[mapping.key] = String(val); break;
        case 'number': { const n = parseInt(val, 10); if (!isNaN(n)) config[mapping.key] = n; } break;
        case 'boolean': config[mapping.key] = val === 'true' || val === '1' || val === true; break;
        case 'array':
          config[mapping.key] = typeof val === 'string'
            ? val.split(',').map(s => s.trim()).filter(Boolean)
            : Array.isArray(val) ? val : config[mapping.key];
          break;
      }
    }
  }
  return config;
}

// ========== 主处理函数 ==========
export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    const CONFIG = getConfig(env);

    try {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get('Upgrade');

      // 健康检查
      if (url.pathname === '/health') {
        return jsonResponse({ status: 'ok', version: '2.1', ws: CONFIG.enableWebSocket });
      }

      // 根路径
      if (url.pathname === '/' || url.pathname === '') {
        return corsResponse(new Response(getUsageHTML(CONFIG), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }));
      }

      // OPTIONS 预检
      if (request.method === 'OPTIONS') {
        return corsResponse(new Response(null, { status: 204 }));
      }

      // IP 访问控制
      const clientIP = request.headers.get('cf-connecting-ip') || '';
      if (!checkAccess(clientIP, CONFIG.allowedIPs, CONFIG.blockedIPs)) {
        return corsResponse(jsonResponse({ error: 'Access Denied' }, 403));
      }

      // 解析路径
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length === 0) {
        return corsResponse(jsonResponse({ error: 'Empty path' }, 400));
      }

      let startIndex = 0;
      if (CONFIG.authUser) {
        if (parts.length < 2 || parts[0] !== CONFIG.authUser) {
          return corsResponse(jsonResponse({ error: 'Unauthorized' }, 401));
        }
        startIndex = 1;
      }

      if (parts.length <= startIndex) {
        return corsResponse(jsonResponse({ error: 'No target specified' }, 400));
      }

      const targetPath = parts.slice(startIndex).join('/');
      const upstreamUrl = parseUpstreamUrl(targetPath, url.search, CONFIG);

      // 域名访问控制
      const hostname = upstreamUrl.hostname.toLowerCase();
      if (!checkAccess(hostname, CONFIG.allowedDomains, CONFIG.blockedDomains)) {
        return corsResponse(jsonResponse({ error: 'Domain not allowed' }, 403));
      }

      // ========== WebSocket 处理 ==========
      if (CONFIG.enableWebSocket && upgradeHeader?.toLowerCase() === 'websocket') {
        return handleWebSocket(request, upstreamUrl);
      }

      // ========== HTTP 请求处理 ==========
      const lowerPath = upstreamUrl.pathname.toLowerCase();
      const isStreamPath = CONFIG.streamPaths.some(p => lowerPath.includes(p.toLowerCase()));
      const isImagePath = CONFIG.imagePaths.some(p => lowerPath.includes(p.toLowerCase()));

      // 构建请求头
      const headers = new Headers(request.headers);
      ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'cf-visitor'].forEach(h => headers.delete(h));
      headers.set('host', upstreamUrl.host);
      if (CONFIG.userAgent) headers.set('user-agent', CONFIG.userAgent);

      // 确保 Range 头透传
      const rangeHeader = request.headers.get('range');
      if (rangeHeader) headers.set('range', rangeHeader);

      // 选择超时时间
      const timeout = isStreamPath ? CONFIG.streamTimeout : CONFIG.requestTimeout;

      // 发起请求
      const response = await fetchWithRedirect(
        upstreamUrl.toString(),
        {
          method: request.method,
          headers,
          body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
        },
        CONFIG,
        timeout,
      );

      // 构建响应头
      const respHeaders = new Headers(response.headers);

      // 移除安全限制头
      ['content-security-policy', 'x-frame-options', 'strict-transport-security'].forEach(h => respHeaders.delete(h));

      // 缓存策略
      if (request.method === 'GET') {
        if (isStreamPath) {
          // 流媒体：禁用缓存，直接透传
          respHeaders.set('cache-control', 'no-store, no-cache, must-revalidate');
          respHeaders.set('x-stream-mode', 'direct');
        } else if (isImagePath) {
          // 图片：强缓存
          respHeaders.set('cache-control', `public, max-age=${CONFIG.imageCacheTTL}, immutable`);
          if (CONFIG.enableEdgeCache) {
            respHeaders.append('cache-control', `s-maxage=${CONFIG.imageCacheTTL}`);
          }
          respHeaders.set('x-cache-type', 'image');
        } else {
          // 常规缓存逻辑
          const cache = getCacheConfig(upstreamUrl.pathname, response, CONFIG);
          if (cache.cacheable) {
            respHeaders.set('cache-control', cache.cacheControl);
            if (CONFIG.enableEdgeCache && cache.ttl) {
              respHeaders.append('cache-control', `s-maxage=${cache.ttl}`);
            }
            respHeaders.set('x-cache-type', cache.type);
          }
        }
      }

      // 代理标识
      respHeaders.set('x-proxy-by', 'CF-Proxy/2.1');
      respHeaders.set('x-response-time', `${Date.now() - startTime}ms`);

      return corsResponse(new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      }));

    } catch (error) {
      return corsResponse(jsonResponse({ error: error.message || 'Proxy Error' }, 500));
    }
  },
};

// ========== WebSocket 处理 ==========
async function handleWebSocket(request, upstreamUrl) {
  // 构建 WebSocket URL
  const wsUrl = new URL(upstreamUrl);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  // 构建请求头
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    if (!['host', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'x-forwarded-for'].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  headers.set('host', wsUrl.host);

  // 建立到上游的 WebSocket 连接
  const upstreamResponse = await fetch(wsUrl.toString(), {
    headers,
    // Cloudflare Workers 会自动处理 WebSocket 升级
  });

  // 返回 WebSocket 响应
  return new Response(null, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: upstreamResponse.headers,
    webSocket: upstreamResponse.webSocket,
  });
}

// ========== 辅助函数 ==========

function parseUpstreamUrl(path, search, config) {
  let p = path.replace(/^(https?):\/(?!\/)/, '$1://');
  if (!p.startsWith('http://') && !p.startsWith('https://')) {
    p = config.defaultProtocol + '://' + p;
  }
  const u = new URL(p);
  if (search) u.search = search;
  return u;
}

async function fetchWithRedirect(url, options, config, timeout, count = 0) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(new Request(url, {
      ...options,
      redirect: 'manual',
      signal: controller.signal,
    }));
    clearTimeout(timeoutId);

    if ([301, 302, 303, 307, 308].includes(resp.status) && count < config.maxRedirects) {
      const location = resp.headers.get('location');
      if (location) {
        const nextUrl = new URL(location, url);
        return fetchWithRedirect(nextUrl.toString(), options, config, timeout, count + 1);
      }
    }
    return resp;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error('Request timeout');
    throw e;
  }
}

function checkAccess(value, allowList, blockList) {
  if (!value) return true;
  if (blockList.length > 0 && blockList.some(b => value === b || value.includes(b))) return false;
  if (allowList.length > 0 && !allowList.some(a => value === a || value.includes(a))) return false;
  return true;
}

function getCacheConfig(pathname, response, config) {
  const path = pathname.toLowerCase();

  if (config.noCachePaths.some(p => path.includes(p))) return { cacheable: false };
  if (![200, 301, 302, 304].includes(response.status)) return { cacheable: false };

  const cc = response.headers.get('cache-control') || '';
  if (cc.includes('no-store') || cc.includes('private')) return { cacheable: false };

  if (config.staticExtensions.some(ext => path.endsWith(ext))) {
    return { cacheable: true, ttl: config.staticCacheTTL, type: 'static', cacheControl: `public, max-age=${config.staticCacheTTL}, immutable` };
  }

  const ct = response.headers.get('content-type') || '';
  if (ct.match(/^(image|font|audio|video)\//)) {
    return { cacheable: true, ttl: config.staticCacheTTL, type: 'media', cacheControl: `public, max-age=${config.staticCacheTTL}` };
  }
  if (ct.includes('text/html')) {
    return { cacheable: true, ttl: config.dynamicCacheTTL, type: 'html', cacheControl: `public, max-age=${config.dynamicCacheTTL}, stale-while-revalidate=60` };
  }
  if (ct.includes('application/json')) {
    return { cacheable: true, ttl: config.dynamicCacheTTL, type: 'api', cacheControl: `public, max-age=${config.dynamicCacheTTL}` };
  }

  return { cacheable: true, ttl: config.defaultCacheTTL, type: 'default', cacheControl: `public, max-age=${config.defaultCacheTTL}` };
}

function corsResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', '*');
  headers.set('access-control-allow-headers', '*');
  headers.set('access-control-max-age', '86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function getUsageHTML(config) {
  const authPrefix = config.authUser ? `/${config.authUser}` : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CF Proxy v2.1</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#eee;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:rgba(255,255,255,.05);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.1);border-radius:16px;max-width:650px;width:100%;padding:35px}
    h1{font-size:1.8em;margin-bottom:8px;background:linear-gradient(90deg,#667eea,#764ba2);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .sub{color:#aaa;margin-bottom:28px}
    h2{color:#667eea;font-size:1em;margin:24px 0 12px;text-transform:uppercase;letter-spacing:1px}
    .code{background:rgba(0,0,0,.3);padding:14px;border-radius:8px;font-family:'Fira Code',monospace;font-size:13px;overflow-x:auto;border-left:3px solid #667eea}
    ul{margin-left:20px}
    li{margin:8px 0;color:#ccc}
    .tag{display:inline-block;background:#667eea;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;margin-left:6px}
    .footer{margin-top:28px;text-align:center;color:#666;font-size:11px}
  </style>
</head>
<body>
  <div class="card">
    <h1>🎬 CF Proxy v2.1</h1>
    <p class="sub">高性能流媒体反向代理 · Emby / Plex / Jellyfin</p>

    <h2>使用方法</h2>
    <div class="code">https://你的域名${authPrefix}/目标域名/路径</div>

    <h2>Emby 示例</h2>
    <div class="code">https://proxy.dev${authPrefix}/your-emby.com/emby/Items</div>

    <h2>核心特性</h2>
    <ul>
      <li>🔌 WebSocket 全双工 <span class="tag">${config.enableWebSocket ? 'ON' : 'OFF'}</span></li>
      <li>📺 流媒体智能直通（禁用缓存，5min 超时）</li>
      <li>🖼️ 海报墙强缓存（图片 ${config.imageCacheTTL/86400} 天 + Edge Cache）</li>
      <li>🔄 Range 分片透传（拖拽进度无延迟）</li>
      <li>⚡ 静态资源 ${config.staticCacheTTL/3600}h / 动态 ${config.dynamicCacheTTL/60}min</li>
    </ul>

    <div class="footer">Powered by Cloudflare Workers</div>
  </div>
</body>
</html>`;
}
