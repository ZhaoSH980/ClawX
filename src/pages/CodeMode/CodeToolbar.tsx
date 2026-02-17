/**
 * Code Toolbar Component
 * Working directory selector, CLI status indicator, Telegram bridge toggle, and clear button.
 */
import { useState } from 'react';
import {
  FolderOpen,
  CheckCircle,
  XCircle,
  Loader2,
  Trash2,
  Send as SendIcon,
  Unplug,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useCodeStore } from '@/stores/code';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export function CodeToolbar() {
  const workingDirectory = useCodeStore((s) => s.workingDirectory);
  const cliInstalled = useCodeStore((s) => s.cliInstalled);
  const cliVersion = useCodeStore((s) => s.cliVersion);
  const selectDirectory = useCodeStore((s) => s.selectDirectory);
  const clearMessages = useCodeStore((s) => s.clearMessages);
  const messages = useCodeStore((s) => s.messages);
  const telegramEnabled = useCodeStore((s) => s.telegramEnabled);
  const telegramConnecting = useCodeStore((s) => s.telegramConnecting);
  const enableTelegram = useCodeStore((s) => s.enableTelegram);
  const disableTelegram = useCodeStore((s) => s.disableTelegram);
  const sessionId = useCodeStore((s) => s.sessionId);
  const resetSession = useCodeStore((s) => s.resetSession);

  const savedBotToken = useSettingsStore((s) => s.codeTelegramBotToken);
  const savedChatId = useSettingsStore((s) => s.codeTelegramChatId);
  const [botTokenInput, setBotTokenInput] = useState(savedBotToken || '');
  const [chatIdInput, setChatIdInput] = useState(savedChatId || '');
  const [tgPopoverOpen, setTgPopoverOpen] = useState(false);

  const { t } = useTranslation('code');

  const handleTelegramConnect = async () => {
    const trimmedToken = botTokenInput.trim();
    const trimmedChatId = chatIdInput.trim();
    if (!trimmedToken || !trimmedChatId) return;
    const result = await enableTelegram(trimmedToken, trimmedChatId);
    if (result.success) {
      setTgPopoverOpen(false);
    }
  };

  const handleTelegramDisconnect = async () => {
    await disableTelegram();
  };

  return (
    <div className="flex items-center gap-2">
      {/* CLI Status */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {cliInstalled === null ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : cliInstalled ? (
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-destructive" />
            )}
            <span className="hidden sm:inline">Claude Code</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {cliInstalled === null
            ? t('toolbar.checking')
            : cliInstalled
              ? `Claude Code ${cliVersion || ''}`
              : t('toolbar.notInstalled')}
        </TooltipContent>
      </Tooltip>

      {/* Directory Selector */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 max-w-[220px] text-xs gap-1.5"
            onClick={() => selectDirectory()}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {workingDirectory || t('toolbar.selectDir')}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{workingDirectory || t('toolbar.selectDir')}</p>
        </TooltipContent>
      </Tooltip>

      {/* Telegram Bridge Toggle */}
      {telegramEnabled ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 border-blue-500/50 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
              onClick={handleTelegramDisconnect}
            >
              <SendIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Telegram</span>
              <Unplug className="h-3 w-3 opacity-60" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('toolbar.tgDisconnect')}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <Popover open={tgPopoverOpen} onOpenChange={setTgPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'h-8 text-xs gap-1.5',
                telegramConnecting && 'opacity-70',
              )}
              disabled={telegramConnecting}
              title={t('toolbar.tgConnect')}
            >
              {telegramConnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SendIcon className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">Telegram</span>
            </Button>
          </PopoverTrigger>

          <PopoverContent className="w-80" align="end">
            <div className="space-y-3">
              <div>
                <h4 className="font-medium text-sm mb-1">{t('toolbar.tgTitle')}</h4>
                <p className="text-xs text-muted-foreground">
                  {t('toolbar.tgDescription')}
                </p>
              </div>
              <div className="space-y-2">
                <Input
                  placeholder={t('toolbar.tgBotTokenPlaceholder')}
                  value={botTokenInput}
                  onChange={(e) => setBotTokenInput(e.target.value)}
                  type="password"
                  className="text-sm font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  {t('toolbar.tgBotTokenHint')}
                </p>
              </div>
              <div className="space-y-2">
                <Input
                  placeholder={t('toolbar.tgChatIdPlaceholder')}
                  value={chatIdInput}
                  onChange={(e) => setChatIdInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTelegramConnect();
                  }}
                  className="text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                  {t('toolbar.tgHint')}
                </p>
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={handleTelegramConnect}
                disabled={!botTokenInput.trim() || !chatIdInput.trim() || telegramConnecting}
              >
                {telegramConnecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <SendIcon className="h-3.5 w-3.5 mr-1.5" />
                )}
                {t('toolbar.tgConnectBtn')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* New Session (reset Claude Code conversation context) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8',
              sessionId
                ? 'text-blue-500 hover:text-blue-600'
                : 'text-muted-foreground',
            )}
            onClick={async () => {
              if (sessionId && confirm(t('toolbar.resetSessionConfirm'))) {
                await resetSession();
                clearMessages();
              }
            }}
            disabled={!sessionId}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {sessionId
              ? t('toolbar.resetSession')
              : t('toolbar.noSession')}
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Clear Messages */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-8 w-8 text-muted-foreground hover:text-destructive')}
            disabled={messages.length === 0}
            onClick={() => {
              if (confirm(t('toolbar.clearConfirm'))) {
                clearMessages();
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.clear')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
