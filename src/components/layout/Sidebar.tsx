/**
 * Sidebar Component
 * Navigation sidebar with menu items
 */
import { NavLink } from 'react-router-dom';
import {
  Home,
  MessageSquare,
  Radio,
  Puzzle,
  Clock,
  Settings,
  ChevronLeft,
  ChevronRight,
  Terminal,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';


interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  collapsed?: boolean;
}

function NavItem({ to, icon, label, badge, collapsed }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground',
          collapsed && 'justify-center px-2'
        )
      }
    >
      {icon}
      {!collapsed && (
        <>
          <span className="flex-1">{label}</span>
          {badge && (
            <Badge variant="secondary" className="ml-auto">
              {badge}
            </Badge>
          )}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const gatewayStatus = useGatewayStore((state) => state.status);
  
  // Open developer console
  const openDevConsole = () => {
    window.electron.openExternal('http://localhost:18789');
  };
  
  const navItems = [
    { to: '/', icon: <Home className="h-5 w-5" />, label: 'Dashboard' },
    { to: '/chat', icon: <MessageSquare className="h-5 w-5" />, label: 'Chat' },
    { to: '/channels', icon: <Radio className="h-5 w-5" />, label: 'Channels' },
    { to: '/skills', icon: <Puzzle className="h-5 w-5" />, label: 'Skills' },
    { to: '/cron', icon: <Clock className="h-5 w-5" />, label: 'Cron Tasks' },
    { to: '/settings', icon: <Settings className="h-5 w-5" />, label: 'Settings' },
  ];
  
  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-background transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Header with drag region for macOS */}
      <div className="drag-region flex h-14 items-center border-b px-4">
        {/* macOS traffic light spacing */}
        <div className="w-16" />
        {!sidebarCollapsed && (
          <h1 className="no-drag text-xl font-bold">ClawX</h1>
        )}
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => (
          <NavItem
            key={item.to}
            {...item}
            collapsed={sidebarCollapsed}
          />
        ))}
      </nav>
      
      {/* Footer */}
      <div className="border-t p-2 space-y-2">
        {/* Gateway Status */}
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2',
            sidebarCollapsed && 'justify-center px-2'
          )}
        >
          <div
            className={cn(
              'h-2 w-2 rounded-full',
              gatewayStatus.state === 'running' && 'bg-green-500',
              gatewayStatus.state === 'starting' && 'bg-yellow-500 animate-pulse',
              gatewayStatus.state === 'stopped' && 'bg-gray-400',
              gatewayStatus.state === 'error' && 'bg-red-500'
            )}
          />
          {!sidebarCollapsed && (
            <span className="text-xs text-muted-foreground">
              Gateway: {gatewayStatus.state}
            </span>
          )}
        </div>
        
        {/* Developer Mode Button */}
        {devModeUnlocked && !sidebarCollapsed && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={openDevConsole}
          >
            <Terminal className="h-4 w-4 mr-2" />
            Developer Console
            <ExternalLink className="h-3 w-3 ml-auto" />
          </Button>
        )}

        
        {/* Collapse Toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="w-full"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}
