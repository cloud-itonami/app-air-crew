import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
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
} from "../src/index.js";

const OWNER = "did:web:air-crew.etzhayyim.com";

describe("air-crew kotoba (product-front, kotoba E2E split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("pairing (PLAINTEXT public ops catalog)", () => {
    it("records, dedups, validates decimal hours, lists/filters", async () => {
      expect((await recordPairing(e, { pairingId: "p1", carrierCode: "NH", crewBase: "HND", startDate: "2026-06-01", endDate: "2026-06-04", totalFdtHours: "42.5" })).status).toBe("recorded");
      expect((await recordPairing(e, { pairingId: "p1", carrierCode: "NH", crewBase: "HND", startDate: "2026-06-01", endDate: "2026-06-04", totalFdtHours: "42.5" })).status).toBe("alreadyExists");
      // float-as-string with bad shape rejected
      expect((await recordPairing(e, { pairingId: "pX", carrierCode: "NH", crewBase: "HND", startDate: "a", endDate: "b", totalFdtHours: "8h" })).status).toBe("rejected");
      await recordPairing(e, { pairingId: "p2", carrierCode: "JL", crewBase: "KIX", startDate: "2026-06-02", endDate: "2026-06-05", totalFdtHours: "30" });
      expect((await listPairings(e)).total).toBe(2);
      expect((await listPairings(e, { carrierCode: "NH" })).total).toBe(1);
      expect((await listPairings(e, { crewBase: "KIX" })).total).toBe(1);
    });
  });

  describe("crewRoster (E2E per-person PII)", () => {
    it("seals, round-trips, validates, filters", async () => {
      const ok = await recordRoster(e, { rosterId: "r1", crewDid: "did:web:crew.a", flightNo: "NH101", depDate: "2026-06-10", role: "CAPT", dutyStart: "2026-06-10T06:00Z", dutyEnd: "2026-06-10T14:00Z", base: "HND" });
      expect(ok.status).toBe("recorded");
      expect(ok.keyId).toBeTruthy();
      expect((await recordRoster(e, { rosterId: "rX", crewDid: "", flightNo: "x", depDate: "d", role: "r", dutyStart: "s", dutyEnd: "e", base: "b" })).status).toBe("rejected");
      const got = await getRoster(e, { rosterId: "r1" });
      expect(got.roster?.crewDid).toBe("did:web:crew.a");
      await recordRoster(e, { rosterId: "r2", crewDid: "did:web:crew.b", flightNo: "JL55", depDate: "2026-06-11", role: "FO", dutyStart: "s", dutyEnd: "e", base: "KIX" });
      expect((await listRosters(e)).total).toBe(2);
      expect((await listRosters(e, { crewDid: "did:web:crew.a" })).total).toBe(1);
    });

    it("enforces read-cap: non-recipient DID sees no rosters", async () => {
      await recordRoster(e, { rosterId: "r1", crewDid: "did:web:crew.a", flightNo: "NH101", depDate: "d", role: "CAPT", dutyStart: "s", dutyEnd: "e", base: "HND" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listRosters(outsider)).total).toBe(0);
    });

    it("grants read-cap to an explicit recipient", async () => {
      const ops = "did:web:ops.example";
      const r = await recordRoster(e, { rosterId: "r1", crewDid: "did:web:crew.a", flightNo: "NH101", depDate: "d", role: "CAPT", dutyStart: "s", dutyEnd: "e", base: "HND", recipients: [ops] });
      expect(r.status).toBe("recorded");
      expect((await listRosters(e)).total).toBe(1);
    });
  });

  describe("qualification (E2E)", () => {
    it("seals + round-trips + filters by aircraftType", async () => {
      expect((await recordQualification(e, { qualificationId: "q1", crewDid: "did:web:crew.a", aircraftType: "B789", ratingType: "TYPE", issuedAt: "2025-01-01", expiresAt: "2027-01-01", issuingAuthority: "JCAB" })).status).toBe("recorded");
      expect((await recordQualification(e, { qualificationId: "qX", crewDid: "", aircraftType: "", ratingType: "", issuedAt: "", expiresAt: "", issuingAuthority: "" })).status).toBe("rejected");
      expect((await getQualification(e, { qualificationId: "q1" })).qualification?.issuingAuthority).toBe("JCAB");
      expect((await listQualifications(e, { aircraftType: "B789" })).total).toBe(1);
    });
  });

  describe("fatigueAssessment (E2E health/sensitive, decimal hours)", () => {
    it("validates decimal hours, seals, round-trips", async () => {
      const ok = await recordFatigue(e, { assessmentId: "f1", crewDid: "did:web:crew.a", dutyDate: "2026-06-10", fdpHours: "11.5", fdtHours: "8.0", restHours: "12.5", cumulative28d: "95.0", cumulative365d: "780.5" });
      expect(ok.status).toBe("recorded");
      expect((await recordFatigue(e, { assessmentId: "fX", crewDid: "did:web:crew.a", dutyDate: "d", fdpHours: "bad", fdtHours: "8", restHours: "12", cumulative28d: "95", cumulative365d: "780" })).status).toBe("rejected");
      expect((await getFatigue(e, { assessmentId: "f1" })).assessment?.cumulative365d).toBe("780.5");
      expect((await listFatigue(e, { crewDid: "did:web:crew.a" })).total).toBe(1);
    });
  });

  describe("crewAssignment (E2E)", () => {
    it("seals + round-trips + filters by flightNo", async () => {
      expect((await recordAssignment(e, { assignmentId: "a1", crewDid: "did:web:crew.a", flightNo: "NH101", depDate: "2026-06-10", role: "CAPT", assignmentType: "LINE" })).status).toBe("recorded");
      expect((await getAssignment(e, { assignmentId: "a1" })).assignment?.assignmentType).toBe("LINE");
      expect((await listAssignments(e, { flightNo: "NH101" })).total).toBe(1);
    });
  });

  describe("crewTravel (E2E; fiat/BSP settlement stays etzhayyim)", () => {
    it("validates hotelRequired bit, seals, round-trips", async () => {
      expect((await recordTravel(e, { travelId: "t1", crewDid: "did:web:crew.a", travelType: "POSITIONING", origin: "HND", dest: "ITM", depDate: "2026-06-10", hotelRequired: 1 })).status).toBe("recorded");
      expect((await recordTravel(e, { travelId: "tX", crewDid: "did:web:crew.a", travelType: "x", origin: "o", dest: "d", depDate: "d", hotelRequired: 5 as any })).status).toBe("rejected");
      expect((await getTravel(e, { travelId: "t1" })).travel?.hotelRequired).toBe(1);
      expect((await listTravel(e, { travelType: "POSITIONING" })).total).toBe(1);
    });
  });

  describe("dutyTimeRecord (E2E ledger, decimal hours)", () => {
    it("validates decimal hours, seals, round-trips", async () => {
      expect((await recordDutyTime(e, { dutyId: "dt1", crewDid: "did:web:crew.a", dutyDate: "2026-06-10", fdpHours: "10.0", fdtHours: "7.5", restHours: "13.0" })).status).toBe("recorded");
      expect((await recordDutyTime(e, { dutyId: "dtX", crewDid: "did:web:crew.a", dutyDate: "d", fdpHours: "x", fdtHours: "7", restHours: "13" })).status).toBe("rejected");
      expect((await getDutyTime(e, { dutyId: "dt1" })).duty?.fdtHours).toBe("7.5");
      expect((await listDutyTime(e, { crewDid: "did:web:crew.a" })).total).toBe(1);
    });
  });

  describe("crewNotification (E2E message metadata + content)", () => {
    it("seals + round-trips + filters by type", async () => {
      expect((await recordNotification(e, { notificationId: "n1", crewDid: "did:web:crew.a", notificationType: "ROSTER_CHANGE", message: "Flight NH101 retimed", flightNo: "NH101" })).status).toBe("recorded");
      expect((await recordNotification(e, { notificationId: "nX", crewDid: "", notificationType: "", message: "", flightNo: "" })).status).toBe("rejected");
      expect((await getNotification(e, { notificationId: "n1" })).notification?.message).toBe("Flight NH101 retimed");
      expect((await listNotifications(e, { notificationType: "ROSTER_CHANGE" })).total).toBe(1);
    });
  });

  describe("coverage rollup (countAll across plaintext + all 7 E2E)", () => {
    it("counts every collection", async () => {
      await recordPairing(e, { pairingId: "p1", carrierCode: "NH", crewBase: "HND", startDate: "a", endDate: "b", totalFdtHours: "42.5" });
      await recordPairing(e, { pairingId: "p2", carrierCode: "NH", crewBase: "HND", startDate: "a", endDate: "b", totalFdtHours: "30.0" });
      await recordRoster(e, { rosterId: "r1", crewDid: "did:web:crew.a", flightNo: "NH101", depDate: "d", role: "CAPT", dutyStart: "s", dutyEnd: "e", base: "HND" });
      await recordQualification(e, { qualificationId: "q1", crewDid: "did:web:crew.a", aircraftType: "B789", ratingType: "TYPE", issuedAt: "i", expiresAt: "x", issuingAuthority: "JCAB" });
      await recordFatigue(e, { assessmentId: "f1", crewDid: "did:web:crew.a", dutyDate: "d", fdpHours: "11.5", fdtHours: "8.0", restHours: "12.5", cumulative28d: "95.0", cumulative365d: "780.5" });
      await recordAssignment(e, { assignmentId: "a1", crewDid: "did:web:crew.a", flightNo: "NH101", depDate: "d", role: "CAPT", assignmentType: "LINE" });
      await recordTravel(e, { travelId: "t1", crewDid: "did:web:crew.a", travelType: "POSITIONING", origin: "HND", dest: "ITM", depDate: "d", hotelRequired: 1 });
      await recordDutyTime(e, { dutyId: "dt1", crewDid: "did:web:crew.a", dutyDate: "d", fdpHours: "10.0", fdtHours: "7.5", restHours: "13.0" });
      await recordNotification(e, { notificationId: "n1", crewDid: "did:web:crew.a", notificationType: "ROSTER_CHANGE", message: "m", flightNo: "NH101" });

      const cov = await coverage(e);
      expect(cov.pairingCount).toBe(2);
      expect(cov.crewRosterCount).toBe(1);
      expect(cov.qualificationCount).toBe(1);
      expect(cov.fatigueAssessmentCount).toBe(1);
      expect(cov.crewAssignmentCount).toBe(1);
      expect(cov.crewTravelCount).toBe(1);
      expect(cov.dutyTimeRecordCount).toBe(1);
      expect(cov.crewNotificationCount).toBe(1);
      expect(cov.pairingsByCarrier?.NH).toBe(2);
      expect(cov.truncated).toBe(false);
    });
  });
});
