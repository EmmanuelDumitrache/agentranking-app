export type MfaStatusDto = {
  mfaVerified: boolean;
  profileId: number;
  totpEnabled: boolean;
  emailOtpMfaEnabled: boolean;
  backupCodesRemaining: number;
  mfaRequired: boolean;
  canEnableEmailOtp: boolean;
  email: string | null;
};
