/**
 * IPC Handlers
 * Registers all IPC handlers for main-renderer communication
 */
import { ipcMain, BrowserWindow, shell, dialog, app, nativeImage } from 'electron';
import { existsSync, copyFileSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { TelegramCodeBridge } from '../utils/telegram-code-bridge';
import { MinimaxOrchestrator } from '../utils/minimax-orchestrator';
import { GatewayManager } from '../gateway/manager';
import { ClawHubService, ClawHubSearchParams, ClawHubInstallParams, ClawHubUninstallParams } from '../gateway/clawhub';
import {
  storeApiKey,
  getApiKey,
  deleteApiKey,
  hasApiKey,
  saveProvider,
  getProvider,
  deleteProvider,
  setDefaultProvider,
  getDefaultProvider,
  getAllProvidersWithKeyInfo,
  type ProviderConfig,
} from '../utils/secure-storage';
import { getOpenClawStatus, getOpenClawDir, getOpenClawConfigDir, getOpenClawSkillsDir, ensureDir } from '../utils/paths';
import { getOpenClawCliCommand, installOpenClawCliMac } from '../utils/openclaw-cli';
import { getSetting, setSetting } from '../utils/store';
import {
  saveProviderKeyToOpenClaw,
  removeProviderKeyFromOpenClaw,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
} from '../utils/openclaw-auth';
import { logger } from '../utils/logger';
import {
  saveChannelConfig,
  getChannelConfig,
  getChannelFormValues,
  deleteChannelConfig,
  listConfiguredChannels,
  setChannelEnabled,
  validateChannelConfig,
  validateChannelCredentials,
} from '../utils/channel-config';
import { checkUvInstalled, installUv, setupManagedPython } from '../utils/uv-setup';
import { updateSkillConfig, getSkillConfig, getAllSkillConfigs } from '../utils/skill-config';
import { whatsAppLoginManager } from '../utils/whatsapp-login';
import { getProviderConfig } from '../utils/provider-registry';

/**
 * Register all IPC handlers
 */
export function registerIpcHandlers(
  gatewayManager: GatewayManager,
  clawHubService: ClawHubService,
  mainWindow: BrowserWindow
): void {
  // Gateway handlers
  registerGatewayHandlers(gatewayManager, mainWindow);

  // ClawHub handlers
  registerClawHubHandlers(clawHubService);

  // OpenClaw handlers
  registerOpenClawHandlers();

  // Provider handlers
  registerProviderHandlers();

  // Shell handlers
  registerShellHandlers();

  // Dialog handlers
  registerDialogHandlers();

  // App handlers
  registerAppHandlers();

  // UV handlers
  registerUvHandlers();

  // Log handlers (for UI to read gateway/app logs)
  registerLogHandlers();

  // Skill config handlers (direct file access, no Gateway RPC)
  registerSkillConfigHandlers();

  // Cron task handlers (proxy to Gateway RPC)
  registerCronHandlers(gatewayManager);

  // Window control handlers (for custom title bar on Windows/Linux)
  registerWindowHandlers(mainWindow);

  // WhatsApp handlers
  registerWhatsAppHandlers(mainWindow);

  // File staging handlers (upload/send separation)
  registerFileHandlers();

  // Code Mode handlers (Claude Code CLI integration)
  registerCodeModeHandlers(mainWindow, gatewayManager);
}

/**
 * Skill config IPC handlers
 * Direct read/write to ~/.openclaw/openclaw.json (bypasses Gateway RPC)
 */
function registerSkillConfigHandlers(): void {
  // Update skill config (apiKey and env)
  ipcMain.handle('skill:updateConfig', async (_, params: {
    skillKey: string;
    apiKey?: string;
    env?: Record<string, string>;
  }) => {
    return updateSkillConfig(params.skillKey, {
      apiKey: params.apiKey,
      env: params.env,
    });
  });

  // Get skill config
  ipcMain.handle('skill:getConfig', async (_, skillKey: string) => {
    return getSkillConfig(skillKey);
  });

  // Get all skill configs
  ipcMain.handle('skill:getAllConfigs', async () => {
    return getAllSkillConfigs();
  });
}

/**
 * Gateway CronJob type (as returned by cron.list RPC)
 */
interface GatewayCronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: string; expr?: string; everyMs?: number; at?: string; tz?: string };
  payload: { kind: string; message?: string; text?: string };
  delivery?: { mode: string; channel?: string; to?: string };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
}

/**
 * Transform a Gateway CronJob to the frontend CronJob format
 */
function transformCronJob(job: GatewayCronJob) {
  // Extract message from payload
  const message = job.payload?.message || job.payload?.text || '';

  // Build target from delivery info
  const channelType = job.delivery?.channel || 'unknown';
  const target = {
    channelType,
    channelId: channelType,
    channelName: channelType,
  };

  // Build lastRun from state
  const lastRun = job.state?.lastRunAtMs
    ? {
      time: new Date(job.state.lastRunAtMs).toISOString(),
      success: job.state.lastStatus === 'ok',
      error: job.state.lastError,
      duration: job.state.lastDurationMs,
    }
    : undefined;

  // Build nextRun from state
  const nextRun = job.state?.nextRunAtMs
    ? new Date(job.state.nextRunAtMs).toISOString()
    : undefined;

  return {
    id: job.id,
    name: job.name,
    message,
    schedule: job.schedule, // Pass the object through; frontend parseCronSchedule handles it
    target,
    enabled: job.enabled,
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
    lastRun,
    nextRun,
  };
}

/**
 * Cron task IPC handlers
 * Proxies cron operations to the Gateway RPC service.
 * The frontend works with plain cron expression strings, but the Gateway
 * expects CronSchedule objects ({ kind: "cron", expr: "..." }).
 * These handlers bridge the two formats.
 */
function registerCronHandlers(gatewayManager: GatewayManager): void {
  // List all cron jobs — transforms Gateway CronJob format to frontend CronJob format
  ipcMain.handle('cron:list', async () => {
    try {
      const result = await gatewayManager.rpc('cron.list', { includeDisabled: true });
      const data = result as { jobs?: GatewayCronJob[] };
      const jobs = data?.jobs ?? [];
      // Transform Gateway format to frontend format
      return jobs.map(transformCronJob);
    } catch (error) {
      console.error('Failed to list cron jobs:', error);
      throw error;
    }
  });

  // Create a new cron job (with duplicate protection)
  ipcMain.handle('cron:create', async (_, input: {
    name: string;
    message: string;
    schedule: string;
    target: { channelType: string; channelId: string; channelName: string };
    enabled?: boolean;
  }) => {
    try {
      // --- Duplicate protection ---
      // Prevent creating jobs with the same name to guard against AI agents
      // autonomously creating duplicate cron jobs without user request.
      try {
        const existing = await gatewayManager.rpc('cron.list', { includeDisabled: true });
        const existingData = existing as { jobs?: GatewayCronJob[] };
        const existingJobs = existingData?.jobs ?? [];
        const normalizedName = input.name.trim().toLowerCase();
        const duplicate = existingJobs.find(
          (j) => j.name?.trim().toLowerCase() === normalizedName
        );
        if (duplicate) {
          console.warn(`Blocked duplicate cron job creation: "${input.name}" (existing id: ${duplicate.id})`);
          throw new Error(`A cron job with the name "${input.name}" already exists. Please use a different name or update the existing job.`);
        }
      } catch (dupError) {
        // Re-throw if it's our duplicate error; swallow list failures so creation still works
        if (dupError instanceof Error && dupError.message.includes('already exists')) {
          throw dupError;
        }
        console.warn('Could not check for duplicate cron jobs:', dupError);
      }

      // Transform frontend input to Gateway cron.add format
      // For Discord, the recipient must be prefixed with "channel:" or "user:"
      const recipientId = input.target.channelId;
      const deliveryTo = input.target.channelType === 'discord' && recipientId
        ? `channel:${recipientId}`
        : recipientId;

      const gatewayInput = {
        name: input.name,
        schedule: { kind: 'cron', expr: input.schedule },
        payload: { kind: 'agentTurn', message: input.message },
        enabled: input.enabled ?? true,
        wakeMode: 'next-heartbeat',
        sessionTarget: 'isolated',
        delivery: {
          mode: 'announce',
          channel: input.target.channelType,
          to: deliveryTo,
        },
      };
      const result = await gatewayManager.rpc('cron.add', gatewayInput);
      // Transform the returned job to frontend format
      if (result && typeof result === 'object') {
        return transformCronJob(result as GatewayCronJob);
      }
      return result;
    } catch (error) {
      console.error('Failed to create cron job:', error);
      throw error;
    }
  });

  // Update an existing cron job
  ipcMain.handle('cron:update', async (_, id: string, input: Record<string, unknown>) => {
    try {
      // Transform schedule string to CronSchedule object if present
      const patch = { ...input };
      if (typeof patch.schedule === 'string') {
        patch.schedule = { kind: 'cron', expr: patch.schedule };
      }
      // Transform message to payload format if present
      if (typeof patch.message === 'string') {
        patch.payload = { kind: 'agentTurn', message: patch.message };
        delete patch.message;
      }
      const result = await gatewayManager.rpc('cron.update', { id, patch });
      return result;
    } catch (error) {
      console.error('Failed to update cron job:', error);
      throw error;
    }
  });

  // Delete a cron job
  ipcMain.handle('cron:delete', async (_, id: string) => {
    try {
      const result = await gatewayManager.rpc('cron.remove', { id });
      return result;
    } catch (error) {
      console.error('Failed to delete cron job:', error);
      throw error;
    }
  });

  // Toggle a cron job enabled/disabled
  ipcMain.handle('cron:toggle', async (_, id: string, enabled: boolean) => {
    try {
      const result = await gatewayManager.rpc('cron.update', { id, patch: { enabled } });
      return result;
    } catch (error) {
      console.error('Failed to toggle cron job:', error);
      throw error;
    }
  });

  // Trigger a cron job manually
  ipcMain.handle('cron:trigger', async (_, id: string) => {
    try {
      const result = await gatewayManager.rpc('cron.run', { id, mode: 'force' });
      return result;
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      throw error;
    }
  });
}

