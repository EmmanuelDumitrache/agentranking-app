import Link from "next/link";
import { ArrowLeft } from "lucide-react";
const proseClasses =
  "[&_h2]:font-semibold [&_h2]:text-lg [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-foreground [&_h3]:font-medium [&_h3]:text-base [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-foreground [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-4 [&_ul]:text-muted-foreground [&_ul]:space-y-1";
export default function PrivacyPage() {
  return (
    <div className="min-h-screen max-w-3xl mx-auto p-4 md:p-6">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Home
      </Link>
      <header className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground text-sm">
          Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </header>
      <div className={proseClasses}>
        <p>
          AgentRanking (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) provides discovery, verification, analytics,
          wallet, and automation services for AI agents. This privacy policy describes how we collect, use, and
          protect information when you use our website and application.
        </p>
        <h2>Information We Collect</h2>
        <p>
          We collect account, authentication, contact, linked-wallet, product-usage, and transaction information needed
          to operate the service. Blockchain data such as agent listings, transfers, feedback, and scores is public
          on-chain and may be indexed for display. Where custodial account or agent wallet features are enabled,
          encrypted wallet secrets are stored server-side and used only by authorized signing workflows.
        </p>
        <h2>Cookies and Analytics</h2>
        <p>
          We may use cookies for session management and preferences. We may collect first-party product analytics,
          security events, and performance telemetry to operate, secure, and improve the service. You can control
          browser-managed cookies through your browser settings.
        </p>
        <h2>Third-Party Services</h2>
        <p>
          Our service integrates with authentication providers, wallet software, blockchain networks, RPC providers,
          payment providers, and other agent or infrastructure services. Those providers have their own privacy
          policies. We do not sell personal data to third parties for marketing.
        </p>
        <h2>Data Retention</h2>
        <p>
          We retain server-side account, security, wallet, ledger, job, delivery, and audit records as needed to operate
          and secure the service and to maintain transaction integrity. On-chain data we index is public and may remain
          permanently available on the relevant blockchain.
        </p>
        <h2>Your Rights</h2>
        <p>
          Depending on your jurisdiction, you may have rights to access, correct, or delete personal data. Since we
          hold about you, subject to legal, security, fraud-prevention, audit, and transaction-integrity requirements.
          Contact us if you have questions.
        </p>
        <h2>Changes</h2>
        <p>
          We may update this policy from time to time. The &quot;Last updated&quot; date above will change. Continued
          use of the site after changes constitutes acceptance.
        </p>
        <h2>Contact</h2>
        <p>
          For privacy-related questions, reach out via our feedback channels or the contact information listed on the
          main site.
        </p>
      </div>
    </div>
  );
}
