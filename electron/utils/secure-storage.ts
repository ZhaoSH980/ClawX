/**
 * Secure Storage Utility
 * Uses Electron's safeStorage for encrypting sensitive data like API keys
 */
import { safeStorage } from 'electron';

// Lazy-load electron-store (ESM module)
let store: any = null;
let providerStore: any = null;

async function getStore() {
  if (!store) {
    const Store = (await import('electron-store')).default;
    store = new Store({
      name: 'clawx-secure',
      defaults: {
        encryptedKeys: {},
      },
    });
  }
  return store;
}

async function getProviderStore() {
  if (!providerStore) {
    const Store = (await import('electron-store')).default;
    providerStore = new Store({
      name: 'clawx-providers',
      defaults: {
        providers: {},
      },
    });
  }
  return providerStore;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: string;
  name: string;
  type: 'anthropic' | 'openai' | 'google' | 'openrouter' | 'ollama' | 'custom';
  baseUrl?: string;
  model?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Check if encryption is available
 */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/**
 * Store an API key securely
 */
export async function storeApiKey(providerId: string, apiKey: string): Promise<boolean> {
  try {
    const s = await getStore();
    
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('Encryption not available, storing key in plain text');
      // Fallback to plain storage (not recommended for production)
      const keys = s.get('encryptedKeys') as Record<string, string>;
      keys[providerId] = Buffer.from(apiKey).toString('base64');
      s.set('encryptedKeys', keys);
      return true;
    }
    
    // Encrypt the API key
    const encrypted = safeStorage.encryptString(apiKey);
    const keys = s.get('encryptedKeys') as Record<string, string>;
    keys[providerId] = encrypted.toString('base64');
    s.set('encryptedKeys', keys);
    
    return true;
  } catch (error) {
    console.error('Failed to store API key:', error);
    return false;
  }
}

/**
 * Retrieve an API key
 */
export async function getApiKey(providerId: string): Promise<string | null> {
  try {
    const s = await getStore();
    const keys = s.get('encryptedKeys') as Record<string, string>;
    const encryptedBase64 = keys[providerId];
    
    if (!encryptedBase64) {
      return null;
    }
    
    if (!safeStorage.isEncryptionAvailable()) {
      // Fallback for plain storage
      return Buffer.from(encryptedBase64, 'base64').toString('utf-8');
    }
    
    // Decrypt the API key
    const encrypted = Buffer.from(encryptedBase64, 'base64');
    return safeStorage.decryptString(encrypted);
  } catch (error) {
    console.error('Failed to retrieve API key:', error);
    return null;
  }
}

/**
 * Delete an API key
 */
export async function deleteApiKey(providerId: string): Promise<boolean> {
  try {
    const s = await getStore();
    const keys = s.get('encryptedKeys') as Record<string, string>;
    delete keys[providerId];
    s.set('encryptedKeys', keys);
    return true;
  } catch (error) {
    console.error('Failed to delete API key:', error);
    return false;
  }
}

/**
 * Check if an API key exists for a provider
 */
export async function hasApiKey(providerId: string): Promise<boolean> {
  const s = await getStore();
  const keys = s.get('encryptedKeys') as Record<string, string>;
  return providerId in keys;
}

/**
 * List all provider IDs that have stored keys
 */
export async function listStoredKeyIds(): Promise<string[]> {
  const s = await getStore();
  const keys = s.get('encryptedKeys') as Record<string, string>;
  return Object.keys(keys);
}

// ==================== Provider Configuration ====================

/**
 * Save a provider configuration
 */
export async function saveProvider(config: ProviderConfig): Promise<void> {
  const s = await getProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  providers[config.id] = config;
  s.set('providers', providers);
}

/**
 * Get a provider configuration
 */
export async function getProvider(providerId: string): Promise<ProviderConfig | null> {
  const s = await getProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  return providers[providerId] || null;
}

/**
 * Get all provider configurations
 */
export async function getAllProviders(): Promise<ProviderConfig[]> {
  const s = await getProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  return Object.values(providers);
}

/**
 * Delete a provider configuration
 */
export async function deleteProvider(providerId: string): Promise<boolean> {
  try {
    // Delete the API key first
    await deleteApiKey(providerId);
    
    // Delete the provider config
    const s = await getProviderStore();
    const providers = s.get('providers') as Record<string, ProviderConfig>;
    delete providers[providerId];
    s.set('providers', providers);
    
    // Clear default if this was the default
    if (s.get('defaultProvider') === providerId) {
      s.delete('defaultProvider');
    }
    
    return true;
  } catch (error) {
    console.error('Failed to delete provider:', error);
    return false;
  }
}

/**
 * Set the default provider
 */
export async function setDefaultProvider(providerId: string): Promise<void> {
  const s = await getProviderStore();
  s.set('defaultProvider', providerId);
}

/**
 * Get the default provider
 */
export async function getDefaultProvider(): Promise<string | undefined> {
  const s = await getProviderStore();
  return s.get('defaultProvider') as string | undefined;
}

/**
 * Get provider with masked key info (for UI display)
 */
export async function getProviderWithKeyInfo(providerId: string): Promise<(ProviderConfig & { hasKey: boolean; keyMasked: string | null }) | null> {
  const provider = await getProvider(providerId);
  if (!provider) return null;
  
  const apiKey = await getApiKey(providerId);
  let keyMasked: string | null = null;
  
  if (apiKey) {
    // Show first 4 and last 4 characters
    if (apiKey.length > 12) {
      keyMasked = `${apiKey.substring(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.substring(apiKey.length - 4)}`;
    } else {
      keyMasked = '*'.repeat(apiKey.length);
    }
  }
  
  return {
    ...provider,
    hasKey: !!apiKey,
    keyMasked,
  };
}

/**
 * Get all providers with key info (for UI display)
 */
export async function getAllProvidersWithKeyInfo(): Promise<Array<ProviderConfig & { hasKey: boolean; keyMasked: string | null }>> {
  const providers = await getAllProviders();
  const results: Array<ProviderConfig & { hasKey: boolean; keyMasked: string | null }> = [];
  
  for (const provider of providers) {
    const apiKey = await getApiKey(provider.id);
    let keyMasked: string | null = null;
    
    if (apiKey) {
      if (apiKey.length > 12) {
        keyMasked = `${apiKey.substring(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.substring(apiKey.length - 4)}`;
      } else {
        keyMasked = '*'.repeat(apiKey.length);
      }
    }
    
    results.push({
      ...provider,
      hasKey: !!apiKey,
      keyMasked,
    });
  }
  
  return results;
}
