import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, mergeSettings, DEFAULT_SETTINGS, type AppSettings } from "../data/db";
import type { TaskInput } from "../data/repo";
import { desktop } from "../desktop";

/* ---------------- Settings ---------------- */

export function useSettings(): AppSettings {
  const s = useLiveQuery(() => db.settings.get("app"), [], undefined);
  return s ? mergeSettings(s) : DEFAULT_SETTINGS;
}

/* ---------------- Toasts with undo ---------------- */

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface ToastApi {
  show: (message: string, action?: Toast["action"]) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback<ToastApi["show"]>((message, action) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), message, action });
    timer.current = window.setTimeout(() => setToast(null), action ? 5000 : 2800);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6"
      >
        {toast && (
          <div
            key={toast.id}
            className="sheet-in pointer-events-auto flex items-center gap-4 rounded-xl bg-ink px-4 py-3 text-sm text-bg shadow-lg"
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                className="font-semibold text-accent-soft underline-offset-2 hover:underline"
                onClick={() => {
                  toast.action?.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------------- Task editor ---------------- */

export interface EditorRequest {
  taskId?: string;
  defaults?: Partial<TaskInput>;
}

interface EditorApi {
  request: EditorRequest | null;
  open: (req?: EditorRequest) => void;
  close: () => void;
}

const EditorContext = createContext<EditorApi>({ request: null, open: () => {}, close: () => {} });
export const useEditor = () => useContext(EditorContext);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<EditorRequest | null>(null);
  const open = useCallback((req: EditorRequest = {}) => setRequest(req), []);
  const close = useCallback(() => setRequest(null), []);

  // "q" opens a new task from anywhere, unless the user is typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        setRequest({});
      }
    }
    window.addEventListener("keydown", onKey);
    // The Windows app's global shortcut (Ctrl+Shift+Space) and tray menu.
    const stopQuickAdd = desktop?.onQuickAdd(() => setRequest({}));
    return () => {
      window.removeEventListener("keydown", onKey);
      stopQuickAdd?.();
    };
  }, []);

  return <EditorContext.Provider value={{ request, open, close }}>{children}</EditorContext.Provider>;
}
