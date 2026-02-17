/**
 * Telegram Code Bridge
 * Sends Code Mode messages (user commands + Claude responses) to a Telegram group.
 * Polls for incoming messages:
 *   - /code prefix → direct Claude Code execution (onCommand)
 *   - plain messages → MiniMax orchestration (onChat)
 */
// Telegram Bot API base URL
const TG_API = 'https://api.telegram.org/bot';

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  from?: { id: number; first_name?: string; username?: string };
  text?: string;
  date: number;
}

interface TelegramSendResult {
  ok: boolean;
  result?: TelegramMessage;
  description?: string;
}

interface TelegramUpdatesResult {
  ok: boolean;
  result?: Array<{
    update_id: number;
    message?: TelegramMessage;
  }>;
}

export class TelegramCodeBridge {
  private botToken: string | null = null;
  private chatId: string | null = null;
  private botUserId: number | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastUpdateId = 0;
  private enabled = false;
  private onCommand: ((text: string) => void) | null = null;
  private onChat: ((text: string) => void) | null = null;

  /**
   * Initialize the bridge with a dedicated bot token and target chat/group ID.
   * Uses a separate bot token from Gateway to avoid getUpdates conflicts.
   */
  async init(botToken: string, chatId: string): Promise<{ success: boolean; error?: string; botName?: string }> {
    if (!botToken) {
      return {
        success: false,
        error: 'Code Mode bot token is required. Please create a dedicated bot via @BotFather.',
      };
    }

    this.botToken = botToken;
    this.chatId = chatId;

    // Verify bot token + chat access
    try {
      const meRes = await fetch(`${TG_API}${this.botToken}/getMe`);
      const meData = (await meRes.json()) as { ok: boolean; result?: { id?: number; username?: string } };
      if (!meData.ok) {
        return { success: false, error: 'Invalid bot token' };
      }
      this.botUserId = meData.result?.id ?? null;

      // Try sending a test "typing" action to verify chat access
      const chatRes = await fetch(`${TG_API}${this.botToken}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      });
      const chatData = (await chatRes.json()) as { ok: boolean; description?: string };
      if (!chatData.ok) {
        return { success: false, error: `Cannot access chat ${chatId}: ${chatData.description}` };
      }

      this.enabled = true;
      return { success: true, botName: meData.result?.username };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Start polling for incoming messages from the group.
   * Uses the dedicated Code Mode bot token (separate from Gateway).
   */
  async startPolling(callbacks: {
    onCommand: (text: string) => void;
    onChat?: (text: string) => void;
  }) {
    this.onCommand = callbacks.onCommand;
    this.onChat = callbacks.onChat ?? null;
    if (this.pollInterval) return;

    // Sync pending updates once (process /code from our chat instead of discarding),
    // so the message you sent right before clicking Connect is not skipped.
    await this.syncPendingUpdates();

    this.pollInterval = setInterval(() => this.poll(), 3000);
  }

  /**
   * Stop polling.
   */
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.onCommand = null;
    this.onChat = null;
  }

  /**
   * Send the user's command to Telegram (formatted as a command block).
   */
  async sendUserCommand(text: string): Promise<number | null> {
    if (!this.enabled || !this.botToken || !this.chatId) return null;

    const formatted = `👤 <b>Command</b>\n<pre>${escapeHtml(text)}</pre>`;
    return this.sendMessage(formatted);
  }

  /**
   * Send Claude's response to Telegram (formatted as a response block).
   * If replyToId is provided, sends as a reply to the command message.
   */
  async sendAssistantResponse(text: string, replyToId?: number | null): Promise<number | null> {
    if (!this.enabled || !this.botToken || !this.chatId) return null;

    // Telegram message limit is 4096 chars.
    // Escape first, then truncate to account for expanded HTML entities.
    const prefix = '🤖 <b>Claude Code</b>\n<pre>';
    const suffix = '</pre>';
    const overhead = prefix.length + suffix.length;
    const maxBody = 4096 - overhead - 30; // 30 chars safety margin for "… (truncated)"

    let escaped = escapeHtml(text);
    if (escaped.length > maxBody) {
      escaped = escaped.slice(0, maxBody) + '\n\n… (truncated)';
    }

    const formatted = `${prefix}${escaped}${suffix}`;
    return this.sendMessage(formatted, replyToId ?? undefined);
  }

  /**
   * Send MiniMax orchestrator message to Telegram.
   */
  async sendOrchestratorMessage(text: string, replyToId?: number | null): Promise<number | null> {
    if (!this.enabled || !this.botToken || !this.chatId) return null;

    const prefix = '🧠 <b>MiniMax M2.5</b>\n';
    const maxBody = 4096 - prefix.length - 30;

    let escaped = escapeHtml(text);
    if (escaped.length > maxBody) {
      escaped = escaped.slice(0, maxBody) + '\n\n… (truncated)';
    }

    const formatted = `${prefix}${escaped}`;
    return this.sendMessage(formatted, replyToId ?? undefined);
  }

  /**
   * Send a status/info message to Telegram.
   */
  async sendStatus(text: string): Promise<number | null> {
    if (!this.enabled || !this.botToken || !this.chatId) return null;

    const formatted = `ℹ️ ${escapeHtml(text)}`;
    return this.sendMessage(formatted);
  }

  /**
   * Disable and clean up.
   */
  destroy() {
    this.stopPolling();
    this.enabled = false;
    this.botToken = null;
    this.chatId = null;
    this.botUserId = null;
  }

  get isEnabled() {
    return this.enabled;
  }

  // ── Private ─────────────────────────────────────────────────

  private async sendMessage(html: string, replyToMessageId?: number): Promise<number | null> {
    if (!this.botToken || !this.chatId) return null;

    try {
      const body: Record<string, unknown> = {
        chat_id: this.chatId,
        text: html,
        parse_mode: 'HTML',
      };
      if (replyToMessageId) {
        body.reply_parameters = { message_id: replyToMessageId };
      }

      const res = await fetch(`${TG_API}${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as TelegramSendResult;
      if (data.ok && data.result) {
        return data.result.message_id;
      }
      console.warn('[TelegramCodeBridge] sendMessage failed:', data.description);
      return null;
    } catch (err) {
      console.warn('[TelegramCodeBridge] sendMessage error:', err);
      return null;
    }
  }

  /**
   * Fetch pending updates and process any /code commands from our chat.
   * This way the message you sent right before clicking Connect is still executed.
   */
  private async syncPendingUpdates() {
    if (!this.botToken || !this.chatId) return;
    try {
      const url = new URL(`${TG_API}${this.botToken}/getUpdates`);
      url.searchParams.set('offset', String(this.lastUpdateId + 1));
      url.searchParams.set('timeout', '0');
      url.searchParams.set('allowed_updates', JSON.stringify(['message']));

      const res = await fetch(url.toString());
      const data = (await res.json()) as TelegramUpdatesResult;
      if (!data.ok || !data.result) return;

      for (const update of data.result) {
        this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);

        const msg = update.message;
        if (!msg?.text) continue;
        if (String(msg.chat.id) !== String(this.chatId)) continue;
        // Skip messages sent by the bot itself to prevent echo loops
        if (this.botUserId && msg.from?.id === this.botUserId) continue;

        this.dispatchMessage(msg.text.trim());
      }
    } catch (err) {
      console.warn('[TelegramCodeBridge] syncPendingUpdates error:', err);
    }
  }

  private async poll() {
    if (!this.botToken || !this.chatId) return;

    try {
      const url = new URL(`${TG_API}${this.botToken}/getUpdates`);
      url.searchParams.set('offset', String(this.lastUpdateId + 1));
      url.searchParams.set('timeout', '0');
      url.searchParams.set('allowed_updates', JSON.stringify(['message']));

      const res = await fetch(url.toString());
      const data = (await res.json()) as TelegramUpdatesResult;
      if (!data.ok || !data.result) return;

      for (const update of data.result) {
        this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);

        const msg = update.message;
        if (!msg?.text) continue;

        // Only process messages from the configured chat/group
        if (String(msg.chat.id) !== String(this.chatId)) continue;
        // Skip messages sent by the bot itself to prevent echo loops
        if (this.botUserId && msg.from?.id === this.botUserId) continue;

        this.dispatchMessage(msg.text.trim());
      }
    } catch (err) {
      console.warn('[TelegramCodeBridge] poll error:', err);
    }
  }

  /**
   * Route a message to the appropriate callback based on prefix.
   */
  private dispatchMessage(text: string): void {
    if (!text) return;

    // /code prefix → direct Claude Code execution
    if (text.startsWith('/code ') || text.startsWith('/code\n')) {
      const command = text.slice(6).trim();
      if (command && this.onCommand) {
        this.onCommand(command);
      }
      return;
    }

    // Skip other bot commands (e.g. /start, /help)
    if (text.startsWith('/')) return;

    // Plain message → MiniMax orchestration
    if (this.onChat) {
      this.onChat(text);
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
