/**
 * Cloudflare Workers 动态反向代理
 * 支持通过 URL 路径指定目标地址
 * 格式：https://your-domain.com/target-domain.com/path
 * 示例：https://自定义域名/目的代理URL/api/users
 */

// ========== 配置区 ==========
const CONFIG = {
  // 用户认证（留空则禁用认证，启用后格式为: /用户名/目标URL）
  authUser: '', // 例如: 'admin'

  // 默认协议
  defaultProtocol: 'https',

  // 最大重定向跟随次数
  maxRedirects: 3,

  // 缓存时间（秒，仅 GET 请求）
  cacheTTL: 3600,

  // 请求超时时间（毫秒）
  requestTimeout: 30000,

  // 最大请求体大小（字节，0 表示不限制）
  maxBodySize: 10 * 1024 * 1024, // 10MB

  // 自定义 User-Agent
  userAgent: 'Cloudflare-Workers-Proxy/1.1',

  // 域名黑名单（禁止代理的域名）
  blockedDomains: [
    // 本地地址
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',

    // 内网地址段（通过域名匹配）
    '10.',
    '172.16.',
    '192.168.',
    'internal',
    'local',

    // 容器镜像仓库（通常需要认证，代理意义不大）
    'docker.io',
    'hub.docker.com',
    'registry.hub.docker.com',
    'docker.com',
    'registry-1.docker.io',
    'ghcr.io', // GitHub Container Registry
    'gcr.io', // Google Container Registry
    'quay.io', // Red Hat Quay
    'mcr.microsoft.com', // Microsoft Container Registry

    // 云服务商内部服务（可能导致安全问题）
    'metadata.google.internal',
    '169.254.169.254', // AWS/GCP metadata service
    'kubernetes.default.svc',
    'rancher.internal',

    // 金融支付相关（安全考虑）
    'paypal.com',
    'stripe.com',
    'alipay.com',
    'pay.weixin.qq.com',

    // 政府和敏感机构
    'gov.cn',
    'mil.cn',
    'gov',
    'mil',

    // 可能被滥用的服务
    'ipify.org',
    'ifconfig.me',
    'icanhazip.com',
    'api.ipify.org',
  ],

  // 域名白名单（留空表示允许所有，建议生产环境配置）
  allowedDomains: [],

  // 危险路径黑名单（防止路径遍历和敏感文件访问）
  blockedPaths: [
    '/.env',
    '/.git',
    '/admin',
    '/phpmyadmin',
    '/.aws',
    '/.ssh',
    '/etc/passwd',
    '/etc/shadow',
    '/../',
    '/./.',
  ],

  // 是否启用详细错误信息（生产环境建议关闭）
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
          version: '1.1',
        });
      }

      // 根路径状态检查
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
          return corsResponse(
            textResponse('Bad Request: Invalid path format', 400),
          );
        }
        if (parts[0] !== CONFIG.authUser) {
          return corsResponse(textResponse('Forbidden: Invalid user', 403));
        }
        startIndex = 1;
      }

      if (parts.length <= startIndex) {
        return corsResponse(
          textResponse('Bad Request: No target specified', 400),
        );
      }

      // 提取目标 URL
      const targetPath = parts.slice(startIndex).join('/');
      const upstreamUrl = parseUpstreamUrl(targetPath, url.search);

      // 协议验证
      if (!['http:', 'https:'].includes(upstreamUrl.protocol)) {
        return corsResponse(
          jsonResponse(
            {
              error: 'Invalid Protocol',
              message: 'Only HTTP and HTTPS protocols are supported',
              protocol: upstreamUrl.protocol,
            },
            400,
          ),
        );
      }

      // 域名验证
      const hostname = upstreamUrl.hostname.toLowerCase();

      // 检查黑名单
      if (
        CONFIG.blockedDomains.some(
          d =>
            hostname === d ||
            hostname.endsWith('.' + d) ||
            hostname.startsWith(d) ||
            hostname.includes(d),
        )
      ) {
        return corsResponse(
          jsonResponse(
            {
              error: 'Forbidden',
              message: 'Domain is blocked by security policy',
              domain: hostname,
              reason:
                'This domain is in the blocklist for security or compliance reasons',
            },
            403,
          ),
        );
      }

      // 检查白名单
      if (
        CONFIG.allowedDomains.length > 0 &&
        !CONFIG.allowedDomains.some(
          d => hostname === d || hostname.endsWith('.' + d),
        )
      ) {
        return corsResponse(
          jsonResponse(
            {
              error: 'Forbidden',
              message: 'Domain not in allowed list',
              domain: hostname,
              hint: 'Only whitelisted domains are permitted',
            },
            403,
          ),
        );
      }

      // 路径安全检查
      const path = upstreamUrl.pathname.toLowerCase();
      if (
        CONFIG.blockedPaths &&
        CONFIG.blockedPaths.some(p => path.includes(p))
      ) {
        return corsResponse(
          jsonResponse(
            {
              error: 'Forbidden',
              message: 'Requested path contains blocked patterns',
              path: upstreamUrl.pathname,
              reason: 'This path is blocked for security reasons',
            },
            403,
          ),
        );
      }

      // IP 地址直接访问检查（防止内网探测）
      if (
        /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
        /^\[?[0-9a-f:]+\]?$/i.test(hostname)
      ) {
        // 检查是否是私有 IP
        if (isPrivateIP(hostname)) {
          return corsResponse(
            jsonResponse(
              {
                error: 'Forbidden',
                message: 'Direct access to private IP addresses is not allowed',
                ip: hostname,
                reason: 'Security policy prevents access to internal networks',
              },
              403,
            ),
          );
        }
      }

      // 请求体大小检查
      if (CONFIG.maxBodySize > 0 && request.body) {
        const contentLength = request.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > CONFIG.maxBodySize) {
          return corsResponse(
            jsonResponse(
              {
                error: 'Payload Too Large',
                message: `Request body exceeds maximum size of ${CONFIG.maxBodySize} bytes`,
                maxSize: CONFIG.maxBodySize,
              },
              413,
            ),
          );
        }
      }

      // 构建代理请求
      const method = request.method.toUpperCase();
      const headers = new Headers(request.headers);

      // 清理和设置请求头
      stripClientHeaders(headers);
      headers.delete('referer');
      headers.set('host', upstreamUrl.host);
      headers.set('user-agent', CONFIG.userAgent);

      // 发起请求（支持超时控制和重定向跟随）
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

      // 添加缓存控制（增强版）
      if (method === 'GET' && CONFIG.cacheTTL > 0) {
        const newHeaders = new Headers(response.headers);
        newHeaders.set('cache-control', `public, max-age=${CONFIG.cacheTTL}`);

        // 添加 Vary 头以支持更好的缓存
        if (!newHeaders.has('vary')) {
          newHeaders.set('vary', 'Accept-Encoding');
        }

        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }

      // 计算性能指标
      const responseTime = Date.now() - startTime;

      // 添加调试和性能头
      const finalHeaders = new Headers(response.headers);
      finalHeaders.set('x-proxy-by', 'Cloudflare-Workers-Enhanced-v1.1');
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

      // 在开发模式下添加详细错误信息
      if (CONFIG.verboseErrors && error.stack) {
        errorResponse.stack = error.stack.split('\n').slice(0, 5);
      }

      return corsResponse(jsonResponse(errorResponse, 500));
    }
  },
};

