/**
 * Cloudflare Workers 动态反向代理 v1.2
 * 支持通过 URL 路径指定目标地址
 * 格式：https://your-domain.com/target-domain.com/path
 *
 * v1.2 优化：
 * - 增强缓存策略（智能缓存、Edge Cache、条件缓存）
 * - 移除不必要的限速功能（Cloudflare 免费服务无需限速）
 * - 优化请求体处理（移除大小限制）
 * - 增强缓存命中率
 */

// ========== 配置区 ==========
const CONFIG = {
  // 用户认证（留空则禁用认证，启用后格式为: /用户名/目标URL）
  authUser: '',

  // 默认协议
  defaultProtocol: 'https',

  // 最大重定向跟随次数
  maxRedirects: 5,

  // 请求超时时间（毫秒）
  requestTimeout: 30000,

  // 自定义 User-Agent
  userAgent: 'Cloudflare-Workers-Proxy/1.2',

  // ========== 缓存配置 ==========
  // 默认缓存时间（秒，仅 GET 请求）
  defaultCacheTTL: 3600,

  // 静态资源缓存时间（秒）
  staticCacheTTL: 86400, // 24小时

  // 动态内容缓存时间（秒）
  dynamicCacheTTL: 300, // 5分钟

  // 是否启用 Edge Cache（使用 Cloudflare 边缘缓存）
  enableEdgeCache: true,

  // 缓存键包含查询参数
  cacheIncludeQuery: true,

  // 静态资源扩展名（长期缓存）
  staticExtensions: [
    '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.avif',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.mp3', '.mp4', '.webm', '.ogg', '.wav',
    '.pdf', '.zip', '.rar', '.7z', '.tar', '.gz',
  ],

  // 不缓存的路径模式
  noCachePaths: [
    '/api/auth', '/api/login', '/api/logout',
    '/api/session', '/api/user',
    '/webhook', '/callback',
  ],

  // 域名黑名单（禁止代理的域名）
  blockedDomains: [
    // 本地地址
    'localhost', '127.0.0.1', '0.0.0.0', '::1',
    // 内网地址段
    '10.', '172.16.', '192.168.', 'internal', 'local',
    // 容器镜像仓库
    'docker.io', 'hub.docker.com', 'registry.hub.docker.com', 'docker.com',
    'registry-1.docker.io', 'ghcr.io', 'gcr.io', 'quay.io', 'mcr.microsoft.com',
    // 云服务商内部服务
    'metadata.google.internal', '169.254.169.254', 'kubernetes.default.svc', 'rancher.internal',
    // 金融支付相关
    'paypal.com', 'stripe.com', 'alipay.com', 'pay.weixin.qq.com',
    // 政府和敏感机构
    'gov.cn', 'mil.cn', 'gov', 'mil',
    // 可能被滥用的服务
    'ipify.org', 'ifconfig.me', 'icanhazip.com', 'api.ipify.org',
  ],

  // 域名白名单（留空表示允许所有）
  allowedDomains: [],

  // 危险路径黑名单
  blockedPaths: [
    '/.env', '/.git', '/admin', '/phpmyadmin',
    '/.aws', '/.ssh', '/etc/passwd', '/etc/shadow',
    '/../', '/./.',
  ],

  // 是否启用详细错误信息
  verboseErrors: false,

  // 是否启用性能监控
  enableMetrics: true,
};
// ============================

