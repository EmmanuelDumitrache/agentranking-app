import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ContactForm } from "@/app/(public-site)/contact/contact-form";

export default function ContactPage() {
  return (
    <div className="min-h-screen max-w-lg mx-auto p-4 md:p-6">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Home
      </Link>
      <header className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Contact</h1>
        <p className="text-muted-foreground text-sm">
          Send us a message and we&apos;ll get back to you.
        </p>
      </header>
      <ContactForm />
    </div>
  );
}
