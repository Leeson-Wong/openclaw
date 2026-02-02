# Vibecraft 集成 - 快速检查清单

## 文件检查

已创建的集成文件：

- [x] `src/infra/vibecraft-integration.ts` - 简单集成（推荐）
- [x] `src/infra/vibecraft-adapter.ts` - 完整适配器
- [x] `src/plugins/builtin/vibecraft-plugin.ts` - 插件版本
- [x] `VIBECAFT_INTEGRATION.md` - 完整文档

## 代码检查

- [x] 无 TODO 注释
- [x] 兼容 Node.js 18+（内置 fetch）
- [x] 超时处理（2秒）
- [x] 错误处理（静默失败，不阻塞 Agent）
- [x] 清理函数支持
- [x] 调试日志支持

## 启动步骤

### 1. 编译 OpenClaw

```bash
cd E:\opensource\token_plan\openclaw
npm run build
```

### 2. 启动 Vibecraft

```bash
cd E:\opensource\token_plan\vibecraft
npm run server
```

预期输出：
```
Vibecraft server listening on port 4003
WebSocket server ready
```

### 3. 在 Agent 代码中启用集成

```typescript
import { enableVibecraft } from './infra/vibecraft-integration.js'

// 启用（推荐在 Agent 启动时）
const cleanup = enableVibecraft({
  enabled: true,
  debug: true,
  serverUrl: 'http://localhost:4003/event'
})

// 可选：注册清理
process.on('exit', cleanup)
```

### 4. 打开浏览器

```
http://localhost:4003
```

### 5. 测试

运行一个使用工具的 Agent，例如：

```typescript
// Agent 代码
const response = await agent.run({
  prompt: '读取当前目录下的 package.json 文件'
})
```

预期看到：
- 控制台日志：`[vibecraft] 发送事件: ...`
- Vibecraft 网页：Claude 角色移动到 Bookshelf（书架）

## 故障排查

### 问题：没有看到可视化

1. 检查 Vibecraft 是否运行：
   ```bash
   curl http://localhost:4003/health
   ```

2. 检查 OpenClaw 日志：
   ```
   [vibecraft] 启用 Vibecraft 集成
   [vibecraft] 事件已发送
   ```

3. 启用调试：
   ```typescript
   enableVibecraft({ enabled: true, debug: true })
   ```

### 问题：发送失败

```
[vibecraft] 发送失败 (服务器可能未运行)
```

**解决**：确保 Vibecraft 已启动

### 问题：编译错误

```
Cannot find module './infra/vibecraft-integration.js'
```

**解决**：
1. 确保文件在正确位置：`openclaw/src/infra/vibecraft-integration.ts`
2. 运行 `npm run build`
3. 检查 TypeScript 编译输出

## 事件映射

| OpenClaw 事件 | Vibecraft 事件 | 视觉效果 |
|--------------|----------------|----------|
| lifecycle/start | session_start | 会话开始 |
| tool/pre | pre_tool_use | 移动到工作站 |
| tool/post | post_tool_use | 完成工具使用 |
| lifecycle/end | stop | 返回中心 |
| error | notification | 错误提示 |

## 工具映射

| 工具 | 工作站 | 描述 |
|------|--------|------|
| Read | Bookshelf | 书架 |
| Write | Desk | 书桌 |
| Edit | Workbench | 工作台 |
| Bash | Terminal | 终端 |
| Grep/Glob | Scanner | 扫描仪 |
| WebFetch/WebSearch | Antenna | 天线 |
| Task | Portal | 传送门 |
| TodoWrite | Taskboard | 任务板 |

## 配置示例

### 最简配置

```typescript
enableVibecraft({ enabled: true })
```

### 完整配置

```typescript
enableVibecraft({
  enabled: true,
  serverUrl: 'http://localhost:4003/event',
  debug: true,
  cwd: process.cwd()
})
```

## 性能考虑

- 事件发送是异步的（`fire-and-forget`）
- 超时 2 秒，不会阻塞 Agent
- Vibecraft 服务器未运行时静默失败
- 每个工具调用产生 2 个事件（pre + post）

## 下一步

1. 提交代码到服务器
2. 编译：`npm run build`
3. 启动 Vibecraft：`npm run server`（在 vibecraft 目录）
4. 在 Agent 代码中添加：`enableVibecraft({ enabled: true, debug: true })`
5. 测试运行！

## 需要帮助？

- 查看完整文档：`VIBECAFT_INTEGRATION.md`
- Vibecraft 项目：`../vibecraft/CLAUDE.md`
- Vibecraft README：`../vibecraft/README.md`
