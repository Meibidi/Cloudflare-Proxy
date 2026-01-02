# 🚀 Cloudflare Workers 动态反向代理

一个简洁、高效、功能强大的 Cloudflare Workers 反向代理服务，支持通过 URL 路径动态指定目标地址。

## ✨ 核心特性

### 基础功能
- 🎯 **动态目标域名** - 通过 URL 路径指定任意目标域名
- 🔄 **智能重定向** - 自动跟随最多 3 次重定向
- 🔒 **完整 IP 隐藏** - 清理 14+ 个客户端相关请求头
- 🛡️ **安全优化** - 自动处理可能冲突的安全响应头
- 🌍 **完整 CORS** - 统一的跨域资源共享支持
- ⚡ **智能缓存** - GET 请求自动缓存，提升访问速度
- 👤 **可选认证** - 支持简单的用户认证机制
- 🎨 **友好界面** - 精美的动态使用说明页面
- 🎯 **灵活 URL** - 支持多种 URL 格式（带/不带协议）

### v2.1 新增功能 🆕
- ⏱️ **请求超时控制** - 可配置请求超时时间（默认 30 秒）
- 📦 **请求体大小限制** - 防止过大请求（默认 10MB）
- 🏥 **健康检查端点** - `/health` 和 `/ping` 端点用于监控
- 📊 **性能监控** - 实时追踪响应时间和时间戳
- 🎭 **自定义 User-Agent** - 可配置代理标识
- 📋 **JSON 错误响应** - 结构化错误信息，便于调试
- 🔐 **协议验证增强** - 严格验证仅支持 HTTP/HTTPS
- 🚀 **增强缓存策略** - 添加 Vary 头优化缓存行为
- 📝 **详细错误日志** - 可配置的详细错误堆栈信息

## 📖 使用方法

### 基本格式

```
# 无认证模式
https://您的域名/目标域名/路径

# 认证模式（启用 authUser 后）
https://您的域名/用户名/目标域名/路径
```

### 使用示例

#### 示例 1: 代理 API 请求

```bash
# 访问
https://your-worker.workers.dev/api.github.com/users/octocat

# 实际代理到
https://api.github.com/users/octocat
```

#### 示例 2: 代理媒体服务

```bash
# 访问
https://your-worker.workers.dev/m.mobaiemby.site/api/users

# 实际代理到
https://m.mobaiemby.site/api/users
```

#### 示例 3: 带查询参数

```bash
# 访问
https://your-worker.workers.dev/example.com/search?q=test&page=1

# 实际代理到
https://example.com/search?q=test&page=1
```

#### 示例 4: 启用认证（authUser: 'admin'）

```bash
# 访问
https://your-worker.workers.dev/admin/api.example.com/data

# 实际代理到
https://api.example.com/data
```

## 🚀 快速开始

### 1. 部署到 Cloudflare Workers

#### 方法一：通过 Dashboard

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages**
3. 点击 **Create Application** → **Create Worker**
4. 将 `cloudflareproxy.js` 的代码复制粘贴到编辑器
5. 点击 **Save and Deploy**

#### 方法二：使用 Wrangler CLI

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建项目
wrangler init my-proxy

# 复制代码到 src/index.js
cp cloudflareproxy.js src/index.js

# 部署
wrangler deploy
```

### 2. 配置自定义域名（可选）

1. 在 Workers 设置中点击 **Triggers**
2. 点击 **Add Custom Domain**
3. 输入您的域名（如 `proxy.yourdomain.com`）
4. 等待 DNS 配置生效

## ⚙️ 配置选项

编辑 `_worker.js` 顶部的 `CONFIG` 对象：

```javascript
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
  userAgent: 'Cloudflare-Workers-Proxy/2.1',

  // 域名黑名单
  blockedDomains: ['localhost', '127.0.0.1', '0.0.0.0', '::1'],

  // 域名白名单（留空表示允许所有）
  allowedDomains: [],

  // 是否启用详细错误信息（生产环境建议关闭）
  verboseErrors: true,

  // 是否启用性能监控
  enableMetrics: true,
};
```

### 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `authUser` | string | `''` | 用户认证，留空禁用 |
| `defaultProtocol` | string | `'https'` | 目标地址的默认协议 |
| `maxRedirects` | number | `3` | 最大重定向跟随次数 |
| `cacheTTL` | number | `3600` | GET 请求的缓存时间（秒） |
| `requestTimeout` | number | `30000` | 请求超时时间（毫秒） 🆕 |
| `maxBodySize` | number | `10485760` | 最大请求体大小（字节） 🆕 |
| `userAgent` | string | `'...'` | 自定义 User-Agent 🆕 |
| `blockedDomains` | array | `['localhost', ...]` | 域名黑名单 |
| `allowedDomains` | array | `[]` | 域名白名单，留空允许所有 |
| `verboseErrors` | boolean | `true` | 启用详细错误信息 🆕 |
| `enableMetrics` | boolean | `true` | 启用性能监控 🆕 |

## 🔧 高级配置

### 健康检查端点 🆕

访问健康检查端点获取服务状态：

```bash
# 健康检查
curl https://your-domain.com/health

