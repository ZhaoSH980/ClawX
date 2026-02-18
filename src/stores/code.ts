/**
 * Code Mode Store
 * Manages Claude Code CLI execution state, messages, and terminal output.
 */
import { create } from 'zustand';
import { useSettingsStore } from './settings';

// ── Types ────────────────────────────────────────────────────────

export interface CodeMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface CodeOutputChunk {
  type: 'stdout' | 'stderr' | 'exit' | 'error';
  data?: string;
  code?: number | null;
  signal?: string | null;
  pid?: number;
}

/**
 * A parsed terminal event from Claude Code's stream-json output.
 * Used to render a beautiful, structured activity log in the UI.
 */
export type TerminalEvent =
  | { kind: 'system'; sessionId?: string; cwd?: string; tools?: string[]; model?: string; timestamp: number }
  | { kind: 'thinking'; text: string; timestamp: number }
  | { kind: 'text'; text: string; timestamp: number }
  | { kind: 'tool_use'; id: string; tool: string; input: Record<string, unknown>; timestamp: number }
  | { kind: 'tool_result'; id: string; output: string; isError?: boolean; timestamp: number }
  | { kind: 'result'; text: string; timestamp: number }
  | { kind: 'stderr'; text: string; timestamp: number };

interface CodeState {
  // Working directory
  workingDirectory: string;

  // Messages (chat-style)
  messages: CodeMessage[];

  // Terminal output (raw CLI output)
  terminalOutput: string;

  // Parsed terminal events (structured activity log)
  terminalEvents: TerminalEvent[];

  // Execution state
  isRunning: boolean;
  activePid: number | null;
  error: string | null;

  // Claude Code CLI status
  cliInstalled: boolean | null;
  cliVersion: string | null;

  // Telegram bridge
  telegramEnabled: boolean;
  telegramConnecting: boolean;

  // Claude Code session (conversation continuity)
  sessionId: string | null;

  // Actions
  setWorkingDirectory: (dir: string) => void;
  checkCliStatus: () => Promise<void>;
  executeCommand: (prompt: string) => Promise<void>;
  abortCommand: () => Promise<void>;
  handleOutput: (chunk: CodeOutputChunk) => void;
  clearTerminal: () => void;
  clearMessages: () => void;
  clearError: () => void;
  selectDirectory: () => Promise<void>;
  enableTelegram: (botToken: string, chatId: string) => Promise<{ success: boolean; error?: string }>;
  disableTelegram: () => Promise<void>;
  checkTelegramStatus: () => Promise<void>;
  fetchSessionId: () => Promise<void>;
  resetSession: () => Promise<void>;
}

// ── Store ────────────────────────────────────────────────────────