export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();

    try {
      const url = new URL(request.url);

      // 健康检查端点
      if (url.pathname === '/health' || url.pathname === '/ping') {
        return jsonResponse({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: '1.2',
          cache: {
            edge: CONFIG.enableEdgeCache,
            defaultTTL: CONFIG.defaultCacheTTL,
            staticTTL: CONFIG.staticCacheTTL,
          },
        });
      }

      // 根路径
      if (url.pathname === '/' || url.pathname === '') {
        return corsResponse(
          new Response(getUsageHTML(), {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
        );
      }

      // OPTIONS 预检请求
      if (request.method === 'OPTIONS') {
        return corsResponse(new Response(null, { status: 204 }));
      }

      // 解析路径
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length === 0) {
        return corsResponse(textResponse('Bad Request: Empty path', 400));
      }

      let startIndex = 0;

      // 用户认证检查
      if (CONFIG.authUser) {
        if (parts.length < 2) {
          return corsResponse(textResponse('Bad Request: Invalid path format', 400));
        }
        if (parts[0] !== CONFIG.authUser) {
          return corsResponse(textResponse('Forbidden: Invalid user', 403));
        }
        startIndex = 1;
      }

      if (parts.length <= startIndex) {
        return corsResponse(textResponse('Bad Request: No target specified', 400));
      }

      // 提取目标 URL
      const targetPath = parts.slice(startIndex).join('/');
      const upstreamUrl = parseUpstreamUrl(targetPath, url.search);

      // 协议验证
      if (!['http:', 'https:'].includes(upstreamUrl.protocol)) {
        return corsResponse(jsonResponse({
          error: 'Invalid Protocol',
          message: 'Only HTTP and HTTPS protocols are supported',
        }, 400));
      }

      // 域名验证
      const hostname = upstreamUrl.hostname.toLowerCase();

      if (CONFIG.blockedDomains.some(d =>
        hostname === d || hostname.endsWith('.' + d) ||
        hostname.startsWith(d) || hostname.includes(d)
      )) {
        return corsResponse(jsonResponse({
          error: 'Forbidden',
          message: 'Domain is blocked by security policy',
        }, 403));
      }

      if (CONFIG.allowedDomains.length > 0 &&
          !CONFIG.allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d))) {
        return corsResponse(jsonResponse({
          error: 'Forbidden',
          message: 'Domain not in allowed list',
        }, 403));
      }

      // 路径安全检查
      const path = upstreamUrl.pathname.toLowerCase();
      if (CONFIG.blockedPaths.some(p => path.includes(p))) {
        return corsResponse(jsonResponse({
          error: 'Forbidden',
          message: 'Requested path is blocked',
        }, 403));
      }

      // 私有 IP 检查
      if (isPrivateIP(hostname)) {
        return corsResponse(jsonResponse({
          error: 'Forbidden',
          message: 'Access to private IP is not allowed',
        }, 403));
      }

      // 构建代理请求
      const method = request.method.toUpperCase();
      const headers = new Headers(request.headers);

      // 清理和设置请求头
      stripClientHeaders(headers);
      headers.delete('referer');
      headers.set('host', upstreamUrl.host);
      headers.set('user-agent', CONFIG.userAgent);

      // 添加缓存相关请求头
      if (method === 'GET') {
        // 支持条件请求以提高缓存效率
        const ifNoneMatch = request.headers.get('if-none-match');
        const ifModifiedSince = request.headers.get('if-modified-since');
        if (ifNoneMatch) headers.set('if-none-match', ifNoneMatch);
        if (ifModifiedSince) headers.set('if-modified-since', ifModifiedSince);
      }

      // 发起请求
      let response = await fetchWithTimeout(
        upstreamUrl.toString(),
        {
          method,
          headers,
          body: method === 'GET' || method === 'HEAD' ? null : request.body,
        },
        CONFIG.requestTimeout,
      );

      // 处理响应
      response = stripSecurityHeaders(response);

      // 智能缓存处理
      const cacheConfig = getCacheConfig(upstreamUrl.pathname, response);
      const finalHeaders = new Headers(response.headers);

      if (method === 'GET' && cacheConfig.cacheable) {
        // 设置缓存控制头
        finalHeaders.set('cache-control', cacheConfig.cacheControl);

        // 添加 Vary 头优化缓存
        if (!finalHeaders.has('vary')) {
          finalHeaders.set('vary', 'Accept-Encoding, Accept');
        }

        // 添加缓存标识
        finalHeaders.set('x-cache-ttl', `${cacheConfig.ttl}s`);
        finalHeaders.set('x-cache-type', cacheConfig.type);

        // Edge Cache 支持
        if (CONFIG.enableEdgeCache) {
          finalHeaders.set('cf-cache-status', 'DYNAMIC');
          // s-maxage 用于 CDN 边缘缓存
          if (!finalHeaders.get('cache-control')?.includes('s-maxage')) {
            const currentCC = finalHeaders.get('cache-control') || '';
            finalHeaders.set('cache-control', `${currentCC}, s-maxage=${cacheConfig.ttl}`);
          }
        }
      } else if (method !== 'GET' && method !== 'HEAD') {
        // 非 GET/HEAD 请求不缓存
        finalHeaders.set('cache-control', 'no-store, no-cache, must-revalidate');
      }

      // 计算性能指标
      const responseTime = Date.now() - startTime;

      // 添加调试头
      finalHeaders.set('x-proxy-by', 'CF-Workers-Proxy-v1.2');
      finalHeaders.set('x-target-url', upstreamUrl.toString());

      if (CONFIG.enableMetrics) {
        finalHeaders.set('x-response-time', `${responseTime}ms`);
        finalHeaders.set('x-proxy-timestamp', new Date().toISOString());
      }

      return corsResponse(
        new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: finalHeaders,
        }),
      );

    } catch (error) {
      console.error('Proxy Error:', error);

      const errorResponse = {
        error: error.name || 'ProxyError',
        message: error.message,
        timestamp: new Date().toISOString(),
      };

      if (CONFIG.verboseErrors && error.stack) {
        errorResponse.stack = error.stack.split('\n').slice(0, 5);
      }

      return corsResponse(jsonResponse(errorResponse, 500));
    }
  },
};

