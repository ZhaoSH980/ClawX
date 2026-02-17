/**
 * MiniMax Orchestrator
 * Calls MiniMax M2.5 API to interpret user intent and generate Claude Code commands.
 * Maintains conversation history for multi-turn orchestration.
 */
import { getApiKey } from './secure-storage';
import { getProviderConfig } from './provider-registry';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OrchestratorResult {
  /** MiniMax's full reply text (sent to Telegram) */
  reply: string;
  /** Extracted Claude Code command, if any */
  command: string | null;
}

const SYSTEM_PROMPT = `你是一个代码任务编排器。用户会用自然语言描述他们的需求，你需要：

1. 理解用户的意图
2. 如果需要执行代码操作（查看文件、修改代码、运行命令等），用以下格式输出要执行的 Claude Code 命令：
   [EXECUTE]具体的自然语言指令，描述你想让 Claude Code 做什么[/EXECUTE]
3. 如果是简单的问题或不需要代码操作，直接回答即可，不需要 [EXECUTE] 标签
4. 每次回复中最多包含一个 [EXECUTE] 块
5. 你可以在 [EXECUTE] 块前后加上你的分析和说明
6. 当收到 Claude Code 的执行结果后，分析结果并决定是否需要继续执行更多操作

注意：[EXECUTE] 中的内容会被传给 Claude Code CLI（一个能理解自然语言的编程 AI），所以用自然语言描述即可，不需要写具体的 shell 命令。`;

/** Maximum conversation history entries to keep (system prompt excluded). */
const MAX_HISTORY = 30;

export class MinimaxOrchestrator {
  private messages: ChatMessage[] = [];
  private apiKey: string | null = null;
  private baseUrl: string = 'https://api.minimaxi.com/v1';
  private model: string = 'MiniMax-M2.5';

  /**
   * Initialise the orchestrator: load API key and provider config.
   * Returns false if MiniMax API key is not configured.
   */
  async init(): Promise<{ success: boolean; error?: string }> {
    // Try to get key by provider ID first, fall back to type name
    this.apiKey = await getApiKey('minimax');
    if (!this.apiKey) {
      // Scan all stored keys — user may have saved with a custom provider ID
      // but the type is 'minimax'. For now, just report not configured.
      return {
        success: false,
        error: 'MiniMax API key not configured. Please add MiniMax provider in Settings → Providers.',
      };
    }

    const cfg = getProviderConfig('minimax');
    if (cfg?.baseUrl) {
      this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    }

    return { success: true };
  }

  /**
   * Send a user message to MiniMax and get a structured response.
   */
  async chat(userMessage: string): Promise<OrchestratorResult> {
    if (!this.apiKey) {
      return { reply: 'MiniMax API key not configured.', command: null };
    }

    this.messages.push({ role: 'user', content: userMessage });
    this.trimHistory();

    const requestMessages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...this.messages,
    ];

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: requestMessages,
          max_tokens: 4096,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const errMsg = `MiniMax API error ${res.status}: ${errBody}`;
        console.warn('[MinimaxOrchestrator]', errMsg);
        return { reply: errMsg, command: null };
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const reply = data.choices?.[0]?.message?.content?.trim() || '';
      if (!reply) {
        return { reply: '(MiniMax returned empty response)', command: null };
      }

      // Store assistant reply in history
      this.messages.push({ role: 'assistant', content: reply });
      this.trimHistory();

      // Extract [EXECUTE]...[/EXECUTE] command
      const command = extractCommand(reply);

      return { reply, command };
    } catch (err) {
      const errMsg = `MiniMax request failed: ${err instanceof Error ? err.message : String(err)}`;
      console.warn('[MinimaxOrchestrator]', errMsg);
      return { reply: errMsg, command: null };
    }
  }

  /**
   * Inject a Claude Code execution result into the conversation history
   * so MiniMax can reason about it on the next turn.
   */
  addCodeResult(result: string): void {
    this.messages.push({
      role: 'user',
      content: `[Claude Code 执行结果]\n${result}`,
    });
    this.trimHistory();
  }

  /** Clear conversation history. */
  clearHistory(): void {
    this.messages = [];
  }

  private trimHistory(): void {
    if (this.messages.length > MAX_HISTORY) {
      this.messages = this.messages.slice(-MAX_HISTORY);
    }
  }
}

/**
 * Extract the first [EXECUTE]...[/EXECUTE] block from text.
 * Returns null if no block found.
 */
function extractCommand(text: string): string | null {
  const match = text.match(/\[EXECUTE\]([\s\S]*?)\[\/EXECUTE\]/i);
  if (!match) return null;
  const cmd = match[1].trim();
  return cmd || null;
}
