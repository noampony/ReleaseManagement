import { useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import './primitives.css';

export type Tone = 'neutral' | 'berry' | 'amber' | 'green' | 'blue' | 'danger';

export function BoardHeader({ title, eyebrow, description, actions }: {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return <header className="board-header">
    <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="board-description">{description}</p>}</div>
    {actions && <div className="board-header-actions">{actions}</div>}
  </header>;
}

export function FilterBar({ children, label = 'Board filters', ...props }: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return <div {...props} className={`filter-bar ${props.className ?? ''}`} role="group" aria-label={label}>{children}</div>;
}

export function FilterSelect({ label, value, options, onChange, id }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  id?: string;
}) {
  const generatedId = useId();
  return <label className="filter-control" htmlFor={id ?? generatedId}><span>{label}</span><select id={id ?? generatedId} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export function FilterInput({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return <label className="filter-control" htmlFor={props.id ?? id}><span>{label}</span><input {...props} id={props.id ?? id} /></label>;
}

export function GroupedSection({ title, count, children, defaultOpen = true, className = '' }: {
  title: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return <section className={`grouped-section component-group ${className}`}>
    <h2 className="grouped-heading"><button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen((current) => !current)}><span>{title}</span>{count !== undefined && <span className="group-count">{count}</span>}<span className="group-chevron" aria-hidden="true">{open ? '⌄' : '›'}</span></button></h2>
    {open && <div id={contentId} className="grouped-content">{children}</div>}
  </section>;
}

export function CompactRow({ title, summary, meta, children, onOpen, className = '', ...props }: {
  title: ReactNode;
  summary?: string;
  meta?: ReactNode;
  children?: ReactNode;
  onOpen?: () => void;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  const [expanded, setExpanded] = useState(false);
  const content = <>
    <div className="compact-row-main"><div className="compact-row-copy"><strong>{title}</strong>{summary && <TruncatedText text={summary} />}</div>{meta && <div className="compact-row-meta">{meta}</div>}{(onOpen || children) && <span className="row-chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span>}</div>
    {expanded && children && <div className="component-detail compact-row-detail" onClick={(event) => event.stopPropagation()}>{children}</div>}
  </>;
  return <article {...props} className={`compact-row component-row${expanded ? ' component-row-open' : ''} ${className}`}>
    {onOpen ? <button type="button" className="compact-row-trigger" aria-label={`Open details for ${typeof title === 'string' ? title : 'item'}`} onClick={onOpen}>{content}</button> : children ? <button type="button" className="compact-row-trigger" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{content}</button> : <div className="compact-row-trigger">{content}</div>}
  </article>;
}

export function DetailDrawer({ open, title, onClose, triggerRef, children, labelledBy }: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  triggerRef?: { current: HTMLElement | null };
  children: ReactNode;
  labelledBy?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const priorFocus = useRef<HTMLElement | null>(null);
  const pendingRestore = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) {
      const target = triggerRef?.current ?? pendingRestore.current;
      pendingRestore.current = null;
      target?.focus();
      return undefined;
    }
    priorFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) { event.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      pendingRestore.current = triggerRef?.current ?? priorFocus.current;
    };
  }, [open, onClose, triggerRef]);
  if (!open) return null;
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={dialogRef} className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? headingId} tabIndex={-1}>
      <header className="drawer-header"><h2 id={headingId}>{title}</h2><button ref={closeButtonRef} type="button" className="drawer-close" aria-label="Close details" onClick={onClose}>×</button></header>
      <div className="drawer-content">{children}</div>
    </aside>
  </div>;
}

export function StatusPill({ children, tone = 'neutral', className = '' }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={`status-pill tone-${tone} ${className}`}>{children}</span>;
}

export function RiskPill({ level }: { level: string }) {
  const key = level.toLowerCase();
  const tone: Tone = key === 'high' || key === 'critical' ? 'berry' : key === 'medium' ? 'amber' : key === 'low' ? 'blue' : 'neutral';
  const label = key === 'critical' ? 'C' : key === 'high' ? 'H' : key === 'medium' ? 'M' : key === 'low' ? 'L' : undefined;
  return <StatusPill tone={tone}>{label && <span className="pill-initial" aria-hidden="true">{label}</span>}{level}</StatusPill>;
}

export function SeverityPill({ level }: { level: string }) {
  return <RiskPill level={level} />;
}

export function Avatar({ name, src, size = 'medium', active = false }: { name: string; src?: string; size?: 'small' | 'medium'; active?: boolean }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  return <span className={`person-avatar avatar-${size}${active ? ' avatar-active' : ''}`} role="img" aria-label={name} title={name}>{src ? <img src={src} alt="" /> : initials}</span>;
}

export function AvatarStack({ people, limit = 4 }: { people: Array<{ name: string; src?: string; active?: boolean }>; limit?: number }) {
  const visible = people.slice(0, limit);
  const remaining = people.length - visible.length;
  return <span className="avatar-stack avatar-stack-shared" aria-label={people.map((person) => person.name).join(', ')}>{visible.map((person) => <Avatar key={`${person.name}-${person.src ?? ''}`} {...person} size="small" />)}{remaining > 0 && <span className="avatar-overflow" aria-label={`${remaining} more people`}>+{remaining}</span>}</span>;
}

export function TruncatedText({ text, className = '' }: { text: string; className?: string }) {
  return <span className={`truncated-text ${className}`} tabIndex={0} aria-label={text} title={text}><span className="truncated-text-value">{text}</span><span className="component-tooltip truncation-tooltip" role="tooltip">{text}</span></span>;
}

export function Banner({ tone = 'info', title, children, action }: { tone?: 'info' | 'success' | 'warning' | 'error'; title?: string; children: ReactNode; action?: ReactNode }) {
  return <div className={`state-banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><div>{title && <strong>{title}</strong>}<div>{children}</div></div>{action && <div className="banner-action">{action}</div>}</div>;
}

export function EmptyState({ title, description, action, className = '' }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return <div className={`board-state empty-state ${className}`} role="status"><span className="state-mark" aria-hidden="true">⌕</span><h3>{title}</h3>{description && <p>{description}</p>}{action && <div className="state-action">{action}</div>}</div>;
}

export function LoadingState({ label = 'Loading items', rows = 3 }: { label?: string; rows?: number }) {
  return <div className="loading-state" role="status" aria-label={label} aria-busy="true">{Array.from({ length: rows }, (_, index) => <div className="loading-row" key={index}><span /><i /><b /></div>)}<span className="visually-hidden">{label}…</span></div>;
}

export function ErrorState({ title = 'We couldn’t load this board', description = 'Your data is still safe. Try again.', onRetry }: { title?: string; description?: string; onRetry: () => void }) {
  return <div className="board-state error-state" role="alert"><span className="state-mark" aria-hidden="true">!</span><h3>{title}</h3><p>{description}</p><button type="button" className="primitive-button" onClick={onRetry}>Try again</button></div>;
}

export function ActionItemRow({ text, owner, checked, onCheckedChange, jiraKey, eta, className = '' }: {
  text: string;
  owner?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  jiraKey?: string;
  eta?: string;
  className?: string;
}) {
  const id = useId();
  return <div className={`action-item-row ${className}`}><label htmlFor={id} className="action-item-label"><input id={id} type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} /><span className="action-item-text">{text}</span></label>{owner && <span className="action-item-owner">{owner}</span>}{jiraKey && <span className="action-item-jira">{jiraKey}</span>}{eta && <time className="action-item-eta">{eta}</time>}</div>;
}
