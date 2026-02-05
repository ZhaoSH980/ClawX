/**
 * Channels Page
 * Manage messaging channel connections
 */
import { useState, useEffect } from 'react';
import { 
  Plus, 
  Radio, 
  RefreshCw, 
  Settings, 
  Trash2, 
  Power, 
  PowerOff,
  QrCode,
  Loader2,
  X,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { StatusBadge, type Status } from '@/components/common/StatusBadge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelType, type Channel } from '@/types/channel';
import { toast } from 'sonner';

// Channel type info with connection instructions
const channelInfo: Record<ChannelType, { 
  description: string; 
  connectionType: 'qr' | 'token' | 'oauth';
  instructions: string[];
  tokenLabel?: string;
  docsUrl?: string;
}> = {
  whatsapp: {
    description: 'Connect WhatsApp by scanning a QR code',
    connectionType: 'qr',
    instructions: [
      'Open WhatsApp on your phone',
      'Go to Settings > Linked Devices',
      'Tap "Link a Device"',
      'Scan the QR code below',
    ],
    docsUrl: 'https://faq.whatsapp.com/1317564962315842',
  },
  telegram: {
    description: 'Connect Telegram using a bot token',
    connectionType: 'token',
    instructions: [
      'Open Telegram and search for @BotFather',
      'Send /newbot and follow the instructions',
      'Copy the bot token provided',
      'Paste it below',
    ],
    tokenLabel: 'Bot Token',
    docsUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
  },
  discord: {
    description: 'Connect Discord using a bot token',
    connectionType: 'token',
    instructions: [
      'Go to Discord Developer Portal',
      'Create a new Application',
      'Go to Bot section and create a bot',
      'Copy the bot token',
    ],
    tokenLabel: 'Bot Token',
    docsUrl: 'https://discord.com/developers/applications',
  },
  slack: {
    description: 'Connect Slack via OAuth',
    connectionType: 'token',
    instructions: [
      'Go to Slack API apps page',
      'Create a new app',
      'Configure OAuth scopes',
      'Install to workspace and copy the token',
    ],
    tokenLabel: 'Bot Token (xoxb-...)',
    docsUrl: 'https://api.slack.com/apps',
  },
  wechat: {
    description: 'Connect WeChat by scanning a QR code',
    connectionType: 'qr',
    instructions: [
      'Open WeChat on your phone',
      'Scan the QR code below',
      'Confirm login on your phone',
    ],
  },
};

export function Channels() {
  const { channels, loading, error, fetchChannels, connectChannel, disconnectChannel, deleteChannel } = useChannelsStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedChannelType, setSelectedChannelType] = useState<ChannelType | null>(null);
  const [connectingChannelId, setConnectingChannelId] = useState<string | null>(null);
  
  // Fetch channels on mount
  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);
  
  // Supported channel types for adding
  const supportedTypes: ChannelType[] = ['whatsapp', 'telegram', 'discord', 'slack'];
  
  // Connected/disconnected channel counts
  const connectedCount = channels.filter((c) => c.status === 'connected').length;
  
  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Channels</h1>
          <p className="text-muted-foreground">
            Connect and manage your messaging channels
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchChannels}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Channel
          </Button>
        </div>
      </div>
      
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                <Radio className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{channels.length}</p>
                <p className="text-sm text-muted-foreground">Total Channels</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-green-100 p-3 dark:bg-green-900">
                <Power className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{connectedCount}</p>
                <p className="text-sm text-muted-foreground">Connected</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-slate-100 p-3 dark:bg-slate-800">
                <PowerOff className="h-6 w-6 text-slate-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{channels.length - connectedCount}</p>
                <p className="text-sm text-muted-foreground">Disconnected</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Gateway Warning */}
      {gatewayStatus.state !== 'running' && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10">
          <CardContent className="py-4 flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
            <span className="text-yellow-700 dark:text-yellow-400">
              Gateway is not running. Channels cannot connect without an active Gateway.
            </span>
          </CardContent>
        </Card>
      )}
      
      {/* Error Display */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="py-4 text-destructive">
            {error}
          </CardContent>
        </Card>
      )}
      
      {/* Channels Grid */}
      {channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Radio className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No channels configured</h3>
            <p className="text-muted-foreground text-center mb-4">
              Connect a messaging channel to start using ClawX
            </p>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Channel
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              onConnect={() => {
                setConnectingChannelId(channel.id);
                connectChannel(channel.id);
              }}
              onDisconnect={() => disconnectChannel(channel.id)}
              onDelete={() => {
                if (confirm('Are you sure you want to delete this channel?')) {
                  deleteChannel(channel.id);
                }
              }}
              isConnecting={connectingChannelId === channel.id}
            />
          ))}
        </div>
      )}
      
      {/* Add Channel Section */}
      <Card>
        <CardHeader>
          <CardTitle>Supported Channels</CardTitle>
          <CardDescription>
            Click on a channel type to add it
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {supportedTypes.map((type) => (
              <Button
                key={type}
                variant="outline"
                className="h-auto flex-col gap-2 py-4"
                onClick={() => {
                  setSelectedChannelType(type);
                  setShowAddDialog(true);
                }}
              >
                <span className="text-3xl">{CHANNEL_ICONS[type]}</span>
                <span>{CHANNEL_NAMES[type]}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* Add Channel Dialog */}
      {showAddDialog && (
        <AddChannelDialog
          selectedType={selectedChannelType}
          onSelectType={setSelectedChannelType}
          onClose={() => {
            setShowAddDialog(false);
            setSelectedChannelType(null);
          }}
          supportedTypes={supportedTypes}
        />
      )}
    </div>
  );
}

// ==================== Channel Card Component ====================

