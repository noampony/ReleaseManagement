import { pool, withTransaction } from '../server/db/index.js';

const people = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Alex Morgan', email: 'alex.morgan@example.test' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Jordan Lee', email: 'jordan.lee@example.test' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Sam Taylor', email: 'sam.taylor@example.test' },
];

const references = [
  { kind: 'region', label: 'Europe' }, { kind: 'region', label: 'North America' },
  { kind: 'region', label: 'Asia Pacific' },
  { kind: 'farm', label: 'eu-west-farm', parent: 'Europe' },
  { kind: 'farm', label: 'us-east-farm', parent: 'North America' },
  { kind: 'farm', label: 'ap-south-farm', parent: 'Asia Pacific' },
  { kind: 'cluster', label: 'cp-euw2-1', parent: 'eu-west-farm' },
  { kind: 'cluster', label: 'cp-us-2', parent: 'us-east-farm' },
  { kind: 'cluster', label: 'aps1', parent: 'ap-south-farm' },
  { kind: 'release', label: 'mta-incoming-inline' }, { kind: 'release', label: 'siem-exporter' },
  { kind: 'release', label: 'mail-routing-certificates' },
  { kind: 'severity', label: 'critical' }, { kind: 'severity', label: 'high' },
  { kind: 'severity', label: 'medium' }, { kind: 'severity', label: 'low' },
  { kind: 'risk', label: 'high' }, { kind: 'risk', label: 'medium' }, { kind: 'risk', label: 'low' },
];

await withTransaction(async (client) => {
  for (const person of people) {
    await client.query(
      `INSERT INTO person (id, display_name, email) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [person.id, person.name, person.email],
    );
  }

  const referenceIds = new Map<string, string>();
  for (const [index, item] of references.entries()) {
    const parentId = item.parent ? referenceIds.get(item.parent) : null;
    const result = await client.query<{ id: string }>(
      `INSERT INTO reference_item (kind, label, parent_id, sort_order) VALUES ($1, $2, $3, $4)
       ON CONFLICT (kind, label) DO UPDATE SET parent_id = EXCLUDED.parent_id, sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [item.kind, item.label, parentId ?? null, index],
    );
    referenceIds.set(item.label, result.rows[0].id);
  }

  const deploymentIds = [
    '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003',
  ];
  const deployments = [
    { title: 'mta-incoming-inline (milter)', category: 'infrastructure', risk: 'high', state: 'in_rollout' },
    { title: 'SIEM exporter retry tuning', category: 'application', risk: 'medium', state: 'planned' },
    { title: 'Mail routing certificate refresh', category: 'infrastructure', risk: 'low', state: 'qa' },
  ];
  for (const [index, deployment] of deployments.entries()) {
    const id = deploymentIds[index];
    const versionLabel = `main-2026-10-0${index + 1}-1`;
    await client.query(
      `INSERT INTO deployment (id, title, category, version_label, content, risk_level, planned_start_date, state)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE + $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [id, deployment.title, deployment.category, versionLabel, 'Development seed record',
        deployment.risk, index, deployment.state],
    );
    await client.query(
      `INSERT INTO jira_link (entity_type, entity_id, jira_key)
       VALUES ('deployment', $1, $2) ON CONFLICT (entity_type, entity_id, jira_key) DO NOTHING`,
      [id, `REL-${index + 1}`],
    );
    await client.query(
      'INSERT INTO deployment_owner (deployment_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, people[index % people.length].id],
    );
    const stepStates = index === 0 ? ['done', 'in_progress', 'pending'] : index === 1 ? ['pending'] : ['done', 'pending'];
    for (const [stepIndex, state] of stepStates.entries()) {
      const label = ['London - 3 clusters', 'N. Virginia - 42 clusters', 'Singapore - 8 clusters'][stepIndex];
      const cluster = ['cp-euw2-1', 'cp-us-2', 'aps1'][stepIndex];
      await client.query(
        `INSERT INTO rollout_step (deployment_id, sort_order, label, scope_ref_id, state, clusters_done, clusters_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (deployment_id, sort_order) DO NOTHING`,
        [id, stepIndex, label, referenceIds.get(cluster), state, state === 'done' ? 3 : 0, 3],
      );
    }
  }

  const issueIds = [
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
  ];
  const issues = [
    { title: 'Delayed outbound email in EU', severity: 'critical', status: 'investigation', scope: 'cp-euw2-1' },
    { title: 'Intermittent SIEM export retries', severity: 'high', status: 'in_progress', scope: 'cp-us-2' },
    { title: 'Resolved mail queue growth', severity: 'medium', status: 'monitoring', scope: 'aps1' },
  ];
  for (const [index, issue] of issues.entries()) {
    const id = issueIds[index];
    await client.query(
      `INSERT INTO production_issue (id, title, description, severity, status, started_on, customer_impact)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE - $6, $7) ON CONFLICT (id) DO NOTHING`,
      [id, issue.title, 'Development seed record', issue.severity, issue.status, index + 1,
        index === 0 ? 'Email delays' : index === 1 ? 'Delayed SIEM exports' : null],
    );
    await client.query(
      'INSERT INTO issue_scope (production_issue_id, reference_item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, referenceIds.get(issue.scope)],
    );
  }

  for (let index = 0; index < 6; index += 1) {
    const parentType = index < 3 ? 'deployment' : 'production_issue';
    const parentId = index < 3 ? deploymentIds[index] : issueIds[index - 3];
    await client.query(
      `INSERT INTO action_item (id, parent_type, parent_id, text, owner_id, state, eta_date, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE + 2, 0)
       ON CONFLICT (id) DO UPDATE SET parent_type = EXCLUDED.parent_type, parent_id = EXCLUDED.parent_id,
         text = EXCLUDED.text, owner_id = EXCLUDED.owner_id, state = EXCLUDED.state,
         eta_date = EXCLUDED.eta_date, sort_order = EXCLUDED.sort_order`,
      [`40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, parentType, parentId,
        `Seed action ${index + 1}: verify and report status`, people[index % people.length].id,
        index % 2 === 0 ? 'done' : 'open'],
    );
  }
});

await pool.end();
