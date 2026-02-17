/**
 * Terminal Panel Component
 * Displays raw Claude Code CLI output with auto-scroll and monospace font.
 */
import { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

interface TerminalPanelProps {
  output: string;
  isRunning: boolean;
  onClear: () => void;
}

export function TerminalPanel({ output, isRunning, onClear }: TerminalPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation('code');

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div className="flex flex-col h-full border-t">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
          <span className="text-xs font-medium text-muted-foreground">
            {t('terminal.title')}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClear}
          disabled={!output}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Terminal output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-[#1e1e2e] p-3 font-mono text-xs leading-5 text-[#cdd6f4] select-text"
      >
        {output ? (
          <pre className="whitespace-pre-wrap break-all m-0">{output}</pre>
        ) : (
          <span className="text-[#6c7086] italic">
            {t('terminal.empty')}
          </span>
        )}
        {isRunning && (
          <span className="inline-block w-2 h-4 bg-[#cdd6f4] animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
    </div>
  );
}
