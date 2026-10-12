import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AvatarStack, DetailDrawer, ErrorState, FilterBar, FilterInput, FilterSelect, GroupedSection, LoadingState, RiskPill, StatusPill } from './components/primitives';
import './styles/tokens.css';
import './release-board.css';

type Person = { id: string; display_name: string; avatar_url?: string | null };
type Step = { id: string; deployment_id: string; sort_order: number; label: string; state: string; clusters_done?: number | null; clusters_total?: number | null; occurred_on?: string | null; note?: string | null; version: number; scope_label?: string | null };
type Deployment = { id: string; title: string; category: string; version_label?: string | null; content?: string | null; risk_level?: string | null; risk_notes?: string | null; rollback_plan?: string | null; planned_start_date?: string | null; qa_verified: boolean; qa_verified_at?: string | null; qa_link?: string | null; confluence_url?: string | null; state: string; lifecycle: string; done_at?: string | null; version: number; owners: Person[]; steps: Step[]; action_items: Array<Record<string, unknown>>; history: Array<Record<string, unknown>>; comments: Array<Record<string, unknown>>; jira_links: Array<Record<string, unknown>> };
type Filters = { category: string; risk: string; owner: string; state: string; today: boolean; q: string };
const today = new Date().toISOString().slice(0, 10);
const initialFilters = (): Filters => {
  const params = new URLSearchParams(window.location.search);
  return { category: params.get('category') ?? '', risk: params.get('risk') ?? '', owner: params.get('owner') ?? '', state: params.get('state') ?? '', today: params.get('today') === '1', q: params.get('q') ?? '' };
};
const text = (value: unknown) => typeof value === 'string' && value ? value : '—';
const labelForState = (value: string) => ({ in_rollout: 'In rollout', planned: 'Planned', qa: 'QA / Pending', done: 'Closed', reverted: 'Reverted' }[value] ?? value);
const toneForState = (value: string) => value === 'done' ? 'green' : value === 'in_progress' || value === 'qa' ? 'amber' : value === 'failed' || value === 'reverted' ? 'berry' : 'neutral';