/* ========== 核心函数 ========== */

/**
 * 解析上游 URL（支持多种格式）
 */
function parseUpstreamUrl(path, search) {
  // 处理 https:/ 和 http:/ 格式（单斜杠）
  let p = path.replace(/^(https?):\/(?!\/)/, '$1://');

  // 如果没有协议，添加默认协议
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
 * 支持超时控制的 fetch
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
 * 支持重定向跟随的 fetch
 */
async function fetchWithRedirect(url, options, redirectCount = 0) {
  const response = await fetch(
    new Request(url, {
      ...options,
      redirect: 'manual',
    }),
  );

  // 检查是否需要跟随重定向
  if (isRedirect(response.status) && redirectCount < CONFIG.maxRedirects) {
    const location = response.headers.get('location');
    if (location) {
      try {
        const nextUrl = new URL(location, url);
        return await fetchWithRedirect(
          nextUrl.toString(),
          options,
          redirectCount + 1,
        );
      } catch (e) {
        // 重定向 URL 无效，返回原响应
        return response;
      }
    }
  }

  return response;
}

/**
 * 清理客户端相关请求头（隐藏真实 IP）
 */
function stripClientHeaders(headers) {
  const clientHeaders = [
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip',
    'CF-Connecting-IP',
    'true-client-ip',
    'True-Client-IP',
    'x-client-ip',
    'x-forwarded',
    'forwarded-for',
    'forwarded',
    'cf-ray',
    'CF-Ray',
    'cf-visitor',
    'CF-Visitor',
  ];

  clientHeaders.forEach(h => headers.delete(h));
}

/**
 * 移除可能导致问题的安全响应头
 */
function stripSecurityHeaders(response) {
  const headers = new Headers(response.headers);

  const securityHeaders = [
    'content-security-policy',
    'content-security-policy-report-only',
    'x-frame-options',
    'x-xss-protection',
    'strict-transport-security',
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
 * 添加 CORS 头
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
 * 创建文本响应
 */
function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * 创建 JSON 响应
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

/**
 * 判断是否为重定向状态码
 */
function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

/**
 * 检查是否为私有 IP 地址
 */
function isPrivateIP(ip) {
  // IPv6 本地地址
  if (ip.includes(':')) {
    return (
      ip.startsWith('fe80:') ||
      ip.startsWith('fc00:') ||
      ip.startsWith('fd00:') ||
      ip === '::1'
    );
  }

  // IPv4 私有地址
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  // 10.0.0.0/8
  if (parts[0] === 10) return true;

  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;

  // 127.0.0.0/8 (loopback)
  if (parts[0] === 127) return true;

  // 169.254.0.0/16 (link-local)
  if (parts[0] === 169 && parts[1] === 254) return true;

  // 0.0.0.0/8
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
  <title>动态反向代理 - 增强版</title>
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
      max-width: 850px;
      width: 100%;
      padding: 40px;
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 2.2em;
    }
    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 1.1em;
    }
    .auth-notice {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px;
      border-radius: 4px;
      margin-bottom: 25px;
      font-size: 0.95em;
    }
    .auth-notice code {
      background: rgba(0,0,0,0.1);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
    }
    .section {
      margin-bottom: 30px;
    }
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
      overflow-x: auto;
      margin: 10px 0;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
    }
    .example {
      color: #2c5282;
      line-height: 1.8;
    }
    .arrow {
      color: #667eea;
      font-weight: bold;
      margin: 8px 0;
    }
    ul {
      margin-left: 20px;
      margin-top: 10px;
    }
    li {
      margin-bottom: 10px;
      line-height: 1.6;
    }
    .highlight {
      background: #fef3c7;
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: 500;
    }
    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    .feature-item {
      background: #f8f9fa;
      padding: 12px;
      border-radius: 6px;
      font-size: 0.9em;
    }
    .footer {
      text-align: center;
      color: #999;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 动态反向代理 - 增强版</h1>
    <p class="subtitle">简洁、高效、功能强大的 Cloudflare Workers 代理服务</p>

    ${authInfo}

    <div class="section">
      <h2>📖 使用格式</h2>
      <div class="code-block">
        ${
          CONFIG.authUser
            ? `https://<span class="highlight">您的域名</span>/<span class="highlight">${CONFIG.authUser}</span>/<span class="highlight">目标URL</span>`
            : `https://<span class="highlight">您的域名</span>/<span class="highlight">目标URL</span>`
        }
      </div>
    </div>

    <div class="section">
      <h2>💡 使用示例</h2>
      <div class="code-block">
        <div class="example">
          ${
            CONFIG.authUser
              ? `访问: https://your-domain.com/${CONFIG.authUser}/api.github.com/users`
              : `访问: https://your-domain.com/api.github.com/users`
          }
        </div>
        <div class="arrow">↓ 实际代理到</div>
        <div class="example">
          https://api.github.com/users
        </div>
      </div>

      <div class="code-block">
        <div class="example">
          支持查询参数和路径：<br>
          ${
            CONFIG.authUser
              ? `https://your-domain.com/${CONFIG.authUser}/example.com/api/data?key=value`
              : `https://your-domain.com/example.com/api/data?key=value`
          }
        </div>
      </div>
    </div>

    <div class="section">
      <h2>✨ 增强特性</h2>
      <div class="feature-grid">
        <div class="feature-item">
          <strong>🔄 智能重定向</strong><br>
          自动跟随 ${CONFIG.maxRedirects} 次重定向
        </div>
        <div class="feature-item">
          <strong>🔒 IP 隐藏</strong><br>
          完全隐藏客户端 IP 信息
        </div>
        <div class="feature-item">
          <strong>⚡ 智能缓存</strong><br>
          GET 请求缓存 ${CONFIG.cacheTTL}秒
        </div>
        <div class="feature-item">
          <strong>🛡️ 安全优化</strong><br>
          自动处理安全响应头
        </div>
        <div class="feature-item">
          <strong>🌍 完整 CORS</strong><br>
          支持所有跨域请求
        </div>
        <div class="feature-item">
          <strong>🎯 灵活 URL</strong><br>
          支持多种 URL 格式
        </div>
        <div class="feature-item">
          <strong>⏱️ 超时控制</strong><br>
          ${CONFIG.requestTimeout / 1000}秒请求超时
        </div>
        <div class="feature-item">
          <strong>📊 性能监控</strong><br>
          实时响应时间追踪
        </div>
      </div>
    </div>

    <div class="section">
      <h2>⚙️ 当前配置</h2>
      <ul>
        <li><strong>版本：</strong>v1.1 优化增强版</li>
        <li><strong>用户认证：</strong>${
          CONFIG.authUser ? `已启用 (${CONFIG.authUser})` : '未启用'
        }</li>
        <li><strong>默认协议：</strong>${CONFIG.defaultProtocol.toUpperCase()}</li>
        <li><strong>最大重定向：</strong>${CONFIG.maxRedirects} 次</li>
        <li><strong>缓存时间：</strong>${CONFIG.cacheTTL} 秒</li>
        <li><strong>请求超时：</strong>${CONFIG.requestTimeout / 1000} 秒</li>
        <li><strong>最大请求体：</strong>${
          CONFIG.maxBodySize > 0
            ? (CONFIG.maxBodySize / 1024 / 1024).toFixed(1) + ' MB'
            : '不限制'
        }</li>
        <li><strong>黑名单域名：</strong>${CONFIG.blockedDomains.length} 个</li>
        <li><strong>白名单域名：</strong>${
          CONFIG.allowedDomains.length > 0
            ? CONFIG.allowedDomains.length + ' 个'
            : '全部允许'
        }</li>
        <li><strong>性能监控：</strong>${
          CONFIG.enableMetrics ? '已启用' : '未启用'
        }</li>
      </ul>
    </div>

    <div class="section">
      <h2>🔧 API 端点</h2>
      <ul>
        <li><code>/health</code> 或 <code>/ping</code> - 健康检查</li>
        <li><code>/</code> - 使用说明页面</li>
        ${
          CONFIG.authUser
            ? `<li><code>/${CONFIG.authUser}/:target</code> - 代理请求（需认证）</li>`
            : '<li><code>/:target</code> - 代理请求</li>'
        }
      </ul>
    </div>

    <div class="footer">
      Powered by Cloudflare Workers | Enhanced Dynamic Proxy v1.1<br>
      <small>⚡ 高性能 · 🔒 安全可靠 · 🌍 全球加速</small>
    </div>
  </div>
</body>
</html>`;
}
