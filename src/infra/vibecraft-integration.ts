/**
 * Vibecraft Integration for OpenClaw Agents
 *
 * 简化版的 Vibecraft 集成，不需要完整的插件系统。
 * 可以直接在 Agent 代码中使用。
 *
 * 用法示例:
 *
 * ```typescript
 * import { enableVibecraft } from './infra/vibecraft-integration.js'
 *
 * // 在 Agent 启动时启用
 * enableVibecraft({
 *   enabled: true,
 *   debug: true
 * })
 * ```
 */

import { onAgentEvent, type AgentEventPayload } from './agent-events.js'

// ============================================================================
// Configuration
// ============================================================================

export interface VibecraftIntegrationOptions {
  /** 是否启用集成 */
  enabled?: boolean
  /** Vibecraft 服务器 URL */
  serverUrl?: string
  /** 是否启用调试日志 */
  debug?: boolean
  /** 当前工作目录 */
  cwd?: string
}

const DEFAULT_OPTIONS: Required<VibecraftIntegrationOptions> = {
  enabled: false,
  serverUrl: 'http://localhost:4003/event',
  debug: false,
  cwd: process.cwd(),
}

let options: Required<VibecraftIntegrationOptions> = DEFAULT_OPTIONS
let unsubscribe: (() => void) | null = null
let toolStartTimes = new Map<string, number>()

// ============================================================================
// Utility Functions
// ============================================================================

function logDebug(message: string, ...args: unknown[]) {
  if (options.debug) {
    console.log(`[vibecraft] ${message}`, ...args)
  }
}

function logError(message: string, error: unknown) {
  console.error(`[vibecraft] ERROR: ${message}`, error)
}

