# 🚀 Cloudflare Workers 动态反向代理 v1.1

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

### v1.1 安全增强功能 🆕
- ⏱️ **请求超时控制** - 可配置请求超时时间（默认 30 秒）
- 📦 **请求体大小限制** - 防止过大请求（默认 10MB）
- 🏥 **健康检查端点** - `/health` 和 `/ping` 端点用于监控
- 📊 **性能监控** - 实时追踪响应时间和时间戳
- 🎭 **自定义 User-Agent** - 可配置代理标识
- 📋 **JSON 错误响应** - 结构化错误信息，便于调试
- 🔐 **协议验证增强** - 严格验证仅支持 HTTP/HTTPS
- 🚀 **增强缓存策略** - 添加 Vary 头优化缓存行为
- 🛡️ **扩展域名黑名单** - 预设常见敏感域名（Docker Hub、云服务、支付网关等）
- 🔒 **路径安全检查** - 阻止敏感路径和文件访问
- 🚫 **私有 IP 检测** - 防止内网探测和 SSRF 攻击

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
https://your-worker.workers.dev/cdn.example.com/assets/image.png

# 实际代理到
https://cdn.example.com/assets/image.png
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
4. 将 `_worker.js` 的代码复制粘贴到编辑器
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
cp _worker.js src/index.js

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
  userAgent: 'Cloudflare-Workers-Proxy/1.1',

  // 域名黑名单（禁止代理的域名）
  blockedDomains: [
    // 本地地址
    'localhost', '127.0.0.1', '0.0.0.0', '::1',

    // 内网地址
    '10.', '172.16.', '192.168.', 'internal', 'local',

    // 容器镜像仓库
    'docker.io', 'hub.docker.com', 'ghcr.io', 'gcr.io', 'quay.io',

    // 云服务商内部服务
    'metadata.google.internal', '169.254.169.254',
    'kubernetes.default.svc', 'rancher.internal',

    // 金融支付
    'paypal.com', 'stripe.com', 'alipay.com', 'pay.weixin.qq.com',

    // 政府机构
    'gov.cn', 'mil.cn', 'gov', 'mil',

    // 可能被滥用的服务
    'ipify.org', 'ifconfig.me', 'icanhazip.com', 'api.ipify.org',
  ],

  // 域名白名单（留空表示允许所有，建议生产环境配置）
  allowedDomains: [],

  // 危险路径黑名单（防止路径遍历和敏感文件访问）
  blockedPaths: [
    '/.env', '/.git', '/admin', '/phpmyadmin',
    '/.aws', '/.ssh', '/etc/passwd', '/etc/shadow',
    '/../', '/./.',
  ],

  // 是否启用详细错误信息（生产环境建议关闭）
  verboseErrors: false,

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
| `blockedDomains` | array | `[...]` | 域名黑名单 🆕 |
| `allowedDomains` | array | `[]` | 域名白名单，留空允许所有 |
| `blockedPaths` | array | `[...]` | 危险路径黑名单 🆕 |
| `verboseErrors` | boolean | `false` | 启用详细错误信息 🆕 |
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
  "timestamp": "2026-01-02T08:00:00.000Z",
  "version": "1.1"
}
```

用途：
- 监控服务可用性
- 负载均衡器健康检查
- 自动化运维脚本

### 安全黑名单说明 🛡️

v1.1 版本预设了以下类别的安全黑名单：

**容器镜像仓库**
- Docker Hub (docker.io, hub.docker.com)
- GitHub Container Registry (ghcr.io)
- Google Container Registry (gcr.io)
- Quay.io, Microsoft Container Registry

**云服务商内部服务**
- metadata.google.internal
- 169.254.169.254 (AWS/GCP metadata)
- kubernetes.default.svc
- rancher.internal

**金融支付相关**
- PayPal, Stripe, Alipay, 微信支付

**政府和敏感机构**
- .gov.cn, .mil.cn, .gov, .mil

**可能被滥用的服务**
- ipify.org, ifconfig.me 等 IP 查询服务

### 路径安全检查 🔒

自动阻止以下危险路径：
- 敏感文件：`/.env`, `/.git`, `/.aws`, `/.ssh`
- 管理后台：`/admin`, `/phpmyadmin`
- 系统文件：`/etc/passwd`, `/etc/shadow`
- 路径遍历：`/../`, `/./`

### 私有 IP 检测 🚫

自动阻止访问私有 IP 地址，防止 SSRF 攻击：
- IPv4: 10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x
- IPv6: fe80:, fc00:, fd00:, ::1

### 性能监控 📊

启用 `enableMetrics` 后，每个响应都会包含性能指标：

```http
x-response-time: 245ms
x-proxy-timestamp: 2026-01-02T08:00:00.000Z
x-proxy-by: Cloudflare-Workers-Proxy-v1.1
x-target-url: https://api.example.com/data
```

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
https://your-worker.workers.dev/api.example.com/data
```

### 4. 统一入口 + 认证

为多个后端服务提供统一且安全的访问入口：

