import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AvatarStack, DetailDrawer, ErrorState, FilterBar, FilterSelect, GroupedSection, LoadingState, RiskPill, StatusPill } from './components/primitives';
import './styles/tokens.css';
import './release-board.css';

type Person = { id: string; display_name: string; avatar_url?: string | null };
type Step = { id: string; deployment_id: string; sort_order: number; label: string; state: string; clusters_done?: number | null; clusters_total?: number | null; occurred_on?: string | null; note?: string | null; version: number; scope_label?: string | null };
type ActionItem = { id: string; text: string; owner_id?: string | null; state: string; eta_date?: string | null; jira_key?: string | null; sort_order: number; version: number };
type Deployment = { id: string; title: string; category: string; version_label?: string | null; content?: string | null; risk_level?: string | null; risk_notes?: string | null; rollback_plan?: string | null; planned_start_date?: string | null; qa_verified: boolean; qa_verified_at?: string | null; qa_link?: string | null; confluence_url?: string | null; state: string; lifecycle: string; done_at?: string | null; version: number; owners: Person[]; steps: Step[]; action_items: ActionItem[]; history: Array<Record<string, unknown>>; comments: Array<Record<string, unknown>>; jira_links: Array<Record<string, unknown>> };
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorRow, setEditorRow] = useState<Deployment | null>(null);

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
  const saveDeployment = async (draft: Record<string, unknown>, base: Deployment | null) => {
    if (base && !Object.keys(draft).length) { setEditorRow(base); return { conflict: undefined }; }
    const response = await fetch(base ? `/api/deployments/${encodeURIComponent(base.id)}` : '/api/deployments', {
      method: base ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(base ? { ...draft, version: base.version } : draft),
    });
    const payload = await response.json() as Record<string, any>;
    if (response.status === 409) return { conflict: payload.error?.details as { current: Record<string, unknown>; changedFields: string[] } };
    if (!response.ok) throw new Error(payload.error?.message ?? 'Could not save release');
    await load();
    if (base) {
      const detail = await fetch(`/api/deployments/${encodeURIComponent(base.id)}`);
      if (detail.ok) setSelected(await detail.json() as Deployment);
    }
    setEditorOpen(false); setEditorRow(null);
    return { conflict: undefined };
  };
  const openEditor = async (row: Deployment | null) => {
    setEditorRow(row); setEditorOpen(true);
    if (row && !row.steps?.length && !row.action_items?.length) {
      const response = await fetch(`/api/deployments/${encodeURIComponent(row.id)}`);
      if (response.ok) { const detail = await response.json() as Deployment; setEditorRow(detail); setSelected(detail); }
    }
  };
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
      <section className="release-heading"><div><p className="eyebrow">BOARD 03 · DEPLOYMENTS</p><h1>Release Management</h1><p className="board-description">A clear view of release risk, ownership, and rollout progress.</p></div><div className="heading-actions"><span className="unit-tag">{allRows.length} RELEASES</span><button type="button" className="edit-button" onClick={() => void openEditor(null)}>+ New release</button></div></section>
      <details className="ground-rules"><summary><span className="rules-icon" aria-hidden="true">i</span><span><strong>Ground rules</strong><small>Shared release and rollout guidance</small></span><span className="group-chevron" aria-hidden="true">⌄</span></summary><div className="rules-columns"><div><h2>Risks</h2><p>Regression (functional / performance) · Stability (downtime / timeouts / retries / errors) · Service continuity.</p></div><div><h2>Deployment plan</h2><p>Graduality · Consider the region's local time · Variety: brands, customer size.</p></div></div></details>
      <FilterBar className="release-filters"><FilterSelect label="CATEGORY" value={filters.category} onChange={(value) => updateFilter('category', value)} options={[{ value: '', label: 'All categories' }, { value: 'infrastructure', label: 'Infrastructure' }, { value: 'application', label: 'Application' }]} /><FilterSelect label="RISK" value={filters.risk} onChange={(value) => updateFilter('risk', value)} options={[{ value: '', label: 'All risks' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} /><FilterSelect label="OWNER" value={filters.owner} onChange={(value) => updateFilter('owner', value)} options={[{ value: '', label: 'All owners' }, ...owners.map((owner) => ({ value: owner.id, label: owner.display_name }))]} /><FilterSelect label="STATE" value={filters.state} onChange={(value) => updateFilter('state', value)} options={[{ value: '', label: 'All states' }, { value: 'in_rollout', label: 'In rollout' }, { value: 'planned', label: 'Planned' }, { value: 'qa', label: 'QA / Pending' }, { value: 'done', label: 'Closed' }, { value: 'reverted', label: 'Reverted' }]} /><label className="today-toggle"><input type="checkbox" checked={filters.today} onChange={(event) => updateFilter('today', event.target.checked)} />Today only</label><button type="button" className="clear-filters" onClick={() => setFilters({ category: '', risk: '', owner: '', state: '', today: false, q: '' })}>Reset filters</button></FilterBar>
      {notice && <div className="board-notice" role="status">{notice}</div>}
      {loading ? <LoadingState label="Loading release deployments" rows={4} /> : error ? <ErrorState onRetry={() => void load()} /> : <div className="release-groups">{groups.map(([name, items], index) => <GroupedSection key={name} title={name} count={items.length} defaultOpen={index === 0 || items.length > 0} className="release-group">{items.length ? items.map((row) => <ReleaseRow key={row.id} row={row} expanded={expanded === row.id} onExpand={() => setExpanded((current) => current === row.id ? null : row.id)} onOpen={() => setSelected(row)} onState={(step, state) => void updateStep(row, step, state)} onReorder={(dragged, target) => void reorder(row, dragged, target)} />) : <p className="group-empty">No releases in this group</p>}</GroupedSection>)}</div>}
    </div>
    <DetailDrawer open={Boolean(selected)} title={selected?.title ?? ''} onClose={() => setSelected(null)}>{selected && <ReleaseDetails row={selected} onEdit={() => void openEditor(selected)} />}</DetailDrawer>
    <DetailDrawer open={editorOpen} title={editorRow ? `Edit ${editorRow.title}` : 'Create release'} onClose={() => setEditorOpen(false)}>{editorOpen && <DeploymentEditor row={editorRow} people={owners} onSave={saveDeployment} onCancel={() => setEditorOpen(false)} />}</DetailDrawer>
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

function ReleaseDetails({ row, onEdit }: { row: Deployment; onEdit: () => void }) {
  return <div className="release-details"><div className="drawer-toolbar"><div className="detail-tag-row"><RiskPill level={text(row.risk_level)} /><StatusPill tone={toneForState(row.state)}>{labelForState(row.state)}</StatusPill><span className="version-chip">{text(row.version_label)}</span></div><button type="button" className="edit-button" onClick={onEdit}>Edit release</button></div><DetailSection title="Content / what is in the release"><p>{text(row.content)}</p></DetailSection><DetailSection title="Risk management notes"><p>{text(row.risk_notes)}</p></DetailSection><DetailSection title="Rollback plan"><p>{text(row.rollback_plan)}</p></DetailSection><DetailSection title="QA verification">{row.qa_verified ? <div className="qa-detail"><StatusPill tone="green">✓ QA verified</StatusPill><span>{row.qa_verified_at ? new Date(row.qa_verified_at).toLocaleDateString() : 'Verified date not recorded'}</span>{row.qa_link && <a href={row.qa_link} target="_blank" rel="noreferrer">QA evidence ↗</a>}</div> : <p>QA verification not recorded</p>}</DetailSection><DetailSection title="Linked Jira issues">{row.jira_links.length ? <ul className="detail-link-list">{row.jira_links.map((link, index) => <li key={String(link.id ?? index)}><span className="jira-key">{String(link.jira_key)}</span><span>{text(link.status)}{link.synced_at ? ` · synced ${new Date(String(link.synced_at)).toLocaleString()}` : ''}</span></li>)}</ul> : <p>No Jira issues linked</p>}</DetailSection><DetailSection title="Rollout schedule">{row.confluence_url ? <a href={row.confluence_url} target="_blank" rel="noreferrer">Open Confluence rollout schedule ↗</a> : <p>No schedule linked</p>}</DetailSection><DetailSection title="Action items">{row.action_items.length ? <ul className="plain-detail-list">{row.action_items.map((item) => <li key={item.id}>{item.text}<small>{text(item.state)}{item.jira_key ? ` · ${item.jira_key}` : ''}</small></li>)}</ul> : <p>No action items</p>}</DetailSection><DetailSection title="History timeline">{row.history.length ? <ul className="timeline">{row.history.map((item, index) => <li key={String(item.id ?? index)}><time>{new Date(String(item.occurred_at)).toLocaleString()}</time><span><strong>{text(item.actor_name)}</strong> changed {String(item.field)}{item.new_value ? ` to ${String(item.new_value)}` : ''}</span></li>)}</ul> : <p>No history recorded</p>}</DetailSection><DetailSection title="Comments">{row.comments.length ? <ul className="plain-detail-list">{row.comments.map((item, index) => <li key={String(item.id ?? index)}>{String(item.body ?? '')}<small>{text(item.author_name)} · {item.created_at ? new Date(String(item.created_at)).toLocaleString() : ''}</small></li>)}</ul> : <p>No comments</p>}</DetailSection></div>;
}

type EditorDraft = {
  title: string; category: string; version_label: string; content: string; risk_level: string; risk_notes: string;
  rollback_plan: string; planned_start_date: string; qa_verified: boolean; qa_verified_at: string; qa_link: string;
  confluence_url: string; state: string; owner_ids: string[];
};
const draftFromRow = (row: Deployment | null): EditorDraft => ({
  title: row?.title ?? '', category: row?.category ?? 'infrastructure', version_label: row?.version_label ?? '',
  content: row?.content ?? '', risk_level: row?.risk_level ?? 'medium', risk_notes: row?.risk_notes ?? '',
  rollback_plan: row?.rollback_plan ?? '', planned_start_date: row?.planned_start_date ?? '', qa_verified: row?.qa_verified ?? false,
  qa_verified_at: row?.qa_verified_at?.slice(0, 10) ?? '', qa_link: row?.qa_link ?? '', confluence_url: row?.confluence_url ?? '',
  state: row?.state ?? 'planned', owner_ids: row?.owners.map((person) => person.id) ?? [],
});
const editorFields: Array<keyof EditorDraft> = ['title', 'category', 'version_label', 'content', 'risk_level', 'risk_notes', 'rollback_plan', 'planned_start_date', 'qa_verified', 'qa_verified_at', 'qa_link', 'confluence_url', 'state', 'owner_ids'];
const displayField = (field: keyof EditorDraft) => ({ title: 'Release name', category: 'Category', version_label: 'Version', content: 'Content', risk_level: 'Risk', risk_notes: 'Risk notes', rollback_plan: 'Rollback plan', planned_start_date: 'Planned start', qa_verified: 'QA verified', qa_verified_at: 'QA date', qa_link: 'QA evidence link', confluence_url: 'Rollout schedule', state: 'State', owner_ids: 'Owners' }[field]);

function DeploymentEditor({ row, people, onSave, onCancel }: { row: Deployment | null; people: Person[]; onSave: (draft: Record<string, unknown>, base: Deployment | null) => Promise<{ conflict?: { current: Record<string, unknown>; changedFields: string[] } }>; onCancel: () => void }) {
  const [base, setBase] = useState<Deployment | null>(row);
  const [draft, setDraft] = useState<EditorDraft>(() => draftFromRow(row));
  const [conflict, setConflict] = useState<{ current: Record<string, unknown>; changedFields: string[] } | null>(null);
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const patch = <K extends keyof EditorDraft>(field: K, value: EditorDraft[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const save = async (nextDraft = draft, nextBase = base) => {
    setSaving(true); setError('');
    try {
      const result = await onSave({ title: nextDraft.title.trim(), category: nextDraft.category, version_label: nextDraft.version_label || null,
        content: nextDraft.content || null, risk_level: nextDraft.risk_level || null, risk_notes: nextDraft.risk_notes || null,
        rollback_plan: nextDraft.rollback_plan || null, planned_start_date: nextDraft.planned_start_date || null,
        qa_verified: nextDraft.qa_verified, qa_verified_at: nextDraft.qa_verified_at ? new Date(`${nextDraft.qa_verified_at}T00:00:00.000Z`).toISOString() : null,
        qa_link: nextDraft.qa_link || null, confluence_url: nextDraft.confluence_url || null, state: nextDraft.state, owner_ids: nextDraft.owner_ids,
      }, nextBase);
      if (result.conflict) setConflict(result.conflict);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save release. Your changes are still here.'); }
    finally { setSaving(false); }
  };
  const applyConflict = (choice: 'mine' | 'theirs' | 'merge') => {
    if (!conflict) return;
    const server = conflict.current as unknown as Deployment;
    const theirs = draftFromRow(server);
    let nextDraft = { ...draft };
    const serverFields = editorFields.filter((candidate) => JSON.stringify((draftFromRow(server)[candidate])) !== JSON.stringify((draftFromRow(base)[candidate])));
    const changedFields = new Set([...conflict.changedFields, ...serverFields] as Array<keyof EditorDraft>);
    for (const field of changedFields) {
      if (!editorFields.includes(field)) continue;
      if (choice === 'theirs') nextDraft = { ...nextDraft, [field]: theirs[field] };
      if (choice === 'merge') {
        if (field === 'owner_ids') nextDraft.owner_ids = [...new Set([...draft.owner_ids, ...theirs.owner_ids])];
        else if (typeof draft[field] === 'string' && typeof theirs[field] === 'string' && draft[field] !== theirs[field]) {
          const combined = [String(theirs[field]), String(draft[field])].filter(Boolean).join('\n\n');
          nextDraft = { ...nextDraft, [field]: combined };
        }
      }
    }
    setDraft(nextDraft); setBase(server); setConflict(null);
    if (choice !== 'theirs') void save(nextDraft, server);
    else void onSave({}, server);
  };
  const fieldChanged = (field: keyof EditorDraft) => {
    if (!base) return false;
    const current = draftFromRow(base)[field];
    return JSON.stringify(draft[field]) !== JSON.stringify(current);
  };
  return <form className="deployment-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    {conflict && <section className="conflict-banner" role="alert"><strong>Someone else updated this release{(conflict.current.updated_by_name || conflict.current.editor_name) ? ` · ${String(conflict.current.updated_by_name ?? conflict.current.editor_name)}` : ''}.</strong><p>Review the differing fields below. Your unsaved values are preserved until you choose an action.</p><div className="conflict-fields">{[...new Set([...conflict.changedFields, ...editorFields.filter((field) => JSON.stringify(draftFromRow(base)[field]) !== JSON.stringify(draftFromRow(conflict.current as unknown as Deployment)[field]))])].map((field) => <div key={field}><strong>{displayField(field as keyof EditorDraft) ?? field}</strong><span>Server: {String((draftFromRow(conflict.current as unknown as Deployment) as any)[field] ?? '—')}</span><span>Mine: {String((draft as any)[field] ?? '—')}</span></div>)}</div><div className="conflict-actions"><button type="button" className="edit-button" onClick={() => applyConflict('mine')}>Keep mine</button><button type="button" className="edit-button" onClick={() => applyConflict('theirs')}>Take theirs</button><button type="button" className="edit-button" onClick={() => applyConflict('merge')}>Merge</button></div></section>}
    {error && <p className="editor-error" role="alert">{error}</p>}
    <label className="editor-field">Release name<input required maxLength={500} value={draft.title} onChange={(event) => patch('title', event.target.value)} /></label>
    <div className="editor-grid"><label className="editor-field">Category<select value={draft.category} onChange={(event) => patch('category', event.target.value)}><option value="infrastructure">Infrastructure</option><option value="application">Application</option></select></label><label className="editor-field">Version<input maxLength={200} value={draft.version_label} onChange={(event) => patch('version_label', event.target.value)} /></label><label className="editor-field">Risk<select value={draft.risk_level} onChange={(event) => patch('risk_level', event.target.value)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label className="editor-field">State<select value={draft.state} onChange={(event) => patch('state', event.target.value)}><option value="planned">Planned</option><option value="qa">QA / Pending</option><option value="in_rollout">In rollout</option><option value="reverted">Reverted</option></select></label><label className="editor-field">Planned start<input type="date" value={draft.planned_start_date} onChange={(event) => patch('planned_start_date', event.target.value)} /></label></div>
    <label className="editor-field">Owners<select multiple value={draft.owner_ids} onChange={(event) => patch('owner_ids', Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{people.map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}</select></label>
    <label className="editor-field">Content<textarea maxLength={50000} rows={4} value={draft.content} onChange={(event) => patch('content', event.target.value)} /></label><label className="editor-field">Risk management notes<textarea maxLength={20000} rows={3} value={draft.risk_notes} onChange={(event) => patch('risk_notes', event.target.value)} /></label><label className="editor-field">Rollback plan<textarea maxLength={20000} rows={3} value={draft.rollback_plan} onChange={(event) => patch('rollback_plan', event.target.value)} /></label>
    <label className="editor-check"><input type="checkbox" checked={draft.qa_verified} onChange={(event) => patch('qa_verified', event.target.checked)} /> QA verified</label><div className="editor-grid"><label className="editor-field">QA date<input type="date" value={draft.qa_verified_at} onChange={(event) => patch('qa_verified_at', event.target.value)} /></label><label className="editor-field">QA evidence URL<input type="url" maxLength={2000} value={draft.qa_link} onChange={(event) => patch('qa_link', event.target.value)} /></label></div><label className="editor-field">Confluence rollout schedule URL<input type="url" maxLength={2000} value={draft.confluence_url} onChange={(event) => patch('confluence_url', event.target.value)} /></label>
    {row && <EditorChildren row={row} people={people} onError={setError} onRefreshParent={async () => { const response = await fetch(`/api/deployments/${encodeURIComponent(row.id)}`); if (response.ok) setBase(await response.json() as Deployment); }} />}
    <div className="editor-footer"><span>{editorFields.filter(fieldChanged).length} unsaved fields</span><button type="button" className="edit-button" onClick={onCancel}>Cancel</button><button type="submit" className="edit-button primary" disabled={saving}>{saving ? 'Saving…' : row ? 'Save changes' : 'Create release'}</button></div>
  </form>;
}

function EditorChildren({ row, people, onError, onRefreshParent }: { row: Deployment; people: Person[]; onError: (message: string) => void; onRefreshParent: () => Promise<void> }) {
  const [steps, setSteps] = useState(row.steps); const [items, setItems] = useState(row.action_items);
  const [newStep, setNewStep] = useState(''); const [newAction, setNewAction] = useState('');
  const updateStepField = async (step: Step, changes: Record<string, unknown>) => {
    try {
      const response = await fetch(`/api/rollout-steps/${encodeURIComponent(step.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...changes, version: step.version }) });
      if (!response.ok) throw new Error('Rollout step save failed; your editor remains open.');
      const saved = await response.json() as Step; setSteps((current) => current.map((item) => item.id === step.id ? saved : item)); await onRefreshParent();
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not save rollout step'); }
  };
  const createStep = async () => {
    if (!newStep.trim()) return;
    try { const response = await fetch(`/api/deployments/${encodeURIComponent(row.id)}/steps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sort_order: steps.length, label: newStep.trim() }) }); if (!response.ok) throw new Error('Could not add rollout step'); const saved = await response.json() as Step; setSteps((current) => [...current, saved]); setNewStep(''); await onRefreshParent(); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not add rollout step'); }
  };
  const createItem = async () => {
    if (!newAction.trim()) return;
    try { const response = await fetch('/api/action-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent_type: 'deployment', parent_id: row.id, text: newAction.trim(), sort_order: items.length }) }); if (!response.ok) throw new Error('Could not add action item'); const saved = await response.json() as ActionItem; setItems((current) => [...current, saved]); setNewAction(''); await onRefreshParent(); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not add action item'); }
  };
  const updateItem = async (item: ActionItem, changes: Record<string, unknown>) => {
    try { const response = await fetch(`/api/action-items/${encodeURIComponent(item.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...changes, version: item.version }) }); if (!response.ok) throw new Error('Action item save failed; your editor remains open.'); const saved = await response.json() as ActionItem; setItems((current) => current.map((candidate) => candidate.id === item.id ? saved : candidate)); await onRefreshParent(); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not save action item'); }
  };
  return <><section className="editor-child-section"><h3>Rollout steps</h3>{steps.map((step) => <div className="child-editor-row" key={step.id}><input aria-label="Step name" value={step.label} onChange={(event) => setSteps((current) => current.map((candidate) => candidate.id === step.id ? { ...candidate, label: event.target.value } : candidate))} onBlur={(event) => { if (event.target.value !== step.label) void updateStepField(step, { label: event.target.value }); }} /><select aria-label="Step state" value={step.state} onChange={(event) => void updateStepField(step, { state: event.target.value })}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="skipped">Skipped</option><option value="failed">Failed</option></select><input aria-label="Clusters done" type="number" min="0" value={step.clusters_done ?? ''} onChange={(event) => setSteps((current) => current.map((candidate) => candidate.id === step.id ? { ...candidate, clusters_done: event.target.value ? Number(event.target.value) : null } : candidate))} onBlur={() => void updateStepField(step, { clusters_done: step.clusters_done ?? null })} /><input aria-label="Clusters total" type="number" min="0" value={step.clusters_total ?? ''} onChange={(event) => setSteps((current) => current.map((candidate) => candidate.id === step.id ? { ...candidate, clusters_total: event.target.value ? Number(event.target.value) : null } : candidate))} onBlur={() => void updateStepField(step, { clusters_total: step.clusters_total ?? null })} /><input aria-label="Step date" type="date" value={step.occurred_on ?? ''} onChange={(event) => void updateStepField(step, { occurred_on: event.target.value || null })} /><input aria-label="Step note" value={step.note ?? ''} placeholder="Note" onChange={(event) => setSteps((current) => current.map((candidate) => candidate.id === step.id ? { ...candidate, note: event.target.value } : candidate))} onBlur={(event) => void updateStepField(step, { note: event.target.value || null })} /></div>)}<div className="inline-add"><input value={newStep} maxLength={500} placeholder="Add rollout step" onChange={(event) => setNewStep(event.target.value)} /><button type="button" className="edit-button" onClick={() => void createStep()}>Add step</button></div></section><section className="editor-child-section"><h3>Action items</h3>{items.map((item) => <div className="child-editor-row action-editor-row" key={item.id}><input aria-label="Action item" value={item.text} onChange={(event) => setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, text: event.target.value } : candidate))} onBlur={(event) => { if (event.target.value !== item.text) void updateItem(item, { text: event.target.value }); }} /><select aria-label="Action owner" value={item.owner_id ?? ''} onChange={(event) => void updateItem(item, { owner_id: event.target.value || null })}><option value="">Unassigned</option>{people.map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}</select><select aria-label="Action state" value={item.state} onChange={(event) => void updateItem(item, { state: event.target.value })}><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select><input aria-label="Action ETA" type="date" value={item.eta_date ?? ''} onChange={(event) => void updateItem(item, { eta_date: event.target.value || null })} /><input aria-label="Jira key" value={item.jira_key ?? ''} placeholder="AV-12345" onBlur={(event) => void updateItem(item, { jira_key: event.target.value || null })} onChange={(event) => setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, jira_key: event.target.value } : candidate))} /></div>)}<div className="inline-add"><input value={newAction} maxLength={10000} placeholder="Add action item" onChange={(event) => setNewAction(event.target.value)} /><button type="button" className="edit-button" onClick={() => void createItem()}>Add item</button></div></section></>;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="detail-section"><h3>{title}</h3>{children}</section>; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
