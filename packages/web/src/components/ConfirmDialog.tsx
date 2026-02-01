// Reusable confirmation dialog component

import { useEffect, useCallback } from 'react';
import { AlertTriangle, Trash2, Archive, XCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

type IconType = 'warning' | 'trash' | 'archive' | 'stop';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  secondaryLabel?: string;
  variant?: 'default' | 'destructive';
  icon?: IconType;
  onConfirm: () => void;
  onCancel: () => void;
  onSecondary?: () => void;
}

const iconMap = {
  warning: AlertTriangle,
  trash: Trash2,
  archive: Archive,
  stop: XCircle,
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  secondaryLabel,
  variant = 'default',
  icon = 'warning',
  onConfirm,
  onCancel,
  onSecondary,
}: ConfirmDialogProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm();
    }
  }, [onConfirm]);

  useEffect(() => {
    if (open) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  const Icon = iconMap[icon];
  const isDestructive = variant === 'destructive';

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              isDestructive 
                ? 'bg-red-500/10 text-red-400' 
                : 'bg-amber-500/10 text-amber-400'
            )}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex flex-col gap-1 pt-0.5">
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{cancelLabel}</AlertDialogCancel>
          {secondaryLabel && onSecondary && (
            <AlertDialogAction
              onClick={onSecondary}
              className="border border-border bg-secondary/50 text-secondary-foreground hover:bg-secondary/80"
            >
              {secondaryLabel}
            </AlertDialogAction>
          )}
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(
              isDestructive && 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-600'
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
