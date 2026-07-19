/**
 * air-crew kotoba — kotoba product-front for airline crew management.
 *
 * Per ADR-2606011400 (Consensys product-front / infra-back) + ADR-2605172400
 * (3-axis split) + ADR-2605181100 (kotoba E2E encrypted-record envelope).
 * Founder directive 2026-06-03: MAXIMAL migration — front everything that can
 * move; only the irreducible regulated EXECUTION stays etzhayyim.
 *
 * SPLIT (discriminator = presence of a per-person crewDid):
 *   PUBLIC (plaintext AT records) — pairing TEMPLATES (carrier / base / date
 *   window / aggregate FDT hours). No person bound, frontable open ops catalog.
 *   Written via sdk.write / read via sdk.read.
 *
 *   PER-PERSON / PII (kotoba E2E, com.etzhayyim.encrypted.record) — every record
 *   that binds a named crewDid to duty / health / certification / travel /
 *   message / ledger data: crewRoster, qualification, fatigueAssessment,
 *   crewAssignment, crewTravel, dutyTimeRecord, crewNotification. Sealed via
 *   sdk.encryptedWrite (read-cap = owner DID + explicit recipients), so crew PII
 *   lives on-substrate encrypted, never etzhayyim-resident.
 *
 *   STAYS etzhayyim (consumed via consent-capability) — the crew-travel fiat / IATA
 *   BSP settlement EXECUTION rail (hotel + positioning-transport payment
 *   clearing). The travel DATA fronts E2E here; only the fiat-clearing CALL
 *   stays etzhayyim, because per ADR-2605172100 etzhayyim never becomes the fiat
 *   merchant-of-record / counterparty.
 *
 * AT-Lexicon: no float. Counts / integer hours are integers; duty-hour decimals
 * (FDP / FDT / rest / cumulative) are carried as decimal STRINGS.
 */

// ─── Collection NSIDs ───────────────────────────────────────────────

// Plaintext public collection.
export const PAIRING_COLLECTION = "com.etzhayyim.apps.airCrew.pairing";

// E2E inner-type NSIDs (= collection NSID for each sealed body).
export const ROSTER_INNER_TYPE = "com.etzhayyim.apps.airCrew.crewRoster";
export const QUALIFICATION_INNER_TYPE = "com.etzhayyim.apps.airCrew.qualification";
export const FATIGUE_INNER_TYPE = "com.etzhayyim.apps.airCrew.fatigueAssessment";
export const ASSIGNMENT_INNER_TYPE = "com.etzhayyim.apps.airCrew.crewAssignment";
export const TRAVEL_INNER_TYPE = "com.etzhayyim.apps.airCrew.crewTravel";
export const DUTY_TIME_INNER_TYPE = "com.etzhayyim.apps.airCrew.dutyTimeRecord";
export const NOTIFICATION_INNER_TYPE = "com.etzhayyim.apps.airCrew.crewNotification";

export const AIR_CREW_DID_PREFIX = "did:web:air-crew.etzhayyim.com:" as const;

// ─── Pairing template (PLAINTEXT, public ops catalog) ───────────────

export interface PairingRecord {
  did: string;
  pairingId: string;
  carrierCode: string;
  crewBase: string;
  startDate: string;
  endDate: string;
  /** decimal string (hours), e.g. "42.5". */
  totalFdtHours: string;
  createdAt: string;
}
export interface PairingView extends PairingRecord {
  pairingUri: string;
}
export interface RecordPairingInput {
  pairingId: string;
  carrierCode: string;
  crewBase: string;
  startDate: string;
  endDate: string;
  totalFdtHours: string;
}
export interface RecordPairingOutput {
  status: "recorded" | "alreadyExists" | "rejected";
  pairingUri?: string;
  did?: string;
  pairingId?: string;
  error?: string;
}
export interface ListPairingsInput {
  carrierCode?: string;
  crewBase?: string;
  limit?: number;
  cursor?: string;
}
export interface ListPairingsOutput {
  items: PairingView[];
  cursor?: string;
  total: number;
}

