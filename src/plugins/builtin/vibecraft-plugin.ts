/**
 * Vibecraft Plugin for OpenClaw
 *
 * This plugin integrates OpenClaw with Vibecraft's 3D visualization system.
 * It captures agent activity and sends it to Vibecraft for real-time visualization.
 *
 * Installation:
 * 1. Add this plugin to your openclaw.json:
 *    {
 *      "plugins": [
 *        { "id": "builtin:vibecraft", "enabled": true }
 *      ]
 *    }
 *
 * 2. Configure Vibecraft settings (optional):
 *    {
 *      "plugins": [
 *        {
 *           "id": "builtin:vibecraft",
 *           "enabled": true,
 *           "config": {
 *             "serverUrl": "http://localhost:4003/event",
 *             "debug": false
 *           }
 *        }
 *      ]
 *    }
 *
 * 3. Start Vibecraft server:
 *    npx vibecraft
 *    # or from the vibecraft directory:
 *    npm run server
 *
 * 4. Run OpenClaw agent - you'll see events in the Vibecraft web UI!
 *    open http://localhost:4003
 */

import type { Plugin } from '../types.js'
import type { PluginRegistry } from '../registry.js'
import { setupVibecraftIntegration, type VibecraftAdapterConfig } from '../../infra/vibecraft-adapter.js'
import type {
  PluginHookBeforeToolCallEvent,
  PluginHookAfterToolCallEvent,
  PluginHookBeforeAgentStartEvent,
  PluginHookAgentEndEvent,
  PluginHookMessageReceivedEvent,
  PluginHookMessageSentEvent,
} from '../types.js'

// ============================================================================
// Plugin Configuration
// ============================================================================

export interface VibecraftPluginConfig {
  /** Enable/disable the plugin */
  enabled?: boolean
  /** Vibecraft server URL */
  serverUrl?: string
  /** Path to events.jsonl for persistence */
  eventsFilePath?: string
  /** Enable debug logging */
  debug?: boolean
}

const DEFAULT_CONFIG: Required<VibecraftPluginConfig> = {
  enabled: true,
  serverUrl: 'http://localhost:4003/event',
  eventsFilePath: '',
  debug: false,
}

// ============================================================================
// Plugin State
// ============================================================================`

let cleanupIntegration: (() => void) | null = null
let config = DEFAULT_CONFIG

// ============================================================================
// Hook Handlers
// ============================================================================

/**
 * Called when agent is about to start
 */
async function handleBeforeAgentStart(
  event: PluginHookBeforeAgentStartEvent,
  ctx: { agentId: string; sessionKey?: string }
): Promise<void> {
  if (!config.enabled) return

  const sessionId = ctx.sessionKey || ctx.agentId
  const vibecraftEvent = {
    id: `${sessionId}-start-${Date.now()}`,
    timestamp: Date.now(),
    type: 'session_start' as const,
    sessionId,
    cwd: process.cwd(),
    source: 'startup' as const,
  }

  await sendToVibecraft(vibecraftEvent)
  if (config.debug) {
    console.log('[vibecraft-plugin] Agent start:', sessionId)
  }
}

/**
 * Called when agent finishes
 */
async function handleAgentEnd(
  event: PluginHookAgentEndEvent,
  ctx: { agentId: string; sessionKey?: string }
): Promise<void> {
  if (!config.enabled) return

  const sessionId = ctx.sessionKey || ctx.agentId
  const vibecraftEvent = {
    id: `${sessionId}-stop-${Date.now()}`,
    timestamp: Date.now(),
    type: 'stop' as const,
    sessionId,
    cwd: process.cwd(),
    stopHookActive: false,
    response: event.result?.response as string | undefined,
  }

  await sendToVibecraft(vibecraftEvent)
  if (config.debug) {
    console.log('[vibecraft-plugin] Agent end:', sessionId)
  }
}

/**
 * Called before tool execution
 */
async function handleBeforeToolCall(
  event: PluginHookBeforeToolCallEvent,
  ctx: { toolName: string; agentId: string; sessionKey?: string; toolCallId?: string }
): Promise<void> {
  if (!config.enabled) return

  const sessionId = ctx.sessionKey || ctx.agentId
  const toolUseId = ctx.toolCallId || `${sessionId}-${Date.now()}`

  const vibecraftEvent = {
    id: `${toolUseId}-pre`,
    timestamp: Date.now(),
    type: 'pre_tool_use' as const,
    sessionId,
    cwd: process.cwd(),
    tool: ctx.toolName,
    toolInput: (event.params || {}) as Record<string, unknown>,
    toolUseId,
  }

  await sendToVibecraft(vibecraftEvent)
  if (config.debug) {
    console.log('[vibecraft-plugin] Tool call:', ctx.toolName)
  }
}

