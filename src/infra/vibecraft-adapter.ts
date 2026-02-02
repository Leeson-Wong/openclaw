/**
 * Vibecraft Integration Adapter for OpenClaw
 *
 * This adapter connects OpenClaw's agent events to Vibecraft's 3D visualization system.
 * It transforms OpenClaw events into Vibecraft-compatible format and sends them to
 * the Vibecraft WebSocket server.
 *
 * Usage:
 *   import { setupVibecraftIntegration } from './infra/vibecraft-adapter.js'
 *   setupVibecraftIntegration({ enabled: true, serverUrl: 'http://localhost:4003' })
 */

import { onAgentEvent, type AgentEventPayload } from './agent-events.js'
import type { HookRunner } from '../plugins/hooks.js'
import type {
  PluginHookBeforeToolCallEvent,
  PluginHookAfterToolCallEvent,
  PluginHookBeforeAgentStartEvent,
  PluginHookAgentEndEvent,
  PluginHookMessageReceivedEvent,
  PluginHookMessageSentEvent,
  PluginHookSessionStartEvent,
  PluginHookSessionEndEvent,
} from '../plugins/types.js'

// ============================================================================
// Configuration
// ============================================================================

export interface VibecraftAdapterConfig {
  /** Whether the adapter is enabled */
  enabled?: boolean
  /** Vibecraft server URL for HTTP POST events */
  serverUrl?: string
  /** Path to events.jsonl file (optional, for persistence) */
  eventsFilePath?: string
  /** Current working directory to report in events */
  cwd?: string
  /** Enable debug logging */
  debug?: boolean
}

const DEFAULT_CONFIG: Required<VibecraftAdapterConfig> = {
  enabled: false,
  serverUrl: 'http://localhost:4003/event',
  eventsFilePath: '',
  cwd: process.cwd(),
  debug: false,
}

// ============================================================================
// Vibecraft Event Types (simplified from vibecraft/shared/types.ts)
// ============================================================================

type VibecraftEventType =
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'stop'
  | 'session_start'
  | 'session_end'
  | 'user_prompt_submit'
  | 'notification'

interface BaseVibecraftEvent {
  id: string
  timestamp: number
  type: VibecraftEventType
  sessionId: string
  cwd: string
}

interface PreToolUseEvent extends BaseVibecraftEvent {
  type: 'pre_tool_use'
  tool: string
  toolInput: Record<string, unknown>
  toolUseId: string
  assistantText?: string
}

interface PostToolUseEvent extends BaseVibecraftEvent {
  type: 'post_tool_use'
  tool: string
  toolInput: Record<string, unknown>
  toolResponse: Record<string, unknown>
  toolUseId: string
  success: boolean
  duration?: number
}

interface StopEvent extends BaseVibecraftEvent {
  type: 'stop'
  stopHookActive: boolean
  response?: string
}

interface SessionStartEvent extends BaseVibecraftEvent {
  type: 'session_start'
  source: 'startup' | 'resume' | 'clear' | 'compact'
}

interface SessionEndEvent extends BaseVibecraftEvent {
  type: 'session_end'
  reason: 'clear' | 'logout' | 'prompt_input_exit' | 'other'
}

interface UserPromptSubmitEvent extends BaseVibecraftEvent {
  type: 'user_prompt_submit'
  prompt: string
}

interface NotificationEvent extends BaseVibecraftEvent {
  type: 'notification'
  message: string
  notificationType: string
}

type VibecraftEvent =
  | PreToolUseEvent
  | PostToolUseEvent
  | StopEvent
  | SessionStartEvent
  | SessionEndEvent
  | UserPromptSubmitEvent
  | NotificationEvent

// ============================================================================
// State Management
// ============================================================================

let config: Required<VibecraftAdapterConfig> = DEFAULT_CONFIG
let unsubscribeAgentEvents: (() => void) | null = null
let toolUseStartTime = new Map<string, number>() // toolUseId -> startTime

// ============================================================================
// Utility Functions
// ============================================================================

