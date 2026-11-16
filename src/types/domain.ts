export type Role = 'ADMIN' | 'USER_DEPARTMENT' | 'SUPPLIER';
export type AccountStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';
export type RequestedRole = 'USER_DEPARTMENT' | 'SUPPLIER';

export type ProjectStatus = 'Planning' | 'In Progress' | 'Completed';
export type TenderPublicationState = 'DRAFT' | 'PUBLISHED';
export type TenderComputedStatus = 'DRAFT' | 'OPEN' | 'RECEIVING' | 'CLOSED';
export type SupplierWindowState = 'OPEN' | 'CLOSED';
export type SupplierOwnSubmissionState = 'NOT_SUBMITTED' | 'SUBMITTED';

export type MilestoneStatus = 'UNSET' | 'NOT_APPLICABLE' | 'PLANNED';
export type ScheduleSource = 'INHERITED' | 'OVERRIDE';

export type DeliveryMode = 'DIRECT' | 'LOCAL_PARTNER' | 'UNAVAILABLE';
export type NdaStatus = 'Not Checked' | 'Not Signed' | 'Signed' | 'Not Required';
export type LicenseStatus =
  | 'Current'
  | 'Renewal Planned'
  | 'Renewal Pending'
  | 'Not Required'
  | 'Not Tracked';
export type CompanyStatus = 'Active' | 'Inactive';
export type ScanStatus = 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED';

export type MilestoneKey =
  | 'rfpDistribution'
  | 'rfiReceipt'
  | 'rfiResponse'
  | 'rfpReceipt'
  | 'interview'
  | 'ptcDistribution'
  | 'ptcReceipt'
  | 'supplierSelection';

export interface MilestoneEntry {
  dateLocal: string | null;
  status: MilestoneStatus;
}

export type ProcurementSchedule = Record<MilestoneKey, MilestoneEntry>;
export type ScheduleSourceMap = Record<MilestoneKey, ScheduleSource>;

