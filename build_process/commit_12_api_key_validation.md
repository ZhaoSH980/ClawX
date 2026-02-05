# Commit 12: Real API Key Validation & OpenRouter Support

## Overview
Implemented real API key validation by making actual API calls to each provider, replacing the mock validation. Also added OpenRouter as a new provider option.

## Changes

### 1. Real API Key Validation (`electron/main/ipc-handlers.ts`)

**Before**: Mock validation that only checked key format (e.g., `apiKey.startsWith('sk-ant-')`)

**After**: Real API validation that sends a minimal chat completion request to verify the key works

#### New Functions Added:
- `validateApiKeyWithProvider(providerType, apiKey)` - Routes to provider-specific validation
- `validateAnthropicKey(apiKey)` - Calls Anthropic `/v1/messages` endpoint
- `validateOpenAIKey(apiKey)` - Calls OpenAI `/v1/chat/completions` endpoint
- `validateGoogleKey(apiKey)` - Calls Google Gemini `generateContent` endpoint
- `validateOpenRouterKey(apiKey)` - Calls OpenRouter `/api/v1/chat/completions` endpoint
- `parseApiError(data)` - Extracts user-friendly error messages from API responses

#### Validation Logic:
- Sends minimal request with `max_tokens: 1` and message "hi"
- HTTP 200: Key is valid
- HTTP 401/403: Invalid API key
- HTTP 429: Rate limited but key is valid
- HTTP 402 (OpenRouter): No credits but key is valid
- HTTP 400/404: Check error message for auth vs model issues

#### Error Handling:
- Returns user-friendly "Invalid API key" instead of raw API errors like "User not found."

### 2. Setup Page Real Validation (`src/pages/Setup/index.tsx`)

**Before**:
```typescript
// Mock validation
await new Promise((resolve) => setTimeout(resolve, 1500));
const isValid = apiKey.length > 10;
```

**After**:
```typescript
// Real API validation via IPC
const result = await window.electron.ipcRenderer.invoke(
  'provider:validateKey',
  selectedProvider,
  apiKey
);
```

### 3. OpenRouter Provider Support

Added OpenRouter to:
- `src/pages/Setup/index.tsx` - Provider selection in setup wizard
- `src/components/settings/ProvidersSettings.tsx` - Provider settings panel
- `electron/utils/secure-storage.ts` - ProviderConfig type
- `src/stores/providers.ts` - ProviderConfig type

### 4. IPC Handler Improvement

Modified `provider:validateKey` handler to accept provider type directly:
- During setup, provider may not exist in storage yet
- Falls back to using `providerId` as the provider type
- Enables validation before provider is saved

## Files Changed
- `electron/main/ipc-handlers.ts` - Real API validation implementation (+300 lines)
- `src/pages/Setup/index.tsx` - Real validation call, OpenRouter option
- `src/components/settings/ProvidersSettings.tsx` - OpenRouter option
- `electron/utils/secure-storage.ts` - OpenRouter type
- `src/stores/providers.ts` - OpenRouter type

## API Endpoints Used
| Provider | Endpoint | Model |
|----------|----------|-------|
| Anthropic | `https://api.anthropic.com/v1/messages` | claude-3-haiku-20240307 |
| OpenAI | `https://api.openai.com/v1/chat/completions` | gpt-4o-mini |
| Google | `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent` | gemini-2.0-flash |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | meta-llama/llama-3.2-3b-instruct:free |

## Testing
1. Select OpenRouter in setup wizard
2. Enter an invalid API key (e.g., "asdasfdsadf")
3. Click Validate - should show "Invalid API key"
4. Enter a valid API key
5. Click Validate - should show "API key validated successfully"
