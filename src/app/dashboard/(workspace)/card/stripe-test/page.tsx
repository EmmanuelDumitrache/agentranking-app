import { redirect } from "next/navigation";

export default function StripeTestRedirectPage() {
  redirect("/dashboard/card");
}