# 响应示例
{
  "status": "healthy",
  "timestamp": "2026-01-02T03:20:00.000Z",
  "version": "2.1"
}
```

用途：
- 监控服务可用性
- 负载均衡器健康检查
- 自动化运维脚本

### 性能监控 🆕

启用 `enableMetrics` 后，每个响应都会包含性能指标：

```http
x-response-time: 245ms
x-proxy-timestamp: 2026-01-02T03:20:00.000Z
x-proxy-by: Cloudflare-Workers-Enhanced-v2.1
x-target-url: https://api.example.com/data
```

### 超时控制 🆕

配置请求超时防止长时间挂起：

```javascript
const CONFIG = {
  requestTimeout: 10000, // 10 秒超时
  // ...其他配置
};
```

适用场景：
- 快速失败策略
- 防止资源浪费
- 提升用户体验

### 请求体大小限制 🆕

防止过大请求占用资源：

```javascript
const CONFIG = {
  maxBodySize: 5 * 1024 * 1024, // 限制 5MB
  // 或者
  maxBodySize: 0, // 不限制
  // ...其他配置
};
```

### 启用用户认证

保护代理服务，只允许知道用户名的人使用：

```javascript
const CONFIG = {
  authUser: 'mySecretUser', // 启用认证
  // ...其他配置
};
```

使用方式变更为：
```
https://your-domain.com/mySecretUser/target-url.com/path
```

### 设置域名白名单

限制只能代理特定域名：

```javascript
const CONFIG = {
  allowedDomains: [
    'api.github.com',
    'api.example.com',
    'cdn.jsdelivr.net'
  ],
  // ...其他配置
};
```

### 添加域名黑名单

禁止代理特定域名：

```javascript
const CONFIG = {
  blockedDomains: [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    'internal.company.com', // 添加内部域名
    'admin.example.com'      // 添加管理后台
  ],
  // ...其他配置
};
```

### 调整重定向次数

```javascript
const CONFIG = {
  maxRedirects: 5, // 最多跟随 5 次重定向
  // ...其他配置
};
```

### 调整缓存时间

```javascript
const CONFIG = {
  cacheTTL: 7200, // 2小时
  // 或者
  cacheTTL: 0,    // 禁用缓存
  // ...其他配置
};
```

## 🎯 增强特性详解

### 1. 智能重定向跟随

与原版使用 `redirect: 'follow'` 不同，增强版手动实现重定向跟随：

```javascript
// 自动处理 301, 302, 303, 307, 308 重定向
// 最多跟随 maxRedirects 次
// 支持相对和绝对重定向 URL
```

**优势：**
- 更好的控制重定向行为
- 避免某些边缘情况的问题
- 支持跨域重定向

### 2. 完整 IP 隐藏

清理 14+ 个可能暴露客户端 IP 的请求头：

```javascript
const clientHeaders = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'x-client-ip',
  'x-forwarded',
  'forwarded-for',
  'forwarded',
  'cf-ray',
  'cf-visitor',
  // ... 等
];
```

**优势：**
- 完全隐藏真实客户端 IP
- 保护用户隐私
- 避免目标服务器获取原始访客信息

### 3. 安全响应头优化

自动移除可能导致问题的安全响应头：

```javascript
const securityHeaders = [
  'content-security-policy',
  'x-frame-options',
  'x-xss-protection',
  'strict-transport-security',
  // ...
];
```

**优势：**
- 避免 CSP 策略冲突
- 允许在 iframe 中使用
- 提升代理内容的兼容性

### 4. 灵活的 URL 解析

支持多种 URL 格式：

```javascript
// 完整 URL
https://example.com/path

// 单斜杠格式（自动修复）
https:/example.com/path

// 无协议（自动添加）
example.com/path
```

### 5. 统一 CORS 处理

所有响应都经过 `corsResponse()` 函数包装：

```javascript
function corsResponse(response) {
  // 统一添加 CORS 头
  // 确保跨域请求 100% 成功
}
```

## 📊 响应头信息

服务会添加以下调试头信息：

| 响应头 | 说明 | 示例值 |
|--------|------|--------|
| `x-proxy-by` | 代理服务标识 | `Cloudflare-Workers-Enhanced` |
| `x-target-url` | 实际请求的目标 URL | `https://api.example.com/data` |
| `cache-control` | 缓存控制（GET 请求） | `public, max-age=3600` |
| `access-control-allow-*` | CORS 相关头 | `*` |

