import { z } from "zod";
import {
  isValidLocalDate,
  isValidTimeZone,
  localDateDifferenceInDays,
  parseWorkingHours,
} from "./time";
import { normalizeEmail } from "./oauth-state";
import {
  WEEKLY_SLOT_COUNT,
  WEEKLY_SLOT_STATES,
  hasOpenWeeklyRun,
} from "./weekly-availability";

/**
 * Hard server-side caps.
 *
 * These bound what a single anonymous request can cost us in mail volume,
 * database rows, and slot computation. The client's own limits are a
 * convenience; these are the ones that matter.
 */
export const MAX_PARTICIPANTS = 20;
export const MAX_RANGE_DAYS = 90;
export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 1000;

const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email("Enter a valid email address");

const localDateSchema = z
  .string()
  .refine(isValidLocalDate, "Use a real calendar date in YYYY-MM-DD form");

export const CreateEventSchema = z
  .object({
    title: z.string().trim().min(1, "Give the meeting a title").max(MAX_TITLE_LENGTH),
    description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional(),
    organizerEmail: emailSchema,
    organizerName: z.string().trim().min(1, "Enter your name").max(100),

    /** Inclusive local calendar dates in `timezone`. */
    startDate: localDateSchema,
    endDate: localDateSchema,

    timezone: z.string().refine(isValidTimeZone, "Unknown timezone"),
    durationMinutes: z.number().int().min(15).max(480),
    workingHoursStart: z.string(),
    workingHoursEnd: z.string(),
    excludeWeekends: z.boolean().default(true),
    weeklyAvailability: z
      .array(z.enum(WEEKLY_SLOT_STATES))
      .length(WEEKLY_SLOT_COUNT)
      .optional(),
    participantEmails: z
      .array(emailSchema)
      .min(1, "Invite at least one person")
      .max(MAX_PARTICIPANTS, `Invite at most ${MAX_PARTICIPANTS} people`),

    /** Optional deadline for responses, as a unix timestamp in seconds. */
    responseDeadline: z.number().int().positive().nullish(),
    nonresponderPolicy: z.enum(["wait", "proceed_without"]).default("wait"),
    /**
     * Honeypot. A person never sees this field, so a value means a bot filled
     * in everything it found.
     *
     * Validation deliberately accepts any value: rejecting it here would
     * return an error naming the field, which teaches a bot exactly what to
     * omit next time. The route checks it after parsing and returns an
     * ordinary-looking success instead.
     */
    website: z.string().max(200).optional(),
  })
  .superRefine((data, ctx) => {
    // Zod still runs object refinements when individual fields are invalid.
    // Keep malformed dates as ordinary validation errors instead of letting
    // the range helper throw and turning a bad request into a 500 response.
    if (isValidLocalDate(data.startDate) && isValidLocalDate(data.endDate)) {
      const span = localDateDifferenceInDays(data.startDate, data.endDate);
      if (span < 0) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: "The latest date must not be before the earliest date",
        });
      } else if (span + 1 > MAX_RANGE_DAYS) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: `Choose a window of at most ${MAX_RANGE_DAYS} days`,
        });
      }
    }

    try {
      const { startMinutes, endMinutes } = parseWorkingHours(
        data.workingHoursStart,
        data.workingHoursEnd
      );
      if (endMinutes - startMinutes < data.durationMinutes) {
        ctx.addIssue({
          code: "custom",
          path: ["durationMinutes"],
          message: "The meeting is longer than the working hours you chose",
        });
      }
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["workingHoursEnd"],
        message: error instanceof Error ? error.message : "Invalid working hours",
      });
    }

    if (
      data.weeklyAvailability &&
      !hasOpenWeeklyRun(data.weeklyAvailability, data.durationMinutes)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["weeklyAvailability"],
        message: "Leave at least one open stretch long enough for this plan",
      });
    }

    const seen = new Set<string>();
    const organizer = normalizeEmail(data.organizerEmail);
    for (const email of data.participantEmails) {
      const normalized = normalizeEmail(email);
      if (normalized === organizer) {
        ctx.addIssue({
          code: "custom",
          path: ["participantEmails"],
          message:
            "You are already included as the organizer — no need to invite yourself",
        });
      }
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: "custom",
          path: ["participantEmails"],
          message: `${email} was added more than once`,
        });
      }
      seen.add(normalized);
    }
  });

export type CreateEventInput = z.infer<typeof CreateEventSchema>;

export interface FieldError {
  field: string;
  message: string;
}

/**
 * One consistent error shape.
 *
 * The iOS client used to receive either a string or an array depending on which
 * branch failed, and rendered "Unknown error" for the array case. Every failure
 * now carries a human `error` plus optional per-field detail.
 */
export interface ApiErrorBody {
  error: string;
  fieldErrors?: FieldError[];
}

export function zodToApiError(error: z.ZodError): ApiErrorBody {
  const fieldErrors = error.issues.map((issue) => ({
    field: issue.path.map(String).join(".") || "_",
    message: issue.message,
  }));
  return {
    error: fieldErrors[0]?.message ?? "That request wasn't valid",
    fieldErrors,
  };
}