// ─── crewRoster (E2E, per-person duty assignment) ───────────────────

export interface CrewRosterBody {
  rosterId: string;
  crewDid: string;
  flightNo: string;
  depDate: string;
  role: string;
  dutyStart: string;
  dutyEnd: string;
  base: string;
  recordedAt: string;
}
export interface CrewRosterView extends CrewRosterBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordRosterInput {
  rosterId: string;
  crewDid: string;
  flightNo: string;
  depDate: string;
  role: string;
  dutyStart: string;
  dutyEnd: string;
  base: string;
  recordedAt?: string;
  recipients?: string[];
}
export interface RecordRosterOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  rosterId?: string;
  error?: string;
}
export interface ListRostersInput {
  crewDid?: string;
  flightNo?: string;
  limit?: number;
}
export interface ListRostersOutput {
  items: CrewRosterView[];
  total: number;
}
export interface GetRosterInput {
  rosterId: string;
}
export interface GetRosterOutput {
  roster?: CrewRosterView;
  error?: string;
}

// ─── qualification (E2E, per-person certification/PII) ──────────────

export interface QualificationBody {
  qualificationId: string;
  crewDid: string;
  aircraftType: string;
  ratingType: string;
  issuedAt: string;
  expiresAt: string;
  issuingAuthority: string;
  recordedAt: string;
}
export interface QualificationView extends QualificationBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordQualificationInput {
  qualificationId: string;
  crewDid: string;
  aircraftType: string;
  ratingType: string;
  issuedAt: string;
  expiresAt: string;
  issuingAuthority: string;
  recordedAt?: string;
  recipients?: string[];
}
export interface RecordQualificationOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  qualificationId?: string;
  error?: string;
}
export interface ListQualificationsInput {
  crewDid?: string;
  aircraftType?: string;
  limit?: number;
}
export interface ListQualificationsOutput {
  items: QualificationView[];
  total: number;
}
export interface GetQualificationInput {
  qualificationId: string;
}
export interface GetQualificationOutput {
  qualification?: QualificationView;
  error?: string;
}

// ─── fatigueAssessment (E2E, per-person health/sensitive) ───────────

export interface FatigueAssessmentBody {
  assessmentId: string;
  crewDid: string;
  dutyDate: string;
  /** decimal strings (hours). */
  fdpHours: string;
  fdtHours: string;
  restHours: string;
  cumulative28d: string;
  cumulative365d: string;
  assessedAt: string;
}
export interface FatigueAssessmentView extends FatigueAssessmentBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordFatigueInput {
  assessmentId: string;
  crewDid: string;
  dutyDate: string;
  fdpHours: string;
  fdtHours: string;
  restHours: string;
  cumulative28d: string;
  cumulative365d: string;
  assessedAt?: string;
  recipients?: string[];
}
export interface RecordFatigueOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  assessmentId?: string;
  error?: string;
}
export interface ListFatigueInput {
  crewDid?: string;
  limit?: number;
}
export interface ListFatigueOutput {
  items: FatigueAssessmentView[];
  total: number;
}
export interface GetFatigueInput {
  assessmentId: string;
}
export interface GetFatigueOutput {
  assessment?: FatigueAssessmentView;
  error?: string;
}

// ─── crewAssignment (E2E, per-person assignment) ────────────────────

export interface CrewAssignmentBody {
  assignmentId: string;
  crewDid: string;
  flightNo: string;
  depDate: string;
  role: string;
  assignmentType: string;
  assignedAt: string;
}
export interface CrewAssignmentView extends CrewAssignmentBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordAssignmentInput {
  assignmentId: string;
  crewDid: string;
  flightNo: string;
  depDate: string;
  role: string;
  assignmentType: string;
  assignedAt?: string;
  recipients?: string[];
}
export interface RecordAssignmentOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  assignmentId?: string;
  error?: string;
}
export interface ListAssignmentsInput {
  crewDid?: string;
  flightNo?: string;
  limit?: number;
}
export interface ListAssignmentsOutput {
  items: CrewAssignmentView[];
  total: number;
}
export interface GetAssignmentInput {
  assignmentId: string;
}
export interface GetAssignmentOutput {
  assignment?: CrewAssignmentView;
  error?: string;
}