function App() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [rows, setRows] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Deployment | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.category) params.set('category', filters.category);
    if (filters.risk) params.set('risk', filters.risk);
    if (filters.owner) params.set('owner', filters.owner);
    if (filters.state) params.set('state', filters.state);
    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (filters.today) params.set('today', '1');
    return params.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const params = new URLSearchParams(queryString); params.delete('today');
      const response = await fetch(`/api/deployments${params.size ? `?${params}` : ''}`);
      if (!response.ok) throw new Error('Could not load deployments');
      const base = await response.json() as Array<Omit<Deployment, 'steps' | 'action_items' | 'history' | 'comments' | 'jira_links'>>;
      const details = await Promise.all(base.map(async (item) => {
        const result = await fetch(`/api/deployments/${encodeURIComponent(item.id)}`);
        if (!result.ok) throw new Error('Could not load deployment details');
        return await result.json() as Deployment;
      }));
      setRows(details);
    } catch { setError(true); } finally { setLoading(false); }
  }, [queryString]);

  useEffect(() => {
    const next = queryString ? `?${queryString}` : window.location.pathname;
    window.history.replaceState(null, '', next);
    void load();
  }, [queryString, load]);

  const updateFilter = (key: keyof Filters, value: string | boolean) => setFilters((current) => ({ ...current, [key]: value }));
  const allRows = useMemo(() => filters.today ? rows.filter((row) => row.planned_start_date === today) : rows, [filters.today, rows]);
  const owners = useMemo(() => [...new Map(rows.flatMap((row) => row.owners).map((owner) => [owner.id, owner])).values()], [rows]);
  const groups = useMemo(() => {
    const result: Array<[string, Deployment[]]> = [
      ['In rollout', allRows.filter((row) => row.state === 'in_rollout')],
      ['Planned today', allRows.filter((row) => row.state === 'planned' && row.planned_start_date === today)],
      ['Planned later', allRows.filter((row) => row.state === 'planned' && row.planned_start_date !== today)],
      ['QA / Pending', allRows.filter((row) => row.state === 'qa')],
      ['Closed yesterday', allRows.filter((row) => row.lifecycle === 'done' || row.state === 'done')],
    ];
    return result;
  }, [allRows]);

  const updateStep = async (row: Deployment, step: Step, state: string) => {
    const next = state === step.state ? 'pending' : state;
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, steps: item.steps.map((candidate) => candidate.id === step.id ? { ...candidate, state: next } : candidate) } : item));
    try {
      const response = await fetch(`/api/rollout-steps/${encodeURIComponent(step.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: step.version, state: next }) });
      if (!response.ok) throw new Error('Step update failed');
      const updated = await response.json() as Step;
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, version: item.version + 1, steps: item.steps.map((candidate) => candidate.id === step.id ? updated : candidate) } : item));
      setNotice(`${step.label}: ${next.replace('_', ' ')}`); window.setTimeout(() => setNotice(''), 2600);
      if (selected?.id === row.id) setSelected((current) => current ? { ...current, steps: current.steps.map((candidate) => candidate.id === step.id ? updated : candidate) } : null);
    } catch { await load(); setNotice('Could not update rollout step. The latest server state has been restored.'); }
  };

  const reorder = async (row: Deployment, dragged: Step, target: Step) => {
    if (dragged.id === target.id) return;
    const reordered = [...row.steps]; const from = reordered.findIndex((step) => step.id === dragged.id); const to = reordered.findIndex((step) => step.id === target.id);
    reordered.splice(to, 0, reordered.splice(from, 1)[0]);
    const sorted = reordered.map((step, index) => ({ ...step, sort_order: index }));
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, steps: sorted } : item));
    try {
      const response = await fetch('/api/rollout-steps/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deployment_id: row.id, version: row.version, ordered_ids: reordered.map((step) => step.id) }) });
      if (!response.ok) throw new Error('Reorder failed');
      await load();
    } catch { await load(); setNotice('Could not save the step order. The latest server state has been restored.'); }
  };

  const navItems = ['Customer Commitments', 'Production Issues', 'Release Management'];
  return <main className="app-shell" aria-label="Daily R&D Sync">
    <header className="topbar"><a className="brand" href="#" aria-label="Daily R&D Sync home"><img src="/src/assets/check-point-logo-reversed.svg" alt="Check Point" /><span>Daily R&amp;D Sync</span></a><button className="date-stamp" type="button"><span aria-hidden="true">▦</span> MON 12 OCT 2026</button><label className="search-box"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search releases" aria-label="Search releases" value={filters.q} onChange={(event) => updateFilter('q', event.target.value)} /></label><div className="presence" aria-label="Seeded team"><span className="presence-dot" /><span>TEAM</span><div className="avatar-stack" aria-hidden="true"><i>AM</i><i>JL</i><i>ST</i></div></div><button className="meeting-button" type="button"><span aria-hidden="true">▶</span> Meeting Mode</button><button className="user-menu" type="button" aria-label="User menu for Noam"><span className="user-avatar">N</span><span className="user-name">Noam</span><span aria-hidden="true">⌄</span></button></header>
    <div className="page-content"><nav className="board-tabs" aria-label="Boards" role="tablist">{navItems.map((name, index) => <button key={name} className={`board-tab${index === 2 ? ' active' : ''}`} type="button" role="tab" aria-selected={index === 2}>{name}<span className="count-badge">{index === 2 ? rows.length : '—'}</span></button>)}</nav>
      <section className="release-heading"><div><p className="eyebrow">BOARD 03 · DEPLOYMENTS</p><h1>Release Management</h1><p className="board-description">A clear view of release risk, ownership, and rollout progress.</p></div><span className="unit-tag">{allRows.length} RELEASES</span></section>
      <details className="ground-rules"><summary><span className="rules-icon" aria-hidden="true">i</span><span><strong>Ground rules</strong><small>Shared release and rollout guidance</small></span><span className="group-chevron" aria-hidden="true">⌄</span></summary><div className="rules-columns"><div><h2>Risks</h2><p>Regression (functional / performance) · Stability (downtime / timeouts / retries / errors) · Service continuity.</p></div><div><h2>Deployment plan</h2><p>Graduality · Consider the region's local time · Variety: brands, customer size.</p></div></div></details>
      <FilterBar className="release-filters"><FilterSelect label="CATEGORY" value={filters.category} onChange={(value) => updateFilter('category', value)} options={[{ value: '', label: 'All categories' }, { value: 'infrastructure', label: 'Infrastructure' }, { value: 'application', label: 'Application' }]} /><FilterSelect label="RISK" value={filters.risk} onChange={(value) => updateFilter('risk', value)} options={[{ value: '', label: 'All risks' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} /><FilterSelect label="OWNER" value={filters.owner} onChange={(value) => updateFilter('owner', value)} options={[{ value: '', label: 'All owners' }, ...owners.map((owner) => ({ value: owner.id, label: owner.display_name }))]} /><FilterSelect label="STATE" value={filters.state} onChange={(value) => updateFilter('state', value)} options={[{ value: '', label: 'All states' }, { value: 'in_rollout', label: 'In rollout' }, { value: 'planned', label: 'Planned' }, { value: 'qa', label: 'QA / Pending' }, { value: 'done', label: 'Closed' }, { value: 'reverted', label: 'Reverted' }]} /><label className="today-toggle"><input type="checkbox" checked={filters.today} onChange={(event) => updateFilter('today', event.target.checked)} />Today only</label><button type="button" className="clear-filters" onClick={() => setFilters({ category: '', risk: '', owner: '', state: '', today: false, q: '' })}>Reset filters</button></FilterBar>
      {notice && <div className="board-notice" role="status">{notice}</div>}
      {loading ? <LoadingState label="Loading release deployments" rows={4} /> : error ? <ErrorState onRetry={() => void load()} /> : <div className="release-groups">{groups.map(([name, items], index) => <GroupedSection key={name} title={name} count={items.length} defaultOpen={index === 0 || items.length > 0} className="release-group">{items.length ? items.map((row) => <ReleaseRow key={row.id} row={row} expanded={expanded === row.id} onExpand={() => setExpanded((current) => current === row.id ? null : row.id)} onOpen={() => setSelected(row)} onState={(step, state) => void updateStep(row, step, state)} onReorder={(dragged, target) => void reorder(row, dragged, target)} />) : <p className="group-empty">No releases in this group</p>}</GroupedSection>)}</div>}
    </div>
    <DetailDrawer open={Boolean(selected)} title={selected?.title ?? ''} onClose={() => setSelected(null)}>{selected && <ReleaseDetails row={selected} />}</DetailDrawer>
  </main>;
}

function ReleaseRow({ row, expanded, onExpand, onOpen, onState, onReorder }: { row: Deployment; expanded: boolean; onExpand: () => void; onOpen: () => void; onState: (step: Step, state: string) => void; onReorder: (dragged: Step, target: Step) => void }) {
  const totals = row.steps.reduce((total, step) => {
    const clusterTotal = step.clusters_total ?? 1;
    const done = step.clusters_done ?? (step.state === 'done' || step.state === 'skipped' ? clusterTotal : 0);
    return { done: total.done + done, total: total.total + clusterTotal };
  }, { done: 0, total: 0 });
  const [dragId, setDragId] = useState<string | null>(null);
  return <article className={`release-row component-row${expanded ? ' component-row-open' : ''}`}>
    <div className="release-row-main"><button className="release-title-button" type="button" onClick={onExpand} aria-expanded={expanded}><span className="release-title-line"><strong>{row.title}</strong><span className="version-chip">{text(row.version_label)}</span></span><span className="release-summary">{text(row.content)}</span></button><div className="release-meta"><RiskPill level={text(row.risk_level)} /><AvatarStack people={row.owners.map((person) => ({ name: person.display_name, src: person.avatar_url ?? undefined }))} /><time className="date-stamp compact-date">{row.planned_start_date ?? 'No date'}</time>{row.qa_verified && <StatusPill tone="green" className="qa-badge">✓ QA verified</StatusPill>}</div><RolloutBar steps={row.steps} /><span className="cluster-count">{totals.done}/{totals.total}<small> clusters</small></span><button className="row-details" type="button" onClick={onOpen} aria-label={`Open full details for ${row.title}`}>Details <span aria-hidden="true">↗</span></button></div>
    {expanded && <div className="rollout-inline component-detail"><div className="inline-heading"><div><strong>Rollout plan</strong><span>{row.steps.length} steps · drag to reorder</span></div><button type="button" className="text-button" onClick={onOpen}>Open full details</button></div>{row.steps.length ? <ol className="step-list">{row.steps.map((step) => <li key={step.id} className="step-item" draggable onDragStart={() => setDragId(step.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => { const source = row.steps.find((item) => item.id === dragId); if (source) onReorder(source, step); setDragId(null); }}><button type="button" className="drag-handle" aria-label={`Drag to reorder ${step.label}`} title="Drag to reorder">⠿</button><span className="step-label">{step.label}</span><label className="step-state"><span className="visually-hidden">State for {step.label}</span><select value={step.state} onChange={(event) => onState(step, event.target.value)}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="skipped">Skipped</option><option value="failed">Failed</option></select></label><time className="step-date">{step.occurred_on ?? '—'}</time>{step.note && <span className="step-note">{step.note}</span>}{step.clusters_total !== null && step.clusters_total !== undefined && <span className="step-clusters">{step.clusters_done ?? 0}/{step.clusters_total} clusters</span>}</li>)}</ol> : <p className="group-empty">No rollout steps recorded</p>}</div>}
  </article>;
}

function RolloutBar({ steps }: { steps: Step[] }) {
  return <div className="rollout-bar" role="group" aria-label="Rollout progress by step">{steps.length ? steps.map((step) => <span key={step.id} className={`rollout-segment segment-${step.state}`} tabIndex={0} aria-label={`${step.label}: ${step.state.replace('_', ' ')}`} title={`${step.label} · ${step.state.replace('_', ' ')}`}><span role="tooltip">{step.label} · {step.state.replace('_', ' ')}</span></span>) : <span className="rollout-empty">No steps</span>}</div>;
}

function ReleaseDetails({ row }: { row: Deployment }) {
  return <div className="release-details"><div className="detail-tag-row"><RiskPill level={text(row.risk_level)} /><StatusPill tone={toneForState(row.state)}>{labelForState(row.state)}</StatusPill><span className="version-chip">{text(row.version_label)}</span></div><DetailSection title="Content / what is in the release"><p>{text(row.content)}</p></DetailSection><DetailSection title="Risk management notes"><p>{text(row.risk_notes)}</p></DetailSection><DetailSection title="Rollback plan"><p>{text(row.rollback_plan)}</p></DetailSection><DetailSection title="QA verification">{row.qa_verified ? <div className="qa-detail"><StatusPill tone="green">✓ QA verified</StatusPill><span>{row.qa_verified_at ? new Date(row.qa_verified_at).toLocaleDateString() : 'Verified date not recorded'}</span>{row.qa_link && <a href={row.qa_link} target="_blank" rel="noreferrer">QA evidence ↗</a>}</div> : <p>QA verification not recorded</p>}</DetailSection><DetailSection title="Linked Jira issues">{row.jira_links.length ? <ul className="detail-link-list">{row.jira_links.map((link, index) => <li key={String(link.id ?? index)}><span className="jira-key">{String(link.jira_key)}</span><span>{text(link.status)}{link.synced_at ? ` · synced ${new Date(String(link.synced_at)).toLocaleString()}` : ''}</span></li>)}</ul> : <p>No Jira issues linked</p>}</DetailSection><DetailSection title="Rollout schedule">{row.confluence_url ? <a href={row.confluence_url} target="_blank" rel="noreferrer">Open Confluence rollout schedule ↗</a> : <p>No schedule linked</p>}</DetailSection><DetailSection title="Action items">{row.action_items.length ? <ul className="plain-detail-list">{row.action_items.map((item, index) => <li key={String(item.id ?? index)}>{String(item.text ?? '')}<small>{text(item.state)}{item.jira_key ? ` · ${String(item.jira_key)}` : ''}</small></li>)}</ul> : <p>No action items</p>}</DetailSection><DetailSection title="History timeline">{row.history.length ? <ul className="timeline">{row.history.map((item, index) => <li key={String(item.id ?? index)}><time>{new Date(String(item.occurred_at)).toLocaleString()}</time><span><strong>{text(item.actor_name)}</strong> changed {String(item.field)}{item.new_value ? ` to ${String(item.new_value)}` : ''}</span></li>)}</ul> : <p>No history recorded</p>}</DetailSection><DetailSection title="Comments">{row.comments.length ? <ul className="plain-detail-list">{row.comments.map((item, index) => <li key={String(item.id ?? index)}>{String(item.body ?? '')}<small>{text(item.author_name)} · {item.created_at ? new Date(String(item.created_at)).toLocaleString() : ''}</small></li>)}</ul> : <p>No comments</p>}</DetailSection></div>;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="detail-section"><h3>{title}</h3>{children}</section>; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