/**
 * UV-related IPC handlers
 */
function registerUvHandlers(): void {
  // Check if uv is installed
  ipcMain.handle('uv:check', async () => {
    return await checkUvInstalled();
  });

  // Install uv and setup managed Python
  ipcMain.handle('uv:install-all', async () => {
    try {
      const isInstalled = await checkUvInstalled();
      if (!isInstalled) {
        await installUv();
      }
      // Always run python setup to ensure it exists in uv's cache
      await setupManagedPython();
      return { success: true };
    } catch (error) {
      console.error('Failed to setup uv/python:', error);
      return { success: false, error: String(error) };
    }
  });
}

/**
 * Log-related IPC handlers
 * Allows the renderer to read application logs for diagnostics
 */
function registerLogHandlers(): void {
  // Get recent logs from memory ring buffer
  ipcMain.handle('log:getRecent', async (_, count?: number) => {
    return logger.getRecentLogs(count);
  });

  // Read log file content (last N lines)
  ipcMain.handle('log:readFile', async (_, tailLines?: number) => {
    return logger.readLogFile(tailLines);
  });

  // Get log file path (so user can open in file explorer)
  ipcMain.handle('log:getFilePath', async () => {
    return logger.getLogFilePath();
  });

  // Get log directory path
  ipcMain.handle('log:getDir', async () => {
    return logger.getLogDir();
  });

  // List all log files
  ipcMain.handle('log:listFiles', async () => {
    return logger.listLogFiles();
  });
}

/**
 * Gateway-related IPC handlers
 */
