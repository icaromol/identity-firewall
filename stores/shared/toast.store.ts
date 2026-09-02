// A minimal global toast/snackbar system, shared by both entrypoints
// (popup and options) the same way every other store under stores/ is --
// each page has its own separate JS execution context and Pinia instance,
// so a toast pushed in one page's context never appears in the other's;
// each page mounts its own components/ui/ToastHost.vue to render whatever
// it pushed.
//
// Deliberately NOT a third-party toast library -- matches this project's
// established zero-UI-dependency convention (Phase 6's own hand-rolled-
// tabs decision, confirmed with the user over shadcn-vue).
//
// Reserved for TRANSIENT, positive-or-neutral feedback ("Saved.",
// "Backup downloaded.") -- an error a user needs to actually read and
// react to stays inline near the control that caused it (this project's
// existing convention throughout every store's own `error`/`saveError`/
// `actionError` field), not in a toast that can auto-dismiss before it's
// read.
import { defineStore } from 'pinia';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

const AUTO_DISMISS_MS = 3000;

export interface ToastStoreState {
  toasts: Toast[];
}

export const useToastStore = defineStore('toast', {
  state: (): ToastStoreState => ({
    toasts: [],
  }),
  actions: {
    push(message: string, variant: ToastVariant = 'info'): void {
      const id = crypto.randomUUID();
      this.toasts.push({ id, message, variant });
      setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS);
    },

    dismiss(id: string): void {
      this.toasts = this.toasts.filter((toast) => toast.id !== id);
    },
  },
});
