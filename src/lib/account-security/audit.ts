import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export type SecurityAuditAction =
  | "totp_enroll"
  | "totp_disable"
  | "backup_regenerate"
  | "email_otp_enable"
  | "email_otp_disable"
  | "admin_totp_reset"
  | "admin_email_otp_disable"
  | "mfa_challenge_ok"
  | "mfa_challenge_fail"
  | "step_up_ok"
  | "step_up_fail";

type SecurityAuditClient = Pick<Prisma.TransactionClient, "accountSecurityAudit">;

export async function writeSecurityAudit(
  input: {
    userProfileId: number;
    action: SecurityAuditAction;
    actor?: "user" | "admin";
    metadata?: Prisma.InputJsonValue;
  },
  client: SecurityAuditClient = prisma,
): Promise<void> {
  await client.accountSecurityAudit.create({
    data: {
      userProfileId: input.userProfileId,
      action: input.action,
      actor: input.actor ?? "user",
      metadataJson: input.metadata ?? undefined,
    },
  });
}
