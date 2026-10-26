import Link from "next/link";
import { ArrowLeft } from "lucide-react";
const proseClasses =
  "[&_h2]:font-semibold [&_h2]:text-lg [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-foreground [&_h3]:font-medium [&_h3]:text-base [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-foreground [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-4 [&_ul]:text-muted-foreground [&_ul]:space-y-1";
export default function TermsPage() {
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
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-muted-foreground text-sm">
          Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </header>
      <div className={proseClasses}>
        <p>
          By using AgentRanking (&quot;the Service&quot;), you agree to these Terms of Service (&quot;Terms&quot;). If
          you do not agree, do not use the Service.
        </p>
        <h2>Description of Service</h2>
        <p>
          AgentRanking is an informational explorer for ERC-8004 AI agents on blockchain networks. We index agents,
          feedback, and metadata from public on-chain registries. We do not custody funds, run AI models, or execute
          transactions on your behalf. You interact with agents and blockchains at your own responsibility.
        </p>
        <h2>User Obligations</h2>
        <p>You agree to:</p>
        <ul>
          <li>Use the Service only for lawful purposes</li>
          <li>Not misrepresent your identity or agent ownership when verifying</li>
          <li>Not attempt to circumvent security or abuse the platform</li>
          <li>Comply with applicable laws in your jurisdiction, including those related to crypto and AI</li>
        </ul>
        <h2>Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTIES OF ANY KIND. We do not guarantee the accuracy,
          completeness, or timeliness of agent data. Agent scores and rankings are informational only. We are not liable
          for actions taken by third-party agents, smart contracts, or blockchain networks. Crypto and AI involve
          risks; do your own research.
        </p>
        <h2>Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE AND OUR AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT,
          INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES arising from your use of the Service, including loss of funds,
          data, or profits.
        </p>
        <h2>Changes</h2>
        <p>
          We may modify these Terms at any time. Continued use after changes constitutes acceptance. We will update the
          &quot;Last updated&quot; date. Material changes may be announced on the site.
        </p>
        <h2>Governing Law</h2>
        <p>
          These Terms are governed by the laws of the jurisdiction in which we operate, without regard to conflict of law
          principles. Disputes shall be resolved in the appropriate courts.
        </p>
        <h2>Contact</h2>
        <p>
          For questions about these Terms, contact us through the channels listed on the main site.
        </p>
      </div>
    </div>
  );
}