export const useCodeStore = create<CodeState>((set, get) => ({
  workingDirectory: '',
  messages: [],
  terminalOutput: '',
  terminalEvents: [],
  isRunning: false,
  activePid: null,
  error: null,
  cliInstalled: null,
  cliVersion: null,
  telegramEnabled: false,
  telegramConnecting: false,
  sessionId: null,

  setWorkingDirectory: (dir: string) => {
    set({ workingDirectory: dir });
    // Persist to zustand settings store
    useSettingsStore.getState().setCodeWorkingDirectory(dir);
  },

  checkCliStatus: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('code:status') as {
        installed: boolean;
        version?: string;
      };
      set({ cliInstalled: result.installed, cliVersion: result.version || null });
    } catch {
      set({ cliInstalled: false, cliVersion: null });
    }
  },

  executeCommand: async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    const { workingDirectory, isRunning } = get();
    if (isRunning) {
      set({ error: 'A command is already running' });
      return;
    }

    // Add user message
    const userMsg: CodeMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    set((s) => ({
      messages: [...s.messages, userMsg],
      isRunning: true,
      error: null,
      terminalOutput: '',
      terminalEvents: [],
    }));

    try {
      const result = await window.electron.ipcRenderer.invoke(
        'code:execute',
        trimmed,
        { cwd: workingDirectory || undefined, maxTurns: 50 },
      ) as { success: boolean; pid?: number; error?: string };

      if (!result.success) {
        set({ error: result.error || 'Failed to execute', isRunning: false });
      } else {
        set({ activePid: result.pid || null });
      }
    } catch (err) {
      set({ error: String(err), isRunning: false });
    }
  },

  abortCommand: async () => {
    try {
      await window.electron.ipcRenderer.invoke('code:abort');
    } catch { /* ignore */ }
    set({ isRunning: false, activePid: null });
  },

  handleOutput: (chunk: CodeOutputChunk) => {
    switch (chunk.type) {
      case 'stdout': {
        const rawData = chunk.data || '';
        set((s) => ({
          terminalOutput: s.terminalOutput + rawData,
        }));

        // Parse stream-json lines into structured events
        const newEvents: TerminalEvent[] = [];
        for (const line of rawData.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const evt = parseStreamJsonEvent(parsed);
            if (evt) newEvents.push(evt);
          } catch {
            // Not JSON — skip
          }
        }
        if (newEvents.length > 0) {
          set((s) => ({
            terminalEvents: [...s.terminalEvents, ...newEvents],
          }));
        }
        break;
      }

      case 'stderr':
        set((s) => ({
          terminalOutput: s.terminalOutput + (chunk.data || ''),
          terminalEvents: chunk.data?.trim()
            ? [...s.terminalEvents, { kind: 'stderr' as const, text: chunk.data.trim(), timestamp: Date.now() }]
            : s.terminalEvents,
        }));
        break;

      case 'exit': {
        const { terminalEvents, messages } = get();
        // Build summary from parsed events (prefer result events, fall back to text)
        const resultParts: string[] = [];
        const textParts: string[] = [];
        for (const ev of terminalEvents) {
          if (ev.kind === 'result') resultParts.push(ev.text);
          else if (ev.kind === 'text') textParts.push(ev.text);
        }
        let summary = (resultParts.length > 0 ? resultParts : textParts).join('\n').trim();
        if (!summary) {
          const { terminalOutput } = get();
          summary = terminalOutput.length > 500
            ? `...${terminalOutput.slice(-500)}`
            : terminalOutput;
        }

        const exitCode = chunk.code ?? 0;
        const assistantMsg: CodeMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: summary || (exitCode === 0 ? 'Done.' : `Process exited with code ${exitCode}`),
          timestamp: Date.now(),
        };

        set({
          messages: [...messages, assistantMsg],
          isRunning: false,
          activePid: null,
        });
        break;
      }

      case 'error':
        set({
          error: chunk.data || 'Unknown error',
          isRunning: false,
          activePid: null,
        });
        break;
    }
  },

  clearTerminal: () => set({ terminalOutput: '', terminalEvents: [] }),

  clearMessages: () => set({ messages: [], terminalOutput: '', terminalEvents: [] }),

  clearError: () => set({ error: null }),

  selectDirectory: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('code:selectDirectory') as {
        canceled: boolean;
        path?: string;
      };
      if (!result.canceled && result.path) {
        get().setWorkingDirectory(result.path);
      }
    } catch (err) {
      set({ error: String(err) });
    }
  },

  enableTelegram: async (botToken: string, chatId: string) => {
    set({ telegramConnecting: true, error: null });
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'code:enableTelegram',
        botToken,
        chatId,
        { cwd: get().workingDirectory || undefined },
      ) as { success: boolean; error?: string; botName?: string };

      if (result.success) {
        set({ telegramEnabled: true, telegramConnecting: false });
        useSettingsStore.getState().setCodeTelegramBotToken(botToken);
        useSettingsStore.getState().setCodeTelegramChatId(chatId);
      } else {
        set({ telegramConnecting: false, error: result.error || 'Failed to enable Telegram' });
      }
      return result;
    } catch (err) {
      set({ telegramConnecting: false, error: String(err) });
      return { success: false, error: String(err) };
    }
  },

  disableTelegram: async () => {
    try {
      await window.electron.ipcRenderer.invoke('code:disableTelegram');
    } catch { /* ignore */ }
    set({ telegramEnabled: false });
  },

  checkTelegramStatus: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('code:telegramStatus') as {
        enabled: boolean;
      };
      set({ telegramEnabled: result.enabled });

      // Auto-reconnect: if bridge is not enabled but we have saved token + chat ID, connect (once)
      if (!result.enabled) {
        const settings = useSettingsStore.getState();
        const savedToken = settings.codeTelegramBotToken;
        const savedChatId = settings.codeTelegramChatId;
        if (savedToken?.trim() && savedChatId?.trim() && !get().telegramConnecting) {
          set({ telegramConnecting: true });
          await get().enableTelegram(savedToken.trim(), savedChatId.trim());
        }
      }
    } catch {
      set({ telegramEnabled: false });
    }
  },

  fetchSessionId: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('code:getSessionId') as {
        sessionId: string | null;
      };
      set({ sessionId: result.sessionId || null });
    } catch {
      // ignore
    }
  },

  resetSession: async () => {
    try {
      await window.electron.ipcRenderer.invoke('code:resetSession');
      set({ sessionId: null });
    } catch {
      // ignore
    }
  },
}));

