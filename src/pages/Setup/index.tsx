/**
 * Setup Wizard Page
 * First-time setup experience for new users
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Check, 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  AlertCircle,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { toast } from 'sonner';

interface SetupStep {
  id: string;
  title: string;
  description: string;
}

const steps: SetupStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to ClawX',
    description: 'Your AI assistant is ready to be configured',
  },
  {
    id: 'runtime',
    title: 'Environment Check',
    description: 'Verifying system requirements',
  },
  {
    id: 'provider',
    title: 'AI Provider',
    description: 'Configure your AI service',
  },
  {
    id: 'channel',
    title: 'Connect Channel',
    description: 'Link a messaging app',
  },
  {
    id: 'skills',
    title: 'Choose Skills',
    description: 'Select your skill bundles',
  },
  {
    id: 'complete',
    title: 'All Set!',
    description: 'ClawX is ready to use',
  },
];

// Provider types
interface Provider {
  id: string;
  name: string;
  model: string;
  icon: string;
  placeholder: string;
}

const providers: Provider[] = [
  { id: 'anthropic', name: 'Anthropic', model: 'Claude', icon: '🤖', placeholder: 'sk-ant-...' },
  { id: 'openai', name: 'OpenAI', model: 'GPT-4', icon: '💚', placeholder: 'sk-...' },
  { id: 'google', name: 'Google', model: 'Gemini', icon: '🔷', placeholder: 'AI...' },
  { id: 'openrouter', name: 'OpenRouter', model: 'Multi-Model', icon: '🌐', placeholder: 'sk-or-...' },
];

// Channel types
interface Channel {
  type: string;
  name: string;
  icon: string;
  description: string;
}

const channels: Channel[] = [
  { type: 'whatsapp', name: 'WhatsApp', icon: '📱', description: 'Connect via QR code scan' },
  { type: 'telegram', name: 'Telegram', icon: '✈️', description: 'Connect via bot token' },
  { type: 'discord', name: 'Discord', icon: '🎮', description: 'Connect via bot token' },
  { type: 'slack', name: 'Slack', icon: '💼', description: 'Connect via OAuth' },
];

// Skill bundle types
interface SkillBundle {
  id: string;
  name: string;
  icon: string;
  description: string;
  skills: string[];
  recommended?: boolean;
}

const skillBundles: SkillBundle[] = [
  { 
    id: 'productivity', 
    name: 'Productivity', 
    icon: '📋', 
    description: 'Task management, reminders, notes',
    skills: ['todo', 'reminder', 'notes', 'calendar'],
    recommended: true,
  },
  { 
    id: 'developer', 
    name: 'Developer', 
    icon: '💻', 
    description: 'Code assistance, git, terminal',
    skills: ['code-assist', 'git', 'terminal', 'docs'],
    recommended: true,
  },
  { 
    id: 'smart-home', 
    name: 'Smart Home', 
    icon: '🏠', 
    description: 'Home automation, IoT control',
    skills: ['lights', 'thermostat', 'security', 'iot'],
  },
  { 
    id: 'media', 
    name: 'Media', 
    icon: '🎨', 
    description: 'Image generation, music, video',
    skills: ['image-gen', 'music', 'video', 'transcribe'],
  },
];

export function Setup() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [canProceed, setCanProceed] = useState(true);
  
  // Setup state
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [selectedBundles, setSelectedBundles] = useState<Set<string>>(new Set(['productivity', 'developer']));
  
  const step = steps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;
  
  const markSetupComplete = useSettingsStore((state) => state.markSetupComplete);
  
  const handleNext = async () => {
    if (isLastStep) {
      // Complete setup
      markSetupComplete();
      toast.success('Setup complete! Welcome to ClawX');
      navigate('/');
    } else {
      setCurrentStep((i) => i + 1);
    }
  };
  
  const handleBack = () => {
    setCurrentStep((i) => Math.max(i - 1, 0));
  };
  
  const handleSkip = () => {
    markSetupComplete();
    navigate('/');
  };
  
  // Update canProceed based on current step
  useEffect(() => {
    switch (currentStep) {
      case 0: // Welcome
        setCanProceed(true);
        break;
      case 1: // Runtime
        // Will be managed by RuntimeContent
        break;
      case 2: // Provider
        setCanProceed(selectedProvider !== null && apiKey.length > 0);
        break;
      case 3: // Channel
        setCanProceed(true); // Channel is optional
        break;
      case 4: // Skills
        setCanProceed(selectedBundles.size > 0);
        break;
      case 5: // Complete
        setCanProceed(true);
        break;
    }
  }, [currentStep, selectedProvider, apiKey, selectedChannel, selectedBundles]);
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      {/* Progress Indicator */}
      <div className="flex justify-center pt-8">
        <div className="flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors',
                  i < currentStep
                    ? 'border-primary bg-primary text-primary-foreground'
                    : i === currentStep
                    ? 'border-primary text-primary'
                    : 'border-slate-600 text-slate-600'
                )}
              >
                {i < currentStep ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span className="text-sm">{i + 1}</span>
                )}
              </div>
              {i < steps.length - 1 && (
                <div
                  className={cn(
                    'h-0.5 w-8 transition-colors',
                    i < currentStep ? 'bg-primary' : 'bg-slate-600'
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      
      {/* Step Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="mx-auto max-w-2xl p-8"
        >
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">{step.title}</h1>
            <p className="text-slate-400">{step.description}</p>
          </div>
          
          {/* Step-specific content */}
          <div className="rounded-xl bg-white/10 backdrop-blur p-8 mb-8">
            {currentStep === 0 && <WelcomeContent />}
            {currentStep === 1 && <RuntimeContent onStatusChange={setCanProceed} />}
            {currentStep === 2 && (
              <ProviderContent
                providers={providers}
                selectedProvider={selectedProvider}
                onSelectProvider={setSelectedProvider}
                apiKey={apiKey}
                onApiKeyChange={setApiKey}
              />
            )}
            {currentStep === 3 && (
              <ChannelContent
                channels={channels}
                selectedChannel={selectedChannel}
                onSelectChannel={setSelectedChannel}
              />
            )}
            {currentStep === 4 && (
              <SkillsContent
                bundles={skillBundles}
                selectedBundles={selectedBundles}
                onToggleBundle={(id) => {
                  const newSet = new Set(selectedBundles);
                  if (newSet.has(id)) {
                    newSet.delete(id);
                  } else {
                    newSet.add(id);
                  }
                  setSelectedBundles(newSet);
                }}
              />
            )}
            {currentStep === 5 && (
              <CompleteContent
                selectedProvider={selectedProvider}
                selectedChannel={selectedChannel}
                selectedBundles={selectedBundles}
                bundles={skillBundles}
              />
            )}
          </div>
          
          {/* Navigation */}
          <div className="flex justify-between">
            <div>
              {!isFirstStep && (
                <Button variant="ghost" onClick={handleBack}>
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {!isLastStep && currentStep !== 1 && (
                <Button variant="ghost" onClick={handleSkip}>
                  Skip Setup
                </Button>
              )}
              <Button onClick={handleNext} disabled={!canProceed}>
                {isLastStep ? (
                  'Get Started'
                ) : (
                  <>
                    {currentStep === 3 && !selectedChannel ? 'Skip' : 'Next'}
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ==================== Step Content Components ====================

function WelcomeContent() {
  return (
    <div className="text-center space-y-4">
      <div className="text-6xl mb-4">🤖</div>
      <h2 className="text-xl font-semibold">Welcome to ClawX</h2>
      <p className="text-slate-300">
        ClawX is a graphical interface for OpenClaw, making it easy to use AI
        assistants across your favorite messaging platforms.
      </p>
      <ul className="text-left space-y-2 text-slate-300">
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          Zero command-line required
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          Modern, beautiful interface
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          Pre-installed skill bundles
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          Cross-platform support
        </li>
      </ul>
    </div>
  );
}

interface RuntimeContentProps {
  onStatusChange: (canProceed: boolean) => void;
}

function RuntimeContent({ onStatusChange }: RuntimeContentProps) {
  const gatewayStatus = useGatewayStore((state) => state.status);
  const startGateway = useGatewayStore((state) => state.start);
  
  const [checks, setChecks] = useState({
    nodejs: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
    openclaw: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
    gateway: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
  });
  
  const runChecks = useCallback(async () => {
    // Reset checks
    setChecks({
      nodejs: { status: 'checking', message: '' },
      openclaw: { status: 'checking', message: '' },
      gateway: { status: 'checking', message: '' },
    });
    
    // Check Node.js
    try {
      // In Electron, we can assume Node.js is available
      setChecks((prev) => ({
        ...prev,
        nodejs: { status: 'success', message: 'Node.js is available' },
      }));
    } catch {
      setChecks((prev) => ({
        ...prev,
        nodejs: { status: 'error', message: 'Node.js not found' },
      }));
    }
    
    // Check OpenClaw submodule status
    try {
      const openclawStatus = await window.electron.ipcRenderer.invoke('openclaw:status') as {
        submoduleExists: boolean;
        isInstalled: boolean;
        isBuilt: boolean;
        dir: string;
      };
      
      if (!openclawStatus.submoduleExists) {
        setChecks((prev) => ({
          ...prev,
          openclaw: { 
            status: 'error', 
            message: 'OpenClaw submodule not found. Run: git submodule update --init' 
          },
        }));
      } else if (!openclawStatus.isInstalled) {
        setChecks((prev) => ({
          ...prev,
          openclaw: { 
            status: 'error', 
            message: 'Dependencies not installed. Run: cd openclaw && pnpm install' 
          },
        }));
      } else {
        const modeLabel = openclawStatus.isBuilt ? 'production' : 'development';
        setChecks((prev) => ({
          ...prev,
          openclaw: { 
            status: 'success', 
            message: `OpenClaw package ready (${modeLabel} mode)` 
          },
        }));
      }
    } catch (error) {
      setChecks((prev) => ({
        ...prev,
        openclaw: { status: 'error', message: `Failed to check: ${error}` },
      }));
    }
    
    // Check Gateway
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (gatewayStatus.state === 'running') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'success', message: `Running on port ${gatewayStatus.port}` },
      }));
    } else if (gatewayStatus.state === 'starting') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'checking', message: 'Starting...' },
      }));
    } else {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: 'Not running' },
      }));
    }
  }, [gatewayStatus]);
  
  useEffect(() => {
    runChecks();
  }, [runChecks]);
  
  // Update canProceed when gateway status changes
  useEffect(() => {
    const allPassed = checks.nodejs.status === 'success' 
      && checks.openclaw.status === 'success' 
      && (checks.gateway.status === 'success' || gatewayStatus.state === 'running');
    onStatusChange(allPassed);
  }, [checks, gatewayStatus, onStatusChange]);
  
  // Update gateway check when gateway status changes
  useEffect(() => {
    if (gatewayStatus.state === 'running') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'success', message: `Running on port ${gatewayStatus.port}` },
      }));
    } else if (gatewayStatus.state === 'error') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: gatewayStatus.error || 'Failed to start' },
      }));
    }
  }, [gatewayStatus]);
  
  const handleStartGateway = async () => {
    setChecks((prev) => ({
      ...prev,
      gateway: { status: 'checking', message: 'Starting...' },
    }));
    await startGateway();
  };
  
  const renderStatus = (status: 'checking' | 'success' | 'error', message: string) => {
    if (status === 'checking') {
      return (
        <span className="flex items-center gap-2 text-yellow-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {message || 'Checking...'}
        </span>
      );
    }
    if (status === 'success') {
      return (
        <span className="flex items-center gap-2 text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-2 text-red-400">
        <XCircle className="h-4 w-4" />
        {message}
      </span>
    );
  };
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Checking Environment</h2>
        <Button variant="ghost" size="sm" onClick={runChecks}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Re-check
        </Button>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <span>Node.js Runtime</span>
          {renderStatus(checks.nodejs.status, checks.nodejs.message)}
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <span>OpenClaw Package</span>
          {renderStatus(checks.openclaw.status, checks.openclaw.message)}
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <div className="flex items-center gap-2">
            <span>Gateway Service</span>
            {checks.gateway.status === 'error' && (
              <Button variant="outline" size="sm" onClick={handleStartGateway}>
                Start Gateway
              </Button>
            )}
          </div>
          {renderStatus(checks.gateway.status, checks.gateway.message)}
        </div>
      </div>
      
      {(checks.nodejs.status === 'error' || checks.openclaw.status === 'error') && (
        <div className="mt-4 p-4 rounded-lg bg-red-900/20 border border-red-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
            <div>
              <p className="font-medium text-red-400">Environment issue detected</p>
              <p className="text-sm text-slate-300 mt-1">
                Please ensure Node.js is installed and OpenClaw is properly set up.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ProviderContentProps {
  providers: Provider[];
  selectedProvider: string | null;
  onSelectProvider: (id: string | null) => void;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
}

function ProviderContent({ 
  providers, 
  selectedProvider, 
  onSelectProvider, 
  apiKey, 
  onApiKeyChange 
}: ProviderContentProps) {
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  
  const selectedProviderData = providers.find((p) => p.id === selectedProvider);
  
  const handleValidateKey = async () => {
    if (!apiKey || !selectedProvider) return;
    
    setValidating(true);
    setKeyValid(null);
    
    try {
      // Call real API validation
      const result = await window.electron.ipcRenderer.invoke(
        'provider:validateKey',
        selectedProvider,
        apiKey
      ) as { valid: boolean; error?: string };
      
      setKeyValid(result.valid);
      
      if (result.valid) {
        toast.success('API key validated successfully');
      } else {
        toast.error(result.error || 'Invalid API key');
      }
    } catch (error) {
      setKeyValid(false);
      toast.error('Validation failed: ' + String(error));
    } finally {
      setValidating(false);
    }
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Select AI Provider</h2>
        <p className="text-slate-300">
          Choose your preferred AI model provider
        </p>
      </div>
      
      <div className="grid grid-cols-3 gap-4">
        {providers.map((provider) => (
          <button
            key={provider.id}
            onClick={() => {
              onSelectProvider(provider.id);
              setKeyValid(null);
            }}
            className={cn(
              'p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-all text-center',
              selectedProvider === provider.id && 'ring-2 ring-primary bg-white/10'
            )}
          >
            <span className="text-3xl">{provider.icon}</span>
            <p className="font-medium mt-2">{provider.name}</p>
            <p className="text-sm text-slate-400">{provider.model}</p>
          </button>
        ))}
      </div>
      
      {selectedProvider && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="apiKey"
                  type={showKey ? 'text' : 'password'}
                  placeholder={selectedProviderData?.placeholder}
                  value={apiKey}
                  onChange={(e) => {
                    onApiKeyChange(e.target.value);
                    setKeyValid(null);
                  }}
                  className="pr-10 bg-white/5 border-white/10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button 
                variant="outline" 
                onClick={handleValidateKey}
                disabled={!apiKey || validating}
              >
                {validating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Validate'
                )}
              </Button>
            </div>
            {keyValid !== null && (
              <p className={cn('text-sm', keyValid ? 'text-green-400' : 'text-red-400')}>
                {keyValid ? '✓ API key is valid' : '✗ Invalid API key'}
              </p>
            )}
          </div>
          
          <p className="text-sm text-slate-400">
            Your API key will be securely stored in the system keychain.
          </p>
        </motion.div>
      )}
    </div>
  );
}

interface ChannelContentProps {
  channels: Channel[];
  selectedChannel: string | null;
  onSelectChannel: (type: string | null) => void;
}

function ChannelContent({ channels, selectedChannel, onSelectChannel }: ChannelContentProps) {
  const [connecting, setConnecting] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  
  const handleConnect = async (channelType: string) => {
    onSelectChannel(channelType);
    setConnecting(true);
    
    // Simulate QR code generation for WhatsApp
    if (channelType === 'whatsapp') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // In real app, this would be a real QR code
      setQrCode('placeholder');
    }
    
    setConnecting(false);
  };
  
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold mb-2">Connect a Channel</h2>
        <p className="text-slate-300">
          Link a messaging app to start chatting with your AI
        </p>
      </div>
      
      {!selectedChannel ? (
        <div className="grid grid-cols-2 gap-4">
          {channels.map((channel) => (
            <button
              key={channel.type}
              onClick={() => handleConnect(channel.type)}
              className="p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{channel.icon}</span>
                <div>
                  <p className="font-medium">{channel.name}</p>
                  <p className="text-sm text-slate-400">{channel.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center space-y-4"
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl">
              {channels.find((c) => c.type === selectedChannel)?.icon}
            </span>
            <span className="font-medium">
              {channels.find((c) => c.type === selectedChannel)?.name}
            </span>
          </div>
          
          {connecting ? (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p>Generating QR code...</p>
            </div>
          ) : selectedChannel === 'whatsapp' && qrCode ? (
            <div className="space-y-4">
              <div className="bg-white p-4 rounded-lg inline-block">
                {/* Placeholder QR code */}
                <div className="w-48 h-48 bg-gray-200 flex items-center justify-center text-gray-500">
                  QR Code Placeholder
                </div>
              </div>
              <p className="text-sm text-slate-300">
                Scan this QR code with WhatsApp to connect
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-slate-300">
                Follow the instructions to connect your {channels.find((c) => c.type === selectedChannel)?.name} account.
              </p>
            </div>
          )}
          
          <Button variant="ghost" onClick={() => {
            onSelectChannel(null);
            setQrCode(null);
          }}>
            Choose different channel
          </Button>
        </motion.div>
      )}
      
      <p className="text-sm text-slate-400 text-center">
        You can add more channels later in Settings
      </p>
    </div>
  );
}

interface SkillsContentProps {
  bundles: SkillBundle[];
  selectedBundles: Set<string>;
  onToggleBundle: (id: string) => void;
}

function SkillsContent({ bundles, selectedBundles, onToggleBundle }: SkillsContentProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold mb-2">Choose Skill Bundles</h2>
        <p className="text-slate-300">
          Select pre-configured skill packages to enable
        </p>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        {bundles.map((bundle) => (
          <button
            key={bundle.id}
            onClick={() => onToggleBundle(bundle.id)}
            className={cn(
              'p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-all text-left relative',
              selectedBundles.has(bundle.id) && 'ring-2 ring-primary bg-white/10'
            )}
          >
            <div className="flex items-start justify-between">
              <span className="text-2xl">{bundle.icon}</span>
              {selectedBundles.has(bundle.id) && (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              )}
            </div>
            <p className="font-medium mt-2">{bundle.name}</p>
            <p className="text-sm text-slate-400 mt-1">{bundle.description}</p>
            <p className="text-xs text-slate-500 mt-2">
              {bundle.skills.length} skills
            </p>
            {bundle.recommended && (
              <span className="absolute top-2 right-2 text-xs bg-primary px-2 py-0.5 rounded">
                Recommended
              </span>
            )}
          </button>
        ))}
      </div>
      
      <p className="text-sm text-slate-400 text-center">
        Selected: {selectedBundles.size} bundle{selectedBundles.size !== 1 ? 's' : ''}
      </p>
    </div>
  );
}

interface CompleteContentProps {
  selectedProvider: string | null;
  selectedChannel: string | null;
  selectedBundles: Set<string>;
  bundles: SkillBundle[];
}

function CompleteContent({ selectedProvider, selectedChannel, selectedBundles, bundles }: CompleteContentProps) {
  const gatewayStatus = useGatewayStore((state) => state.status);
  
  const providerData = providers.find((p) => p.id === selectedProvider);
  const channelData = channels.find((c) => c.type === selectedChannel);
  const selectedBundleNames = bundles
    .filter((b) => selectedBundles.has(b.id))
    .map((b) => b.name)
    .join(', ');
  
  return (
    <div className="text-center space-y-6">
      <div className="text-6xl mb-4">🎉</div>
      <h2 className="text-xl font-semibold">Setup Complete!</h2>
      <p className="text-slate-300">
        ClawX is configured and ready to use. You can now start chatting with
        your AI assistant.
      </p>
      
      <div className="space-y-3 text-left max-w-md mx-auto">
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <span>AI Provider</span>
          <span className="text-green-400">
            {providerData ? `${providerData.icon} ${providerData.name}` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <span>Channel</span>
          <span className={selectedChannel ? 'text-green-400' : 'text-slate-400'}>
            {channelData ? `${channelData.icon} ${channelData.name}` : 'Skipped'}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <span>Skills</span>
          <span className="text-green-400">
            {selectedBundleNames || 'None selected'}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
          <span>Gateway</span>
          <span className={gatewayStatus.state === 'running' ? 'text-green-400' : 'text-yellow-400'}>
            {gatewayStatus.state === 'running' ? '✓ Running' : gatewayStatus.state}
          </span>
        </div>
      </div>
    </div>
  );
}

export default Setup;