export interface AccountProfile {
  uid: string;
  email: string;
  displayName: string;
  phone: string;
  departmentOrCompany: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccessRequestRecord {
  uid: string;
  verifiedEmail: string;
  displayName: string;
  phone: string;
  requestedRole: RequestedRole;
  requestedCompanyOrDept: string;
  status: AccountStatus;
  decisionByUid: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipRecord {
  uid: string;
  tenantId: string;
  role: Role | null;
  status: AccountStatus;
  supplierCompanyId: string | null;
  authzVersion: number;
  canManageAdmins: boolean;
  updatedAt: string;
  updatedByUid: string | null;
}

export interface TenantSettings {
  organizationName: string;
  displayTimeZone: string;
  defaultLanguage: 'en' | 'ko';
  maxFileSizeMb: number;
  maxFilesPerSubmission: number;
  allowedExtensions: string[];
  inviteExpiryDays: number;
  updatedAt: string;
  updatedByUid: string | null;
}

export interface DashboardTask {
  id: string;
  tenantId: string;
  title: string;
  projectId: string | null;
  dateLocal: string;
  priority: 'High' | 'Normal';
  done: boolean;
  createdByUid: string;
  updatedAt: string;
}

export interface CoverageItem {
  countryCode: string;
  subdivisionCode: string | null;
  cityName: string | null;
  displayName: string;
  deliveryMode: DeliveryMode;
  legacyValue?: string | null;
}

export interface SupplierContact {
  countryCode: string;
  countryName: string;
  city: string;
  name: string;
  email: string;
  phone: string;
}

export interface SupplierRecord {
  id: string;
  tenantId: string;
  name: string;
  countryCode: string;
  countryName: string;
  city: string;
  categories: string[];
  coverage: CoverageItem[];
  contacts: SupplierContact[];
  website: string;
  ndaStatus: NdaStatus;
  ndaSignedDate: string;
  license: string;
  licenseStatus: LicenseStatus;
  licenseExpiry: string;
  status: CompanyStatus;
  internalNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierDirectoryDTO {
  id: string;
  name: string;
  countryCode: string;
  countryName: string;
  city: string;
  categories: string[];
  coverage: CoverageItem[];
  contacts: SupplierContact[];
  website: string;
  ndaStatus: NdaStatus;
  ndaSignedDate: string;
  license: string;
  licenseStatus: LicenseStatus;
  licenseExpiry: string;
  status: CompanyStatus;
}

export interface ProjectRecord {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  countryCode: string;
  countryName: string;
  city: string;
  type: string;
  owner: string;
  status: ProjectStatus;
  timeZone: string;
  dateLocal: string;
  masterSchedule: ProcurementSchedule;
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
}

export interface TenderRecord {
  id: string;
  tenantId: string;
  code: string;
  projectId: string;
  name: string;
  type: string;
  publicationState: TenderPublicationState;
  deadlineAt: string | null;
  timeZone: string;
  requiredDocuments: string;
  description: string;
  schedule: ProcurementSchedule;
  scheduleSources: ScheduleSourceMap;
  invitedCompanyIds: string[];
  receivedCompanyIds: string[];
  receivedCompanyCount: number;
  revision: number;
  lastChangeReason: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
}

export interface TenderAdminDTO extends TenderRecord {
  computedStatus: TenderComputedStatus;
  projectName: string;
  projectLocation: string;
}

export interface TenderParticipantRecord {
  companyId: string;
  tenantId: string;
  tenderId: string;
  invitedAt: string;
  invitedByUid: string;
  assignedUserIds: string[];
  hasSubmitted: boolean;
  latestVersionId: string | null;
  latestReceiptNumber: string | null;
  latestSubmittedAt: string | null;
}

export interface TenderAccessGrant {
  uid: string;
  tenantId: string;
  tenderId: string;
  companyId: string;
  enabled: boolean;
  published: boolean;
  deadlineAt: string | null;
  updatedAt: string;
}

export interface FileManifestItem {
  fileId: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: ScanStatus;
  publishedToSuppliers?: boolean;
  uploadedAt: string;
}

export interface SupplierTenderViewDTO {
  tenderId: string;
  code: string;
  projectId: string;
  projectName: string;
  projectLocation: string;
  name: string;
  type: string;
  deadlineAt: string;
  timeZone: string;
  requiredDocuments: string;
  description: string;
  schedule: ProcurementSchedule;
  windowState: SupplierWindowState;
  ownSubmissionState: SupplierOwnSubmissionState;
  latestReceiptNumber: string | null;
  latestSubmittedAt: string | null;
  latestVersionNumber: number | null;
  rfpFiles: FileManifestItem[];
  ownSubmittedFiles: FileManifestItem[];
  submissionHistory: Array<{
    versionId: string;
    versionNumber: number;
    receiptNumber: string;
    acceptedAt: string;
    files: FileManifestItem[];
  }>;
}

export interface StoredFileRecord {
  id: string;
  tenantId: string;
  tenderId: string;
  companyId: string | null;
  ownerScope: 'RFP' | 'SUBMISSION';
  originalName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  objectGeneration: string;
  scanStatus: ScanStatus;
  scanDetail?: string | null;
  publishedToSuppliers: boolean;
  uploadedByUid: string;
  versionId: string | null;
  finalizedAt: string;
}

export interface SubmissionVersionRecord {
  versionId: string;
  versionNumber: number;
  receiptNumber: string;
  tenantId: string;
  tenderId: string;
  companyId: string;
  submittedByUid: string;
  acceptedAt: string;
  idempotencyKey: string;
  files: FileManifestItem[];
}

export interface AuditLogRecord {
  id: string;
  tenantId: string;
  requestId: string;
  actorUid: string;
  actorRole: Role | 'SYSTEM_BOOTSTRAP';
  action: string;
  targetType: string;
  targetId: string;
  beforeSummary: Record<string, unknown> | null;
  afterSummary: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}
