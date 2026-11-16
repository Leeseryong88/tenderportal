import { z } from 'zod';

// Strict request validation schemas — prevents mass assignment of protected fields
// like role, status, approved, supplierCompanyId, tenantId, authzVersion, acceptedAt.

export const registerRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(3).max(40),
    requestedRole: z.enum(['USER_DEPARTMENT', 'SUPPLIER']),
    requestedCompanyOrDept: z.string().trim().min(1).max(150),
  })
  .strict();

export const milestoneEntrySchema = z
  .object({
    status: z.enum(['UNSET', 'NOT_APPLICABLE', 'PLANNED']),
    dateLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .strict();

export const scheduleSchema = z
  .object({
    rfpDistribution: milestoneEntrySchema,
    rfiReceipt: milestoneEntrySchema,
    rfiResponse: milestoneEntrySchema,
    rfpReceipt: milestoneEntrySchema,
    interview: milestoneEntrySchema,
    ptcDistribution: milestoneEntrySchema,
    ptcReceipt: milestoneEntrySchema,
    supplierSelection: milestoneEntrySchema,
  })
  .strict();

export const projectUpsertSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    country: z.string().trim().min(1).max(120),
    city: z.string().trim().min(1).max(120),
    type: z.string().trim().min(1).max(80),
    owner: z.string().trim().min(1).max(120),
    status: z.enum(['Planning', 'In Progress', 'Completed']),
    timeZone: z.string().trim().min(1).max(80).optional(),
    masterSchedule: scheduleSchema,
  })
  .strict();

export const coverageInputSchema = z
  .object({
    market: z.string().trim().min(1).max(120),
    cityName: z.string().trim().max(120).nullable().optional(),
    deliveryMode: z.enum(['DIRECT', 'LOCAL_PARTNER', 'UNAVAILABLE']),
  })
  .strict();

export const supplierContactInputSchema = z
  .object({
    country: z.string().trim().max(120).default(''),
    city: z.string().trim().max(120).default(''),
    name: z.string().trim().max(120).default(''),
    email: z.union([z.string().trim().email().max(160), z.literal('')]).default(''),
    phone: z.string().trim().max(40).default(''),
  })
  .strict();

export const supplierUpsertSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    country: z.string().trim().min(1).max(120),
    city: z.string().trim().max(120).default(''),
    categories: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
    ndaStatus: z.enum(['Not Checked', 'Not Signed', 'Signed', 'Not Required']),
    ndaSignedDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default(''),
    contacts: z.array(supplierContactInputSchema).max(25).default([]),
    website: z
      .union([z.string().trim().url().max(250), z.literal('')])
      .default(''),
    status: z.enum(['Active', 'Inactive']).default('Active'),
    coverage: z.array(coverageInputSchema).min(1).max(120),
    license: z.string().trim().max(160).default(''),
    licenseStatus: z
      .enum(['Current', 'Renewal Planned', 'Renewal Pending', 'Not Required', 'Not Tracked'])
      .default('Not Required'),
    licenseExpiry: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default(''),
    internalNotes: z.string().trim().max(2000).optional(),
  })
  .strict();

export const tenderUpsertSchema = z
  .object({
    name: z.string().trim().max(180).default(''),
    projectId: z.string().trim().min(1).max(100),
    type: z.string().trim().min(1).max(80),
    action: z.enum(['SAVE_DRAFT', 'PUBLISH', 'SAVE_PUBLISHED']),
    deadlineLocal: z.string().trim().max(30).optional().default(''),
    timeZone: z.string().trim().min(1).max(80),
    dstDisambiguation: z.enum(['earlier', 'later', 'reject']).default('reject'),
    schedule: scheduleSchema,
    invitedCompanyIds: z.array(z.string().trim().min(1).max(100)).max(200).default([]),
    requiredDocuments: z.string().trim().max(500).default('Technical Proposal, Commercial Proposal'),
    description: z.string().trim().max(4000).default(''),
    changeReason: z.string().trim().max(500).optional(),
    confirmedSubmissionWarning: z.boolean().optional(),
  })
  .strict();

export const approveUserSchema = z
  .object({
    role: z.enum(['ADMIN', 'USER_DEPARTMENT', 'SUPPLIER']),
    supplierCompanyId: z.string().trim().min(1).max(100).nullable().optional(),
    canManageAdmins: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const updateUserStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'REJECTED', 'DISABLED']),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const assignTenderUsersSchema = z
  .object({
    companyId: z.string().trim().min(1).max(100),
    assignedUserIds: z.array(z.string().trim().min(1).max(128)).max(50),
  })
  .strict();

export const createInviteLinkSchema = z
  .object({
    companyId: z.string().trim().min(1).max(100),
    targetEmail: z.string().trim().email().max(160),
    expiryDays: z.number().int().min(1).max(90).optional(),
  })
  .strict();

export const claimInviteSchema = z
  .object({
    token: z.string().trim().min(20).max(256),
  })
  .strict();

export const uploadIntentSchema = z
  .object({
    originalName: z.string().trim().min(1).max(240),
    contentType: z.string().trim().min(1).max(150),
    sizeBytes: z.number().int().positive().max(200 * 1024 * 1024),
  })
  .strict();

export const finalizeSubmissionSchema = z
  .object({
    intentIds: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();

export const finalizeRfpSchema = z
  .object({
    intentIds: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
    publishedToSuppliers: z.boolean().default(true),
  })
  .strict();

export const toggleRfpVisibilitySchema = z
  .object({
    publishedToSuppliers: z.boolean(),
  })
  .strict();

export const updateSettingsSchema = z
  .object({
    organizationName: z.string().trim().min(1).max(120),
    displayTimeZone: z.string().trim().min(1).max(80),
    defaultLanguage: z.enum(['en', 'ko']),
    maxFileSizeMb: z.number().int().min(1).max(100),
    maxFilesPerSubmission: z.number().int().min(1).max(30),
    allowedExtensions: z.array(z.string().trim().min(2).max(15)).min(1).max(30),
    inviteExpiryDays: z.number().int().min(1).max(90),
  })
  .strict();

export const taskCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    projectId: z.string().trim().max(100).nullable().optional(),
    dateLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    priority: z.enum(['High', 'Normal']).default('Normal'),
  })
  .strict();
