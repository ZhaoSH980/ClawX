/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import { useState, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  Edit, 
  Eye, 
  EyeOff, 
  Check, 
  X, 
  Loader2,
  Star,
  Key,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useProviderStore, type ProviderWithKeyInfo } from '@/stores/providers';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Provider type definitions
const providerTypes = [
  { id: 'anthropic', name: 'Anthropic', icon: '🤖', placeholder: 'sk-ant-api03-...' },
  { id: 'openai', name: 'OpenAI', icon: '💚', placeholder: 'sk-proj-...' },
  { id: 'google', name: 'Google', icon: '🔷', placeholder: 'AIza...' },
  { id: 'openrouter', name: 'OpenRouter', icon: '🌐', placeholder: 'sk-or-v1-...' },
  { id: 'ollama', name: 'Ollama', icon: '🦙', placeholder: 'Not required' },
  { id: 'custom', name: 'Custom', icon: '⚙️', placeholder: 'API key...' },
];

export function ProvidersSettings() {
  const { 
    providers, 
    defaultProviderId, 
    loading, 
    fetchProviders, 
    addProvider,
    updateProvider,
    deleteProvider,
    setApiKey,
    setDefaultProvider,
    validateApiKey,
  } = useProviderStore();
  
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  
  // Fetch providers on mount
  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);
  
  const handleAddProvider = async (type: string, name: string, apiKey: string) => {
    try {
      await addProvider({
        id: `${type}-${Date.now()}`,
        type: type as 'anthropic' | 'openai' | 'google' | 'ollama' | 'custom',
        name,
        enabled: true,
      }, apiKey || undefined);
      
      setShowAddDialog(false);
      toast.success('Provider added successfully');
    } catch (error) {
      toast.error(`Failed to add provider: ${error}`);
    }
  };
  
  const handleDeleteProvider = async (providerId: string) => {
    try {
      await deleteProvider(providerId);
      toast.success('Provider deleted');
    } catch (error) {
      toast.error(`Failed to delete provider: ${error}`);
    }
  };
  
  const handleSetDefault = async (providerId: string) => {
    try {
      await setDefaultProvider(providerId);
      toast.success('Default provider updated');
    } catch (error) {
      toast.error(`Failed to set default: ${error}`);
    }
  };
  
  const handleToggleEnabled = async (provider: ProviderWithKeyInfo) => {
    try {
      await updateProvider(provider.id, { enabled: !provider.enabled });
    } catch (error) {
      toast.error(`Failed to update provider: ${error}`);
    }
  };
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">AI Providers</h3>
          <p className="text-sm text-muted-foreground">
            Configure your AI model providers and API keys
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Provider
        </Button>
      </div>
      
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : providers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Key className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No providers configured</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add an AI provider to start using ClawX
            </p>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Provider
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              isDefault={provider.id === defaultProviderId}
              isEditing={editingProvider === provider.id}
              onEdit={() => setEditingProvider(provider.id)}
              onCancelEdit={() => setEditingProvider(null)}
              onDelete={() => handleDeleteProvider(provider.id)}
              onSetDefault={() => handleSetDefault(provider.id)}
              onToggleEnabled={() => handleToggleEnabled(provider)}
              onUpdateKey={async (key) => {
                await setApiKey(provider.id, key);
                setEditingProvider(null);
              }}
              onValidateKey={(key) => validateApiKey(provider.id, key)}
            />
          ))}
        </div>
      )}
      
      {/* Add Provider Dialog */}
      {showAddDialog && (
        <AddProviderDialog
          onClose={() => setShowAddDialog(false)}
          onAdd={handleAddProvider}
        />
      )}
    </div>
  );
}

interface ProviderCardProps {
  provider: ProviderWithKeyInfo;
  isDefault: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onToggleEnabled: () => void;
  onUpdateKey: (key: string) => Promise<void>;
  onValidateKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
}

function ProviderCard({
  provider,
  isDefault,
  isEditing,
  onEdit,
  onCancelEdit,
  onDelete,
  onSetDefault,
  onToggleEnabled,
  onUpdateKey,
  onValidateKey,
}: ProviderCardProps) {
  const [newKey, setNewKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const typeInfo = providerTypes.find((t) => t.id === provider.type);
  
  const handleSaveKey = async () => {
    if (!newKey) return;
    
    setValidating(true);
    const result = await onValidateKey(newKey);
    setValidating(false);
    
    if (!result.valid) {
      toast.error(result.error || 'Invalid API key');
      return;
    }
    
    setSaving(true);
    try {
      await onUpdateKey(newKey);
      setNewKey('');
      toast.success('API key updated');
    } catch (error) {
      toast.error(`Failed to save key: ${error}`);
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <Card className={cn(isDefault && 'ring-2 ring-primary')}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{typeInfo?.icon || '⚙️'}</span>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">{provider.name}</CardTitle>
                {isDefault && (
                  <Badge variant="default" className="text-xs">Default</Badge>
                )}
              </div>
              <CardDescription className="capitalize">{provider.type}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={provider.enabled}
              onCheckedChange={onToggleEnabled}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>API Key</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder={typeInfo?.placeholder}
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button 
                  variant="outline" 
                  onClick={handleSaveKey}
                  disabled={!newKey || validating || saving}
                >
                  {validating || saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </Button>
                <Button variant="ghost" onClick={onCancelEdit}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-mono">
                {provider.hasKey ? provider.keyMasked : 'No API key set'}
              </span>
              {provider.hasKey && (
                <Badge variant="secondary" className="text-xs">Configured</Badge>
              )}
            </div>
            <div className="flex gap-1">
              {!isDefault && (
                <Button variant="ghost" size="icon" onClick={onSetDefault} title="Set as default">
                  <Star className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={onEdit} title="Edit API key">
                <Edit className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onDelete} title="Delete provider">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface AddProviderDialogProps {
  onClose: () => void;
  onAdd: (type: string, name: string, apiKey: string) => Promise<void>;
}

function AddProviderDialog({ onClose, onAdd }: AddProviderDialogProps) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const typeInfo = providerTypes.find((t) => t.id === selectedType);
  
  const handleAdd = async () => {
    if (!selectedType) return;
    
    setSaving(true);
    try {
      await onAdd(selectedType, name || typeInfo?.name || selectedType, apiKey);
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Add AI Provider</CardTitle>
          <CardDescription>
            Configure a new AI model provider
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedType ? (
            <div className="grid grid-cols-2 gap-3">
              {providerTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => {
                    setSelectedType(type.id);
                    setName(type.name);
                  }}
                  className="p-4 rounded-lg border hover:bg-accent transition-colors text-center"
                >
                  <span className="text-2xl">{type.icon}</span>
                  <p className="font-medium mt-2">{type.name}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                <span className="text-2xl">{typeInfo?.icon}</span>
                <div>
                  <p className="font-medium">{typeInfo?.name}</p>
                  <button 
                    onClick={() => setSelectedType(null)}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Change provider
                  </button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="name">Display Name</Label>
                <Input
                  id="name"
                  placeholder={typeInfo?.name}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <div className="relative">
                  <Input
                    id="apiKey"
                    type={showKey ? 'text' : 'password'}
                    placeholder={typeInfo?.placeholder}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your API key will be securely encrypted and stored locally.
                </p>
              </div>
            </div>
          )}
          
          <Separator />
          
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleAdd} 
              disabled={!selectedType || saving}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Add Provider
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