/* ========== 缓存相关函数 ========== */

/**
 * 获取缓存配置
 */
function getCacheConfig(pathname, response) {
  const lowerPath = pathname.toLowerCase();

  // 检查是否为不缓存路径
  if (CONFIG.noCachePaths.some(p => lowerPath.includes(p))) {
    return {
      cacheable: false,
      ttl: 0,
      type: 'no-cache',
      cacheControl: 'no-store, no-cache, must-revalidate',
    };
  }

  // 检查响应状态码
  const status = response.status;
  if (status !== 200 && status !== 301 && status !== 302 && status !== 304) {
    return {
      cacheable: false,
      ttl: 0,
      type: 'error',
      cacheControl: 'no-store',
    };
  }

  // 检查响应头中的缓存控制
  const originCC = response.headers.get('cache-control') || '';
  if (originCC.includes('no-store') || originCC.includes('private')) {
    return {
      cacheable: false,
      ttl: 0,
      type: 'origin-no-cache',
      cacheControl: originCC,
    };
  }

  // 检查是否为静态资源
  const isStatic = CONFIG.staticExtensions.some(ext => lowerPath.endsWith(ext));

  if (isStatic) {
    return {
      cacheable: true,
      ttl: CONFIG.staticCacheTTL,
      type: 'static',
      cacheControl: `public, max-age=${CONFIG.staticCacheTTL}, immutable`,
    };
  }

  // 检查 Content-Type
  const contentType = response.headers.get('content-type') || '';

  // 图片、字体、媒体类型 -> 长期缓存
  if (contentType.match(/^(image|font|audio|video)\//)) {
    return {
      cacheable: true,
      ttl: CONFIG.staticCacheTTL,
      type: 'media',
      cacheControl: `public, max-age=${CONFIG.staticCacheTTL}`,
    };
  }

  // HTML 页面 -> 短期缓存
  if (contentType.includes('text/html')) {
    return {
      cacheable: true,
      ttl: CONFIG.dynamicCacheTTL,
      type: 'html',
      cacheControl: `public, max-age=${CONFIG.dynamicCacheTTL}, stale-while-revalidate=60`,
    };
  }

  // JSON/API 响应 -> 短期缓存
  if (contentType.includes('application/json')) {
    return {
      cacheable: true,
      ttl: CONFIG.dynamicCacheTTL,
      type: 'api',
      cacheControl: `public, max-age=${CONFIG.dynamicCacheTTL}, stale-while-revalidate=30`,
    };
  }

  // 默认缓存策略
  return {
    cacheable: true,
    ttl: CONFIG.defaultCacheTTL,
    type: 'default',
    cacheControl: `public, max-age=${CONFIG.defaultCacheTTL}`,
  };
}

/* ========== 核心函数 ========== */

/**
 * 解析上游 URL
 */
function parseUpstreamUrl(path, search) {
  let p = path.replace(/^(https?):\/(?!\/)/, '$1://');

  if (!p.startsWith('http://') && !p.startsWith('https://')) {
    p = CONFIG.defaultProtocol + '://' + p;
  }

  try {
    const u = new URL(p);
    if (search) u.search = search;
    return u;
  } catch (e) {
    throw new Error(`Invalid URL: ${p}`);
  }
}

/**
 * 超时控制的 fetch
 */
async function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetchWithRedirect(
      url,
      { ...options, signal: controller.signal },
      0,
    );
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * 重定向跟随的 fetch
 */
async function fetchWithRedirect(url, options, redirectCount = 0) {
  const response = await fetch(new Request(url, {
    ...options,
    redirect: 'manual',
  }));

  if (isRedirect(response.status) && redirectCount < CONFIG.maxRedirects) {
    const location = response.headers.get('location');
    if (location) {
      try {
        const nextUrl = new URL(location, url);
        return await fetchWithRedirect(nextUrl.toString(), options, redirectCount + 1);
      } catch (e) {
        return response;
      }
    }
  }

  return response;
}

/**
 * 清理客户端请求头
 */
function stripClientHeaders(headers) {
  const clientHeaders = [
    'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'CF-Connecting-IP',
    'true-client-ip', 'True-Client-IP', 'x-client-ip', 'x-forwarded',
    'forwarded-for', 'forwarded', 'cf-ray', 'CF-Ray', 'cf-visitor', 'CF-Visitor',
  ];
  clientHeaders.forEach(h => headers.delete(h));
}

/**
 * 移除安全响应头
 */
function stripSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  const securityHeaders = [
    'content-security-policy', 'content-security-policy-report-only',
    'x-frame-options', 'x-xss-protection', 'strict-transport-security',
    'x-content-security-policy',
  ];
  securityHeaders.forEach(h => headers.delete(h));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * CORS 响应
 */
function corsResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', '*');
  headers.set('access-control-allow-headers', '*');
  headers.set('access-control-expose-headers', '*');
  headers.set('access-control-max-age', '86400');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 文本响应
 */
function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * JSON 响应
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * 重定向状态码判断
 */
function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

/**
 * 私有 IP 检测
 */
function isPrivateIP(ip) {
  if (ip.includes(':')) {
    return ip.startsWith('fe80:') || ip.startsWith('fc00:') ||
           ip.startsWith('fd00:') || ip === '::1';
  }

  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 0) return true;

  return false;
}