## 🛡️ 安全特性

### 1. 域名验证

通过黑白名单机制验证目标域名：

```javascript
// 支持精确匹配和子域名匹配
blockedDomains: ['evil.com']  // 阻止 evil.com 和 *.evil.com
allowedDomains: ['safe.com']  // 只允许 safe.com 和 *.safe.com
```

### 2. 用户认证

可选的简单认证机制：

```javascript
authUser: 'secretUser'  // 必须在 URL 中包含此用户名
```

### 3. 请求头清理

自动清理可能导致问题或暴露信息的请求头：

- Cloudflare 特定头
- 客户端 IP 相关头
- Referer 头（可选）

### 4. 响应头优化

移除可能导致兼容性问题的安全响应头，同时保持合理的安全级别。

## 🎯 使用场景

### 1. API 跨域代理

解决前端直接调用第三方 API 的 CORS 问题：

```javascript
// 原始请求（CORS 错误）
fetch('https://api.example.com/data')

// 通过代理（成功）
fetch('https://your-worker.workers.dev/api.example.com/data')
```

### 2. 媒体资源代理

代理视频、图片等媒体资源，支持重定向：

```bash
# 自动跟随 CDN 重定向
https://your-worker.workers.dev/cdn.example.com/video.mp4
```

### 3. 隐藏真实 IP

完全隐藏客户端 IP，保护隐私：

```bash
# 目标服务器无法获取真实访客 IP
https://your-worker.workers.dev/tracking-free-site.com/page
```

### 4. 统一入口 + 认证

为多个后端服务提供统一且安全的访问入口：

```bash
# 启用 authUser: 'admin'
https://proxy.your-domain.com/admin/user-api.internal.com/users
https://proxy.your-domain.com/admin/order-api.internal.com/orders
```

### 5. 绕过限制

访问某些地区或网络环境受限的资源：

```bash
https://your-worker.workers.dev/blocked-site.com/resource
```

## 📝 注意事项

### 1. Cloudflare Workers 限制

| 限制项 | 免费版 | 付费版 |
|--------|--------|--------|
| 每天请求数 | 100,000 | 无限制 |
| CPU 时间 | 10ms | 50ms |
| 并发连接 | 6 | 6 |

详见：[Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)

### 2. 缓存策略

- ✅ 只缓存 GET 请求
- ✅ 默认缓存 1 小时（可配置）
- ❌ POST/PUT/DELETE 等修改请求不缓存
- ⚠️ 缓存时间过长可能导致内容不更新

### 3. 安全建议

- 🔐 启用 `authUser` 防止滥用
- 📋 设置 `allowedDomains` 限制可代理的目标
- 🚫 合理配置 `blockedDomains` 防止内网渗透
- 📊 定期检查 Workers 分析面板
- 🔍 避免代理敏感服务（如银行、支付等）

### 4. 性能优化

- ⚡ 合理设置 `cacheTTL`，静态资源可设置更长时间
- 🌍 使用自定义域名 + Cloudflare CDN 加速
- 📉 监控 CPU 时间使用情况
- 🔄 减少不必要的重定向跟随次数

### 5. 兼容性说明

- ✅ 支持所有标准 HTTP 方法
- ✅ 支持 WebSocket（需要特殊配置）
- ✅ 支持大文件传输（受 Workers 限制）
- ⚠️ 某些网站可能检测并阻止代理访问

## 🐛 故障排除

### 问题 1: 无法访问目标网站

**可能原因：**
- 目标域名在黑名单中
- 白名单已启用但目标域名不在其中
- 认证失败（authUser 不匹配）
- 目标网站主动阻止代理

**解决方案：**
1. 检查 `blockedDomains` 配置
2. 检查 `allowedDomains` 配置
3. 确认 URL 格式正确（包含 authUser）
4. 查看浏览器控制台和 Workers 日志

### 问题 2: 重定向循环

**可能原因：**
- 目标网站重定向次数超过 `maxRedirects`
- 目标网站存在重定向循环

**解决方案：**
1. 增加 `maxRedirects` 值
2. 检查目标网站是否正常
3. 查看 `x-target-url` 响应头了解重定向链

### 问题 3: 认证失败

**错误信息：**
```json
{
  "error": "Forbidden",
  "message": "Invalid user",
  "timestamp": "2026-01-02T03:20:00.000Z"
}
```

**解决方案：**
1. 确认 `authUser` 配置值
2. 检查 URL 格式：`/authUser/target-url`
3. 如果不需要认证，将 `authUser` 设为空字符串

### 问题 4: 缓存未生效

