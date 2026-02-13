// Settings page for managing exe.dev environments

import { useState, useEffect } from 'react';
import type { Environment } from '@agenthq/shared';
import { Button } from './ui/button';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/hooks/useTheme';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Config {
  hasDaemonAuthToken: boolean;
  serverPublicUrl?: string;
  environments: Environment[];
}

interface SettingsPageProps {
  onBack: () => void;
  environments: Environment[];
  username?: string;
  onLogout: () => void;
}

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function SettingsPage({ onBack, environments, username, onLogout }: SettingsPageProps) {
  const { theme, setTheme } = useTheme();
  const [config, setConfig] = useState<Config | null>(null);
  const [daemonAuthToken, setDaemonAuthToken] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [newEnvName, setNewEnvName] = useState('');
  const [newVmName, setNewVmName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Fetch config on mount
  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setConfig(data);
      setServerUrl(data.serverPublicUrl || '');
    } catch (err) {
      setError('Failed to load config');
    }
  };

  const handleSaveServerUrl = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/config/server-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: serverUrl }),
      });
      if (!res.ok) throw new Error('Failed to save server URL');
      setSuccess('Server URL saved');
      fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save server URL');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDaemonAuthToken = async () => {
    if (!daemonAuthToken.trim()) return;
    
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/config/daemon-auth-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: daemonAuthToken }),
      });
      if (!res.ok) throw new Error('Failed to save daemon auth token');
      setDaemonAuthToken('');
      setSuccess('Daemon auth token saved');
      fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save daemon auth token');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEnv = async () => {
    if (!newEnvName.trim() || !newVmName.trim()) {
      setError('Name and VM name are required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/environments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newEnvName, vmName: newVmName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create environment');
      setNewEnvName('');
      setNewVmName('');
      setSuccess('Environment created. Click "Provision" to set it up.');
      fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create environment');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEnv = async (envId: string) => {
    if (!confirm('Are you sure you want to delete this environment? This will also destroy the VM.')) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/environments/${envId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete environment');
      setSuccess('Environment deleted');
      fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete environment');
    } finally {
      setLoading(false);
    }
  };

  const handleProvisionEnv = async (envId: string) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/environments/${envId}/provision`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to provision environment');
      setSuccess('Environment provisioned! The daemon should connect shortly.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to provision environment');
    } finally {
      setLoading(false);
    }
  };

  const handleRestartDaemon = async (envId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/environments/${envId}/restart`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to restart daemon');
      setSuccess('Daemon restart requested');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart daemon');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateDaemon = async (envId: string) => {
    if (!confirm('This will update the daemon to the latest version and restart it. Continue?')) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/environments/${envId}/update-daemon`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update daemon');
      setSuccess('Daemon updated successfully. It should reconnect shortly.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update daemon');
    } finally {
      setLoading(false);
    }
  };

  // Clear messages after 5s
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 10000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const exeEnvs = environments.filter((e) => e.type === 'exe');

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center border-b border-border px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="mr-3">
          ← Back
        </Button>
        <h1 className="text-lg font-semibold">Settings</h1>
        <div className="ml-auto flex items-center gap-3">
          {username && <span className="text-xs text-muted-foreground">Signed in as {username}</span>}
          <Button variant="outline" size="sm" onClick={onLogout}>
            Log out
          </Button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="mx-4 mt-4 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="mx-4 mt-4 rounded-lg border border-green-500/50 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          {success}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-2xl space-y-8">
          {/* Appearance */}
          <section>
            <h2 className="mb-4 text-base font-semibold">Appearance</h2>
            <div className="rounded-lg border border-border bg-card p-4">
              <label className="mb-3 block text-sm font-medium">Theme</label>
              <div className="inline-flex rounded-lg border border-border p-1">
                {themeOptions.map((opt) => {
                  const Icon = opt.icon;
                  const isActive = theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setTheme(opt.value)}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Choose your preferred color scheme. System uses your OS setting.
              </p>
            </div>
          </section>

          {/* exe.dev Configuration */}
          <section>
            <h2 className="mb-4 text-base font-semibold">exe.dev Configuration</h2>
            
            {/* Server URL */}
            <div className="mb-4 rounded-lg border border-border bg-card p-4">
              <label className="mb-2 block text-sm font-medium">Server Public URL</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://agenthq.example.com"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <Button size="sm" onClick={handleSaveServerUrl} disabled={loading}>
                  Save
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                The public URL where exe.dev daemons can connect back to this server
              </p>
            </div>

            {/* Daemon Auth Token */}
            <div className="rounded-lg border border-border bg-card p-4">
              <label className="mb-2 block text-sm font-medium">Daemon Auth Token</label>
              <div className="flex items-center gap-2">
                {config?.hasDaemonAuthToken ? (
                  <>
                    <input
                      type="password"
                      value="••••••••••••••••"
                      disabled
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <span className="text-xs text-green-500">Configured</span>
                  </>
                ) : (
                  <>
                    <input
                      type="password"
                      value={daemonAuthToken}
                      onChange={(e) => setDaemonAuthToken(e.target.value)}
                      placeholder="Enter a secure token"
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <Button size="sm" onClick={handleSaveDaemonAuthToken} disabled={loading || !daemonAuthToken.trim()}>
                      Save
                    </Button>
                  </>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Token that remote exe.dev daemons use to authenticate with this server. Local daemons connect without authentication.
              </p>
            </div>
          </section>

          {/* SSH Key Info */}
          <section>
            <h2 className="mb-4 text-base font-semibold">SSH Key</h2>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                The server uses a dedicated SSH key to communicate with exe.dev VMs.
              </p>
              <p className="mt-2 text-sm">
                Key location: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">~/.ssh/id_ed25519_exe</code>
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Add the public key to your exe.dev account at{' '}
                <a href="https://exe.dev" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  exe.dev
                </a>
              </p>
            </div>
          </section>

          {/* Create New Environment */}
          <section>
            <h2 className="mb-4 text-base font-semibold">Create exe.dev Environment</h2>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium">Display Name</label>
                  <input
                    type="text"
                    value={newEnvName}
                    onChange={(e) => setNewEnvName(e.target.value)}
                    placeholder="My Dev VM"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium">VM Name</label>
                  <input
                    type="text"
                    value={newVmName}
                    onChange={(e) => setNewVmName(e.target.value)}
                    placeholder="my-vm"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <Button
                className="mt-4"
                onClick={handleCreateEnv}
                disabled={loading || !newEnvName.trim() || !newVmName.trim()}
              >
                Create Environment
              </Button>
            </div>
          </section>

          {/* Environments List */}
          <section>
            <h2 className="mb-4 text-base font-semibold">exe.dev Environments</h2>
            {exeEnvs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
                No exe.dev environments configured. Create one above.
              </div>
            ) : (
              <div className="space-y-3">
                {exeEnvs.map((env) => (
                  <div key={env.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{env.name}</span>
                          <span
                            className={`inline-flex h-2 w-2 rounded-full ${
                              env.status === 'connected' ? 'bg-green-500' : 'bg-gray-500'
                            }`}
                          />
                          <span className="text-xs text-muted-foreground">
                            {env.status}
                          </span>
                        </div>
                        {env.vmName && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            VM: {env.vmName}
                          </p>
                        )}
                        {env.vmSshDest && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            SSH: {env.vmSshDest}
                          </p>
                        )}
                        {env.capabilities && env.capabilities.length > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Capabilities: {env.capabilities.join(', ')}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {env.status !== 'connected' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleProvisionEnv(env.id)}
                            disabled={loading}
                          >
                            Provision
                          </Button>
                        )}
                        {env.status === 'connected' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleUpdateDaemon(env.id)}
                              disabled={loading}
                            >
                              Update
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRestartDaemon(env.id)}
                              disabled={loading}
                            >
                              Restart
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-400 hover:bg-red-500/10 hover:text-red-400"
                          onClick={() => handleDeleteEnv(env.id)}
                          disabled={loading}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
