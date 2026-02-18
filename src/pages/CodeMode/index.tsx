/**
 * Code Mode Page
 * Hybrid interface: chat-style interaction + real-time terminal output panel.
 * Uses Claude Code CLI via IPC for code execution.
 */
import { useEffect, useRef, useState } from 'react';
import { Send, Square, Terminal, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCodeStore, type CodeOutputChunk } from '@/stores/code';
import { useSettingsStore } from '@/stores/settings';
import { CodeMessage } from './CodeMessage';
import { TerminalPanel } from './TerminalPanel';
import { CodeToolbar } from './CodeToolbar';
import { useTranslation } from 'react-i18next';

export function CodeMode() {
  const messages = useCodeStore((s) => s.messages);
  const terminalOutput = useCodeStore((s) => s.terminalOutput);
  const terminalEvents = useCodeStore((s) => s.terminalEvents);
  const isRunning = useCodeStore((s) => s.isRunning);
  const error = useCodeStore((s) => s.error);
  const cliInstalled = useCodeStore((s) => s.cliInstalled);
  const workingDirectory = useCodeStore((s) => s.workingDirectory);
  const executeCommand = useCodeStore((s) => s.executeCommand);
  const abortCommand = useCodeStore((s) => s.abortCommand);
  const handleOutput = useCodeStore((s) => s.handleOutput);
  const checkCliStatus = useCodeStore((s) => s.checkCliStatus);
  const clearTerminal = useCodeStore((s) => s.clearTerminal);
  const clearError = useCodeStore((s) => s.clearError);
  const setWorkingDirectory = useCodeStore((s) => s.setWorkingDirectory);
  const checkTelegramStatus = useCodeStore((s) => s.checkTelegramStatus);
  const fetchSessionId = useCodeStore((s) => s.fetchSessionId);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useTranslation('code');

  // Check CLI status, Telegram status, session ID, and load saved working directory on mount
  useEffect(() => {
    checkCliStatus();
    checkTelegramStatus();
    fetchSessionId();
    // Load persisted working directory from settings store
    const savedDir = useSettingsStore.getState().codeWorkingDirectory;
    if (savedDir) {
      setWorkingDirectory(savedDir);
    }
  }, [checkCliStatus, checkTelegramStatus, fetchSessionId, setWorkingDirectory]);

  // Listen for session ID updates from main process
  useEffect(() => {
    const unsub = window.electron.ipcRenderer.on(
      'code:session-id',
      (sid: unknown) => {
        if (typeof sid === 'string') {
          useCodeStore.getState().fetchSessionId();
        }
      },
    );
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  // Listen for Claude Code output events
  useEffect(() => {
    const unsub = window.electron.ipcRenderer.on(
      'code:output',
      (chunk: unknown) => {
        handleOutput(chunk as CodeOutputChunk);
      },
    );
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [handleOutput]);

  // Listen for Telegram /code commands (forwarded from main process)
  useEffect(() => {
    const unsub = window.electron.ipcRenderer.on(
      'code:telegram-command',
      (command: unknown) => {
        if (typeof command === 'string' && command.trim()) {
          // Add user message from Telegram to the UI and set running state
          const msg = {
            id: crypto.randomUUID(),
            role: 'user' as const,
            content: `[Telegram] ${command}`,
            timestamp: Date.now(),
          };
          useCodeStore.setState((s) => ({
            messages: [...s.messages, msg],
            isRunning: true,
            error: null,
            terminalOutput: '',
          }));
        }
      },
    );
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isRunning) return;
    setInput('');
    executeCommand(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = input.trim().length > 0 && !isRunning && cliInstalled === true;

  return (
    <div className="flex flex-col -m-6" style={{ height: 'calc(100vh - 2.5rem)' }}>
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-end px-4 py-2">
        <CodeToolbar />
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive text-sm border-b">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearError}>
            {t('dismiss')}
          </Button>
        </div>
      )}

      {/* CLI not installed warning */}
      {cliInstalled === false && (
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm border-b">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">{t('cliNotInstalled.title')}</p>
            <p className="text-xs mt-0.5 opacity-80">{t('cliNotInstalled.description')}</p>
          </div>
        </div>
      )}

      {/* Chat area + Terminal split */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Chat messages area */}
        <div className="flex-1 min-h-0 overflow-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Terminal className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h2 className="text-lg font-semibold text-foreground mb-1">
                {t('welcome.title')}
              </h2>
              <p className="text-sm text-muted-foreground max-w-md">
                {t('welcome.subtitle')}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-w-3xl mx-auto">
              {messages.map((msg) => (
                <CodeMessage key={msg.id} message={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Terminal panel (collapsible, takes ~40% when visible) */}
        {(terminalOutput || isRunning) && (
          <div className="h-[40%] min-h-[150px] max-h-[50%]">
            <TerminalPanel
              output={terminalOutput}
              events={terminalEvents}
              isRunning={isRunning}
              onClear={clearTerminal}
            />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t px-4 py-3">
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              cliInstalled === false
                ? t('input.notInstalled')
                : !workingDirectory
                  ? t('input.selectDirFirst')
                  : t('input.placeholder')
            }
            disabled={isRunning || cliInstalled === false}
            className="min-h-[44px] max-h-[160px] resize-none"
            rows={1}
          />
          {isRunning ? (
            <Button
              variant="destructive"
              size="icon"
              className="h-[44px] w-[44px] shrink-0"
              onClick={abortCommand}
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-[44px] w-[44px] shrink-0"
              onClick={handleSend}
              disabled={!canSend}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-1.5">
          {t('input.hint')}
        </p>
      </div>
    </div>
  );
}
