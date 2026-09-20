// Export code (spec §8, §8.1): copies the current request rendered as
// cURL/Python/TypeScript to the clipboard, falling back to a read-only
// dialog when the Clipboard API is missing or rejects.
import { useEffect, useRef, useState } from 'react';
import { exportRequest, type ExportTarget } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';

const TARGETS: readonly { target: ExportTarget; label: string }[] = [
  { target: 'curl', label: 'cURL' },
  { target: 'python', label: 'Python' },
  { target: 'typescript', label: 'TypeScript' },
];

const COPIED_TIMEOUT_MS = 2000;

export function ExportMenu() {
  const { state } = useWorkbench();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dialogCode, setDialogCode] = useState<string | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
    },
    [],
  );

  useEffect(() => {
    if (dialogCode !== undefined) textareaRef.current?.select();
  }, [dialogCode]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open && dialogCode === undefined) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (dialogCode !== undefined) setDialogCode(undefined);
      else setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, dialogCode]);

  async function choose(target: ExportTarget) {
    const code = exportRequest(target, state.wb.request);
    setOpen(false);
    try {
      const clipboard = navigator.clipboard;
      if (clipboard === undefined) throw new Error('Clipboard API unavailable');
      await clipboard.writeText(code);
      setCopied(true);
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), COPIED_TIMEOUT_MS);
    } catch {
      setDialogCode(code);
    }
  }

  return (
    <div className="sel" ref={rootRef}>
      <button type="button" className="ghost" onClick={() => setOpen((o) => !o)}>
        Export code
      </button>
      {open && (
        <div role="menu">
          {TARGETS.map((t) => (
            <button
              key={t.target}
              type="button"
              role="menuitem"
              onClick={() => void choose(t.target)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {copied && <span role="status">Copied</span>}
      {dialogCode !== undefined && (
        <div role="dialog" aria-label="Exported code">
          <textarea ref={textareaRef} readOnly value={dialogCode} />
          <button type="button" onClick={() => setDialogCode(undefined)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
