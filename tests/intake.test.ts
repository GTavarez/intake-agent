import { describe, expect, it } from "vitest";
import {
  IntakeField,
  isInformative,
  nextUnasked,
  unresolvedSafetyGaps,
  wasAsked,
  type FieldDef,
} from "../src/domain/intake.ts";

const defs: FieldDef[] = [
  {
    key: "chief_complaint",
    labelEn: "What is bothering you?",
    labelEs: "¿Qué le molesta?",
    kind: "text",
    required: true,
    priority: 10,
    safetyCritical: false,
  },
  {
    key: "allergies",
    labelEn: "Any allergies to medicines?",
    labelEs: "¿Es alérgico a algún medicamento?",
    kind: "text",
    required: true,
    priority: 40,
    safetyCritical: true,
  },
  {
    key: "preferred_callback",
    labelEn: "Best number to reach you?",
    labelEs: "¿Cuál es el mejor número?",
    kind: "text",
    required: false,
    priority: 90,
    safetyCritical: false,
  },
];

const field = (
  fieldKey: string,
  status: IntakeField["status"],
  value: string | null = null,
): IntakeField => ({
  fieldKey,
  status,
  value,
  confidence: null,
  sourceMessageId: null,
});

describe("field status", () => {
  it("treats every status but not_asked as asked", () => {
    expect(wasAsked("not_asked")).toBe(false);
    for (const s of ["answered", "denied", "unknown", "refused"] as const) {
      expect(wasAsked(s)).toBe(true);
    }
  });

  it("counts an answer and a denial as clinical information", () => {
    expect(isInformative("answered")).toBe(true);
    expect(isInformative("denied")).toBe(true);
  });

  it("does not treat a refusal or an unknown as reassurance", () => {
    // The whole point: these were asked, so they are not outstanding,
    // but they tell you nothing clinically and must not read as "no".
    expect(isInformative("refused")).toBe(false);
    expect(isInformative("unknown")).toBe(false);
  });
});

describe("IntakeField validation", () => {
  it("accepts an answer carrying a value", () => {
    expect(
      IntakeField.safeParse(field("chief_complaint", "answered", "chest pain"))
        .success,
    ).toBe(true);
  });

  it("accepts a denial with no value", () => {
    expect(IntakeField.safeParse(field("allergies", "denied")).success).toBe(
      true,
    );
  });

  it("rejects an answer with no value", () => {
    expect(IntakeField.safeParse(field("allergies", "answered")).success).toBe(
      false,
    );
  });

  it("rejects a denial that smuggles in a value", () => {
    expect(
      IntakeField.safeParse(field("allergies", "denied", "penicillin")).success,
    ).toBe(false);
  });
});

describe("nextUnasked", () => {
  it("asks the safety-critical field before the lower-priority one", () => {
    // allergies has priority 40, chief_complaint 10 — but allergies is
    // safety-critical, so it wins.
    expect(nextUnasked(defs, [])?.key).toBe("allergies");
  });

  it("falls to required-then-priority once safety is covered", () => {
    const asked = [field("allergies", "denied")];
    expect(nextUnasked(defs, asked)?.key).toBe("chief_complaint");
  });

  it("treats a refusal as asked and moves on", () => {
    const asked = [field("allergies", "refused")];
    expect(nextUnasked(defs, asked)?.key).toBe("chief_complaint");
  });

  it("returns null when everything has been raised", () => {
    const asked = defs.map((d) => field(d.key, "denied"));
    expect(nextUnasked(defs, asked)).toBeNull();
  });
});

describe("unresolvedSafetyGaps", () => {
  it("flags a safety-critical field nobody asked about", () => {
    expect(unresolvedSafetyGaps(defs, []).map((d) => d.key)).toEqual([
      "allergies",
    ]);
  });

  it("clears once the patient denies it", () => {
    expect(unresolvedSafetyGaps(defs, [field("allergies", "denied")])).toEqual(
      [],
    );
  });

  it("still flags when the patient refused or did not know", () => {
    // This is the case that matters. The question was asked, so it is
    // not outstanding — but nobody should proceed as though the answer
    // were "no".
    for (const s of ["refused", "unknown"] as const) {
      expect(
        unresolvedSafetyGaps(defs, [field("allergies", s)]).map((d) => d.key),
      ).toEqual(["allergies"]);
    }
  });
});