// ── Stream-JSON Parser ──────────────────────────────────────────

/**
 * Parse a single stream-json object from Claude Code CLI into a TerminalEvent.
 * Returns null for unrecognised or uninteresting events.
 *
 * Known event shapes:
 *   { type: "system", session_id, cwd, tools, model, ... }
 *   { type: "assistant", message: { content: string | ContentBlock[] } }
 *   { type: "content_block_start", content_block: { type, ... } }
 *   { type: "content_block_delta", delta: { type, text?, ... } }
 *   { type: "tool_use",  tool: "...", input: {...}, id: "..." }   (aggregated by Claude CLI)
 *   { type: "tool_result", tool_use_id: "...", content: "...", is_error?: boolean }
 *   { type: "result", result: "...", ... }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseStreamJsonEvent(raw: any): TerminalEvent | null {
  const now = Date.now();
  const type = raw?.type;

  switch (type) {
    case 'system':
      return {
        kind: 'system',
        sessionId: raw.session_id,
        cwd: raw.cwd,
        tools: raw.tools,
        model: raw.model,
        timestamp: now,
      };

    case 'assistant': {
      const content = raw.message?.content;
      const events: TerminalEvent[] = [];
      if (typeof content === 'string' && content.trim()) {
        return { kind: 'text', text: content, timestamp: now };
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text?.trim()) {
            events.push({ kind: 'text', text: block.text, timestamp: now });
          } else if (block.type === 'tool_use') {
            events.push({
              kind: 'tool_use',
              id: block.id || '',
              tool: block.name || 'unknown',
              input: block.input || {},
              timestamp: now,
            });
          }
        }
        // Return only the first event; others will be emitted as separate assistant blocks.
        // In practice, Claude CLI usually emits one content block per assistant message.
        return events[0] || null;
      }
      return null;
    }

    case 'tool_use':
      return {
        kind: 'tool_use',
        id: raw.id || raw.tool_use_id || '',
        tool: raw.tool || raw.name || 'unknown',
        input: raw.input || {},
        timestamp: now,
      };

    case 'tool_result':
      return {
        kind: 'tool_result',
        id: raw.tool_use_id || raw.id || '',
        output: typeof raw.content === 'string'
          ? raw.content
          : JSON.stringify(raw.content || raw.output || ''),
        isError: raw.is_error === true,
        timestamp: now,
      };

    case 'result':
      if (raw.result && typeof raw.result === 'string') {
        return { kind: 'result', text: raw.result, timestamp: now };
      }
      return null;

    default:
      return null;
  }
}
