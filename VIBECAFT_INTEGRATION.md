# OpenClaw + Vibecraft 集成指南

这个集成允许你在 Vibecraft 的 3D 可视化工作空间中实时查看 OpenClaw Agent 的活动。

## 什么是 Vibecraft？

Vibecraft 是一个 3D 可视化工具，它将 AI Agent 的活动展示为一个动画车间：
- Agent 使用工具时，角色会移动到对应的工作站
- 支持 Read、Write、Edit、Bash、Grep、WebSearch 等工具的可视化
- 实时显示 Agent 的思考状态和响应

## 快速开始（推荐）

### 方法一：直接在代码中启用

在你的 Agent 启动代码中添加：

```typescript
import { enableVibecraft } from './infra/vibecraft-integration.js'

// 启用 Vibecraft 集成
const cleanup = enableVibecraft({
  enabled: true,
  debug: true,  // 启用调试日志
  serverUrl: 'http://localhost:4003/event'
})

// 当 Agent 关闭时清理
process.on('exit', cleanup)
```

### 方法二：通过插件配置（需要插件系统支持）

在你的 `openclaw.json` 中添加：

```json
{
  "plugins": [
    {
      "id": "builtin:vibecraft",
      "enabled": true,
      "config": {
        "serverUrl": "http://localhost:4003/event",
        "debug": false
      }
    }
  ]
}
```

### 启动步骤

1. **启动 Vibecraft 服务器**：
   ```bash
   # 从已下载的 vibecraft 目录
   cd E:\opensource\token_plan\vibecraft
   npm run server

   # 或使用 npx
   npx vibecraft
   ```

2. **打开浏览器**：访问 http://localhost:4003

3. **运行 OpenClaw Agent**：你将看到 Agent 在 3D 车间中活动！

## 工作站映射

Vibecraft 将不同的工具映射到 3D 场景中的工作站：

| 工具 | 工作站 | 描述 |
|------|--------|------|
| Read | Bookshelf (书架) | 从书架上取书阅读 |
| Write | Desk (书桌) | 在书桌上书写 |
| Edit | Workbench (工作台) | 使用扳手修理 |
| Bash | Terminal (终端) | 发光的屏幕 |
| Grep/Glob | Scanner (扫描仪) | 望远镜带透镜 |
| WebFetch/WebSearch | Antenna (天线) | 卫星天线 |
| Task | Portal (传送门) | 发光环传送门 |
| TodoWrite | Taskboard (任务板) | 带便利贴的板子 |

## 配置选项

### enableVibecraft() 函数参数

```typescript
enableVibecraft({
  enabled: true,                    // 是否启用（默认: false）
  serverUrl: 'http://localhost:4003/event',  // Vibecraft 服务器地址
  debug: true,                      // 启用调试日志（默认: false）
  cwd: process.cwd()                // 工作目录（默认: 当前目录）
})
```

| 选项 | 默认值 | 描述 |
|------|--------|------|
| `enabled` | `false` | 启用/禁用集成 |
| `serverUrl` | `'http://localhost:4003/event'` | Vibecraft 服务器 URL |
| `debug` | `false` | 启用调试日志 |
| `cwd` | `process.cwd()` | 工作目录 |

### Vibecraft 服务器配置

### Vibecraft 服务器配置

Vibecraft 服务器默认使用端口 4003。你可以通过环境变量修改：

```bash
# 修改服务器端口
VIBECRAFT_PORT=4004 npx vibecraft
```

然后在 OpenClaw 配置中更新 `serverUrl`：

```json
{
  "config": {
    "serverUrl": "http://localhost:4004/event"
  }
}
```

## 事件类型

集成会发送以下事件到 Vibecraft：

| 事件类型 | 触发时机 | 数据 |
|----------|----------|------|
| `session_start` | Agent 启动 | sessionId, cwd |
| `user_prompt_submit` | 用户发送消息 | sessionId, prompt |
| `pre_tool_use` | 工具调用前 | sessionId, tool, toolInput |
| `post_tool_use` | 工具调用后 | sessionId, tool, toolResponse, success |
| `stop` | Agent 完成 | sessionId, response |

## 故障排除

### Vibecraft 服务器未响应

如果插件无法连接到 Vibecraft 服务器：

1. 确认 Vibecraft 正在运行：
   ```bash
   curl http://localhost:4003/health
   ```

2. 检查端口是否正确（默认 4003）

3. 启用调试日志查看详细错误：
   ```json
   {
     "config": {
       "debug": true
     }
   }
   ```

### 没有看到可视化

1. 确认浏览器已连接到 http://localhost:4003
2. 检查 Vibecraft 控制台是否有错误
3. 确认 Agent 正在执行工具（而不仅仅是文本生成）

### Agent 会话不匹配

OpenClaw 的 `sessionKey` 会作为 Vibecraft 的 `sessionId`。确保：
- Agent 配置中有明确的 `sessionKey`
- 或者在 Agent 配置中设置唯一的 `agentId`

## 高级用法

### 手动发送事件

如果你想在不使用 Agent 事件系统的情况下手动发送事件：

```typescript
import {
  sendToolEvent,
  sendPromptEvent,
  sendStopEvent
} from './infra/vibecraft-integration.js'

// 发送工具使用事件
await sendToolEvent({
  sessionId: 'my-session',
  toolName: 'Read',
  params: { file_path: '/path/to/file.txt' },
  result: { content: 'file content...' }
})

// 发送用户提示事件
await sendPromptEvent({
  sessionId: 'my-session',
  prompt: '帮我分析这个文件'
})

// 发送完成事件
await sendStopEvent({
  sessionId: 'my-session',
  response: '分析完成！'
})
```

### 多 Agent 可视化

### 事件持久化

要保存事件到文件，配置 `eventsFilePath`：

```json
{
  "config": {
    "eventsFilePath": "~/.vibecraft/data/events.jsonl"
  }
}
```

事件将以 JSONL 格式追加到文件中。

## 架构

```
┌─────────────────┐
│  OpenClaw Agent │
│                 │
│  ┌───────────┐  │    ┌──────────────────────┐
│  │   Events  │──┼───→│ vibecraft-integration │
│  │   Stream  │  │    │  (Transforms Events)  │
│  └───────────┘  │    └──────────┬───────────┘
└─────────────────┘               │
                                  ▼
                       ┌─────────────────────┐
                       │ Vibecraft Server    │
                       │ (localhost:4003)    │
                       │  HTTP POST /event   │
                       └──────────┬──────────┘
                                  │ WebSocket
                                  ▼
                       ┌─────────────────────┐
                       │ Browser (Three.js)  │
                       │ 3D Workshop View    │
                       └─────────────────────┘
```

## 文件说明

创建的集成文件：

| 文件 | 描述 |
|------|------|
| `src/infra/vibecraft-integration.ts` | 简化版集成，推荐使用 |
| `src/infra/vibecraft-adapter.ts` | 完整适配器，包含更多功能 |
| `src/plugins/builtin/vibecraft-plugin.ts` | 插件版本（需要插件系统支持） |

## 相关文档

- [Vibecraft README](../vibecraft/README.md)
- [Vibecraft 技术文档](../vibecraft/CLAUDE.md)
- [OpenClaw 插件开发](./docs/PLUGIN_DEVELOPMENT.md)

## 许可证

MIT License - 与 OpenClaw 和 Vibecraft 一致
