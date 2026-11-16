"use client";
import { cn } from "@/lib/utils";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle2, AlertTriangle, ChevronDown, Check } from "lucide-react";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel rounded-2xl", className)} {...props} />;
}
export function Button({ className, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const base = "btn-base focus-visible:outline-none disabled:opacity-55 disabled:pointer-events-none";
  const styles = {
    primary: "btn-base-primary",
    secondary: "btn-base-secondary",
    ghost: "btn-base-ghost",
    danger: "btn-base-danger",
  }[variant];
  return <button className={cn(base, styles, className)} {...props} />;
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("input-base", props.className)} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("input-base min-h-[120px] h-auto py-3 resize-y", props.className)} />;
}
type SelectOption = { value: string; label: React.ReactNode; disabled?: boolean };

export function Select({ className, children, value, onChange, disabled, name }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const options = useMemo<SelectOption[]>(() => {
    const out: SelectOption[] = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      if ((child.type as any) === "option" || (child as any).props?.value !== undefined) {
        const props: any = (child as any).props || {};
        out.push({ value: String(props.value ?? ""), label: props.children, disabled: !!props.disabled });
      }
    });
    return out;
  }, [children]);

  const selected = options.find(o => String(o.value) === String(value ?? "")) || options[0];

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, []);

  function pick(v: string) {
    if (disabled) return;
    onChange?.({ target: { value: v, name }, currentTarget: { value: v, name } } as any);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className={cn("select-wrap custom-select", open && "open")} data-disabled={disabled ? "true" : "false"}>
      {name ? <input type="hidden" name={name} value={String(value ?? "")} /> : null}
      <button
        type="button"
        disabled={disabled}
        className={cn("input-base select-trigger custom-select-trigger", open && "is-open", className)}
        onClick={() => !disabled && setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={cn("truncate text-left", !selected && "text-zinc-500")}>{selected?.label ?? "Pilih..."}</span>
        <ChevronDown size={16} className={cn("select-chevron", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && !disabled && (
        <div className="custom-select-menu" role="listbox">
          {options.map((opt) => {
            const active = String(opt.value) === String(value ?? "");
            return (
              <button
                key={opt.value + String(opt.label)}
                type="button"
                role="option"
                aria-selected={active}
                disabled={opt.disabled}
                className={cn("custom-select-item", active && "active")}
                onClick={() => !opt.disabled && pick(opt.value)}
              >
                <span className="truncate flex-1 text-left">{opt.label}</span>
                {active ? <Check size={14} className="text-violet-300 shrink-0" /> : null}
              </button>
            );
          })}
          {options.length === 0 && <div className="px-3 py-2 text-sm text-zinc-500">Tidak ada opsi</div>}
        </div>
      )}
    </div>
  );
}
export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs border border-white/10 bg-white/5 text-zinc-300", className)}>{children}</span>;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="space-y-2 min-w-0">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-white break-words">{title}</h1>
        {description ? <p className="text-zinc-400 text-base leading-relaxed max-w-3xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">{actions}</div> : null}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => !busy && onCancel()} />
      <div className="relative w-full max-w-md panel rounded-2xl p-5 shadow-2xl ring-1 ring-white/10 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start gap-3">
          <div className={cn("mt-0.5 h-9 w-9 rounded-xl grid place-items-center border", variant === "danger" ? "bg-red-500/10 border-red-500/20 text-red-300" : "bg-violet-500/10 border-violet-500/20 text-violet-300")}> 
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-lg leading-tight">{title}</div>
            {description && <div className="text-sm text-zinc-400 mt-1">{description}</div>}
          </div>
          <button className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-white/5" onClick={onCancel} disabled={busy} aria-label="Close"><X size={16}/></button>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{cancelText}</Button>
          <Button variant={variant} onClick={onConfirm} disabled={busy}>{busy ? "Processing..." : confirmText}</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function Toast({
  open,
  message,
  type = "success",
  onClose,
}: {
  open: boolean;
  message: string;
  type?: "success" | "error";
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onClose, 2600);
    return () => clearTimeout(t);
  }, [open, onClose, message]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed bottom-5 right-5 z-[100]">
      <div className={cn("panel rounded-xl px-4 py-3 shadow-xl border flex items-center gap-3 min-w-[260px] max-w-[90vw]", type === "success" ? "border-emerald-500/20" : "border-red-500/20")}> 
        <div className={cn("h-8 w-8 rounded-lg grid place-items-center", type === "success" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300")}>
          {type === "success" ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>}
        </div>
        <div className="text-sm text-zinc-100 flex-1">{message}</div>
        <button className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-white/5" onClick={onClose} aria-label="Close"><X size={14}/></button>
      </div>
    </div>,
    document.body
  );
}
