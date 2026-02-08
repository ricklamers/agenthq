import { useEffect, useState, type FormEvent } from 'react';
import { Github, Link2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AddRepoDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (url: string) => Promise<void>;
}

export function AddRepoDialog({ open, onClose, onSubmit }: AddRepoDialogProps) {
  const [url, setUrl] = useState('https://github.com/owner/repo');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUrl('https://github.com/owner/repo');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Please enter a GitHub repository URL.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add repository';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && !submitting && onClose()}>
      <AlertDialogContent className="max-w-lg">
        <form onSubmit={handleSubmit}>
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Github className="h-5 w-5" />
              </div>
              <div className="flex flex-col gap-1 pt-0.5">
                <AlertDialogTitle>Add GitHub Repo</AlertDialogTitle>
                <AlertDialogDescription>
                  Paste a GitHub URL and Agent HQ will clone it into your local workspace. Use an SSH URL for private repos.
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>

          <div className="px-5 pb-4 pt-2">
            <label htmlFor="repo-url" className="mb-2 block text-sm font-medium text-foreground">
              Repository URL
            </label>
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="repo-url"
                type="text"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoFocus
                placeholder="https://github.com/owner/repo or git@github.com:owner/repo.git"
                className={cn(
                  'w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                  error && 'border-destructive'
                )}
              />
            </div>
            {error ? (
              <p className="mt-2 text-xs text-destructive">{error}</p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Supports GitHub HTTPS and SSH URLs.
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Repo'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
