/**
 * Terminal Panel Component
 * Renders Claude Code CLI stream-json output as a beautiful structured activity log.
 * Supports both a parsed "Activity" view and a raw "Raw" fallback.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Trash2,
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  FileEdit,
  Search,
  Play,
  Braces,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Settings2,
  Globe,
  Cpu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { TerminalEvent } from '@/stores/code';

interface TerminalPanelProps {
  output: string;
  events: TerminalEvent[];
  isRunning: boolean;
  onClear: () => void;
}

type ViewMode = 'activity' | 'raw';

export function TerminalPanel({ output, events, isRunning, onClear }: TerminalPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation('code');
  const [viewMode, setViewMode] = useState<ViewMode>('activity');

  // Auto-scroll to bottom when output/events change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output, events]);

  return (
    <div className="flex flex-col h-full border-t">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
          <span className="text-xs font-medium text-muted-foreground">
            {t('terminal.title')}
          </span>
          {/* View mode toggle */}
          <div className="flex items-center ml-2 rounded-md border bg-background/60 overflow-hidden">
            <button
              className={cn(
                'px-2 py-0.5 text-[10px] font-medium transition-colors',
                viewMode === 'activity'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setViewMode('activity')}
            >
              Activity
            </button>
            <button
              className={cn(
                'px-2 py-0.5 text-[10px] font-medium transition-colors',
                viewMode === 'raw'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setViewMode('raw')}
            >
              Raw
            </button>
          </div>
          {events.length > 0 && viewMode === 'activity' && (
            <span className="text-[10px] text-muted-foreground/60 ml-1">
              {events.length} events
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClear}
          disabled={!output && events.length === 0}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Content area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-[#1e1e2e] p-3 select-text"
      >
        {viewMode === 'raw' ? (
          // Raw view — original behavior
          output ? (
            <pre className="whitespace-pre-wrap break-all m-0 font-mono text-xs leading-5 text-[#cdd6f4]">{output}</pre>
          ) : (
            <span className="text-[#6c7086] italic text-xs">
              {t('terminal.empty')}
            </span>
          )
        ) : (
          // Activity view — structured events
          events.length > 0 ? (
            <div className="space-y-0.5">
              {events.map((event, i) => (
                <EventRow key={i} event={event} />
              ))}
            </div>
          ) : (
            <span className="text-[#6c7086] italic text-xs">
              {t('terminal.empty')}
            </span>
          )
        )}
        {isRunning && (
          <span className="inline-block w-2 h-4 bg-[#cdd6f4] animate-pulse ml-0.5 align-text-bottom mt-1" />
        )}
      </div>
    </div>
  );
}

// ── Event Row Rendering ─────────────────────────────────────────

function EventRow({ event }: { event: TerminalEvent }) {
  switch (event.kind) {
    case 'system':
      return <SystemEvent event={event} />;
    case 'thinking':
      return <ThinkingEvent event={event} />;
    case 'text':
      return <TextEvent event={event} />;
    case 'tool_use':
      return <ToolUseEvent event={event} />;
    case 'tool_result':
      return <ToolResultEvent event={event} />;
    case 'result':
      return <ResultEvent event={event} />;
    case 'stderr':
      return <StderrEvent event={event} />;
    default:
      return null;
  }
}

// ── System ──────────────────────────────────────────────────────

function SystemEvent({ event }: { event: Extract<TerminalEvent, { kind: 'system' }> }) {
  return (
    <div className="flex items-start gap-2 py-1 text-[#89b4fa]">
      <Settings2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <div className="text-xs">
        <span className="font-semibold">Session started</span>
        {event.model && (
          <span className="ml-2 text-[#89b4fa]/70">
            <Cpu className="h-3 w-3 inline mr-0.5" />
            {event.model}
          </span>
        )}
        {event.cwd && (
          <div className="text-[#89b4fa]/50 text-[10px] mt-0.5 font-mono">{event.cwd}</div>
        )}
      </div>
    </div>
  );
}

// ── Thinking ────────────────────────────────────────────────────

function ThinkingEvent({ event }: { event: Extract<TerminalEvent, { kind: 'thinking' }> }) {
  return (
    <div className="flex items-start gap-2 py-1 text-[#a6adc8]">
      <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-50" />
      <div className="text-xs italic opacity-70 line-clamp-2">{event.text}</div>
    </div>
  );
}

// ── Text (assistant message) ────────────────────────────────────

function TextEvent({ event }: { event: Extract<TerminalEvent, { kind: 'text' }> }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = event.text.length > 300;
  const displayText = isLong && !expanded ? event.text.slice(0, 300) + '…' : event.text;

  return (
    <div className="flex items-start gap-2 py-1 text-[#cdd6f4]">
      <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[#a6e3a1]" />
      <div className="text-xs min-w-0 flex-1">
        <pre className="whitespace-pre-wrap break-words m-0 font-sans leading-relaxed">{displayText}</pre>
        {isLong && (
          <button
            className="text-[10px] text-[#89b4fa] hover:underline mt-0.5"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tool Use ────────────────────────────────────────────────────

/** Map tool names to icons and display labels */
function getToolInfo(tool: string): { icon: React.ReactNode; label: string; color: string } {
  const name = tool.toLowerCase();
  if (name.includes('read') || name === 'view')
    return { icon: <FileText className="h-3.5 w-3.5" />, label: tool, color: 'text-[#89b4fa]' };
  if (name.includes('edit') || name.includes('write') || name === 'replace')
    return { icon: <FileEdit className="h-3.5 w-3.5" />, label: tool, color: 'text-[#f9e2af]' };
  if (name.includes('bash') || name.includes('execute') || name.includes('run'))
    return { icon: <Play className="h-3.5 w-3.5" />, label: tool, color: 'text-[#a6e3a1]' };
  if (name.includes('search') || name.includes('grep') || name.includes('glob') || name.includes('find'))
    return { icon: <Search className="h-3.5 w-3.5" />, label: tool, color: 'text-[#cba6f7]' };
  if (name.includes('web') || name.includes('fetch') || name.includes('url'))
    return { icon: <Globe className="h-3.5 w-3.5" />, label: tool, color: 'text-[#74c7ec]' };
  if (name.includes('list') || name === 'ls')
    return { icon: <Terminal className="h-3.5 w-3.5" />, label: tool, color: 'text-[#94e2d5]' };
  return { icon: <Braces className="h-3.5 w-3.5" />, label: tool, color: 'text-[#fab387]' };
}

/** Extract a short description from tool input */
function getToolDetail(_tool: string, input: Record<string, unknown>): string {
  // File-related tools
  if (input.file_path) return String(input.file_path);
  if (input.path) return String(input.path);
  // Bash/command tools
  if (input.command) {
    const cmd = String(input.command);
    return cmd.length > 80 ? cmd.slice(0, 77) + '…' : cmd;
  }
  // Search tools
  if (input.pattern) return `pattern: ${String(input.pattern)}`;
  if (input.query) return `"${String(input.query)}"`;
  // Glob
  if (input.glob) return String(input.glob);
  return '';
}

function ToolUseEvent({ event }: { event: Extract<TerminalEvent, { kind: 'tool_use' }> }) {
  const [expanded, setExpanded] = useState(false);
  const { icon, label, color } = getToolInfo(event.tool);
  const detail = getToolDetail(event.tool, event.input);
  const hasInput = Object.keys(event.input).length > 0;

  const toggle = useCallback(() => setExpanded((e) => !e), []);

  return (
    <div className="py-0.5">
      <div
        className={cn('flex items-center gap-1.5 py-0.5 cursor-pointer group', color)}
        onClick={toggle}
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
          : <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
        }
        <span className="shrink-0">{icon}</span>
        <span className="text-xs font-semibold">{label}</span>
        {detail && (
          <span className="text-xs opacity-60 truncate font-mono">{detail}</span>
        )}
      </div>
      {expanded && hasInput && (
        <div className="ml-7 mt-0.5 mb-1 rounded bg-[#313244] px-2 py-1.5 overflow-auto max-h-48">
          <pre className="text-[10px] leading-4 text-[#a6adc8] m-0 whitespace-pre-wrap break-all font-mono">
            {JSON.stringify(event.input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Tool Result ─────────────────────────────────────────────────

function ToolResultEvent({ event }: { event: Extract<TerminalEvent, { kind: 'tool_result' }> }) {
  const [expanded, setExpanded] = useState(false);
  const isError = event.isError;
  const hasOutput = event.output.trim().length > 0;
  const isLong = event.output.length > 200;
  const preview = event.output.length > 120 ? event.output.slice(0, 117) + '…' : event.output;

  const toggle = useCallback(() => setExpanded((e) => !e), []);

  return (
    <div className="py-0.5">
      <div
        className={cn(
          'flex items-center gap-1.5 py-0.5',
          hasOutput && 'cursor-pointer group',
          isError ? 'text-[#f38ba8]' : 'text-[#a6e3a1]',
        )}
        onClick={hasOutput ? toggle : undefined}
      >
        {hasOutput
          ? expanded
            ? <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
            : <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
          : <span className="w-3" />
        }
        {isError
          ? <XCircle className="h-3.5 w-3.5 shrink-0" />
          : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        }
        <span className="text-xs font-medium">{isError ? 'Error' : 'Done'}</span>
        {!expanded && hasOutput && !isLong && (
          <span className="text-[10px] opacity-50 truncate font-mono ml-1">{preview}</span>
        )}
      </div>
      {expanded && hasOutput && (
        <div className={cn(
          'ml-7 mt-0.5 mb-1 rounded px-2 py-1.5 overflow-auto max-h-64',
          isError ? 'bg-[#f38ba8]/10' : 'bg-[#313244]',
        )}>
          <pre className={cn(
            'text-[10px] leading-4 m-0 whitespace-pre-wrap break-all font-mono',
            isError ? 'text-[#f38ba8]' : 'text-[#a6adc8]',
          )}>
            {event.output}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Result (final) ──────────────────────────────────────────────

function ResultEvent({ event }: { event: Extract<TerminalEvent, { kind: 'result' }> }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = event.text.length > 300;
  const displayText = isLong && !expanded ? event.text.slice(0, 300) + '…' : event.text;

  return (
    <div className="flex items-start gap-2 py-1.5 mt-1 border-t border-[#313244]">
      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[#a6e3a1]" />
      <div className="text-xs text-[#cdd6f4] min-w-0 flex-1">
        <div className="font-semibold text-[#a6e3a1] mb-1">Result</div>
        <pre className="whitespace-pre-wrap break-words m-0 font-sans leading-relaxed">{displayText}</pre>
        {isLong && (
          <button
            className="text-[10px] text-[#89b4fa] hover:underline mt-0.5"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Stderr ──────────────────────────────────────────────────────

function StderrEvent({ event }: { event: Extract<TerminalEvent, { kind: 'stderr' }> }) {
  return (
    <div className="flex items-start gap-2 py-0.5 text-[#f38ba8]">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <pre className="text-[10px] leading-4 m-0 whitespace-pre-wrap break-all font-mono opacity-80">
        {event.text}
      </pre>
    </div>
  );
}
