import { FormEvent, useEffect, useState } from 'react';
import { Button } from './ui/button';

interface LoginPageProps {
  onAuthenticated: (username: string) => void;
}

interface LoginResponse {
  authenticated?: boolean;
  user?: {
    username: string;
  };
  devicePinRequired?: boolean;
  error?: string;
}

interface DevicePinStatusResponse {
  canUsePin?: boolean;
}

const DEVICE_ID_STORAGE_KEY = 'agenthq:device-id';

function generateDeviceId(): string {
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getOrCreateDeviceId(): string {
  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing && existing.length >= 16) {
    return existing;
  }

  const next = generateDeviceId();
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
  return next;
}

function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin.trim());
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [initializing, setInitializing] = useState(true);
  const [canUsePin, setCanUsePin] = useState(false);
  const [mode, setMode] = useState<'password' | 'pin'>('password');

  const [username, setUsername] = useState('ricklamers');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const [requirePinSetup, setRequirePinSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkDevicePinStatus = async () => {
      try {
        const response = await fetch(`/api/auth/device-pin/status?deviceId=${encodeURIComponent(deviceId)}`);
        const payload = (await response.json().catch(() => ({}))) as DevicePinStatusResponse;
        if (cancelled) return;

        const pinAvailable = !!payload.canUsePin;
        setCanUsePin(pinAvailable);
        setMode(pinAvailable ? 'pin' : 'password');
      } catch {
        if (!cancelled) {
          setCanUsePin(false);
          setMode('password');
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    };

    void checkDevicePinStatus();
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    if (requirePinSetup) {
      if (!isValidPin(pin)) {
        setError('PIN must be 4 to 8 digits');
        setSubmitting(false);
        return;
      }
      if (pin.trim() !== pinConfirmation.trim()) {
        setError('PIN confirmation does not match');
        setSubmitting(false);
        return;
      }
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          deviceId,
          devicePin: requirePinSetup ? pin.trim() : undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as LoginResponse;

      if (response.status === 428 || payload.devicePinRequired) {
        setRequirePinSetup(true);
        setError(payload.error ?? 'Set a PIN for this device before continuing');
        return;
      }

      if (!response.ok || !payload.authenticated || !payload.user) {
        setError(payload.error ?? 'Login failed');
        return;
      }

      onAuthenticated(payload.user.username);
      setPassword('');
      setPin('');
      setPinConfirmation('');
    } catch {
      setError('Unable to reach server');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePinSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    if (!isValidPin(pin)) {
      setError('PIN must be 4 to 8 digits');
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/device-pin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          pin: pin.trim(),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as LoginResponse;
      if (!response.ok || !payload.authenticated || !payload.user) {
        setError(payload.error ?? 'PIN login failed');
        return;
      }

      onAuthenticated(payload.user.username);
      setPin('');
    } catch {
      setError('Unable to reach server');
    } finally {
      setSubmitting(false);
    }
  };

  if (initializing) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background px-4 [height:100svh]">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-lg">
          Checking this device...
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background px-4 [height:100svh]">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg">
        <h1 className="text-xl font-semibold">Sign in to Agent HQ</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === 'pin' ? 'Use your device PIN to continue.' : 'Enter your account password to continue.'}
        </p>

        {mode === 'pin' ? (
          <form className="mt-6 space-y-4" onSubmit={handlePinSubmit}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Device PIN</span>
              <input
                type="password"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </label>

            {error && (
              <div className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in...' : 'Sign in with PIN'}
            </Button>

            <button
              type="button"
              className="w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setMode('password');
                setError(null);
                setPin('');
              }}
            >
              Use password instead
            </button>
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handlePasswordSubmit}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Username</span>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </label>

            {requirePinSetup && (
              <>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">New device PIN (4-8 digits)</span>
                  <input
                    type="password"
                    value={pin}
                    onChange={(event) => setPin(event.target.value)}
                    inputMode="numeric"
                    autoComplete="new-password"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Confirm device PIN</span>
                  <input
                    type="password"
                    value={pinConfirmation}
                    onChange={(event) => setPinConfirmation(event.target.value)}
                    inputMode="numeric"
                    autoComplete="new-password"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </label>
              </>
            )}

            {error && (
              <div className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in...' : requirePinSetup ? 'Set PIN and sign in' : 'Sign in'}
            </Button>

            {canUsePin && (
              <button
                type="button"
                className="w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => {
                  setMode('pin');
                  setError(null);
                  setPassword('');
                  setRequirePinSetup(false);
                }}
              >
                Use PIN instead
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