function registerGatewayHandlers(
  gatewayManager: GatewayManager,
  mainWindow: BrowserWindow
): void {
  // Get Gateway status
  ipcMain.handle('gateway:status', () => {
    return gatewayManager.getStatus();
  });

  // Check if Gateway is connected
  ipcMain.handle('gateway:isConnected', () => {
    return gatewayManager.isConnected();
  });

  // Start Gateway
  ipcMain.handle('gateway:start', async () => {
    try {
      await gatewayManager.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Stop Gateway
  ipcMain.handle('gateway:stop', async () => {
    try {
      await gatewayManager.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Restart Gateway
  ipcMain.handle('gateway:restart', async () => {
    try {
      await gatewayManager.restart();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Gateway RPC call
  ipcMain.handle('gateway:rpc', async (_, method: string, params?: unknown, timeoutMs?: number) => {
    try {
      const result = await gatewayManager.rpc(method, params, timeoutMs);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Chat send with media — reads staged files from disk and builds attachments.
  // Raster images (png/jpg/gif/webp) are inlined as base64 vision attachments.
  // All other files are referenced by path in the message text so the model
  // can access them via tools (the same format channels use).
  const VISION_MIME_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/bmp', 'image/webp',
  ]);

  ipcMain.handle('chat:sendWithMedia', async (_, params: {
    sessionKey: string;
    message: string;
    deliver?: boolean;
    idempotencyKey: string;
    media?: Array<{ filePath: string; mimeType: string; fileName: string }>;
  }) => {
    try {
      let message = params.message;
      // The Gateway processes image attachments through TWO parallel paths:
      // Path A: `attachments` param → parsed via `parseMessageWithAttachments` →
      //   injected as inline vision content when the model supports images.
      //   Format: { content: base64, mimeType: string, fileName?: string }
      // Path B: `[media attached: ...]` in message text → Gateway's native image
      //   detection (`detectAndLoadPromptImages`) reads the file from disk and
      //   injects it as inline vision content. Also works for history messages.
      // We use BOTH paths for maximum reliability.
      const imageAttachments: Array<Record<string, unknown>> = [];
      const fileReferences: string[] = [];

      if (params.media && params.media.length > 0) {
        for (const m of params.media) {
          logger.info(`[chat:sendWithMedia] Processing file: ${m.fileName} (${m.mimeType}), path: ${m.filePath}, exists: ${existsSync(m.filePath)}, isVision: ${VISION_MIME_TYPES.has(m.mimeType)}`);

          // Always add file path reference so the model can access it via tools
          fileReferences.push(
            `[media attached: ${m.filePath} (${m.mimeType}) | ${m.filePath}]`,
          );

          if (VISION_MIME_TYPES.has(m.mimeType)) {
            // Send as base64 attachment in the format the Gateway expects:
            // { content: base64String, mimeType: string, fileName?: string }
            // The Gateway normalizer looks for `a.content` (NOT `a.source.data`).
            const fileBuffer = readFileSync(m.filePath);
            const base64Data = fileBuffer.toString('base64');
            logger.info(`[chat:sendWithMedia] Read ${fileBuffer.length} bytes, base64 length: ${base64Data.length}`);
            imageAttachments.push({
              content: base64Data,
              mimeType: m.mimeType,
              fileName: m.fileName,
            });
          }
        }
      }

      // Append file references to message text so the model knows about them
      if (fileReferences.length > 0) {
        const refs = fileReferences.join('\n');
        message = message ? `${message}\n\n${refs}` : refs;
      }

      const rpcParams: Record<string, unknown> = {
        sessionKey: params.sessionKey,
        message,
        deliver: params.deliver ?? false,
        idempotencyKey: params.idempotencyKey,
      };

      if (imageAttachments.length > 0) {
        rpcParams.attachments = imageAttachments;
      }

      logger.info(`[chat:sendWithMedia] Sending: message="${message.substring(0, 100)}", attachments=${imageAttachments.length}, fileRefs=${fileReferences.length}`);

      // Use a longer timeout when images are present (120s vs default 30s)
      const timeoutMs = imageAttachments.length > 0 ? 120000 : 30000;
      const result = await gatewayManager.rpc('chat.send', rpcParams, timeoutMs);
      logger.info(`[chat:sendWithMedia] RPC result: ${JSON.stringify(result)}`);
      return { success: true, result };
    } catch (error) {
      logger.error(`[chat:sendWithMedia] Error: ${String(error)}`);
      return { success: false, error: String(error) };
    }
  });

  // Get the Control UI URL with token for embedding
  ipcMain.handle('gateway:getControlUiUrl', async () => {
    try {
      const status = gatewayManager.getStatus();
      const token = await getSetting('gatewayToken');
      const port = status.port || 18789;
      // Pass token as query param - Control UI will store it in localStorage
      const url = `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;
      return { success: true, url, port, token };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Health check
  ipcMain.handle('gateway:health', async () => {
    try {
      const health = await gatewayManager.checkHealth();
      return { success: true, ...health };
    } catch (error) {
      return { success: false, ok: false, error: String(error) };
    }
  });

  // Forward Gateway events to renderer
  gatewayManager.on('status', (status) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:status-changed', status);
    }
  });

  gatewayManager.on('message', (message) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:message', message);
    }
  });

  gatewayManager.on('notification', (notification) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:notification', notification);
    }
  });

  gatewayManager.on('channel:status', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:channel-status', data);
    }
  });

  gatewayManager.on('chat:message', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:chat-message', data);
    }
  });

  gatewayManager.on('exit', (code) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:exit', code);
    }
  });

  gatewayManager.on('error', (error) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:error', error.message);
    }
  });
}

/**
 * OpenClaw-related IPC handlers
 * For checking package status and channel configuration
 */
function registerOpenClawHandlers(): void {

  // Get OpenClaw package status
  ipcMain.handle('openclaw:status', () => {
    const status = getOpenClawStatus();
    logger.info('openclaw:status IPC called', status);
    return status;
  });

  // Check if OpenClaw is ready (package present)
  ipcMain.handle('openclaw:isReady', () => {
    const status = getOpenClawStatus();
    return status.packageExists;
  });

  // Get the resolved OpenClaw directory path (for diagnostics)
  ipcMain.handle('openclaw:getDir', () => {
    return getOpenClawDir();
  });

  // Get the OpenClaw config directory (~/.openclaw)
  ipcMain.handle('openclaw:getConfigDir', () => {
    return getOpenClawConfigDir();
  });

  // Get the OpenClaw skills directory (~/.openclaw/skills)
  ipcMain.handle('openclaw:getSkillsDir', () => {
    const dir = getOpenClawSkillsDir();
    ensureDir(dir);
    return dir;
  });

  // Get a shell command to run OpenClaw CLI without modifying PATH
  ipcMain.handle('openclaw:getCliCommand', () => {
    try {
      const status = getOpenClawStatus();
      if (!status.packageExists) {
        return { success: false, error: `OpenClaw package not found at: ${status.dir}` };
      }
      if (!existsSync(status.entryPath)) {
        return { success: false, error: `OpenClaw entry script not found at: ${status.entryPath}` };
      }
      return { success: true, command: getOpenClawCliCommand() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Install a system-wide openclaw command on macOS (requires admin prompt)
  ipcMain.handle('openclaw:installCliMac', async () => {
    return installOpenClawCliMac();
  });

  // ==================== Channel Configuration Handlers ====================

  // Save channel configuration
  ipcMain.handle('channel:saveConfig', async (_, channelType: string, config: Record<string, unknown>) => {
    try {
      logger.info('channel:saveConfig', { channelType, keys: Object.keys(config || {}) });
      saveChannelConfig(channelType, config);
      return { success: true };
    } catch (error) {
      console.error('Failed to save channel config:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get channel configuration
  ipcMain.handle('channel:getConfig', async (_, channelType: string) => {
    try {
      const config = getChannelConfig(channelType);
      return { success: true, config };
    } catch (error) {
      console.error('Failed to get channel config:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get channel form values (reverse-transformed for UI pre-fill)
  ipcMain.handle('channel:getFormValues', async (_, channelType: string) => {
    try {
      const values = getChannelFormValues(channelType);
      return { success: true, values };
    } catch (error) {
      console.error('Failed to get channel form values:', error);
      return { success: false, error: String(error) };
    }
  });

  // Delete channel configuration
  ipcMain.handle('channel:deleteConfig', async (_, channelType: string) => {
    try {
      deleteChannelConfig(channelType);
      return { success: true };
    } catch (error) {
      console.error('Failed to delete channel config:', error);
      return { success: false, error: String(error) };
    }
  });

  // List configured channels
  ipcMain.handle('channel:listConfigured', async () => {
    try {
      const channels = listConfiguredChannels();
      return { success: true, channels };
    } catch (error) {
      console.error('Failed to list channels:', error);
      return { success: false, error: String(error) };
    }
  });

  // Enable or disable a channel
  ipcMain.handle('channel:setEnabled', async (_, channelType: string, enabled: boolean) => {
    try {
      setChannelEnabled(channelType, enabled);
      return { success: true };
    } catch (error) {
      console.error('Failed to set channel enabled:', error);
      return { success: false, error: String(error) };
    }
  });

  // Validate channel configuration
  ipcMain.handle('channel:validate', async (_, channelType: string) => {
    try {
      const result = await validateChannelConfig(channelType);
      return { success: true, ...result };
    } catch (error) {
      console.error('Failed to validate channel:', error);
      return { success: false, valid: false, errors: [String(error)], warnings: [] };
    }
  });

  // Validate channel credentials by calling actual service APIs (before saving)
  ipcMain.handle('channel:validateCredentials', async (_, channelType: string, config: Record<string, string>) => {
    try {
      const result = await validateChannelCredentials(channelType, config);
      return { success: true, ...result };
    } catch (error) {
      console.error('Failed to validate channel credentials:', error);
      return { success: false, valid: false, errors: [String(error)], warnings: [] };
    }
  });
}

/**
 * WhatsApp Login Handlers
 */
function registerWhatsAppHandlers(mainWindow: BrowserWindow): void {
  // Request WhatsApp QR code
  ipcMain.handle('channel:requestWhatsAppQr', async (_, accountId: string) => {
    try {
      logger.info('channel:requestWhatsAppQr', { accountId });
      await whatsAppLoginManager.start(accountId);
      return { success: true };
    } catch (error) {
      logger.error('channel:requestWhatsAppQr failed', error);
      return { success: false, error: String(error) };
    }
  });

  // Cancel WhatsApp login
  ipcMain.handle('channel:cancelWhatsAppQr', async () => {
    try {
      await whatsAppLoginManager.stop();
      return { success: true };
    } catch (error) {
      logger.error('channel:cancelWhatsAppQr failed', error);
      return { success: false, error: String(error) };
    }
  });

  // Check WhatsApp status (is it active?)
  // ipcMain.handle('channel:checkWhatsAppStatus', ...)

  // Forward events to renderer
  whatsAppLoginManager.on('qr', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('channel:whatsapp-qr', data);
    }
  });

  whatsAppLoginManager.on('success', (data) => {
    if (!mainWindow.isDestroyed()) {
      logger.info('whatsapp:login-success', data);
      mainWindow.webContents.send('channel:whatsapp-success', data);
    }
  });

  whatsAppLoginManager.on('error', (error) => {
    if (!mainWindow.isDestroyed()) {
      logger.error('whatsapp:login-error', error);
      mainWindow.webContents.send('channel:whatsapp-error', error);
    }
  });
}


/**
 * Provider-related IPC handlers
 */
function registerProviderHandlers(): void {
  // Get all providers with key info
  ipcMain.handle('provider:list', async () => {
    return await getAllProvidersWithKeyInfo();
  });

  // Get a specific provider
  ipcMain.handle('provider:get', async (_, providerId: string) => {
    return await getProvider(providerId);
  });

  // Save a provider configuration
  ipcMain.handle('provider:save', async (_, config: ProviderConfig, apiKey?: string) => {
    try {
      // Save the provider config
      await saveProvider(config);

      // Store the API key if provided
      if (apiKey) {
        await storeApiKey(config.id, apiKey);

        // Also write to OpenClaw auth-profiles.json so the gateway can use it
        try {
          saveProviderKeyToOpenClaw(config.type, apiKey);
        } catch (err) {
          console.warn('Failed to save key to OpenClaw auth-profiles:', err);
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Delete a provider
  ipcMain.handle('provider:delete', async (_, providerId: string) => {
    try {
      const existing = await getProvider(providerId);
      await deleteProvider(providerId);

      // Best-effort cleanup in OpenClaw auth profiles
      if (existing?.type) {
        try {
          removeProviderKeyFromOpenClaw(existing.type);
        } catch (err) {
          console.warn('Failed to remove key from OpenClaw auth-profiles:', err);
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Update API key for a provider
  ipcMain.handle('provider:setApiKey', async (_, providerId: string, apiKey: string) => {
    try {
      await storeApiKey(providerId, apiKey);

      // Also write to OpenClaw auth-profiles.json
      // Resolve provider type from stored config, or use providerId as type
      const provider = await getProvider(providerId);
      const providerType = provider?.type || providerId;
      try {
        saveProviderKeyToOpenClaw(providerType, apiKey);
      } catch (err) {
        console.warn('Failed to save key to OpenClaw auth-profiles:', err);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Atomically update provider config and API key
  ipcMain.handle(
    'provider:updateWithKey',
    async (
      _,
      providerId: string,
      updates: Partial<ProviderConfig>,
      apiKey?: string
    ) => {
      const existing = await getProvider(providerId);
      if (!existing) {
        return { success: false, error: 'Provider not found' };
      }

      const previousKey = await getApiKey(providerId);
      const previousProviderType = existing.type;

      try {
        const nextConfig: ProviderConfig = {
          ...existing,
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        await saveProvider(nextConfig);

        if (apiKey !== undefined) {
          const trimmedKey = apiKey.trim();
          if (trimmedKey) {
            await storeApiKey(providerId, trimmedKey);
            saveProviderKeyToOpenClaw(nextConfig.type, trimmedKey);
          } else {
            await deleteApiKey(providerId);
            removeProviderKeyFromOpenClaw(nextConfig.type);
          }
        }

        return { success: true };
      } catch (error) {
        // Best-effort rollback to keep config/key consistent.
        try {
          await saveProvider(existing);
          if (previousKey) {
            await storeApiKey(providerId, previousKey);
            saveProviderKeyToOpenClaw(previousProviderType, previousKey);
          } else {
            await deleteApiKey(providerId);
            removeProviderKeyFromOpenClaw(previousProviderType);
          }
        } catch (rollbackError) {
          console.warn('Failed to rollback provider updateWithKey:', rollbackError);
        }

        return { success: false, error: String(error) };
      }
    }
  );

  // Delete API key for a provider
  ipcMain.handle('provider:deleteApiKey', async (_, providerId: string) => {
    try {
      await deleteApiKey(providerId);

      // Keep OpenClaw auth-profiles.json in sync with local key storage
      const provider = await getProvider(providerId);
      const providerType = provider?.type || providerId;
      try {
        removeProviderKeyFromOpenClaw(providerType);
      } catch (err) {
        console.warn('Failed to remove key from OpenClaw auth-profiles:', err);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Check if a provider has an API key
  ipcMain.handle('provider:hasApiKey', async (_, providerId: string) => {
    return await hasApiKey(providerId);
  });

  // Get the actual API key (for internal use only - be careful!)
  ipcMain.handle('provider:getApiKey', async (_, providerId: string) => {
    return await getApiKey(providerId);
  });

  // Set default provider and update OpenClaw default model
  ipcMain.handle('provider:setDefault', async (_, providerId: string) => {
    try {
      await setDefaultProvider(providerId);

      // Update OpenClaw config to use this provider's default model
      const provider = await getProvider(providerId);
      if (provider) {
        try {
          // If the provider has a user-specified model (e.g. siliconflow),
          // build the full model string: "providerType/modelId"
          const modelOverride = provider.model
            ? `${provider.type}/${provider.model}`
            : undefined;

          if (provider.type === 'custom' || provider.type === 'ollama') {
            // For runtime-configured providers, use user-entered base URL/api.
            setOpenClawDefaultModelWithOverride(provider.type, modelOverride, {
              baseUrl: provider.baseUrl,
              api: 'openai-completions',
            });
          } else {
            setOpenClawDefaultModel(provider.type, modelOverride);
          }

          // Keep auth-profiles in sync with the default provider instance.
          // This is especially important when multiple custom providers exist.
          const providerKey = await getApiKey(providerId);
          if (providerKey) {
            saveProviderKeyToOpenClaw(provider.type, providerKey);
          }
        } catch (err) {
          console.warn('Failed to set OpenClaw default model:', err);
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get default provider
  ipcMain.handle('provider:getDefault', async () => {
    return await getDefaultProvider();
  });

  // Validate API key by making a real test request to the provider.
  // providerId can be either a stored provider ID or a provider type.
  ipcMain.handle(
    'provider:validateKey',
    async (
      _,
      providerId: string,
      apiKey: string,
      options?: { baseUrl?: string }
    ) => {
      try {
        // First try to get existing provider
        const provider = await getProvider(providerId);

        // Use provider.type if provider exists, otherwise use providerId as the type
        // This allows validation during setup when provider hasn't been saved yet
        const providerType = provider?.type || providerId;
        const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
        // Prefer caller-supplied baseUrl (live form value) over persisted config.
        // This ensures Setup/Settings validation reflects unsaved edits immediately.
        const resolvedBaseUrl = options?.baseUrl || provider?.baseUrl || registryBaseUrl;

        console.log(`[clawx-validate] validating provider type: ${providerType}`);
        return await validateApiKeyWithProvider(providerType, apiKey, { baseUrl: resolvedBaseUrl });
      } catch (error) {
        console.error('Validation error:', error);
        return { valid: false, error: String(error) };
      }
    }
  );
}

type ValidationProfile = 'openai-compatible' | 'google-query-key' | 'anthropic-header' | 'chat-completions-probe' | 'openrouter' | 'none';

/**
 * Validate API key using lightweight model-listing endpoints (zero token cost).
 * Providers are grouped into 3 auth styles:
 * - openai-compatible: Bearer auth + /models
 * - google-query-key: ?key=... + /models
 * - anthropic-header: x-api-key + anthropic-version + /models
 */
async function validateApiKeyWithProvider(
  providerType: string,
  apiKey: string,
  options?: { baseUrl?: string }
): Promise<{ valid: boolean; error?: string }> {
  const profile = getValidationProfile(providerType);
  if (profile === 'none') {
    return { valid: true };
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { valid: false, error: 'API key is required' };
  }

  try {
    switch (profile) {
      case 'openai-compatible':
        return await validateOpenAiCompatibleKey(providerType, trimmedKey, options?.baseUrl);
      case 'google-query-key':
        return await validateGoogleQueryKey(providerType, trimmedKey, options?.baseUrl);
      case 'anthropic-header':
        return await validateAnthropicHeaderKey(providerType, trimmedKey, options?.baseUrl);
      case 'chat-completions-probe':
        return await validateChatCompletionsProbe(providerType, trimmedKey, options?.baseUrl);
      case 'openrouter':
        return await validateOpenRouterKey(providerType, trimmedKey);
      default:
        return { valid: false, error: `Unsupported validation profile for provider: ${providerType}` };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMessage };
  }
}

function logValidationStatus(provider: string, status: number): void {
  console.log(`[clawx-validate] ${provider} HTTP ${status}`);
}

function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return `${secret.slice(0, 2)}***`;
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function sanitizeValidationUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const key = url.searchParams.get('key');
    if (key) url.searchParams.set('key', maskSecret(key));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const next = { ...headers };
  if (next.Authorization?.startsWith('Bearer ')) {
    const token = next.Authorization.slice('Bearer '.length);
    next.Authorization = `Bearer ${maskSecret(token)}`;
  }
  if (next['x-api-key']) {
    next['x-api-key'] = maskSecret(next['x-api-key']);
  }
  return next;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildOpenAiModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models?limit=1`;
}

function logValidationRequest(
  provider: string,
  method: string,
  url: string,
  headers: Record<string, string>
): void {
  console.log(
    `[clawx-validate] ${provider} request ${method} ${sanitizeValidationUrl(url)} headers=${JSON.stringify(sanitizeHeaders(headers))}`
  );
}

function getValidationProfile(providerType: string): ValidationProfile {
  switch (providerType) {
    case 'anthropic':
      return 'anthropic-header';
    case 'google':
      return 'google-query-key';
    case 'minimax':
      // MiniMax does not support the /models endpoint (returns 404).
      // Use a lightweight /chat/completions probe instead.
      return 'chat-completions-probe';
    case 'openrouter':
      return 'openrouter';
    case 'ollama':
      return 'none';
    default:
      return 'openai-compatible';
  }
}

async function performProviderValidationRequest(
  providerLabel: string,
  url: string,
  headers: Record<string, string>
): Promise<{ valid: boolean; error?: string }> {
  try {
    logValidationRequest(providerLabel, 'GET', url, headers);
    const response = await fetch(url, { headers });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    return classifyAuthResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Helper: classify an HTTP response as valid / invalid / error.
 * 200 / 429 → valid (key works, possibly rate-limited).
 * 401 / 403 → invalid.
 * Everything else → return the API error message.
 */
function classifyAuthResponse(
  status: number,
  data: unknown
): { valid: boolean; error?: string } {
  if (status >= 200 && status < 300) return { valid: true };
  if (status === 429) return { valid: true }; // rate-limited but key is valid
  if (status === 401 || status === 403) return { valid: false, error: 'Invalid API key' };

  // Try to extract an error message
  const obj = data as { error?: { message?: string }; message?: string } | null;
  const msg = obj?.error?.message || obj?.message || `API error: ${status}`;
  return { valid: false, error: msg };
}

async function validateOpenAiCompatibleKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) {
    return { valid: false, error: `Base URL is required for provider "${providerType}" validation` };
  }

  const headers = { Authorization: `Bearer ${apiKey}` };

  // Try /models first (standard OpenAI-compatible endpoint)
  const modelsUrl = buildOpenAiModelsUrl(trimmedBaseUrl);
  const modelsResult = await performProviderValidationRequest(providerType, modelsUrl, headers);

  // If /models returned 404, the provider likely doesn't implement it (e.g. MiniMax).
  // Fall back to a minimal /chat/completions POST which almost all providers support.
  if (modelsResult.error?.includes('API error: 404')) {
    console.log(
      `[clawx-validate] ${providerType} /models returned 404, falling back to /chat/completions probe`
    );
    const base = normalizeBaseUrl(trimmedBaseUrl);
    const chatUrl = `${base}/chat/completions`;
    return await performChatCompletionsProbe(providerType, chatUrl, headers);
  }

  return modelsResult;
}

/**
 * Fallback validation: send a minimal /chat/completions request.
 * We intentionally use max_tokens=1 to minimise cost. The goal is only to
 * distinguish auth errors (401/403) from a working key (200/400/429).
 * A 400 "invalid model" still proves the key itself is accepted.
 */
async function performChatCompletionsProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>
): Promise<{ valid: boolean; error?: string }> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));

    // 401/403 → invalid key
    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key' };
    }
    // 200, 400 (bad model but key accepted), 429 → key is valid
    if (
      (response.status >= 200 && response.status < 300) ||
      response.status === 400 ||
      response.status === 429
    ) {
      return { valid: true };
    }
    return classifyAuthResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate API key via a minimal POST to /chat/completions with max_tokens=1.
 * Used for providers (e.g. MiniMax) that do not expose a /models endpoint.
 * The probe sends a tiny request; 401/403 → invalid key, 200/429/400 → valid key.
 */
async function validateChatCompletionsProbe(
  providerType: string,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) {
    return { valid: false, error: `Base URL is required for provider "${providerType}" validation` };
  }

  const url = `${normalizeBaseUrl(trimmedBaseUrl)}/chat/completions`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  // Minimal payload — we only care about the auth response, not the completion.
  const body = JSON.stringify({
    model: 'MiniMax-M2.5',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
  });

  try {
    logValidationRequest(providerType, 'POST', url, headers);
    const response = await fetch(url, { method: 'POST', headers, body });
    logValidationStatus(providerType, response.status);
    const data = await response.json().catch(() => ({}));

    // 401/403 → invalid key.  200/429 → valid key.
    // 400 (bad request) also implies key is valid (auth passed, request was bad).
    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key' };
    }
    if (response.status >= 200 && response.status < 300) return { valid: true };
    if (response.status === 429 || response.status === 400) return { valid: true };

    const obj = data as { error?: { message?: string }; message?: string } | null;
    const msg = obj?.error?.message || obj?.message || `API error: ${response.status}`;
    return { valid: false, error: msg };
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function validateGoogleQueryKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) {
    return { valid: false, error: `Base URL is required for provider "${providerType}" validation` };
  }

  const base = normalizeBaseUrl(trimmedBaseUrl);
  const url = `${base}/models?pageSize=1&key=${encodeURIComponent(apiKey)}`;
  return await performProviderValidationRequest(providerType, url, {});
}

async function validateAnthropicHeaderKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  const base = normalizeBaseUrl(baseUrl || 'https://api.anthropic.com/v1');
  const url = `${base}/models?limit=1`;
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  return await performProviderValidationRequest(providerType, url, headers);
}

async function validateOpenRouterKey(
  providerType: string,
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  // Use OpenRouter's auth check endpoint instead of public /models
  const url = 'https://openrouter.ai/api/v1/auth/key';
  const headers = { Authorization: `Bearer ${apiKey}` };
  return await performProviderValidationRequest(providerType, url, headers);
}

/**
 * Shell-related IPC handlers
 */
function registerShellHandlers(): void {
  // Open external URL
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    await shell.openExternal(url);
  });

  // Open path in file explorer
  ipcMain.handle('shell:showItemInFolder', async (_, path: string) => {
    shell.showItemInFolder(path);
  });

  // Open path
  ipcMain.handle('shell:openPath', async (_, path: string) => {
    return await shell.openPath(path);
  });
}

/**
 * ClawHub-related IPC handlers
 */
function registerClawHubHandlers(clawHubService: ClawHubService): void {
  // Search skills
  ipcMain.handle('clawhub:search', async (_, params: ClawHubSearchParams) => {
    try {
      const results = await clawHubService.search(params);
      return { success: true, results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Install skill
  ipcMain.handle('clawhub:install', async (_, params: ClawHubInstallParams) => {
    try {
      await clawHubService.install(params);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Uninstall skill
  ipcMain.handle('clawhub:uninstall', async (_, params: ClawHubUninstallParams) => {
    try {
      await clawHubService.uninstall(params);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List installed skills
  ipcMain.handle('clawhub:list', async () => {
    try {
      const results = await clawHubService.listInstalled();
      return { success: true, results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Open skill readme
  ipcMain.handle('clawhub:openSkillReadme', async (_, slug: string) => {
    try {
      await clawHubService.openSkillReadme(slug);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}

/**
 * Dialog-related IPC handlers
 */
function registerDialogHandlers(): void {
  // Show open dialog
  ipcMain.handle('dialog:open', async (_, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(options);
    return result;
  });

  // Show save dialog
  ipcMain.handle('dialog:save', async (_, options: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(options);
    return result;
  });

  // Show message box
  ipcMain.handle('dialog:message', async (_, options: Electron.MessageBoxOptions) => {
    const result = await dialog.showMessageBox(options);
    return result;
  });
}

/**
 * App-related IPC handlers
 */
function registerAppHandlers(): void {
  // Get app version
  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  // Get app name
  ipcMain.handle('app:name', () => {
    return app.getName();
  });

  // Get app path
  ipcMain.handle('app:getPath', (_, name: Parameters<typeof app.getPath>[0]) => {
    return app.getPath(name);
  });

  // Get platform
  ipcMain.handle('app:platform', () => {
    return process.platform;
  });

  // Quit app
  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  // Relaunch app
  ipcMain.handle('app:relaunch', () => {
    app.relaunch();
    app.quit();
  });
}

/**
 * Window control handlers (for custom title bar on Windows/Linux)
 */
function registerWindowHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('window:minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    mainWindow.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow.isMaximized();
  });
}

// ==================== Code Mode Handlers ====================

/**
 * Resolve the Claude Code CLI executable path.
 * Checks common installation locations since ~/.local/bin may not be
 * in the PATH inherited by the Electron process.
 */
function resolveClaudeCli(): { cmd: string; shell: boolean } {
  const isWin = process.platform === 'win32';
  const home = homedir();

  // Candidate paths where Claude Code CLI could be installed
  const candidates: string[] = isWin
    ? [
        join(home, '.local', 'bin', 'claude.exe'),
        join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        join(home, 'AppData', 'Roaming', 'npm', 'claude'),
      ]
    : [
        join(home, '.local', 'bin', 'claude'),
        '/usr/local/bin/claude',
        join(home, '.npm-global', 'bin', 'claude'),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { cmd: candidate, shell: false };
    }
  }

  // Fallback: hope it's in PATH; use shell so the OS can resolve it
  return { cmd: 'claude', shell: true };
}

/**
 * Build an env object that ensures ~/.local/bin is in PATH.
 * Electron may not inherit user-level PATH entries.
 */
function getClaudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const home = homedir();
  const localBin = join(home, '.local', 'bin');
  const sep = process.platform === 'win32' ? ';' : ':';

  if (env.PATH && !env.PATH.includes(localBin)) {
    env.PATH = `${localBin}${sep}${env.PATH}`;
  }
  return env;
}

/**
 * Code Mode IPC handlers
 * Manages Claude Code CLI processes: spawn, stream output, abort.
 * Integrates with Telegram Code Bridge for mirroring conversations to a TG group.
 * Supports dual-mode Telegram interaction:
 *   - /code prefix → direct Claude Code CLI execution
 *   - plain messages → MiniMax M2.5 orchestration → Claude Code CLI
 */
function registerCodeModeHandlers(mainWindow: BrowserWindow, gatewayManager: GatewayManager): void {
  let activeProcess: ChildProcess | null = null;
  let telegramBridge: TelegramCodeBridge | null = null;
  let orchestrator: MinimaxOrchestrator | null = null;
  // Track the Telegram message ID of the last user command for reply threading
  let lastTgCommandMsgId: number | null = null;
  // Mutable working directory reference so Telegram-initiated commands use the latest value
  let currentWorkingDirectory = '';
  // Session ID for Claude Code conversation continuity (persisted across app restarts via electron-store)
  let claudeSessionId: string | null = null;

  // Restore persisted session ID on startup
  getSetting('codeSessionId').then((id) => {
    if (id) {
      claudeSessionId = id;
      console.log('[CodeMode] Restored session:', id);
    }
  }).catch(() => { /* ignore */ });

  /**
   * Core execution logic: spawn Claude Code CLI, stream output, notify Telegram.
   * Shared by both UI-initiated and Telegram-initiated executions.
   *
   * When `options.collectOutput` is true the returned promise resolves with the
   * extracted summary text after the process exits (used by the orchestrator loop).
   */
  async function executeCore(
    rawPrompt: string,
    options?: {
      cwd?: string;
      maxTurns?: number;
      fromTelegram?: boolean;
      /** If true, suppress automatic Telegram response and resolve with summary */
      collectOutput?: boolean;
      /** Internal: skip --resume to avoid infinite retry loops */
      _skipResume?: boolean;
    },
  ): Promise<{ success: boolean; pid?: number; error?: string; summary?: string }> {
    if (activeProcess) {
      return { success: false, error: 'A Claude Code process is already running' };
    }

    // Strip leading slash commands that would confuse Claude Code CLI
    // e.g. "/code 帮我重构…" → "帮我重构…"
    let prompt = rawPrompt;
    if (/^\/code[\s\n]/i.test(prompt)) {
      prompt = prompt.slice(6).trim();
    }

    const cwd = options?.cwd || process.cwd();
    const maxTurns = options?.maxTurns ?? 50;
    const useResume = !options?._skipResume && !!claudeSessionId;

    if (!existsSync(cwd)) {
      return { success: false, error: `Working directory does not exist: ${cwd}` };
    }

    // Send user command to Telegram (unless the command came FROM Telegram or orchestrator handles it)
    if (telegramBridge?.isEnabled && !options?.fromTelegram && !options?.collectOutput) {
      const msgId = await telegramBridge.sendUserCommand(prompt);
      lastTgCommandMsgId = msgId;
    }

    try {
      const claude = resolveClaudeCli();
      const args = [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',
        '--max-turns', String(maxTurns),
        // Non-interactive: skip "allow execution?" prompts so commands run without manual approval
        '--dangerously-skip-permissions',
      ];

      // Use --resume to maintain conversation context across commands
      if (useResume) {
        args.push('--resume', claudeSessionId!);
      }

      activeProcess = spawn(claude.cmd, args, {
        cwd,
        shell: claude.shell,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: getClaudeEnv(),
      });

      const pid = activeProcess.pid;
      let fullOutput = '';
      /** Flag: set if we detect "No conversation found" — triggers auto-retry */
      let sessionExpired = false;

      // When collectOutput is true, we resolve a promise on process exit
      const collectOutput = options?.collectOutput ?? false;

      // Stream progress tracker for Telegram
      const progressTracker = telegramBridge?.isEnabled
        ? new StreamProgressTracker(telegramBridge)
        : null;

      return new Promise((resolve) => {
        // Immediately report success + pid
        if (!collectOutput) {
          resolve({ success: true, pid });
        }

        activeProcess!.stdout?.on('data', (data: Buffer) => {
          const text = data.toString();
          fullOutput += text;

          // Parse each JSON line for session_id capture and progress tracking
          for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed);

              // Capture session_id from the init message for conversation continuity
              if (!claudeSessionId && parsed.session_id) {
                claudeSessionId = parsed.session_id;
                setSetting('codeSessionId', claudeSessionId).catch(() => {});
                try { mainWindow.webContents.send('code:session-id', claudeSessionId); } catch { /* */ }
              }

              // Detect expired/invalid session: Claude Code returns errors array
              if (useResume && Array.isArray(parsed.errors)) {
                const hasSessionError = parsed.errors.some(
                  (e: unknown) => typeof e === 'string' && e.includes('No conversation found'),
                );
                if (hasSessionError) {
                  sessionExpired = true;
                }
              }

              // Feed to progress tracker
              if (progressTracker) {
                progressTracker.onStreamEvent(parsed);
              }
            } catch { /* not JSON */ }
          }

          try {
            mainWindow.webContents.send('code:output', { type: 'stdout', data: text, pid });
          } catch { /* window closed */ }
        });

        activeProcess!.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();
          // Also check stderr for session errors
          if (useResume && text.includes('No conversation found')) {
            sessionExpired = true;
          }
          try {
            mainWindow.webContents.send('code:output', { type: 'stderr', data: text, pid });
          } catch { /* window closed */ }
        });

        activeProcess!.on('close', async (code, signal) => {
          activeProcess = null;

          // Auto-retry: if session was expired, clear it and re-execute without --resume
          if (sessionExpired && useResume) {
            console.log('[CodeMode] Session expired, clearing and retrying without --resume');
            claudeSessionId = null;
            await setSetting('codeSessionId', '').catch(() => {});
            try { mainWindow.webContents.send('code:session-id', null); } catch { /* */ }

            // Clean up progress message
            if (progressTracker) {
              await progressTracker.finish();
            }

            // Retry without --resume
            const retryResult = await executeCore(prompt, { ...options, _skipResume: true });
            if (collectOutput) {
              resolve(retryResult);
            }
            return;
          }

          try {
            mainWindow.webContents.send('code:output', {
              type: 'exit',
              code,
              signal,
              pid,
            });
          } catch { /* window closed */ }

          // Clean up progress message before sending final result
          if (progressTracker) {
            await progressTracker.finish();
          }

          const summary = extractSummary(fullOutput, code);

          // Send to Telegram unless orchestrator handles it
          if (telegramBridge?.isEnabled && !collectOutput) {
            telegramBridge.sendAssistantResponse(summary, lastTgCommandMsgId).catch(() => {});
            lastTgCommandMsgId = null;
          }

          if (collectOutput) {
            resolve({ success: true, pid, summary });
          }
        });

        activeProcess!.on('error', async (err) => {
          try {
            mainWindow.webContents.send('code:output', {
              type: 'error',
              data: err.message,
              pid,
            });
          } catch { /* window closed */ }

          // Clean up progress message on error
          if (progressTracker) {
            await progressTracker.finish();
          }

          if (telegramBridge?.isEnabled && !collectOutput) {
            telegramBridge.sendStatus(`Error: ${err.message}`).catch(() => {});
            lastTgCommandMsgId = null;
          }

          activeProcess = null;

          if (collectOutput) {
            resolve({ success: false, error: err.message });
          }
        });
      });
    } catch (error) {
      activeProcess = null;
      return { success: false, error: String(error) };
    }
  }

  /**
   * Abort any running Claude Code process.
   * Returns the PID of the killed process (or null).
   */
  function abortActiveProcess(): number | null {
    if (!activeProcess) return null;
    const pid = activeProcess.pid ?? null;
    try {
      if (process.platform === 'win32' && pid) {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: true });
      } else if (activeProcess.kill) {
        activeProcess.kill('SIGTERM');
      }
    } catch { /* already dead */ }
    activeProcess = null;
    return pid;
  }

  /**
   * Handle a plain Telegram message via MiniMax orchestration.
   * MiniMax analyses the user's intent, optionally generates Claude Code commands,
   * and loops until no more commands are produced.
   */
  async function handleOrchestratedChat(userMessage: string): Promise<void> {
    if (!orchestrator || !telegramBridge?.isEnabled) return;

    // Abort any running process before starting orchestration
    if (activeProcess) {
      abortActiveProcess();
      await telegramBridge.sendStatus('⏹ 已中止上一任务，开始处理新消息…');
    }

    // Forward to UI
    try {
      mainWindow.webContents.send('code:telegram-command', `[MiniMax] ${userMessage}`);
    } catch { /* window closed */ }

    // Orchestration loop: MiniMax may issue multiple sequential commands
    const MAX_ROUNDS = 5;
    let round = 0;
    let pendingMessage = userMessage;

    while (round < MAX_ROUNDS) {
      round++;

      const result = await orchestrator.chat(pendingMessage);

      // Send MiniMax's reply to Telegram
      await telegramBridge.sendOrchestratorMessage(result.reply);

      if (!result.command) {
        // No command to execute — done
        break;
      }

      // Send the command MiniMax wants to execute
      const cmdMsgId = await telegramBridge.sendUserCommand(result.command);
      await telegramBridge.sendStatus('⏳ 执行中，请稍候…');

      // Forward command to UI
      try {
        mainWindow.webContents.send('code:telegram-command', `[MiniMax→Code] ${result.command}`);
      } catch { /* window closed */ }

      // Execute Claude Code and wait for result
      const execResult = await executeCore(result.command, {
        cwd: currentWorkingDirectory || undefined,
        fromTelegram: true,
        collectOutput: true,
      });

      const summary = execResult.summary || execResult.error || 'No output';

      // Send Claude Code result to Telegram
      await telegramBridge.sendAssistantResponse(summary, cmdMsgId);

      // Feed result back to MiniMax for potential follow-up
      orchestrator.addCodeResult(summary);

      // The next loop iteration will call orchestrator.chat() with the code result
      // to see if MiniMax wants to do more
      pendingMessage = `[Claude Code 执行结果]\n${summary}`;
    }

    if (round >= MAX_ROUNDS) {
      await telegramBridge.sendStatus('⚠️ 已达到最大编排轮次限制，停止执行。');
    }
  }

  // Check if Claude Code CLI is installed
  ipcMain.handle('code:status', async () => {
    try {
      const claude = resolveClaudeCli();
      const result = await new Promise<{ installed: boolean; version?: string }>((resolve) => {
        const proc = spawn(claude.cmd, ['--version'], {
          shell: claude.shell,
          timeout: 10000,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: getClaudeEnv(),
        });
        let stdout = '';
        proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.on('error', () => resolve({ installed: false }));
        proc.on('close', (exitCode) => {
          if (exitCode === 0 && stdout.trim()) {
            resolve({ installed: true, version: stdout.trim() });
          } else {
            resolve({ installed: false });
          }
        });
      });
      return result;
    } catch {
      return { installed: false };
    }
  });

  // Execute a prompt via Claude Code CLI with streaming output
  ipcMain.handle(
    'code:execute',
    async (_, prompt: string, options?: { cwd?: string; maxTurns?: number }) => {
      // Keep the mutable cwd reference in sync with the latest UI value
      if (options?.cwd) {
        currentWorkingDirectory = options.cwd;
      }
      return executeCore(prompt, options);
    },
  );

  // Abort the running Claude Code process
  ipcMain.handle('code:abort', () => {
    const pid = abortActiveProcess();
    if (pid !== null) {
      if (telegramBridge?.isEnabled) {
        telegramBridge.sendStatus('⏹ Execution aborted').catch(() => {});
      }
      return { success: true, pid };
    }
    return { success: false, error: 'No active process' };
  });

  // Open directory picker dialog
  ipcMain.handle('code:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Working Directory',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, path: result.filePaths[0] };
  });

  // ── Telegram Bridge ─────────────────────────────────────────

  // Enable Telegram bridge with a dedicated bot token and chat/group ID
  ipcMain.handle(
    'code:enableTelegram',
    async (_, botToken: string, chatId: string, options?: { cwd?: string }) => {
      // Clean up existing bridge and orchestrator
      if (telegramBridge) {
        telegramBridge.destroy();
        telegramBridge = null;
      }
      if (orchestrator) {
        orchestrator.clearHistory();
        orchestrator = null;
      }

      telegramBridge = new TelegramCodeBridge();
      const initResult = await telegramBridge.init(botToken, chatId);

      if (!initResult.success) {
        telegramBridge = null;
        return initResult;
      }

      // Guard: another call (e.g. disable or re-connect) may have cleared the bridge
      if (!telegramBridge) {
        return { success: false, error: 'Connection was cancelled or superseded' };
      }

      // Track initial cwd
      if (options?.cwd) {
        currentWorkingDirectory = options.cwd;
      }

      // Initialise MiniMax orchestrator (best-effort: if key not configured, chat mode is disabled)
      orchestrator = new MinimaxOrchestrator();
      const orchInit = await orchestrator.init();
      if (!orchInit.success) {
        console.warn('[CodeMode] MiniMax orchestrator not available:', orchInit.error);
        // Keep orchestrator null so plain messages are ignored
        orchestrator = null;
      }

      // Start polling with dual callbacks
      await telegramBridge.startPolling({
        // /code prefix → direct Claude Code execution
        onCommand: async (command: string) => {
          if (activeProcess) {
            abortActiveProcess();
            await telegramBridge?.sendStatus('⏹ 已中止上一任务，开始执行新指令…');
          }

          const tgMsgId = await telegramBridge!.sendUserCommand(command);
          lastTgCommandMsgId = tgMsgId;

          await telegramBridge!.sendStatus('⏳ 执行中，请稍候…');

          try {
            mainWindow.webContents.send('code:telegram-command', command);
          } catch { /* window closed */ }

          await executeCore(command, { cwd: currentWorkingDirectory || undefined, fromTelegram: true });
        },

        // Plain messages → MiniMax M2.5 orchestration
        onChat: orchestrator
          ? (text: string) => { handleOrchestratedChat(text).catch((err) => console.error('[CodeMode] orchestration error:', err)); }
          : undefined,
      });

      // Build connection status message
      let statusMsg = `🟢 Code Mode bridge connected\nWorking directory: ${currentWorkingDirectory || '(default)'}`;
      statusMsg += '\n\n📡 Using dedicated Code Mode bot. Gateway Telegram unaffected.';
      if (orchestrator) {
        statusMsg += '\n\n✅ MiniMax M2.5 编排已启用\n• /code <指令> → 直接执行 Claude Code\n• 直接发消息 → MiniMax 分析后自动执行';
      } else {
        statusMsg += '\n\n⚠️ MiniMax 未配置，仅支持 /code 命令模式\n请到 设置→Providers 添加 MiniMax API key 以启用智能编排。';
      }

      if (telegramBridge) {
        await telegramBridge.sendStatus(statusMsg);
      }
      return initResult;
    },
  );

  // Disable Telegram bridge
  ipcMain.handle('code:disableTelegram', async () => {
    if (telegramBridge) {
      await telegramBridge.sendStatus('🔴 Code Mode bridge disconnected');
      telegramBridge.destroy();
      telegramBridge = null;
    }
    if (orchestrator) {
      orchestrator.clearHistory();
      orchestrator = null;
    }

    return { success: true };
  });

  // Get Telegram bridge status
  ipcMain.handle('code:telegramStatus', () => {
    return { enabled: telegramBridge?.isEnabled ?? false };
  });

  // Get current Claude Code session ID
  ipcMain.handle('code:getSessionId', () => {
    return { sessionId: claudeSessionId || null };
  });

  // Reset Claude Code session (start fresh conversation)
  ipcMain.handle('code:resetSession', async () => {
    claudeSessionId = null;
    await setSetting('codeSessionId', '').catch(() => {});
    // Also clear orchestrator history since context is no longer valid
    if (orchestrator) {
      orchestrator.clearHistory();
    }
    return { success: true };
  });
}

/**
 * Tracks Claude Code stream-json events and pushes live progress updates
 * to Telegram via the bridge's updateProgress/finishProgress API.
 *
 * Progress is displayed as a compact status panel that is edited in-place:
 *
 *   ⚙️ Claude Code 执行中…
 *
 *   🔄 Turn 2
 *   💭 正在分析代码结构…
 *   🔧 Read(src/utils.ts)
 *   ✅ Read 完成
 *   🔧 Edit(src/utils.ts)
 */
class StreamProgressTracker {
  private bridge: TelegramCodeBridge;
  /** Recent progress steps (rolling window to keep the message compact) */
  private steps: string[] = [];
  /** Current thinking/assistant text snippet */
  private currentThinking = '';
  /** Current tool being used */
  private currentTool = '';
  /** Conversation turn counter */
  private turnCount = 0;
  /** Whether the tracker has been finished (prevents further updates) */
  private finished = false;
  /** Timer for deferred flush */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Maximum number of recent steps to keep visible */
  private static readonly MAX_VISIBLE_STEPS = 8;

  constructor(bridge: TelegramCodeBridge) {
    this.bridge = bridge;
  }

  /**
   * Process a parsed stream-json event from Claude Code CLI.
   * Common event types:
   *   { type: "system", ... }           — init/session info
   *   { type: "assistant", message: { content: [...] } } — assistant thinking/response
   *   { type: "tool_use", tool: "...", input: {...} }    — tool invocation
   *   { type: "tool_result", ... }      — tool result
   *   { type: "result", ... }           — final result
   */
  onStreamEvent(event: Record<string, unknown>): void {
    if (this.finished) return;

    const eventType = event.type as string | undefined;

    switch (eventType) {
      case 'assistant': {
        this.turnCount++;
        // Extract a short snippet from the assistant's thinking
        const content = (event.message as Record<string, unknown>)?.content;
        let snippet = '';
        if (typeof content === 'string') {
          snippet = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if ((block as Record<string, unknown>)?.type === 'text') {
              snippet = (block as Record<string, unknown>).text as string || '';
              break;
            }
          }
        }
        if (snippet) {
          // Take first meaningful line, truncate
          const firstLine = snippet.split('\n').find((l: string) => l.trim()) || '';
          this.currentThinking = firstLine.length > 80
            ? firstLine.slice(0, 77) + '…'
            : firstLine;
          this.scheduleFlush();
        }
        break;
      }

      case 'tool_use': {
        const toolName = (event.tool as string) || 'unknown';
        // Extract a short description of what the tool is doing
        const input = event.input as Record<string, unknown> | undefined;
        let detail = '';
        if (input) {
          // Common tool patterns
          if (input.file_path) detail = ` → ${basename(String(input.file_path))}`;
          else if (input.path) detail = ` → ${basename(String(input.path))}`;
          else if (input.command) {
            const cmd = String(input.command);
            detail = ` → ${cmd.length > 40 ? cmd.slice(0, 37) + '…' : cmd}`;
          }
          else if (input.pattern) detail = ` → ${String(input.pattern)}`;
        }
        this.currentTool = `🔧 ${toolName}${detail}`;
        this.addStep(this.currentTool);
        this.scheduleFlush();
        break;
      }

      case 'tool_result': {
        if (this.currentTool) {
          // Mark the tool as completed
          const toolLabel = this.currentTool.replace('🔧', '✅');
          // Replace the last matching tool step with the completed version
          for (let i = this.steps.length - 1; i >= 0; i--) {
            if (this.steps[i] === this.currentTool) {
              this.steps[i] = toolLabel;
              break;
            }
          }
          this.currentTool = '';
          this.scheduleFlush();
        }
        break;
      }

      // Ignore system, result, and other types
      default:
        break;
    }
  }

  /**
   * Finish tracking: clean up the progress message.
   */
  async finish(): Promise<void> {
    this.finished = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.bridge.finishProgress();
  }

  // ── Private ─────────────────────────────────────────────

  private addStep(step: string): void {
    this.steps.push(step);
    // Keep only the most recent steps
    if (this.steps.length > StreamProgressTracker.MAX_VISIBLE_STEPS) {
      this.steps = this.steps.slice(-StreamProgressTracker.MAX_VISIBLE_STEPS);
    }
  }

  /**
   * Schedule a flush to Telegram. Defers by 300ms so rapid events
   * are batched into a single edit.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return; // already scheduled
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 300);
  }

  private flush(): void {
    if (this.finished) return;

    const lines: string[] = [];
    if (this.turnCount > 0) {
      lines.push(`🔄 Turn ${this.turnCount}`);
    }
    if (this.currentThinking) {
      lines.push(`💭 ${this.currentThinking}`);
    }
    if (this.steps.length > 0) {
      lines.push('');
      lines.push(...this.steps);
    }

    if (lines.length === 0) return;

    this.bridge.updateProgress(lines).catch(() => {});
  }
}

/** Extract the filename from a path (cross-platform). */
function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

/**
 * Extract a readable summary from Claude Code CLI stream-json output.
 */
function extractSummary(fullOutput: string, exitCode: number | null): string {
  const lines = fullOutput.split('\n');
  const resultParts: string[] = [];
  const assistantParts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      // 'result' is the final summary from Claude Code — prefer this over 'assistant'
      if (parsed.type === 'result' && parsed.result) {
        resultParts.push(parsed.result);
      } else if (parsed.type === 'assistant' && parsed.message?.content) {
        const content = parsed.message.content;
        if (typeof content === 'string') {
          assistantParts.push(content);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              assistantParts.push(block.text);
            }
          }
        }
      }
    } catch {
      // Not JSON, skip
    }
  }

  // Prefer 'result' entries (final summary); fall back to 'assistant' messages
  const summary = (resultParts.length > 0 ? resultParts : assistantParts).join('\n').trim();
  if (summary) return summary;

  // Fallback
  if (fullOutput.length > 500) {
    return `…${fullOutput.slice(-500)}`;
  }
  return fullOutput || (exitCode === 0 ? 'Done.' : `Process exited with code ${exitCode}`);
}

// ── Mime type helpers ────────────────────────────────────────────

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function getMimeType(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

function mimeToExt(mimeType: string): string {
  for (const [ext, mime] of Object.entries(EXT_MIME_MAP)) {
    if (mime === mimeType) return ext;
  }
  return '';
}

const OUTBOUND_DIR = join(homedir(), '.openclaw', 'media', 'outbound');

/**
 * Generate a preview data URL for image files.
 * Resizes large images while preserving aspect ratio (only constrain the
 * longer side so the image is never squished). The frontend handles
 * square cropping via CSS object-fit: cover.
 */
function generateImagePreview(filePath: string, mimeType: string): string | null {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const maxDim = 512; // keep enough resolution for crisp display on Retina
    // Only resize if larger than threshold — specify ONE dimension to keep ratio
    if (size.width > maxDim || size.height > maxDim) {
      const resized = size.width >= size.height
        ? img.resize({ width: maxDim })   // landscape / square → constrain width
        : img.resize({ height: maxDim }); // portrait → constrain height
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    }
    // Small image — use original
    const buf = readFileSync(filePath);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * File staging IPC handlers
 * Stage files to ~/.openclaw/media/outbound/ for gateway access
 */
function registerFileHandlers(): void {
  // Stage files from real disk paths (used with dialog:open)
  ipcMain.handle('file:stage', async (_, filePaths: string[]) => {
    mkdirSync(OUTBOUND_DIR, { recursive: true });

    const results = [];
    for (const filePath of filePaths) {
      const id = crypto.randomUUID();
      const ext = extname(filePath);
      const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
      copyFileSync(filePath, stagedPath);

      const stat = statSync(stagedPath);
      const mimeType = getMimeType(ext);
      const fileName = basename(filePath);

      // Generate preview for images
      let preview: string | null = null;
      if (mimeType.startsWith('image/')) {
        preview = generateImagePreview(stagedPath, mimeType);
      }

      results.push({ id, fileName, mimeType, fileSize: stat.size, stagedPath, preview });
    }
    return results;
  });

  // Stage file from buffer (used for clipboard paste / drag-drop)
  ipcMain.handle('file:stageBuffer', async (_, payload: {
    base64: string;
    fileName: string;
    mimeType: string;
  }) => {
    mkdirSync(OUTBOUND_DIR, { recursive: true });

    const id = crypto.randomUUID();
    const ext = extname(payload.fileName) || mimeToExt(payload.mimeType);
    const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
    const buffer = Buffer.from(payload.base64, 'base64');
    writeFileSync(stagedPath, buffer);

    const mimeType = payload.mimeType || getMimeType(ext);
    const fileSize = buffer.length;

    // Generate preview for images
    let preview: string | null = null;
    if (mimeType.startsWith('image/')) {
      preview = generateImagePreview(stagedPath, mimeType);
    }

    return { id, fileName: payload.fileName, mimeType, fileSize, stagedPath, preview };
  });

  // Load thumbnails for file paths on disk (used to restore previews in history)
  // Save an image to a user-chosen location (base64 data URI or existing file path)
  ipcMain.handle('media:saveImage', async (_, params: {
    base64?: string;
    mimeType?: string;
    filePath?: string;
    defaultFileName: string;
  }) => {
    try {
      const ext = params.defaultFileName.includes('.')
        ? params.defaultFileName.split('.').pop()!
        : (params.mimeType?.split('/')[1] || 'png');
      const result = await dialog.showSaveDialog({
        defaultPath: join(homedir(), 'Downloads', params.defaultFileName),
        filters: [
          { name: 'Images', extensions: [ext, 'png', 'jpg', 'jpeg', 'webp', 'gif'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePath) return { success: false };

      if (params.filePath && existsSync(params.filePath)) {
        copyFileSync(params.filePath, result.filePath);
      } else if (params.base64) {
        const buffer = Buffer.from(params.base64, 'base64');
        writeFileSync(result.filePath, buffer);
      } else {
        return { success: false, error: 'No image data provided' };
      }
      return { success: true, savedPath: result.filePath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('media:getThumbnails', async (_, paths: Array<{ filePath: string; mimeType: string }>) => {
    const results: Record<string, { preview: string | null; fileSize: number }> = {};
    for (const { filePath, mimeType } of paths) {
      try {
        if (!existsSync(filePath)) {
          results[filePath] = { preview: null, fileSize: 0 };
          continue;
        }
        const stat = statSync(filePath);
        let preview: string | null = null;
        if (mimeType.startsWith('image/')) {
          preview = generateImagePreview(filePath, mimeType);
        }
        results[filePath] = { preview, fileSize: stat.size };
      } catch {
        results[filePath] = { preview: null, fileSize: 0 };
      }
    }
    return results;
  });
}
