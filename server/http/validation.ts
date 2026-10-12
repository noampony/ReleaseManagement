import type { RequestHandler } from 'express';
import { z, type ZodTypeAny } from 'zod';

export const uuidSchema = z.string().uuid();
export const versionSchema = z.number().int().positive();

const deploymentFields = {
  title: z.string().trim().min(1).max(500),
  category: z.enum(['infrastructure', 'application']),
  version_label: z.string().max(200).nullable().optional(),
  content: z.string().max(50000).nullable().optional(),
  risk_level: z.enum(['high', 'medium', 'low']).nullable().optional(),
  risk_notes: z.string().max(20000).nullable().optional(),
  rollback_plan: z.string().max(20000).nullable().optional(),
  planned_start_date: z.string().date().nullable().optional(),
  qa_verified: z.boolean().optional(),
  qa_verified_at: z.string().datetime().nullable().optional(),
  qa_link: z.string().url().max(2000).nullable().optional(),
  confluence_url: z.string().url().max(2000).nullable().optional(),
  state: z.enum(['planned', 'qa', 'in_rollout', 'done', 'reverted']).optional(),
  owner_ids: z.array(uuidSchema).max(100).optional().refine((ids) => !ids || new Set(ids).size === ids.length, 'Owner IDs must be unique'),
};

const issueFields = {
  title: z.string().trim().min(1).max(500),
  description: z.string().max(50000).nullable().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  status: z.enum(['investigation', 'in_progress', 'monitoring', 'resolved']),
  started_on: z.string().date(),
  customer_impact: z.string().max(10000).nullable().optional(),
  rca_url: z.string().url().max(2000).nullable().optional(),
};

export const createDeploymentSchema = z.object(deploymentFields).strict();
export const updateDeploymentSchema = z.object(deploymentFields).partial().extend({ version: versionSchema }).strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'version'), {
  message: 'At least one field must be updated',
});
export const createIssueSchema = z.object(issueFields).strict();
export const updateIssueSchema = z.object(issueFields).partial().extend({ version: versionSchema }).strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'version'), {
  message: 'At least one field must be updated',
});
const rolloutStepFields = {
  deployment_id: uuidSchema,
  sort_order: z.number().int().nonnegative(),
  label: z.string().trim().min(1).max(500),
  scope_ref_id: uuidSchema.nullable().optional(),
  state: z.enum(['pending', 'in_progress', 'done', 'skipped', 'failed']).optional(),
  clusters_done: z.number().int().nonnegative().nullable().optional(),
  clusters_total: z.number().int().nonnegative().nullable().optional(),
  occurred_on: z.string().date().nullable().optional(),
  note: z.string().max(10000).nullable().optional(),
};
const actionItemFields = {
  parent_type: z.enum(['deployment', 'production_issue']),
  parent_id: uuidSchema,
  text: z.string().trim().min(1).max(10000),
  owner_id: uuidSchema.nullable().optional(),
  state: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
  eta_date: z.string().date().nullable().optional(),
  jira_key: z.string().regex(/^AV-\d+$/).max(32).nullable().optional(),
  sort_order: z.number().int().nonnegative().optional(),
};
export const deploymentListQuerySchema = z.object({
  category: z.enum(['infrastructure', 'application']).optional(),
  risk: z.enum(['high', 'medium', 'low']).optional(),
  state: z.enum(['planned', 'qa', 'in_rollout', 'done', 'reverted']).optional(),
  owner: uuidSchema.optional(),
  q: z.string().trim().max(200).optional(),
}).strict();
export const idParamSchema = z.object({ id: uuidSchema }).strict();
const deploymentStepFields = {
  sort_order: z.number().int().nonnegative(),
  label: rolloutStepFields.label,
  scope_ref_id: rolloutStepFields.scope_ref_id,
  state: rolloutStepFields.state,
  clusters_done: rolloutStepFields.clusters_done,
  clusters_total: rolloutStepFields.clusters_total,
  occurred_on: rolloutStepFields.occurred_on,
  note: rolloutStepFields.note,
};
export const createDeploymentStepSchema = z.object(deploymentStepFields).strict().refine((step) => step.clusters_done == null || step.clusters_total == null || step.clusters_done <= step.clusters_total,
  { message: 'Completed clusters cannot exceed total clusters', path: ['clusters_done'] });
export const updateDeploymentStepSchema = z.object(deploymentStepFields).partial().extend({ version: versionSchema }).strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'version'), { message: 'At least one field must be updated' })
  .refine((body) => body.clusters_done == null || body.clusters_total == null || body.clusters_done <= body.clusters_total,
    { message: 'Completed clusters cannot exceed total clusters', path: ['clusters_done'] });
export const createRolloutStepSchema = z.object(rolloutStepFields).strict();
export const updateRolloutStepSchema = z.object(rolloutStepFields).partial().extend({ version: versionSchema }).strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'version'), {
    message: 'At least one field must be updated',
  });
export const createActionItemSchema = z.object(actionItemFields).strict();
export const updateActionItemSchema = z.object(actionItemFields).partial().extend({ version: versionSchema }).strict()
  .refine((body) => Object.keys(body).some((key) => key !== 'version'), {
    message: 'At least one field must be updated',
  });
const commentFields = {
  entity_type: z.enum(['deployment', 'production_issue']),
  entity_id: uuidSchema,
  body: z.string().trim().min(1).max(20000),
};
export const createCommentSchema = z.object(commentFields).strict();
export const updateCommentSchema = z.object({ body: commentFields.body, version: versionSchema }).strict();
export const reorderRolloutStepsSchema = z.object({
  deployment_id: uuidSchema,
  version: versionSchema,
  ordered_ids: z.array(uuidSchema).max(500),
}).strict().refine((body) => new Set(body.ordered_ids).size === body.ordered_ids.length, {
  message: 'Step IDs must be unique',
  path: ['ordered_ids'],
});
export const versionedMutationSchema = z.object({ version: versionSchema }).strict();
export const doneDeploymentSchema = z.object({ version: versionSchema }).strict();

export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      next(new ValidationError(result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }))));
      return;
    }
    request.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodTypeAny): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.query);
    if (!result.success) {
      next(new ValidationError(result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }))));
      return;
    }
    Object.defineProperty(request, 'validatedQuery', { value: result.data, configurable: true });
    next();
  };
}

export function validateParams(schema: ZodTypeAny): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.params);
    if (!result.success) {
      next(new ValidationError(result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }))));
      return;
    }
    request.params = result.data;
    next();
  };
}

declare global {
  namespace Express {
    interface Request { validatedQuery?: Record<string, unknown> }
  }
}

export class ValidationError extends Error {
  constructor(readonly issues: Array<{ path: string; message: string; code: string }>) {
    super('Request validation failed');
    this.name = 'ValidationError';
  }
}
