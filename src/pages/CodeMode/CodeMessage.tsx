/**
 * Code Message Component
 * Renders a single message bubble in the Code Mode chat area.
 */
import { cn } from '@/lib/utils';
import type { CodeMessage as CodeMessageType } from '@/stores/code';

interface CodeMessageProps {
  message: CodeMessageType;
}

export function CodeMessage({ message }: CodeMessageProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div
      className={cn(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground'
            : isSystem
              ? 'bg-muted/50 text-muted-foreground italic'
              : 'bg-muted text-foreground',
        )}
      >
        <pre className="whitespace-pre-wrap break-words font-sans m-0">
          {message.content}
        </pre>
        <div
          className={cn(
            'text-[10px] mt-1 opacity-60',
            isUser ? 'text-right' : 'text-left',
          )}
        >
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