/**
 * Called after tool execution
 */
async function handleAfterToolCall(
  event: PluginHookAfterToolCallEvent,
  ctx: { toolName: string; agentId: string; sessionKey?: string; toolCallId?: string }
): Promise<void> {
  if (!config.enabled) return

  const sessionId = ctx.sessionKey || ctx.agentId
  const toolUseId = ctx.toolCallId || `${sessionId}-${Date.now()}`

  const vibecraftEvent = {
    id: `${toolUseId}-post`,
    timestamp: Date.now(),
    type: 'post_tool_use' as const,
    sessionId,
    cwd: process.cwd(),
    tool: ctx.toolName,
    toolInput: (event.params || {}) as Record<string, unknown>,
    toolResponse: (event.result || {}) as Record<string, unknown>,
    toolUseId,
    success: event.error === undefined,
  }

  await sendToVibecraft(vibecraftEvent)
  if (config.debug) {
    console.log('[vibecraft-plugin] Tool result:', ctx.toolName, event.error ? 'ERROR' : 'OK')
  }
}

/**
 * Called when user sends a message
 */
async function handleMessageReceived(
  event: PluginHookMessageReceivedEvent,
  ctx: { agentId: string; sessionKey?: string }
): Promise<void> {
  if (!config.enabled) return

  const sessionId = ctx.sessionKey || ctx.agentId

  const vibecraftEvent = {
    id: `${sessionId}-prompt-${Date.now()}`,
    timestamp: Date.now(),
    type: 'user_prompt_submit' as const,
    sessionId,
    cwd: process.cwd(),
    prompt: event.content || '',
  }

  await sendToVibecraft(vibecraftEvent)
  if (config.debug) {
    console.log('[vibecraft-plugin] User prompt:', event.content?.slice(0, 50))
  }
}

/**
 * Send event to Vibecraft server
 */
async function sendToVibecraft(event: Record<string, unknown>): Promise<void> {
  try {
    const response = await fetch(config.serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2000),
    })

    if (!response.ok && config.debug) {
      console.warn(`[vibecraft-plugin] Server responded ${response.status}`)
    }
  } catch (err) {
    // Server might not be running - silently ignore
    if (config.debug) {
      console.debug('[vibecraft-plugin] Send failed (server may not be running)')
    }
  }
}

// ============================================================================
// Plugin Definition
// ============================================================================

export const VibecraftPlugin: Plugin = {
  id: 'builtin:vibecraft',
  name: 'Vibecraft Integration',
  version: '1.0.0',
  description: 'Integrates OpenClaw with Vibecraft 3D visualization',

  async onLoad(registry: PluginRegistry, userConfig?: VibecraftPluginConfig) {
    // Merge user config with defaults
    config = { ...DEFAULT_CONFIG, ...userConfig }

    if (!config.enabled) {
      console.log('[vibecraft-plugin] Disabled')
      return
    }

    console.log('[vibecraft-plugin] Loading...')
    console.log(`[vibecraft-plugin] Server URL: ${config.serverUrl}`)

    // Register hooks
    registry.registerHook({
      pluginId: 'builtin:vibecraft',
      hookName: 'before_agent_start',
      handler: handleBeforeAgentStart,
      priority: 0,
    })

    registry.registerHook({
      pluginId: 'builtin:vibecraft',
      hookName: 'agent_end',
      handler: handleAgentEnd,
      priority: 0,
    })

    registry.registerHook({
      pluginId: 'builtin:vibecraft',
      hookName: 'before_tool_call',
      handler: handleBeforeToolCall,
      priority: 0,
    })

    registry.registerHook({
      pluginId: 'builtin:vibecraft',
      hookName: 'after_tool_call',
      handler: handleAfterToolCall,
      priority: 0,
    })

    registry.registerHook({
      pluginId: 'builtin:vibecraft',
      hookName: 'message_received',
      handler: handleMessageReceived,
      priority: 0,
    })

    // Also set up agent event listener as backup
    cleanupIntegration = setupVibecraftIntegration({
      enabled: true,
      serverUrl: config.serverUrl,
      eventsFilePath: config.eventsFilePath,
      debug: config.debug,
    })

    console.log('[vibecraft-plugin] Ready! Connect to http://localhost:4003 to see visualization')
  },

  onUnload(registry: PluginRegistry) {
    console.log('[vibecraft-plugin] Unloading...')

    // Unregister hooks
    registry.unregisterHooks('builtin:vibecraft')

    // Cleanup integration
    cleanupIntegration?.()
    cleanupIntegration = null

    console.log('[vibecraft-plugin] Unloaded')
  },
}

export default VibecraftPlugin
