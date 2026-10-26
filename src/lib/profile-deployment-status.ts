import type { ProfileDeployment } from "@/lib/agent-profile-deployments";

/** Agent row exists in AgentRanking index (Identity Registry ingested). */
export function isDeploymentIndexed(deployment: ProfileDeployment): boolean {
  return deployment.indexed !== false;
}
/** ERC-8004 identity registered on this EVM network. */
export function isEvmIdentityRegistered(deployment: ProfileDeployment): boolean {
  return deployment.kind === "evm" && isDeploymentIndexed(deployment);
}
/** Validation Registry attestation pass on this EVM deployment (per chain). */
export function isValidatorAttested(deployment: ProfileDeployment): boolean {
  return deployment.kind === "evm" && deployment.chainVerified === true;
}
export function hasErc8004IdentityRegistered(
  deployments: readonly ProfileDeployment[] | undefined,
): boolean {
  if (!deployments?.length) return false;
  return deployments.some(isEvmIdentityRegistered);
}
export type DeploymentIdentityStatus = "registered" | "pending" | "sap" | "metaplex";
export type DeploymentValidatorStatus = "attested" | "none" | "n/a";
export function deploymentIdentityStatus(
  deployment: ProfileDeployment,
): DeploymentIdentityStatus {
  if (deployment.kind === "metaplex") {
    return isDeploymentIndexed(deployment) ? "metaplex" : "pending";
  }
  if (deployment.kind === "sap") {
    return isDeploymentIndexed(deployment) ? "sap" : "pending";
  }
  if (isEvmIdentityRegistered(deployment)) return "registered";
  return "pending";
}
export function deploymentValidatorStatus(
  deployment: ProfileDeployment,
): DeploymentValidatorStatus {
  if (deployment.kind === "sap" || deployment.kind === "metaplex") return "n/a";
  if (!isEvmIdentityRegistered(deployment)) return "n/a";
  return isValidatorAttested(deployment) ? "attested" : "none";
}