/* ========== 使用说明页面 ========== */

function getUsageHTML() {
  const authInfo = CONFIG.authUser
    ? `<div class="auth-notice">🔐 已启用用户认证，格式：<code>/${CONFIG.authUser}/目标URL</code></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>动态反向代理 v1.2</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 900px;
      width: 100%;
      padding: 40px;
    }
    h1 { color: #333; margin-bottom: 10px; font-size: 2.2em; }
    .subtitle { color: #666; margin-bottom: 30px; font-size: 1.1em; }
    .auth-notice {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px;
      border-radius: 4px;
      margin-bottom: 25px;
    }
    .section { margin-bottom: 30px; }
    h2 {
      color: #667eea;
      margin-bottom: 15px;
      font-size: 1.4em;
      border-bottom: 2px solid #667eea;
      padding-bottom: 8px;
    }
    .code-block {
      background: #f5f5f5;
      border-left: 4px solid #667eea;
      padding: 15px;
      border-radius: 4px;
      font-family: monospace;
      margin: 10px 0;
    }
    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
    }
    .feature-item {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
    }
    .feature-item strong { color: #333; display: block; margin-bottom: 5px; }
    .feature-item small { color: #666; }
    ul { margin-left: 20px; margin-top: 10px; }
    li { margin-bottom: 8px; line-height: 1.6; }
    .footer {
      text-align: center;
      color: #999;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
    .cache-info {
      background: #e8f5e9;
      border-left: 4px solid #4caf50;
      padding: 15px;
      border-radius: 4px;
      margin: 15px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 动态反向代理 v1.2</h1>
    <p class="subtitle">高性能、智能缓存的 Cloudflare Workers 代理服务</p>

    ${authInfo}

    <div class="section">
      <h2>📖 使用格式</h2>
      <div class="code-block">
        ${CONFIG.authUser
          ? `https://您的域名/${CONFIG.authUser}/目标URL`
          : `https://您的域名/目标URL`}
      </div>
    </div>

    <div class="section">
      <h2>✨ 核心特性</h2>
      <div class="feature-grid">
        <div class="feature-item">
          <strong>🔄 智能重定向</strong>
          <small>自动跟随 ${CONFIG.maxRedirects} 次重定向</small>
        </div>
        <div class="feature-item">
          <strong>🔒 隐私保护</strong>
          <small>完全隐藏客户端 IP</small>
        </div>
        <div class="feature-item">
          <strong>⚡ 智能缓存</strong>
          <small>静态资源 ${CONFIG.staticCacheTTL / 3600}h / 动态 ${CONFIG.dynamicCacheTTL / 60}min</small>
        </div>
        <div class="feature-item">
          <strong>🌐 Edge Cache</strong>
          <small>Cloudflare 边缘节点缓存</small>
        </div>
        <div class="feature-item">
          <strong>🛡️ 安全优化</strong>
          <small>域名黑名单 + 路径检查</small>
        </div>
        <div class="feature-item">
          <strong>🌍 完整 CORS</strong>
          <small>支持所有跨域请求</small>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>📊 缓存策略</h2>
      <div class="cache-info">
        <strong>智能缓存分类：</strong><br>
        • <strong>静态资源</strong>（JS/CSS/图片/字体）：${CONFIG.staticCacheTTL / 3600} 小时<br>
        • <strong>HTML 页面</strong>：${CONFIG.dynamicCacheTTL / 60} 分钟（支持 stale-while-revalidate）<br>
        • <strong>API 响应</strong>：${CONFIG.dynamicCacheTTL / 60} 分钟<br>
        • <strong>其他内容</strong>：${CONFIG.defaultCacheTTL / 60} 分钟<br>
        • <strong>Edge Cache</strong>：${CONFIG.enableEdgeCache ? '已启用' : '未启用'}
      </div>
    </div>

    <div class="section">
      <h2>⚙️ 当前配置</h2>
      <ul>
        <li><strong>版本：</strong>v1.2 缓存优化版</li>
        <li><strong>认证：</strong>${CONFIG.authUser || '未启用'}</li>
        <li><strong>默认协议：</strong>${CONFIG.defaultProtocol.toUpperCase()}</li>
        <li><strong>请求超时：</strong>${CONFIG.requestTimeout / 1000} 秒</li>
        <li><strong>黑名单域名：</strong>${CONFIG.blockedDomains.length} 个</li>
      </ul>
    </div>

    <div class="section">
      <h2>🔧 API 端点</h2>
      <ul>
        <li><code>/health</code> - 健康检查（返回缓存配置信息）</li>
        <li><code>/</code> - 使用说明</li>
        <li><code>/:target</code> - 代理请求</li>
      </ul>
    </div>

    <div class="footer">
      Powered by Cloudflare Workers | v1.2 Cache-Optimized<br>
      <small>⚡ 高性能 · 📦 智能缓存 · 🌍 全球加速</small>
    </div>
  </div>
</body>
</html>`;
}
