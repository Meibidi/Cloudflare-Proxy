# 🎬 CF Proxy v2.1

高性能流媒体反向代理 - 专为 **Emby / Plex / Jellyfin** 设计。

## ✨ 核心特性

- 🔌 **WebSocket 全双工** - Emby 实时通信完美支持
- 📺 **流媒体智能直通** - 视频流自动识别，禁用缓存，5 分钟超时
- 🖼️ **海报墙强缓存** - 图片资源 7 天缓存 + Edge Cache 加速
- 🔄 **Range 分片透传** - 拖拽进度条无延迟
- ⚡ **智能缓存策略** - 静态 24h / 动态 5min / 可配置
- 🌍 **完整 CORS** - 跨域问题一键解决

## 📖 使用方法

```
https://你的域名/目标域名/路径
```

### Emby 示例

```bash
# 配置 Emby 服务器地址
https://proxy.dev/your-emby.com/emby/Items

# 播放视频（自动直通模式）
https://proxy.dev/your-emby.com/emby/videos/123/stream.mp4

# 海报墙（强缓存模式）
https://proxy.dev/your-emby.com/emby/Items/123/Images/Primary
```

## 🚀 部署

### Dashboard 部署

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **Create**
3. 粘贴 `_worker.js` 代码
4. 点击 **Deploy**

### Wrangler CLI

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

## ⚙️ 配置

通过环境变量配置，无需修改代码。

### 基础配置

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `AUTH_USER` | string | `''` | 认证前缀 |
| `DEFAULT_PROTOCOL` | string | `https` | 默认协议 |
| `MAX_REDIRECTS` | number | `5` | 最大重定向 |
| `REQUEST_TIMEOUT` | number | `30000` | 常规超时(ms) |
| `STREAM_TIMEOUT` | number | `300000` | 流媒体超时(ms) |
| `USER_AGENT` | string | `''` | 自定义 UA |

### 缓存配置

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `DEFAULT_CACHE_TTL` | number | `3600` | 默认缓存(秒) |
| `STATIC_CACHE_TTL` | number | `86400` | 静态资源(秒) |
| `DYNAMIC_CACHE_TTL` | number | `300` | 动态内容(秒) |
| `IMAGE_CACHE_TTL` | number | `604800` | 图片缓存(秒) |
| `ENABLE_EDGE_CACHE` | boolean | `true` | Edge Cache |

### 流媒体配置

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `STREAM_PATHS` | array | `['/videos/',...]` | 流媒体路径 |
| `IMAGE_PATHS` | array | `['/images/',...]` | 图片路径 |
| `ENABLE_WEBSOCKET` | boolean | `true` | WebSocket |

### 访问控制

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `BLOCKED_DOMAINS` | array | `[]` | 域名黑名单 |
| `ALLOWED_DOMAINS` | array | `[]` | 域名白名单 |
| `BLOCKED_IPS` | array | `[]` | IP 黑名单 |
| `ALLOWED_IPS` | array | `[]` | IP 白名单 |
| `NO_CACHE_PATHS` | array | `[]` | 不缓存路径 |

> 数组使用逗号分隔，如 `/api/,/auth/`

## 📊 缓存策略

| 场景 | 缓存时间 | 说明 |
|------|----------|------|
| 视频流 `/videos/` | 禁用 | 直接透传，不缓存 |
| 图片 `/images/` | 7 天 | 海报墙强缓存 |
| 静态资源 `.js/.css` | 24h | 网页资源 |
| HTML 页面 | 5min | stale-while-revalidate |
| API/JSON | 5min | 接口响应 |
| 其他 | 1h | 默认策略 |

## 🎬 Emby 专属优化

### 预设流媒体路径

```
/videos/, /stream, /audio/, /playing, /transcode
/emby/videos/, /emby/audio/
/mediabrowser/videos/
/library/parts/  (Plex)
```

### 预设图片路径

```
/images/, /items/, /primary, /backdrop, /thumb
/emby/items/, /photo/
```

### WebSocket 支持

自动检测 `Upgrade: websocket` 请求头，建立全双工通道，支持：
- 播放进度实时同步
- 控制台通信
- 实时通知推送

## 🔧 API

**健康检查：**
```bash
curl https://proxy.dev/health
# {"status":"ok","version":"2.1","ws":true}
```

## 📝 更新日志

### v2.1 (流媒体优化版)
- ✨ WebSocket 全双工支持
- ✨ 流媒体智能直通模式
- ✨ 海报墙 7 天强缓存
- ✨ Range 分片透传
- ✨ 自适应超时（流媒体 5min）
- 🎨 深色主题使用说明页

### v2.0 (精简版)
- 移除冗余黑名单
- 极简配置架构

## 📜 许可证

MIT

## ⚠️ 免责声明

本项目仅供学习研究，请遵守目标服务条款和当地法律。