```bash
# 启用 authUser: 'admin'
https://proxy.your-domain.com/admin/user-api.internal.com/users
https://proxy.your-domain.com/admin/order-api.internal.com/orders
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
- 🛡️ 生产环境建议关闭 `verboseErrors`

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

### 问题 1: 域名被阻止

**错误信息：**
```json
{
  "error": "Forbidden",
  "message": "Domain is blocked by security policy",
  "domain": "docker.io",
  "reason": "This domain is in the blocklist for security or compliance reasons"
}
```

**解决方案：**
1. 检查目标域名是否在 `blockedDomains` 中
2. 如确需访问，从黑名单中移除该域名
3. 考虑使用白名单模式更精确控制

### 问题 2: 路径被拦截

**错误信息：**
```json
{
  "error": "Forbidden",
  "message": "Requested path contains blocked patterns",
  "path": "/.env",
  "reason": "This path is blocked for security reasons"
}
```

**解决方案：**
1. 检查请求路径是否包含 `blockedPaths` 中的模式
2. 如确需访问，修改 `blockedPaths` 配置
3. 注意：移除安全路径限制可能带来安全风险

### 问题 3: 私有 IP 被阻止

**错误信息：**
```json
{
  "error": "Forbidden",
  "message": "Direct access to private IP addresses is not allowed",
  "ip": "192.168.1.1",
  "reason": "Security policy prevents access to internal networks"
}
```

**解决方案：**
1. 这是防止 SSRF 攻击的安全机制
2. 不建议移除此限制
3. 如需访问内网，考虑使用其他方式

### 问题 4: 请求超时

**错误信息：**
```json
{
  "error": "ProxyError",
  "message": "Request timeout after 30000ms",
  "timestamp": "2026-01-02T08:00:00.000Z"
}
```

**解决方案：**
- 增加 `requestTimeout` 值
- 检查目标服务器响应速度
- 考虑升级到付费版 Workers

### 问题 5: 请求体过大

**错误信息：**
```json
{
  "error": "Payload Too Large",
  "message": "Request body exceeds maximum size of 10485760 bytes",
  "maxSize": 10485760
}
```

**解决方案：**
1. 增加 `maxBodySize` 限制
2. 压缩请求数据
3. 分批发送大数据

## 📚 代码结构

```
_worker.js (v1.1)
├── CONFIG                      # 配置区（易于修改）
├── export default              # 主处理函数
│   ├── 健康检查端点 🆕
│   ├── 路径解析
│   ├── 用户认证
│   ├── 协议验证 🆕
│   ├── 域名黑名单检查 🆕
│   ├── 域名白名单检查
│   ├── 路径安全检查 🆕
│   ├── 私有 IP 检测 🆕
│   ├── 请求体大小检查
│   ├── 代理请求（支持超时）
│   └── 性能监控
└── 辅助函数
    ├── parseUpstreamUrl()      # URL 解析
    ├── fetchWithTimeout()      # 超时控制
    ├── fetchWithRedirect()     # 重定向跟随
    ├── stripClientHeaders()    # 清理客户端头
    ├── stripSecurityHeaders()  # 清理安全头
    ├── corsResponse()          # CORS 处理
    ├── textResponse()          # 文本响应
    ├── jsonResponse()          # JSON 响应
    ├── isRedirect()            # 重定向判断
    ├── isPrivateIP()           # 私有 IP 检测 🆕
    └── getUsageHTML()          # 使用说明页面
```

## 🔄 更新日志

### v1.1 (安全增强版) - 2026-01-02 🎉

**安全增强**
- ✨ 新增：扩展域名黑名单（Docker Hub、云服务、支付网关等 30+ 域名）
- ✨ 新增：路径安全检查（阻止敏感文件和路径遍历）
- ✨ 新增：私有 IP 检测（防止 SSRF 攻击）
- ✨ 新增：协议验证（仅允许 HTTP/HTTPS）
- 🔧 优化：多层域名匹配机制

**性能优化**
- ✨ 新增：请求超时控制机制（AbortController）
- ✨ 新增：请求体大小限制验证
- ✨ 新增：性能监控（响应时间追踪）
- 🔧 优化：增强缓存策略（添加 Vary 头）

**功能增强**
- ✨ 新增：健康检查端点（`/health`、`/ping`）
- ✨ 新增：JSON 格式错误响应
- ✨ 新增：自定义 User-Agent 配置
- 🔧 改进：更详细的错误信息

**开发体验**
- 📝 新增：可配置的详细错误模式
- 📝 新增：响应头中的性能指标
- 🎨 改进：使用说明页面新增配置展示
- 📚 文档：完善安全配置说明

### v1.0 (初始版) - 2026-01-02

- ✨ 初始版本发布
- ✅ 动态反向代理功能
- ✅ 智能重定向跟随
- ✅ 完整 CORS 支持
- ✅ 缓存控制
- ✅ 用户认证
- ✅ 基础域名黑白名单

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

**🔗 项目地址：** [https://github.com/Meibidi/Cloudflare-Proxy](https://github.com/Meibidi/Cloudflare-Proxy)

**📧 反馈建议：** 欢迎提交 Issue