**检查项：**
- 是否为 GET 请求
- `cacheTTL` 是否大于 0
- 查看响应头中的 `cache-control`
- 目标服务器是否设置了 `cache-control: no-cache`

### 问题 5: 请求超时 🆕

**错误信息：**
```json
{
  "error": "ProxyError",
  "message": "Request timeout after 30000ms",
  "timestamp": "2026-01-02T03:20:00.000Z"
}
```

**可能原因：**
- 目标服务器响应慢
- Workers CPU 时间限制
- 重定向次数过多
- 网络连接问题

**解决方案：**
- 增加  `requestTimeout` 值
- 优化目标服务器性能
- 升级到付费版 Workers（50ms CPU 时间）
- 减少 `maxRedirects` 值
- 检查网络连通性

### 问题 6: 请求体过大 🆕

**错误信息：**
```json
{
  "error": "Payload Too Large",
  "message": "Request body exceeds maximum size of 10485760 bytes",
  "maxSize": 10485760,
  "timestamp": "2026-01-02T03:20:00.000Z"
}
```

**解决方案：**
1. 增加 `maxBodySize` 限制
2. 压缩请求数据
3. 分批发送大数据
4. 设置 `maxBodySize: 0` 移除限制（谨慎使用）

## 📚 代码结构

```
_worker.js (v2.1)
├── CONFIG                      # 配置区（易于修改）
├── export default              # 主处理函数
│   ├── 健康检查端点 🆕
│   ├── 路径解析
│   ├── 用户认证
│   ├── 协议验证 🆕
│   ├── 域名验证
│   ├── 请求体大小检查 🆕
│   ├── 代理请求（支持超时） 🆕
│   └── 性能监控 🆕
└── 辅助函数
    ├── parseUpstreamUrl()      # URL 解析
    ├── fetchWithTimeout()      # 超时控制 🆕
    ├── fetchWithRedirect()     # 重定向跟随
    ├── stripClientHeaders()    # 清理客户端头
    ├── stripSecurityHeaders()  # 清理安全头
    ├── corsResponse()          # CORS 处理
    ├── textResponse()          # 文本响应
    ├── jsonResponse()          # JSON 响应 🆕
    ├── isRedirect()            # 重定向判断
    └── getUsageHTML()          # 使用说明页面
```

## 🔄 更新日志

### v2.1 (优化增强版) - 2026-01-02 🎉

**性能优化**
- ✨ 新增：请求超时控制机制（AbortController）
- ✨ 新增：请求体大小限制验证
- ✨ 新增：性能监控（响应时间追踪）
- 🔧 优化：增强缓存策略（添加 Vary 头）

**功能增强**
- ✨ 新增：健康检查端点（`/health`、`/ping`）
- ✨ 新增：JSON 格式错误响应
- ✨ 新增：自定义 User-Agent 配置
- ✨ 新增：协议验证（仅允许 HTTP/HTTPS）
- 🔧 改进：更详细的错误信息和堆栈追踪

**开发体验**
- 📝 新增：可配置的详细错误模式
- 📝 新增：响应头中的性能指标
- 🎨 改进：使用说明页面新增配置展示
- 📚 文档：完善配置说明和最佳实践

### v2.0 (增强版) - 2026-01-01

- ✨ 新增：智能重定向跟随（最多 3 次）
- ✨ 新增：可选用户认证功能
- ✨ 新增：完整 IP 隐藏（14+ 请求头）
- ✨ 新增：优化安全响应头处理（6+ 响应头）
- ✨ 新增：灵活 URL 解析（支持多种格式）
- 🔧 改进：统一 CORS 处理机制
- 🔧 改进：简化配置结构
- 🔧 改进：动态使用说明页面
- 📝 优化：代码结构更清晰
- 📝 优化：减少代码行数 ~10%

### v1.0 (基础版) - 2026-01-01

- ✨ 初始版本
- ✅ 动态反向代理
- ✅ CORS 支持
- ✅ 缓存控制
- ✅ 域名黑白名单

## 📜 许可证

MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📮 相关资源

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)

## 🙏 致谢

- 感谢 [Cloudflare Workers](https://workers.cloudflare.com/) 提供的强大平台
- 感谢所有贡献者和使用者

## ⚠️ 免责声明

本项目仅供学习和研究使用。使用本代理服务时：

1. 请遵守目标网站的服务条款
2. 请遵守当地法律法规
3. 不要用于非法用途
4. 不要滥用或攻击目标网站
5. 作者不对使用本代码造成的任何后果负责

---

**⭐ 如果这个项目对你有帮助，请给一个 Star！**

**🔗 项目地址：** [GitHub Repository](#)

**📧 反馈建议：** 欢迎提交 Issue
