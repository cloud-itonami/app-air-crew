/**
 * air-crew kotoba — registry.
 *
 * Plaintext path (pairing template): sdk.write / sdk.read — public ops catalog.
 * E2E paths (crewRoster, qualification, fatigueAssessment, crewAssignment,
 * crewTravel, dutyTimeRecord, crewNotification): sdk.encryptedWrite /
 * sdk.encryptedRead — per-person crew PII sealed in the kotoba envelope
 * (ADR-2605181100), read-cap = owner DID + explicit recipients. The substrate
 * never sees crew PII in plaintext.
 *
 * The crew-travel fiat / IATA-BSP settlement EXECUTION (hotel + transport
 * payment clearing) is NOT modelled here — it stays etzhayyim and is consumed via
 * consent-capability; only the travel DATA is fronted (E2E).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  PAIRING_COLLECTION,
  ROSTER_INNER_TYPE,
  QUALIFICATION_INNER_TYPE,
  FATIGUE_INNER_TYPE,
  ASSIGNMENT_INNER_TYPE,
  TRAVEL_INNER_TYPE,
  DUTY_TIME_INNER_TYPE,
  NOTIFICATION_INNER_TYPE,
  isBit,
  isDecimalString,
  pairingDidFor,
  rkeyFor,
  type CoverageInput,
  type CoverageOutput,
  type CrewAssignmentBody,
  type CrewAssignmentView,
  type CrewNotificationBody,
  type CrewNotificationView,
  type CrewRosterBody,
  type CrewRosterView,
  type CrewTravelBody,
  type CrewTravelView,
  type DutyTimeBody,
  type DutyTimeView,
  type FatigueAssessmentBody,
  type FatigueAssessmentView,
  type GetAssignmentInput,
  type GetAssignmentOutput,
  type GetDutyTimeInput,
  type GetDutyTimeOutput,
  type GetFatigueInput,
  type GetFatigueOutput,
  type GetNotificationInput,
  type GetNotificationOutput,
  type GetQualificationInput,
  type GetQualificationOutput,
  type GetRosterInput,
  type GetRosterOutput,
  type GetTravelInput,
  type GetTravelOutput,
  type ListAssignmentsInput,
  type ListAssignmentsOutput,
  type ListDutyTimeInput,
  type ListDutyTimeOutput,
  type ListFatigueInput,
  type ListFatigueOutput,
  type ListNotificationsInput,
  type ListNotificationsOutput,
  type ListPairingsInput,
  type ListPairingsOutput,
  type ListQualificationsInput,
  type ListQualificationsOutput,
  type ListRostersInput,
  type ListRostersOutput,
  type ListTravelInput,
  type ListTravelOutput,
  type PairingRecord,
  type PairingView,
  type QualificationBody,
  type QualificationView,
  type RecordAssignmentInput,
  type RecordAssignmentOutput,
  type RecordDutyTimeInput,
  type RecordDutyTimeOutput,
  type RecordFatigueInput,
  type RecordFatigueOutput,
  type RecordNotificationInput,
  type RecordNotificationOutput,
  type RecordPairingInput,
  type RecordPairingOutput,
  type RecordQualificationInput,
  type RecordQualificationOutput,
  type RecordRosterInput,
  type RecordRosterOutput,
  type RecordTravelInput,
  type RecordTravelOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Pairing template (PLAINTEXT) ───────────────────────────────────

export async function recordPairing(e: Etzhayyim, input: RecordPairingInput): Promise<RecordPairingOutput> {
  if (!input.pairingId || !input.carrierCode || !input.crewBase) return { status: "rejected", error: "missingRequiredFields" };
  if (!input.startDate || !input.endDate) return { status: "rejected", error: "missingDateWindow" };
  if (!isDecimalString(input.totalFdtHours)) return { status: "rejected", error: "invalidTotalFdtHours" };
  const rkey = rkeyFor("pairing", input.pairingId);
  const existing = await e.read<PairingRecord>({ collection: PAIRING_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", pairingUri: existing.records[0].uri, did: existing.records[0].value.did, pairingId: input.pairingId };
  }
  const now = new Date().toISOString();
  const did = pairingDidFor(input.pairingId);
  const record: PairingRecord = {
    did,
    pairingId: input.pairingId,
    carrierCode: input.carrierCode,
    crewBase: input.crewBase,
    startDate: input.startDate,
    endDate: input.endDate,
    totalFdtHours: input.totalFdtHours,
    createdAt: now,
  };
  const receipt = await e.write({ collection: PAIRING_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "recorded", pairingUri: receipt.uri, did, pairingId: input.pairingId };
}

export async function listPairings(e: Etzhayyim, input: ListPairingsInput = {}): Promise<ListPairingsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<PairingRecord>({ collection: PAIRING_COLLECTION, cursor: input.cursor, limit });
  const items: PairingView[] = resp.records
    .filter((r) => (!input.carrierCode || r.value.carrierCode === input.carrierCode) && (!input.crewBase || r.value.crewBase === input.crewBase))
    .map((r) => ({ ...r.value, pairingUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Generic E2E scan helper ────────────────────────────────────────

async function scanE2E<B>(e: Etzhayyim, innerType: string, maxScan: number): Promise<Array<B & { uri: string; sender: string; createdAt: string }>> {
  const out: Array<B & { uri: string; sender: string; createdAt: string }> = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<B>({ innerType, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      out.push({ ...(r.value as B), uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    }
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

// ─── crewRoster (E2E) ───────────────────────────────────────────────

export async function recordRoster(e: Etzhayyim, input: RecordRosterInput): Promise<RecordRosterOutput> {
  if (!input.rosterId || !input.crewDid || !input.flightNo || !input.depDate || !input.role) return { status: "rejected", error: "missingRequiredFields" };
  const body: CrewRosterBody = {
    rosterId: input.rosterId,
    crewDid: input.crewDid,
    flightNo: input.flightNo,
    depDate: input.depDate,
    role: input.role,
    dutyStart: input.dutyStart,
    dutyEnd: input.dutyEnd,
    base: input.base,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: ROSTER_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyFor("roster", input.rosterId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, rosterId: input.rosterId };
}

export async function listRosters(e: Etzhayyim, input: ListRostersInput = {}): Promise<ListRostersOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanE2E<CrewRosterBody>(e, ROSTER_INNER_TYPE, DEFAULT_MAX_SCAN);
  const filtered = all.filter((c) => (!input.crewDid || c.crewDid === input.crewDid) && (!input.flightNo || c.flightNo === input.flightNo)) as CrewRosterView[];
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getRoster(e: Etzhayyim, input: GetRosterInput): Promise<GetRosterOutput> {
  if (!input.rosterId) return { error: "invalidRosterId" };
  const all = await scanE2E<CrewRosterBody>(e, ROSTER_INNER_TYPE, DEFAULT_MAX_SCAN);
  const found = all.find((c) => c.rosterId === input.rosterId) as CrewRosterView | undefined;
  return found ? { roster: found } : { error: "notFound" };
}

// ─── qualification (E2E) ────────────────────────────────────────────

export async function recordQualification(e: Etzhayyim, input: RecordQualificationInput): Promise<RecordQualificationOutput> {
  if (!input.qualificationId || !input.crewDid || !input.aircraftType || !input.ratingType) return { status: "rejected", error: "missingRequiredFields" };
  const body: QualificationBody = {
    qualificationId: input.qualificationId,
    crewDid: input.crewDid,
    aircraftType: input.aircraftType,
    ratingType: input.ratingType,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    issuingAuthority: input.issuingAuthority,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: QUALIFICATION_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyFor("qual", input.qualificationId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, qualificationId: input.qualificationId };
}

export async function listQualifications(e: Etzhayyim, input: ListQualificationsInput = {}): Promise<ListQualificationsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanE2E<QualificationBody>(e, QUALIFICATION_INNER_TYPE, DEFAULT_MAX_SCAN);
  const filtered = all.filter((c) => (!input.crewDid || c.crewDid === input.crewDid) && (!input.aircraftType || c.aircraftType === input.aircraftType)) as QualificationView[];
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getQualification(e: Etzhayyim, input: GetQualificationInput): Promise<GetQualificationOutput> {
  if (!input.qualificationId) return { error: "invalidQualificationId" };
  const all = await scanE2E<QualificationBody>(e, QUALIFICATION_INNER_TYPE, DEFAULT_MAX_SCAN);
  const found = all.find((c) => c.qualificationId === input.qualificationId) as QualificationView | undefined;
  return found ? { qualification: found } : { error: "notFound" };
}

// ─── fatigueAssessment (E2E) ────────────────────────────────────────

export async function recordFatigue(e: Etzhayyim, input: RecordFatigueInput): Promise<RecordFatigueOutput> {
  if (!input.assessmentId || !input.crewDid || !input.dutyDate) return { status: "rejected", error: "missingRequiredFields" };
  if (![input.fdpHours, input.fdtHours, input.restHours, input.cumulative28d, input.cumulative365d].every(isDecimalString)) {
    return { status: "rejected", error: "invalidDecimalHours" };
  }
  const body: FatigueAssessmentBody = {
    assessmentId: input.assessmentId,
    crewDid: input.crewDid,
    dutyDate: input.dutyDate,
    fdpHours: input.fdpHours,
    fdtHours: input.fdtHours,
    restHours: input.restHours,
    cumulative28d: input.cumulative28d,
    cumulative365d: input.cumulative365d,
    assessedAt: input.assessedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: FATIGUE_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyFor("fatigue", input.assessmentId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, assessmentId: input.assessmentId };
}

export async function listFatigue(e: Etzhayyim, input: ListFatigueInput = {}): Promise<ListFatigueOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanE2E<FatigueAssessmentBody>(e, FATIGUE_INNER_TYPE, DEFAULT_MAX_SCAN);
  const filtered = all.filter((c) => !input.crewDid || c.crewDid === input.crewDid) as FatigueAssessmentView[];
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getFatigue(e: Etzhayyim, input: GetFatigueInput): Promise<GetFatigueOutput> {
  if (!input.assessmentId) return { error: "invalidAssessmentId" };
  const all = await scanE2E<FatigueAssessmentBody>(e, FATIGUE_INNER_TYPE, DEFAULT_MAX_SCAN);
  const found = all.find((c) => c.assessmentId === input.assessmentId) as FatigueAssessmentView | undefined;
  return found ? { assessment: found } : { error: "notFound" };
}

// ─── crewAssignment (E2E) ───────────────────────────────────────────

export async function recordAssignment(e: Etzhayyim, input: RecordAssignmentInput): Promise<RecordAssignmentOutput> {
  if (!input.assignmentId || !input.crewDid || !input.flightNo || !input.depDate || !input.role) return { status: "rejected", error: "missingRequiredFields" };
  const body: CrewAssignmentBody = {
    assignmentId: input.assignmentId,
    crewDid: input.crewDid,
    flightNo: input.flightNo,
    depDate: input.depDate,
    role: input.role,
    assignmentType: input.assignmentType,
    assignedAt: input.assignedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: ASSIGNMENT_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyFor("assign", input.assignmentId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, assignmentId: input.assignmentId };
}

export async function listAssignments(e: Etzhayyim, input: ListAssignmentsInput = {}): Promise<ListAssignmentsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanE2E<CrewAssignmentBody>(e, ASSIGNMENT_INNER_TYPE, DEFAULT_MAX_SCAN);
  const filtered = all.filter((c) => (!input.crewDid || c.crewDid === input.crewDid) && (!input.flightNo || c.flightNo === input.flightNo)) as CrewAssignmentView[];
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getAssignment(e: Etzhayyim, input: GetAssignmentInput): Promise<GetAssignmentOutput> {
  if (!input.assignmentId) return { error: "invalidAssignmentId" };
  const all = await scanE2E<CrewAssignmentBody>(e, ASSIGNMENT_INNER_TYPE, DEFAULT_MAX_SCAN);
  const found = all.find((c) => c.assignmentId === input.assignmentId) as CrewAssignmentView | undefined;
  return found ? { assignment: found } : { error: "notFound" };
}

// ─── crewTravel (E2E; fiat/BSP settlement CALL stays etzhayyim) ──────────

export async function recordTravel(e: Etzhayyim, input: RecordTravelInput): Promise<RecordTravelOutput> {
  if (!input.travelId || !input.crewDid || !input.travelType || !input.origin || !input.dest) return { status: "rejected", error: "missingRequiredFields" };
  if (!isBit(input.hotelRequired)) return { status: "rejected", error: "invalidHotelRequired" };
  const body: CrewTravelBody = {
    travelId: input.travelId,
    crewDid: input.crewDid,
    travelType: input.travelType,
    origin: input.origin,
    dest: input.dest,
    depDate: input.depDate,
    hotelRequired: input.hotelRequired,
    bookedAt: input.bookedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: TRAVEL_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyFor("travel", input.travelId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, travelId: input.travelId };
}

export async function listTravel(e: Etzhayyim, input: ListTravelInput = {}): Promise<ListTravelOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanE2E<CrewTravelBody>(e, TRAVEL_INNER_TYPE, DEFAULT_MAX_SCAN);
  const filtered = all.filter((c) => (!input.crewDid || c.crewDid === input.crewDid) && (!input.travelType || c.travelType === input.travelType)) as CrewTravelView[];
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getTravel(e: Etzhayyim, input: GetTravelInput): Promise<GetTravelOutput> {
  if (!input.travelId) return { error: "invalidTravelId" };
  const all = await scanE2E<CrewTravelBody>(e, TRAVEL_INNER_TYPE, DEFAULT_MAX_SCAN);
  const found = all.find((c) => c.travelId === input.travelId) as CrewTravelView | undefined;
  return found ? { travel: found } : { error: "notFound" };
}

// ─── dutyTimeRecord (E2E) ───────────────────────────────────────────

export async function recordDutyTime(e: Etzhayyim, input: RecordDutyTimeInput): Promise<RecordDutyTimeOutput> {
  if (!input.dutyId || !input.crewDid || !input.dutyDate) return { status: "rejected", error: "missingRequiredFields" };
  if (![input.fdpHours, input.fdtHours, input.restHours].every(isDecimalString)) return { status: "rejected", error: "invalidDecimalHours" };
  const body: DutyTimeBody = {
    dutyId: input.dutyId,
    crewDid: input.crewDid,
    dutyDate: input.dutyDate,
    fdpHours: input.fdpHours,
    fdtHours: input.fdtHours,
    restHours: input.restHours,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: DUTY_TIME_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyFor("duty", input.dutyId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, dutyId: input.dutyId };
}

export async function listDutyTime(e: Etzhayyim, input: ListDutyTimeInput = {}): Promise<ListDutyTimeOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanE2E<DutyTimeBody>(e, DUTY_TIME_INNER_TYPE, DEFAULT_MAX_SCAN);
  const filtered = all.filter((c) => !input.crewDid || c.crewDid === input.crewDid) as DutyTimeView[];
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getDutyTime(e: Etzhayyim, input: GetDutyTimeInput): Promise<GetDutyTimeOutput> {
  if (!input.dutyId) return { error: "invalidDutyId" };
  const all = await scanE2E<DutyTimeBody>(e, DUTY_TIME_INNER_TYPE, DEFAULT_MAX_SCAN);
  const found = all.find((c) => c.dutyId === input.dutyId) as DutyTimeView | undefined;
  return found ? { duty: found } : { error: "notFound" };
}

// ─── crewNotification (E2E) ─────────────────────────────────────────

export async function recordNotification(e: Etzhayyim, input: RecordNotificationInput): Promise<RecordNotificationOutput> {
  if (!input.notificationId || !input.crewDid || !input.notificationType || !input.message) return { status: "rejected", error: "missingRequiredFields" };
  const body: CrewNotificationBody = {
    notificationId: input.notificationId,
    crewDid: input.crewDid,
    notificationType: input.notificationType,
    message: input.message,
    flightNo: input.flightNo,
    sentAt: input.sentAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: NOTIFICATION_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyFor("notify", input.notificationId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, notificationId: input.notificationId };
}

export async function listNotifications(e: Etzhayyim, input: ListNotificationsInput = {}): Promise<ListNotificationsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanE2E<CrewNotificationBody>(e, NOTIFICATION_INNER_TYPE, DEFAULT_MAX_SCAN);
  const filtered = all.filter((c) => (!input.crewDid || c.crewDid === input.crewDid) && (!input.notificationType || c.notificationType === input.notificationType)) as CrewNotificationView[];
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getNotification(e: Etzhayyim, input: GetNotificationInput): Promise<GetNotificationOutput> {
  if (!input.notificationId) return { error: "invalidNotificationId" };
  const all = await scanE2E<CrewNotificationBody>(e, NOTIFICATION_INNER_TYPE, DEFAULT_MAX_SCAN);
  const found = all.find((c) => c.notificationId === input.notificationId) as CrewNotificationView | undefined;
  return found ? { notification: found } : { error: "notFound" };
}

// ─── Coverage rollup (countAll across plaintext + all 7 E2E) ────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const pairingsByCarrier: Record<string, number> = {};
  let pairingCount = 0;
  let cursor: string | undefined;
  while (pairingCount < maxScan) {
    const page = await e.read<PairingRecord>({ collection: PAIRING_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      pairingsByCarrier[r.value.carrierCode] = (pairingsByCarrier[r.value.carrierCode] ?? 0) + 1;
      pairingCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  const crewRosterCount = (await scanE2E<CrewRosterBody>(e, ROSTER_INNER_TYPE, maxScan)).length;
  const qualificationCount = (await scanE2E<QualificationBody>(e, QUALIFICATION_INNER_TYPE, maxScan)).length;
  const fatigueAssessmentCount = (await scanE2E<FatigueAssessmentBody>(e, FATIGUE_INNER_TYPE, maxScan)).length;
  const crewAssignmentCount = (await scanE2E<CrewAssignmentBody>(e, ASSIGNMENT_INNER_TYPE, maxScan)).length;
  const crewTravelCount = (await scanE2E<CrewTravelBody>(e, TRAVEL_INNER_TYPE, maxScan)).length;
  const dutyTimeRecordCount = (await scanE2E<DutyTimeBody>(e, DUTY_TIME_INNER_TYPE, maxScan)).length;
  const crewNotificationCount = (await scanE2E<CrewNotificationBody>(e, NOTIFICATION_INNER_TYPE, maxScan)).length;
  const counts = [pairingCount, crewRosterCount, qualificationCount, fatigueAssessmentCount, crewAssignmentCount, crewTravelCount, dutyTimeRecordCount, crewNotificationCount];
  return {
    pairingCount,
    crewRosterCount,
    qualificationCount,
    fatigueAssessmentCount,
    crewAssignmentCount,
    crewTravelCount,
    dutyTimeRecordCount,
    crewNotificationCount,
    pairingsByCarrier,
    truncated: counts.some((c) => c >= maxScan),
  };
}
