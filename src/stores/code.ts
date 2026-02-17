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

interface CodeState {
  // Working directory
  workingDirectory: string;

  // Messages (chat-style)
  messages: CodeMessage[];

  // Terminal output (raw CLI output)
  terminalOutput: string;

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
      case 'stdout':
      case 'stderr':
        set((s) => ({
          terminalOutput: s.terminalOutput + (chunk.data || ''),
        }));
        break;

      case 'exit': {
        const { terminalOutput, messages } = get();
        // Try to extract a summary from the output for the chat message
        let summary = '';
        // Try parsing stream-json output for result text
        const lines = terminalOutput.split('\n');
        const resultLines: string[] = [];
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          try {
            const parsed = JSON.parse(trimmedLine);
            if (parsed.type === 'result' && parsed.result) {
              resultLines.push(parsed.result);
            } else if (parsed.type === 'assistant' && parsed.message?.content) {
              const content = parsed.message.content;
              if (typeof content === 'string') {
                resultLines.push(content);
              } else if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text' && block.text) {
                    resultLines.push(block.text);
                  }
                }
              }
            }
          } catch {
            // Not JSON, skip
          }
        }
        summary = resultLines.join('\n').trim();
        if (!summary) {
          // Fallback: use last 500 chars of terminal output
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

  clearTerminal: () => set({ terminalOutput: '' }),

  clearMessages: () => set({ messages: [], terminalOutput: '' }),

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
