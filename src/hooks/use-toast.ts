"use client";

import { toast } from "sonner";

// Тонкая обёртка над sonner (раньше был react-toastify). API тот же:
// showLoading возвращает id (string|number), который потом гасим через dismissToast.
export function useToast() {
  return {
    showSuccess: (message: string) => toast.success(message),
    showError: (message: string) => toast.error(message),
    showLoading: (message: string) => toast.loading(message),
    dismissToast: (id?: string | number) => {
      toast.dismiss(id);
    },
  };
}