// ─── crewTravel (E2E; fiat/BSP settlement CALL stays etzhayyim) ──────────

export interface CrewTravelBody {
  travelId: string;
  crewDid: string;
  travelType: string;
  origin: string;
  dest: string;
  depDate: string;
  /** integer 0/1 boolean-as-int (AT-Lexicon no float, kept integer-safe). */
  hotelRequired: number;
  bookedAt: string;
}
export interface CrewTravelView extends CrewTravelBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordTravelInput {
  travelId: string;
  crewDid: string;
  travelType: string;
  origin: string;
  dest: string;
  depDate: string;
  hotelRequired: number;
  bookedAt?: string;
  recipients?: string[];
}
export interface RecordTravelOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  travelId?: string;
  error?: string;
}
export interface ListTravelInput {
  crewDid?: string;
  travelType?: string;
  limit?: number;
}
export interface ListTravelOutput {
  items: CrewTravelView[];
  total: number;
}
export interface GetTravelInput {
  travelId: string;
}
export interface GetTravelOutput {
  travel?: CrewTravelView;
  error?: string;
}

// ─── dutyTimeRecord (E2E, per-person duty ledger) ───────────────────

export interface DutyTimeBody {
  dutyId: string;
  crewDid: string;
  dutyDate: string;
  /** decimal strings (hours). */
  fdpHours: string;
  fdtHours: string;
  restHours: string;
  recordedAt: string;
}
export interface DutyTimeView extends DutyTimeBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordDutyTimeInput {
  dutyId: string;
  crewDid: string;
  dutyDate: string;
  fdpHours: string;
  fdtHours: string;
  restHours: string;
  recordedAt?: string;
  recipients?: string[];
}
export interface RecordDutyTimeOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  dutyId?: string;
  error?: string;
}
export interface ListDutyTimeInput {
  crewDid?: string;
  limit?: number;
}
export interface ListDutyTimeOutput {
  items: DutyTimeView[];
  total: number;
}
export interface GetDutyTimeInput {
  dutyId: string;
}
export interface GetDutyTimeOutput {
  duty?: DutyTimeView;
  error?: string;
}

// ─── crewNotification (E2E, per-person message metadata/content) ────

export interface CrewNotificationBody {
  notificationId: string;
  crewDid: string;
  notificationType: string;
  message: string;
  flightNo: string;
  sentAt: string;
}
export interface CrewNotificationView extends CrewNotificationBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordNotificationInput {
  notificationId: string;
  crewDid: string;
  notificationType: string;
  message: string;
  flightNo: string;
  sentAt?: string;
  recipients?: string[];
}
export interface RecordNotificationOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  notificationId?: string;
  error?: string;
}
export interface ListNotificationsInput {
  crewDid?: string;
  notificationType?: string;
  limit?: number;
}
export interface ListNotificationsOutput {
  items: CrewNotificationView[];
  total: number;
}
export interface GetNotificationInput {
  notificationId: string;
}
export interface GetNotificationOutput {
  notification?: CrewNotificationView;
  error?: string;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  pairingCount?: number;
  crewRosterCount?: number;
  qualificationCount?: number;
  fatigueAssessmentCount?: number;
  crewAssignmentCount?: number;
  crewTravelCount?: number;
  dutyTimeRecordCount?: number;
  crewNotificationCount?: number;
  pairingsByCarrier?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
export function isBit(n: unknown): n is number {
  return n === 0 || n === 1;
}
/** Decimal string: non-empty, digits with optional single decimal point, no sign. */
export function isDecimalString(s: unknown): s is string {
  return typeof s === "string" && /^\d+(\.\d+)?$/.test(s);
}
export function pairingDidFor(id: string): string {
  return `${AIR_CREW_DID_PREFIX}pairing:${id.toLowerCase()}`;
}
export function rkeyFor(prefix: string, id: string): string {
  return `${prefix}-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
