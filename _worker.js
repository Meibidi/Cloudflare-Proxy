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
  maxBodySize: 0, // 10 * 1024 * 1024 10MB

  // 自定义 User-Agent
  userAgent: 'Cloudflare-Workers-Proxy/2.1',

  // 域名黑名单
  blockedDomains: ['localhost', '127.0.0.1', '0.0.0.0', '::1'],

  // 域名白名单（留空表示允许所有）
  allowedDomains: [],

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
          version: '2.1',
        });
      }

      // 根路径状态检查
      if (url.pathname === '/' || url.pathname === '') {
        return corsResponse(
          new Response(getUsageHTML(), {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
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
          protocol: upstreamUrl.protocol,
        }, 400));
      }

      // 域名验证
      const hostname = upstreamUrl.hostname.toLowerCase();

      if (CONFIG.blockedDomains.some(d => hostname === d || hostname.endsWith('.' + d))) {
        return corsResponse(jsonResponse({
          error: 'Forbidden',
          message: 'Domain is blocked',
          domain: hostname,
        }, 403));
      }

      if (CONFIG.allowedDomains.length > 0 &&
          !CONFIG.allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d))) {
        return corsResponse(jsonResponse({
          error: 'Forbidden',
          message: 'Domain not in allowed list',
          domain: hostname,
        }, 403));
      }

      // 请求体大小检查
      if (CONFIG.maxBodySize > 0 && request.body) {
        const contentLength = request.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > CONFIG.maxBodySize) {
          return corsResponse(jsonResponse({
            error: 'Payload Too Large',
            message: `Request body exceeds maximum size of ${CONFIG.maxBodySize} bytes`,
            maxSize: CONFIG.maxBodySize,
          }, 413));
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
        CONFIG.requestTimeout
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
      finalHeaders.set('x-proxy-by', 'Cloudflare-Workers-Enhanced-v2.1');
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
        })
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
      0
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
  const response = await fetch(new Request(url, {
    ...options,
    redirect: 'manual',
  }));

  // 检查是否需要跟随重定向
  if (isRedirect(response.status) && redirectCount < CONFIG.maxRedirects) {
    const location = response.headers.get('location');
    if (location) {
      try {
        const nextUrl = new URL(location, url);
        return await fetchWithRedirect(
          nextUrl.toString(),
          options,
          redirectCount + 1
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
        ${CONFIG.authUser
          ? `https://<span class="highlight">您的域名</span>/<span class="highlight">${CONFIG.authUser}</span>/<span class="highlight">目标URL</span>`
          : `https://<span class="highlight">您的域名</span>/<span class="highlight">目标URL</span>`
        }
      </div>
    </div>

    <div class="section">
      <h2>💡 使用示例</h2>
      <div class="code-block">
        <div class="example">
          ${CONFIG.authUser
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
          ${CONFIG.authUser
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
        <li><strong>版本：</strong>v2.1 优化增强版</li>
        <li><strong>用户认证：</strong>${CONFIG.authUser ? `已启用 (${CONFIG.authUser})` : '未启用'}</li>
        <li><strong>默认协议：</strong>${CONFIG.defaultProtocol.toUpperCase()}</li>
        <li><strong>最大重定向：</strong>${CONFIG.maxRedirects} 次</li>
        <li><strong>缓存时间：</strong>${CONFIG.cacheTTL} 秒</li>
        <li><strong>请求超时：</strong>${CONFIG.requestTimeout / 1000} 秒</li>
        <li><strong>最大请求体：</strong>${CONFIG.maxBodySize > 0 ? (CONFIG.maxBodySize / 1024 / 1024).toFixed(1) + ' MB' : '不限制'}</li>
        <li><strong>黑名单域名：</strong>${CONFIG.blockedDomains.length} 个</li>
        <li><strong>白名单域名：</strong>${CONFIG.allowedDomains.length > 0 ? CONFIG.allowedDomains.length + ' 个' : '全部允许'}</li>
        <li><strong>性能监控：</strong>${CONFIG.enableMetrics ? '已启用' : '未启用'}</li>
      </ul>
    </div>

    <div class="section">
      <h2>🔧 API 端点</h2>
      <ul>
        <li><code>/health</code> 或 <code>/ping</code> - 健康检查</li>
        <li><code>/</code> - 使用说明页面</li>
        ${CONFIG.authUser ? `<li><code>/${CONFIG.authUser}/:target</code> - 代理请求（需认证）</li>` : '<li><code>/:target</code> - 代理请求</li>'}
      </ul>
    </div>

    <div class="footer">
      Powered by Cloudflare Workers | Enhanced Dynamic Proxy v2.1<br>
      <small>⚡ 高性能 · 🔒 安全可靠 · 🌍 全球加速</small>
    </div>
  </div>
</body>
</html>`;
}
