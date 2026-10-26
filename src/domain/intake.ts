import { z } from "zod";

/**
 * The intake domain, in types.
 *
 * These mirror 002_domain.sql. The schema is the source of truth for
 * storage; these are the source of truth for everything the code does
 * with it, and in week 4 the same schemas constrain what the model is
 * allowed to return.
 */

/**
 * How we came to know a field.
 *
 * This is the distinction the whole model rests on. A null value cannot
 * tell you whether a patient has no allergies or whether nobody asked,
 * and in a clinical record those are not close to the same thing.
 */
export const FieldStatus = z.enum([
  /** Nobody has raised it. Not a gap in the data — a job for the agent. */
  "not_asked",
  /** The patient gave a value. */
  "answered",
  /** Asked, and the patient said no. A finding in its own right. */
  "denied",
  /** Asked, and the patient genuinely does not know. */
  "unknown",
  /** Asked, and the patient declined to answer. */
  "refused",
]);
export type FieldStatus = z.infer<typeof FieldStatus>;

/** A status means we asked. Only `not_asked` is still outstanding. */
export function wasAsked(status: FieldStatus): boolean {
  return status !== "not_asked";
}

/**
 * True when this field carries clinical information, as opposed to
 * merely having been addressed. A denial is informative; a refusal and
 * an unknown are addressed but tell you nothing clinical, and a record
 * that treats them as reassurance is lying to whoever reads it next.
 */
export function isInformative(status: FieldStatus): boolean {
  return status === "answered" || status === "denied";
}

export const IntakeField = z
  .object({
    fieldKey: z.string().min(1),
    status: FieldStatus,
    value: z.string().nullable().default(null),
    confidence: z.number().min(0).max(1).nullable().default(null),
    sourceMessageId: z.uuid().nullable().default(null),
  })
  .refine((f) => (f.status === "answered") === (f.value !== null), {
    message:
      "value must be present if and only if status is 'answered' — " +
      "a denial with a value, or an answer without one, is a bug",
    path: ["value"],
  });
export type IntakeField = z.infer<typeof IntakeField>;

export const IntakeSnapshot = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid().nullable().default(null),
  version: z.number().int().positive(),
  promptVersion: z.string().nullable().default(null),
  fields: z.array(IntakeField),
});
export type IntakeSnapshot = z.infer<typeof IntakeSnapshot>;

export const ActionKind = z.enum([
  "ask_followup",
  "flag_for_nurse",
  "record_intake",
  "schedule_followup",
  "close",
]);
export type ActionKind = z.infer<typeof ActionKind>;

/** A field definition as the catalog stores it. */
export type FieldDef = {
  key: string;
  labelEn: string;
  labelEs: string;
  kind: string;
  required: boolean;
  priority: number;
  safetyCritical: boolean;
};

/**
 * Pick the next question.
 *
 * Deliberately a pure function over data, not a prompt. The model
 * decides how to *phrase* a question; it does not get to decide whether
 * a safety-critical field can be skipped. Keeping that boundary sharp
 * is the difference between an agent you can reason about and one you
 * can only hope about — and it is the single most useful thing to be
 * able to describe in an interview about this project.
 *
 * Safety-critical fields first, then required, then by priority.
 */
export function nextUnasked(
  defs: readonly FieldDef[],
  fields: readonly IntakeField[],
): FieldDef | null {
  const asked = new Set(
    fields.filter((f) => wasAsked(f.status)).map((f) => f.fieldKey),
  );

  const outstanding = defs
    .filter((d) => !asked.has(d.key))
    .sort(
      (a, b) =>
        Number(b.safetyCritical) - Number(a.safetyCritical) ||
        Number(b.required) - Number(a.required) ||
        a.priority - b.priority,
    );

  return outstanding[0] ?? null;
}

/**
 * Fields a human must see before this intake is trusted: anything
 * safety-critical that we could not get a real answer to.
 *
 * A refusal or an unknown on an allergy question is not a reason to
 * proceed quietly. It is a reason to put a person in the loop.
 */
export function unresolvedSafetyGaps(
  defs: readonly FieldDef[],
  fields: readonly IntakeField[],
): FieldDef[] {
  const byKey = new Map(fields.map((f) => [f.fieldKey, f]));
  return defs.filter((d) => {
    if (!d.safetyCritical) return false;
    const f = byKey.get(d.key);
    return !f || !isInformative(f.status);
  });
}
