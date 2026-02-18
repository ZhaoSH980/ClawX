/**
 * Telegram Code Bridge
 * Sends Code Mode messages (user commands + Claude responses) to a Telegram group.
 * Polls for incoming messages:
 *   - /code prefix → direct Claude Code execution (onCommand)
 *   - plain messages → MiniMax orchestration (onChat)
 */
// Telegram Bot API base URL
const TG_API = 'https://api.telegram.org/bot';

/** Telegram hard limit per message */
const TG_MAX_LENGTH = 4096;

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

  /** Currently active progress message ID (for in-place edits) */
  private progressMsgId: number | null = null;
  /** Timestamp of the last editMessage call (for throttling) */
  private lastProgressEditMs = 0;
  /** Minimum interval between editMessage calls (Telegram rate limit protection) */
  private static readonly PROGRESS_THROTTLE_MS = 2000;

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
   * Long responses are automatically split into multiple messages.
   * If replyToId is provided, the first chunk is sent as a reply.
   */
  async sendAssistantResponse(text: string, replyToId?: number | null): Promise<number | null> {
    if (!this.enabled || !this.botToken || !this.chatId) return null;

    const prefix = '🤖 <b>Claude Code</b>\n';
    const escaped = escapeHtml(text);
    const chunks = splitForTelegram(escaped, prefix, '<pre>', '</pre>');

    let firstMsgId: number | null = null;
    for (let i = 0; i < chunks.length; i++) {
      const replyTo = i === 0 ? (replyToId ?? undefined) : undefined;
      const msgId = await this.sendMessage(chunks[i], replyTo);
      if (i === 0) firstMsgId = msgId;
    }
    return firstMsgId;
  }

  /**
   * Send MiniMax orchestrator message to Telegram.
   * Long responses are automatically split into multiple messages.
   */
  async sendOrchestratorMessage(text: string, replyToId?: number | null): Promise<number | null> {
    if (!this.enabled || !this.botToken || !this.chatId) return null;

    const prefix = '🧠 <b>MiniMax M2.5</b>\n';
    const escaped = escapeHtml(text);
    const chunks = splitForTelegram(escaped, prefix, '', '');

    let firstMsgId: number | null = null;
    for (let i = 0; i < chunks.length; i++) {
      const replyTo = i === 0 ? (replyToId ?? undefined) : undefined;
      const msgId = await this.sendMessage(chunks[i], replyTo);
      if (i === 0) firstMsgId = msgId;
    }
    return firstMsgId;
  }

  /**
   * Send a status/info message to Telegram.
   */
  async sendStatus(text: string): Promise<number | null> {
    if (!this.enabled || !this.botToken || !this.chatId) return null;

    const formatted = `ℹ️ ${escapeHtml(text)}`;
    return this.sendMessage(formatted);
  }

  // ── Streaming Progress ─────────────────────────────────────

  /**
   * Create or update a live progress message in Telegram.
   * The message is edited in-place to show real-time status,
   * throttled to avoid hitting Telegram's rate limits (~30 edits/s per chat).
   *
   * @param lines  Progress lines to display (each line is a step/action)
   * @param force  If true, bypass throttle (used for the final update)
   * @returns The progress message ID
   */
  async updateProgress(lines: string[], force = false): Promise<number | null> {
    if (!this.enabled || !this.botToken || !this.chatId) return null;

    const now = Date.now();
    if (!force && now - this.lastProgressEditMs < TelegramCodeBridge.PROGRESS_THROTTLE_MS) {
      return this.progressMsgId;
    }

    const html = `⚙️ <b>Claude Code 执行中…</b>\n\n${lines.map((l) => escapeHtml(l)).join('\n')}`;
    // Truncate to Telegram limit (progress messages should be short, but just in case)
    const truncated = html.length > TG_MAX_LENGTH ? html.slice(0, TG_MAX_LENGTH - 3) + '…' : html;

    if (this.progressMsgId) {
      // Edit the existing progress message
      const ok = await this.editMessage(this.progressMsgId, truncated);
      if (ok) {
        this.lastProgressEditMs = now;
        return this.progressMsgId;
      }
      // If edit failed (message deleted?), fall through to create a new one
    }

    // Create a new progress message
    const msgId = await this.sendMessage(truncated);
    if (msgId) {
      this.progressMsgId = msgId;
      this.lastProgressEditMs = now;
    }
    return msgId;
  }

  /**
   * Finish progress tracking: delete the progress message so the final
   * result message stands on its own.
   */
  async finishProgress(): Promise<void> {
    if (this.progressMsgId) {
      await this.deleteMessage(this.progressMsgId);
      this.progressMsgId = null;
      this.lastProgressEditMs = 0;
    }
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
    this.progressMsgId = null;
    this.lastProgressEditMs = 0;
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
   * Edit an existing message (used for in-place progress updates).
   */
  private async editMessage(messageId: number, html: string): Promise<boolean> {
    if (!this.botToken || !this.chatId) return false;

    try {
      const res = await fetch(`${TG_API}${this.botToken}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          message_id: messageId,
          text: html,
          parse_mode: 'HTML',
        }),
      });
      const data = (await res.json()) as TelegramSendResult;
      if (!data.ok) {
        // "message is not modified" is fine — content didn't change
        if (data.description?.includes('not modified')) return true;
        console.warn('[TelegramCodeBridge] editMessage failed:', data.description);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[TelegramCodeBridge] editMessage error:', err);
      return false;
    }
  }

  /**
   * Delete a message (used to clean up progress messages after completion).
   */
  private async deleteMessage(messageId: number): Promise<boolean> {
    if (!this.botToken || !this.chatId) return false;

    try {
      const res = await fetch(`${TG_API}${this.botToken}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          message_id: messageId,
        }),
      });
      const data = (await res.json()) as { ok: boolean; description?: string };
      if (!data.ok) {
        console.warn('[TelegramCodeBridge] deleteMessage failed:', data.description);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[TelegramCodeBridge] deleteMessage error:', err);
      return false;
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

// ── Utilities ───────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Split a long (already HTML-escaped) body into chunks that fit Telegram's
 * 4096-character limit.
 *
 * The first chunk includes the header prefix. Subsequent chunks include a
 * "… (N/M)" continuation label. If `wrapOpen`/`wrapClose` are given (e.g.
 * `<pre>` / `</pre>`), each chunk is wrapped so HTML stays valid.
 *
 * Splitting happens on newline boundaries when possible; otherwise mid-line.
 */
function splitForTelegram(
  escapedBody: string,
  headerPrefix: string,
  wrapOpen: string,
  wrapClose: string,
): string[] {
  // Fast path: if everything fits in one message, return immediately.
  const singleMsg = `${headerPrefix}${wrapOpen}${escapedBody}${wrapClose}`;
  if (singleMsg.length <= TG_MAX_LENGTH) {
    return [singleMsg];
  }

  // Reserve space for the continuation label, e.g. "\n… (2/5)"
  const CONT_RESERVE = 14;

  // Split body into lines, then greedily pack lines into chunks
  const lines = escapedBody.split('\n');
  const chunks: string[] = [];
  let currentLines: string[] = [];
  let currentLen = 0;

  const flushChunk = () => {
    if (currentLines.length === 0) return;
    chunks.push(currentLines.join('\n'));
    currentLines = [];
    currentLen = 0;
  };

  // Compute available body space per chunk (varies for first vs continuation)
  const firstOverhead = headerPrefix.length + wrapOpen.length + wrapClose.length + CONT_RESERVE;
  const contLabelLen = 16; // "… (NN/MM)\n" + wrapOpen + wrapClose
  const contOverhead = contLabelLen + wrapOpen.length + wrapClose.length + CONT_RESERVE;
  // Use the smaller budget to be safe
  const maxBodyPerChunk = TG_MAX_LENGTH - Math.max(firstOverhead, contOverhead);

  for (const line of lines) {
    const lineLen = line.length + (currentLines.length > 0 ? 1 : 0); // +1 for \n separator

    if (currentLen + lineLen > maxBodyPerChunk && currentLines.length > 0) {
      flushChunk();
    }

    // Handle a single line that itself exceeds the budget: force-split it
    if (line.length > maxBodyPerChunk) {
      flushChunk();
      let pos = 0;
      while (pos < line.length) {
        const slice = line.slice(pos, pos + maxBodyPerChunk);
        chunks.push(slice);
        pos += maxBodyPerChunk;
      }
      continue;
    }

    currentLines.push(line);
    currentLen += lineLen;
  }
  flushChunk();

  if (chunks.length === 0) return [singleMsg]; // shouldn't happen

  // If only one chunk after splitting, return it directly
  if (chunks.length === 1) {
    return [`${headerPrefix}${wrapOpen}${chunks[0]}${wrapClose}`];
  }

  // Assemble final messages with headers and continuation labels
  const total = chunks.length;
  return chunks.map((body, i) => {
    if (i === 0) {
      return `${headerPrefix}${wrapOpen}${body}${wrapClose}\n… (1/${total})`;
    }
    return `${wrapOpen}${body}${wrapClose}\n… (${i + 1}/${total})`;
  });
}