interface ChannelCardProps {
  channel: Channel;
  onConnect: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
  isConnecting: boolean;
}

function ChannelCard({ channel, onConnect, onDisconnect, onDelete, isConnecting }: ChannelCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">
              {CHANNEL_ICONS[channel.type]}
            </span>
            <div>
              <CardTitle className="text-lg">{channel.name}</CardTitle>
              <CardDescription>
                {CHANNEL_NAMES[channel.type]}
              </CardDescription>
            </div>
          </div>
          <StatusBadge status={channel.status as Status} />
        </div>
      </CardHeader>
      <CardContent>
        {channel.lastActivity && (
          <p className="text-sm text-muted-foreground mb-4">
            Last activity: {new Date(channel.lastActivity).toLocaleString()}
          </p>
        )}
        {channel.error && (
          <p className="text-sm text-destructive mb-4">{channel.error}</p>
        )}
        <div className="flex gap-2">
          {channel.status === 'connected' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onDisconnect}
            >
              <PowerOff className="h-4 w-4 mr-2" />
              Disconnect
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onConnect}
              disabled={channel.status === 'connecting' || isConnecting}
            >
              {channel.status === 'connecting' || isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Power className="h-4 w-4 mr-2" />
                  Connect
                </>
              )}
            </Button>
          )}
          <Button variant="ghost" size="sm">
            <Settings className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== Add Channel Dialog ====================

interface AddChannelDialogProps {
  selectedType: ChannelType | null;
  onSelectType: (type: ChannelType | null) => void;
  onClose: () => void;
  supportedTypes: ChannelType[];
}

function AddChannelDialog({ selectedType, onSelectType, onClose, supportedTypes }: AddChannelDialogProps) {
  const { addChannel } = useChannelsStore();
  const [channelName, setChannelName] = useState('');
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const info = selectedType ? channelInfo[selectedType] : null;
  
  const handleConnect = async () => {
    if (!selectedType) return;
    
    setConnecting(true);
    
    try {
      // For QR-based channels, we'd request a QR code from the gateway
      if (info?.connectionType === 'qr') {
        // Simulate QR code generation
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setQrCode('placeholder-qr');
      } else {
        // For token-based, add the channel with the token
        await addChannel({
          type: selectedType,
          name: channelName || CHANNEL_NAMES[selectedType],
          token: token || undefined,
        });
        
        toast.success(`${CHANNEL_NAMES[selectedType]} channel added`);
        onClose();
      }
    } catch (error) {
      toast.error(`Failed to add channel: ${error}`);
    } finally {
      setConnecting(false);
    }
  };
  
  const copyToken = () => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>
              {selectedType ? `Connect ${CHANNEL_NAMES[selectedType]}` : 'Add Channel'}
            </CardTitle>
            <CardDescription>
              {info?.description || 'Select a messaging channel to connect'}
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedType ? (
            // Channel type selection
            <div className="grid grid-cols-2 gap-4">
              {supportedTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => onSelectType(type)}
                  className="p-4 rounded-lg border hover:bg-accent transition-colors text-center"
                >
                  <span className="text-3xl">{CHANNEL_ICONS[type]}</span>
                  <p className="font-medium mt-2">{CHANNEL_NAMES[type]}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {channelInfo[type].connectionType === 'qr' ? 'QR Code' : 'Token'}
                  </p>
                </button>
              ))}
            </div>
          ) : qrCode ? (
            // QR Code display
            <div className="text-center space-y-4">
              <div className="bg-white p-4 rounded-lg inline-block">
                <div className="w-48 h-48 bg-gray-100 flex items-center justify-center">
                  <QrCode className="h-32 w-32 text-gray-400" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Scan this QR code with {CHANNEL_NAMES[selectedType]} to connect
              </p>
              <div className="flex justify-center gap-2">
                <Button variant="outline" onClick={() => setQrCode(null)}>
                  Generate New Code
                </Button>
                <Button onClick={() => {
                  toast.success('Channel connected successfully');
                  onClose();
                }}>
                  I've Scanned It
                </Button>
              </div>
            </div>
          ) : (
            // Connection form
            <div className="space-y-4">
              {/* Instructions */}
              <div className="bg-muted p-4 rounded-lg space-y-2">
                <p className="font-medium text-sm">How to connect:</p>
                <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
                  {info?.instructions.map((instruction, i) => (
                    <li key={i}>{instruction}</li>
                  ))}
                </ol>
                {info?.docsUrl && (
                  <Button
                    variant="link"
                    className="p-0 h-auto text-sm"
                    onClick={() => window.electron.openExternal(info.docsUrl!)}
                  >
                    View documentation
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                )}
              </div>
              
              {/* Channel name */}
              <div className="space-y-2">
                <Label htmlFor="name">Channel Name (optional)</Label>
                <Input
                  id="name"
                  placeholder={`My ${CHANNEL_NAMES[selectedType]}`}
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                />
              </div>
              
              {/* Token input for token-based channels */}
              {info?.connectionType === 'token' && (
                <div className="space-y-2">
                  <Label htmlFor="token">{info.tokenLabel || 'Token'}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="token"
                      type="password"
                      placeholder="Paste your token here"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                    {token && (
                      <Button variant="outline" size="icon" onClick={copyToken}>
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              
              <Separator />
              
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => onSelectType(null)}>
                  Back
                </Button>
                <Button 
                  onClick={handleConnect}
                  disabled={connecting || (info?.connectionType === 'token' && !token)}
                >
                  {connecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {info?.connectionType === 'qr' ? 'Generating QR...' : 'Connecting...'}
                    </>
                  ) : info?.connectionType === 'qr' ? (
                    'Generate QR Code'
                  ) : (
                    'Connect'
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default Channels;
