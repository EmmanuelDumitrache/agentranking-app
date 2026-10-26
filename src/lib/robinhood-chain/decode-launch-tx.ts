import { decodeFunctionData, type Hex } from "viem";
import { quiverFactoryV3Abi } from "@/lib/robinhood-chain/quiver-abis";
/** Extract on-chain image URI from a Quiver `deployToken` calldata. */
export function decodeLaunchLogoFromTxInput(input: Hex): string | null {
  try {
    const decoded = decodeFunctionData({ abi: quiverFactoryV3Abi, data: input });
    if (decoded.functionName !== "deployToken") return null;
    const [tokenConfig] = decoded.args as unknown as [{ image: string }];
    return tokenConfig.image?.trim() || null;
  } catch {
    return null;
  }
}
