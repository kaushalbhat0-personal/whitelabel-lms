import {
  UserRole,
  SessionStatus,
  AttendanceStatus,
  RecordingStatus,
  TestStatus,
  UploadQueueStatus,
  InstallmentStatus,
  PaymentPlanStatus,
  PaymentMethod,
  BulkUploadJobType,
  BulkUploadJobStatus,
  BatchScheduleType,
} from './enums';

export * from './enums';

// ──────────────────────────────────────────────────────────────
// Users & Auth
// ──────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  isActive: boolean;
  avatarUrl?: string;
  createdAt: string;
}

// ──────────────────────────────────────────────────────────────
// Business Config (single-row)
// ──────────────────────────────────────────────────────────────

export interface BusinessConfig {
  id: string;
  businessName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  gstin?: string;
  pan?: string;
  email: string;
  phone: string;
  logoUrl?: string;
  signatureUrl?: string;
  invoicePrefix: string;
  receiptPrefix: string;
  currentFinancialYear: string;
  nextInvoiceNumber: number;
  nextReceiptNumber: number;
  timezone: string;
  currency: string;
  locale: string;
  fyStartMonth: number;
  taxMode: string;
  taxRate: number;
  faviconUrl?: string;
  supportEmail?: string;
  supportPhone?: string;
  website?: string;
  legalFooter?: string;
}

// ──────────────────────────────────────────────────────────────
// Courses
// ──────────────────────────────────────────────────────────────

export interface Course {
  id: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
}

// ──────────────────────────────────────────────────────────────
// Batches
// ──────────────────────────────────────────────────────────────

export interface Batch {
  id: string;
  courseId: string;
  name: string;
  description?: string;
  scheduleType?: BatchScheduleType;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
  createdAt: string;
}

// ──────────────────────────────────────────────────────────────
// Live Sessions & Attendance
// ──────────────────────────────────────────────────────────────

export interface LiveSession {
  id: string;
  zoomWebinarId?: string;
  topic: string;
  startTime: string;
  durationMinutes: number;
  status: SessionStatus;
  batchIds: string[];
}

export interface Recording {
  id: string;
  sessionId?: string;
  title: string;
  muxPlaybackId?: string;
  status: RecordingStatus;
  durationSeconds?: number;
  batchIds: string[];
}

export interface Video {
  id: string;
  topicId?: string;
  title: string;
  muxPlaybackId?: string;
  status: RecordingStatus;
  sortOrder: number;
  batchIds: string[];
}

export interface Topic {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
}

export interface Test {
  id: string;
  title: string;
  status: TestStatus;
  durationMinutes?: number;
  totalMarks: number;
  startTime?: string;
  endTime?: string;
  batchIds: string[];
}

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  userId: string;
  status: AttendanceStatus;
  joinedAt?: string;
  durationSeconds?: number;
}

// ──────────────────────────────────────────────────────────────
// Payment System
// ──────────────────────────────────────────────────────────────

export interface PaymentPlan {
  id: string;
  studentId: string;
  courseId: string;
  totalAmount: number;
  installmentCount: number;
  notes?: string;
  status: PaymentPlanStatus;
  createdBy: string;
  standardCourseFee?: number | null;
  discountAmount?: number;
  discountReason?: string | null;
  bookingAmount?: number | null;
}

export interface PaymentInstallment {
  id: string;
  paymentPlanId: string;
  installmentNumber: number;
  amount: number;
  dueDate: string;
  status: InstallmentStatus;
  paidAt?: string;
  paymentId?: string;
}

export interface Payment {
  id: string;
  studentId: string;
  courseId: string;
  paymentPlanId?: string;
  installmentId?: string;
  amount: number;
  paymentMethod: PaymentMethod;
  transactionId?: string;
  paidOn: string;
  notes?: string;
  isFullPayment: boolean;
  recordedBy: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  studentId: string;
  courseId: string;
  paymentId?: string;
  paymentPlanId?: string | null;
  subtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  gstApplicable: boolean;
  issuedOn: string;
  pdfUrl?: string;
  storagePath?: string | null;
  emailSentAt?: string;
  emailSentTo?: string;
  generatedBy: string;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  studentId: string;
  courseId: string;
  paymentId: string;
  installmentId?: string;
  amount: number;
  issuedOn: string;
  pdfUrl?: string;
  storagePath?: string | null;
  emailSentAt?: string;
  emailSentTo?: string;
  generatedBy: string;
}

// ──────────────────────────────────────────────────────────────
// Bulk Upload
// ──────────────────────────────────────────────────────────────

export interface BulkUploadJob {
  id: string;
  jobType: BulkUploadJobType;
  uploadedBy: string;
  fileName: string;
  totalRows: number;
  successCount: number;
  failureCount: number;
  status: BulkUploadJobStatus;
  failures?: BulkUploadFailure[];
  createdAt: string;
  completedAt?: string;
}

export interface BulkUploadFailure {
  row: number;
  reason: string;
  data?: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────
// Generic API Wrappers
// ──────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

// ──────────────────────────────────────────────────────────────
// Device Fingerprinting
// ──────────────────────────────────────────────────────────────

export interface DeviceFingerprint {
  browser: string;
  os: string;
  screenResolution: string;
  timezone: string;
  language: string;
}

export interface UserDevice {
  id: string;
  userId: string;
  fingerprintHash: string;
  browser: string | null;
  os: string | null;
  screenResolution: string | null;
  timezone: string | null;
  language: string | null;
  ipAddress: string | null;
  lastIpAddress: string | null;
  userAgent: string | null;
  isTrusted: boolean;
  name: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface LoginAlert {
  id: string;
  userId: string;
  deviceId: string | null;
  alertType: LoginAlertType;
  ipAddress: string | null;
  userAgent: string | null;
  details: Record<string, unknown>;
  isRead: boolean;
  isSuspicious: boolean;
  createdAt: string;
}

export type LoginAlertType = 'new_device' | 'new_ip' | 'unusual_time' | 'suspicious';
