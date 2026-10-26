export const XPAY_SERVICE_TYPE = "xpay";
export function isXPayServiceType(serviceType?: string | null): boolean {
  const key = serviceType?.trim().toLowerCase();
  return key === XPAY_SERVICE_TYPE || key === "xona-xpay" || key === "x402-xpay";
}
export function xpayServiceLabel(serviceType?: string | null): string {
  return isXPayServiceType(serviceType) ? "Xona xPay" : serviceType?.trim() || "x402";
}