function generateId(sessionId: string): string {
  return `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * 发送事件到 Vibecraft 服务器
 */
async function sendEvent(event: Record<string, unknown>): Promise<void> {
  if (!options.enabled) {
    return
  }

  try {
    logDebug('发送事件:', JSON.stringify(event).slice(0, 150) + '...')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)

    const response = await fetch(options.serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      logDebug(`服务器响应: ${response.status}`)
    } else {
      logDebug('事件已发送')
    }
  } catch (err) {
    // 服务器可能未运行 - 静默忽略
    logDebug('发送失败 (服务器可能未运行)')
  }
}

// ============================================================================
// Event Transformers
// ============================================================================

/**
 * 将 OpenClaw 的 Agent 事件转换为 Vibecraft 格式
 */
function transformEvent(evt: AgentEventPayload): Record<string, unknown> | null {
  const sessionId = evt.sessionKey || evt.runId
  const baseEvent = {
    id: generateId(sessionId),
    timestamp: evt.ts,
    sessionId,
    cwd: options.cwd,
  }

  // Lifecycle 事件
  if (evt.stream === 'lifecycle') {
    const phase = evt.data.phase as string

    if (phase === 'start') {
      return {
        ...baseEvent,
        type: 'session_start',
        source: 'startup',
      }
    }

    if (phase === 'end') {
      return {
        ...baseEvent,
        type: 'stop',
        stopHookActive: false,
        response: evt.data.result,
      }
    }
  }

  // Tool 事件
  if (evt.stream === 'tool') {
    const phase = evt.data.phase as string
    const toolName = evt.data.toolName as string
    const toolUseId = evt.data.toolUseId as string || `${sessionId}-${evt.seq}`

    if (phase === 'pre') {
      // 记录开始时间
      toolStartTimes.set(toolUseId, evt.ts)

      return {
        ...baseEvent,
        type: 'pre_tool_use',
        tool: toolName,
        toolInput: evt.data.params || {},
        toolUseId,
        assistantText: evt.data.assistantText,
      }
    }

    if (phase === 'post') {
      const startTime = toolStartTimes.get(toolUseId)
      const duration = startTime ? evt.ts - startTime : undefined

      return {
        ...baseEvent,
        type: 'post_tool_use',
        tool: toolName,
        toolInput: evt.data.params || {},
        toolResponse: evt.data.result || {},
        toolUseId,
        success: evt.data.error === undefined,
        duration,
      }
    }
  }

  // Assistant 事件 (响应文本)
  if (evt.stream === 'assistant') {
    // 可以在这里处理响应文本
    // 但通常在 stop 事件中已经包含了
  }

  // Error 事件
  if (evt.stream === 'error') {
    return {
      ...baseEvent,
      type: 'notification',
      message: evt.data.error as string || '未知错误',
      notificationType: 'error',
    }
  }

  return null
}

// ============================================================================
// Main Setup Function
// ============================================================================

/**
 * 启用 Vibecraft 集成
 *
 * @param userOptions - 配置选项
 * @returns 清理函数，调用时禁用集成
 *
 * @example
 * ```typescript
 * // 在 Agent 启动时调用
 * const cleanup = enableVibecraft({ enabled: true, debug: true })
 *
 * // 可选：注册进程退出时的清理
 * process.on('exit', cleanup)
 * process.on('SIGINT', () => { cleanup(); process.exit(0) })
 * process.on('SIGTERM', () => { cleanup(); process.exit(0) })
 * ```
 */
export function enableVibecraft(userOptions: VibecraftIntegrationOptions = {}): () => void {
  options = { ...DEFAULT_OPTIONS, ...userOptions }

  if (!options.enabled) {
    logDebug('Vibecraft 集成已禁用')
    return () => {}
  }

  logDebug('启用 Vibecraft 集成')
  logDebug(`  服务器: ${options.serverUrl}`)
  logDebug(`  工作目录: ${options.cwd}`)

  // 订阅 Agent 事件
  unsubscribe = onAgentEvent((evt: AgentEventPayload) => {
    const vibecraftEvent = transformEvent(evt)
    if (vibecraftEvent) {
      // 异步发送，不阻塞 Agent 执行
      sendEvent(vibecraftEvent).catch(() => {})
    }
  })

  // 发送初始会话开始事件
  sendEvent({
    id: generateId('system'),
    timestamp: Date.now(),
    type: 'notification',
    sessionId: 'system',
    cwd: options.cwd,
    message: 'Vibecraft 集成已启用',
    notificationType: 'info',
  }).catch(() => {})

  logDebug('Vibecraft 集成已就绪!')

  // 返回清理函数
  return () => {
    logDebug('禁用 Vibecraft 集成')
    unsubscribe?.()
    unsubscribe = null
    toolStartTimes.clear()
  }
}

// ============================================================================
// Manual Event Sending (可选)
// ============================================================================

/**
 * 手动发送工具使用事件
 *
 * 如果你想在不使用 Agent 事件系统的情况下发送事件
 */
export async function sendToolEvent(options: {
  sessionId: string
  toolName: string
  params: Record<string, unknown>
  result: Record<string, unknown>
  error?: string
}): Promise<void> {
  const toolUseId = generateId(options.sessionId)
  const startTime = Date.now()

  // Pre-tool 事件
  await sendEvent({
    id: generateId(options.sessionId),
    timestamp: startTime,
    type: 'pre_tool_use',
    sessionId: options.sessionId,
    cwd: process.cwd(),
    tool: options.toolName,
    toolInput: options.params,
    toolUseId,
  })

  // Post-tool 事件
  const endTime = Date.now()
  await sendEvent({
    id: generateId(options.sessionId),
    timestamp: endTime,
    type: 'post_tool_use',
    sessionId: options.sessionId,
    cwd: process.cwd(),
    tool: options.toolName,
    toolInput: options.params,
    toolResponse: options.result,
    toolUseId,
    success: options.error === undefined,
    duration: endTime - startTime,
  })
}

/**
 * 手动发送用户提示事件
 */
export async function sendPromptEvent(options: {
  sessionId: string
  prompt: string
}): Promise<void> {
  await sendEvent({
    id: generateId(options.sessionId),
    timestamp: Date.now(),
    type: 'user_prompt_submit',
    sessionId: options.sessionId,
    cwd: process.cwd(),
    prompt: options.prompt,
  })
}

/**
 * 手动发送完成事件
 */
export async function sendStopEvent(options: {
  sessionId: string
  response?: string
}): Promise<void> {
  await sendEvent({
    id: generateId(options.sessionId),
    timestamp: Date.now(),
    type: 'stop',
    sessionId: options.sessionId,
    cwd: process.cwd(),
    stopHookActive: false,
    response: options.response,
  })
}
