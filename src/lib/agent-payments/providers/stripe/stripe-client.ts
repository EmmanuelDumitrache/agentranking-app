import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is required for Stripe Issuing");
  }

  stripeClient ??= new Stripe(key, {
    typescript: true,
  });

  return stripeClient;
}

export function requireStripeTestMode(): void {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key.startsWith("sk_test_")) {
    throw new Error("Stripe Issuing sandbox helpers require a test-mode secret key (sk_test_…)");
  }
}
