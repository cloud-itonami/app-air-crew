/**
 * air-crew kotoba — barrel. Product-front for airline crew management:
 * pairing TEMPLATES plaintext (public ops catalog) + per-person crew PII
 * (roster / qualification / fatigue / assignment / travel / duty-time /
 * notification) sealed via kotoba E2E (sdk.encryptedWrite/Read, ADR-2605181100).
 * The crew-travel fiat / IATA-BSP settlement EXECUTION stays etzhayyim, consumed via
 * consent-capability. Founder directive 2026-06-03: maximal migration.
 */
export * from "./types.js";
export {
  recordPairing,
  listPairings,
  recordRoster,
  listRosters,
  getRoster,
  recordQualification,
  listQualifications,
  getQualification,
  recordFatigue,
  listFatigue,
  getFatigue,
  recordAssignment,
  listAssignments,
  getAssignment,
  recordTravel,
  listTravel,
  getTravel,
  recordDutyTime,
  listDutyTime,
  getDutyTime,
  recordNotification,
  listNotifications,
  getNotification,
  coverage,
} from "./registry.js";