function generateEventId(sessionId: string): string {
  return `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function logDebug(message: string, ...args: unknown[]) {
  if (config.debug) {
    console.log(`[vibecraft-adapter] ${message}`, ...args)
  }
}

function logError(message: string, error: unknown) {
  console.error(`[vibecraft-adapter] ERROR: ${message}`, error)
}

/**
 * Send event to Vibecraft server via HTTP POST
 */
async function sendToVibecraft(event: VibecraftEvent): Promise<void> {
  if (!config.enabled) {
    return
  }

  try {
    logDebug('Sending event:', JSON.stringify(event).slice(0, 200) + '...')

    const response = await fetch(config.serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2000), // 2 second timeout
    })

    if (!response.ok) {
      logError(`Server responded with ${response.status}`, await response.text().catch(() => ''))
    }
  } catch (err) {
    // Vibecraft server might not be running - that's okay, just log it
    logDebug('Failed to send event (server may not be running)', err)
  }
}

/**
 * Append event to events.jsonl file (optional persistence)
 */
async function appendToEventsFile(event: VibecraftEvent): Promise<void> {
  if (!config.eventsFilePath) {
    return
  }

  try {
    const fs = await import('node:fs/promises')
    const line = JSON.stringify(event) + '\n'
    await fs.appendFile(config.eventsFilePath, line, 'utf-8')
    logDebug('Appended to events file:', config.eventsFilePath)
  } catch (err) {
    logError('Failed to write to events file', err)
  }
}

// ============================================================================
// Event Transformers
// ============================================================================

/**
 * Transform agent event to Vibecraft format
 */
function transformAgentEvent(evt: AgentEventPayload): VibecraftEvent | null {
  const sessionId = evt.sessionKey || evt.runId
  const baseEvent = {
    id: generateEventId(sessionId),
    timestamp: evt.ts,
    sessionId,
    cwd: config.cwd,
  }

  switch (evt.stream) {
    case 'lifecycle':
      if (evt.data.phase === 'start') {
        return {
          ...baseEvent,
          type: 'session_start',
          source: 'startup',
        } satisfies SessionStartEvent
      } else if (evt.data.phase === 'end') {
        return {
          ...baseEvent,
          type: 'stop',
          stopHookActive: false,
          response: evt.data.result as string | undefined,
        } satisfies StopEvent
      }
      break

    case 'tool':
      if (evt.data.phase === 'pre') {
        // Track start time for duration calculation
        const toolUseId = evt.data.toolUseId as string || `${sessionId}-${evt.seq}`
        toolUseStartTime.set(toolUseId, evt.ts)

        return {
          ...baseEvent,
          type: 'pre_tool_use',
          tool: evt.data.toolName as string,
          toolInput: (evt.data.params || {}) as Record<string, unknown>,
          toolUseId,
          assistantText: evt.data.assistantText as string | undefined,
        } satisfies PreToolUseEvent
      } else if (evt.data.phase === 'post') {
        const toolUseId = evt.data.toolUseId as string || `${sessionId}-${evt.seq}`
        const startTime = toolUseStartTime.get(toolUseId)
        const duration = startTime ? evt.ts - startTime : undefined

        return {
          ...baseEvent,
          type: 'post_tool_use',
          tool: evt.data.toolName as string,
          toolInput: (evt.data.params || {}) as Record<string, unknown>,
          toolResponse: (evt.data.result || {}) as Record<string, unknown>,
          toolUseId,
          success: (evt.data.error as string | undefined) === undefined,
          duration,
        } satisfies PostToolUseEvent
      }
      break

    case 'assistant':
      // Assistant stream contains the final response
      // This is handled in the 'stop' event
      break

    case 'error':
      return {
        ...baseEvent,
        type: 'notification',
        message: evt.data.error as string || 'Unknown error',
        notificationType: 'error',
      } satisfies NotificationEvent
  }

  return null
}

// ============================================================================
// Setup and Teardown
// ============================================================================

/**
 * Set up Vibecraft integration
 *
 * This function:
 * 1. Listens to OpenClaw agent events
 * 2. Transforms them to Vibecraft format
 * 3. Sends them to Vibecraft server
 *
 * @param userConfig - Configuration options
 * @returns Cleanup function to disable integration
 */
export function setupVibecraftIntegration(userConfig: VibecraftAdapterConfig = {}): () => void {
  config = { ...DEFAULT_CONFIG, ...userConfig }

  if (!config.enabled) {
    logDebug('Vibecraft integration disabled')
    return () => {}
  }

  logDebug('Setting up Vibecraft integration', config)

  // Subscribe to agent events
  unsubscribeAgentEvents = onAgentEvent((evt: AgentEventPayload) => {
    const vibecraftEvent = transformAgentEvent(evt)
    if (vibecraftEvent) {
      // Send to server and append to file (both async, fire-and-forget)
      sendToVibecraft(vibecraftEvent).catch(() => {})
      appendToEventsFile(vibecraftEvent).catch(() => {})
    }
  })

  logDebug('Vibecraft integration active')

  // Return cleanup function
  return () => {
    logDebug('Cleaning up Vibecraft integration')
    unsubscribeAgentEvents?.()
    unsubscribeAgentEvents = null
    toolUseStartTime.clear()
  }
}

/**
 * Alternative setup using hook system (if you want to use hooks instead)
 *
 * This registers hooks that will be called by OpenClaw's hook runner.
 * Use this if you want more fine-grained control over event timing.
 *
 * Note: This requires access to the global plugin registry. For most users,
 * `setupVibecraftIntegration()` (which uses agent events) is simpler.
 * For plugin-based integration, use `vibecraft-plugin.ts` instead.
 */
export function setupVibecraftHookIntegration(
  hookRunner: HookRunner,
  userConfig: VibecraftAdapterConfig = {}
): () => void {
  config = { ...DEFAULT_CONFIG, ...userConfig }

  if (!config.enabled) {
    logDebug('Vibecraft hook integration disabled')
    return () => {}
  }

  logDebug('Setting up Vibecraft hook integration', config)

  // Note: Actual hook registration requires access to the plugin registry.
  // This function is kept for API compatibility but delegates to the
  // event-based integration internally.
  //
  // For full hook-based integration, use the vibecraft-plugin.ts instead:
  //   import { VibecraftPlugin } from './plugins/builtin/vibecraft-plugin.js'
  //   registry.registerPlugin(VibecraftPlugin, config)

  // Fall back to event-based integration
  const cleanup = setupVibecraftIntegration(config)

  logDebug('Vibecraft hook integration using event-based backend')

  return () => {
    logDebug('Cleaning up Vibecraft hook integration')
    cleanup()
  }
}

// ============================================================================
// Direct API (for manual event sending)
// ============================================================================

/**
 * Manually send a tool use event
 */
export async function sendToolUse(
  sessionId: string,
  toolName: string,
  params: Record<string, unknown>,
  result: Record<string, unknown>,
  error?: string
): Promise<void> {
  const toolUseId = generateEventId(sessionId)
  const startTime = Date.now()

  // Pre-tool event
  const preEvent: PreToolUseEvent = {
    id: generateEventId(sessionId),
    timestamp: startTime,
    type: 'pre_tool_use',
    sessionId,
    cwd: config.cwd,
    tool: toolName,
    toolInput: params,
    toolUseId,
  }
  await sendToVibecraft(preEvent)

  // Post-tool event
  const endTime = Date.now()
  const postEvent: PostToolUseEvent = {
    id: generateEventId(sessionId),
    timestamp: endTime,
    type: 'post_tool_use',
    sessionId,
    cwd: config.cwd,
    tool: toolName,
    toolInput: params,
    toolResponse: result,
    toolUseId,
    success: error === undefined,
    duration: endTime - startTime,
  }
  await sendToVibecraft(postEvent)
}

/**
 * Manually send a user prompt event
 */
export async function sendUserPrompt(sessionId: string, prompt: string): Promise<void> {
  const event: UserPromptSubmitEvent = {
    id: generateEventId(sessionId),
    timestamp: Date.now(),
    type: 'user_prompt_submit',
    sessionId,
    cwd: config.cwd,
    prompt,
  }
  await sendToVibecraft(event)
}

/**
 * Manually send a stop/completion event
 */
export async function sendStop(sessionId: string, response?: string): Promise<void> {
  const event: StopEvent = {
    id: generateEventId(sessionId),
    timestamp: Date.now(),
    type: 'stop',
    sessionId,
    cwd: config.cwd,
    stopHookActive: false,
    response,
  }
  await sendToVibecraft(event)
}
