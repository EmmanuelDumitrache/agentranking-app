import Link from "next/link";
import { ArrowLeft } from "lucide-react";
const proseClasses =
  "[&_h2]:font-semibold [&_h2]:text-lg [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-foreground [&_h3]:font-medium [&_h3]:text-base [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-foreground [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-4 [&_ul]:text-muted-foreground [&_ul]:space-y-1";
export default function AboutPage() {
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
        <h1 className="text-2xl md:text-3xl font-bold mb-2">About AgentRanking</h1>
        <p className="text-muted-foreground text-sm">
          Blockchain AI agent directory for ERC-8004 on-chain AI agents
        </p>
      </header>
      <div className={proseClasses}>
        <p>
          AgentRanking is a blockchain AI agent directory for verified AI agents registered with the ERC-8004
          standard. We help you discover Ethereum AI agents, Base network AI agents, and agents on other supported
          chains—with AI agent rankings, feedback, and verification in one place.
        </p>
        <h2>Mission</h2>
        <p>
          We make on-chain AI agents easier to find and trust. By indexing public identity registries, we surface
          ERC-8004 agents with transparent scores and community signals—not a closed gatekeeper list.
        </p>
        <h2>Built on ERC-8004</h2>
        <p>
          ERC-8004 defines how AI agents register identity and reputation on-chain. AgentRanking reads those
          registries so you can browse a multi-chain directory, compare agents, and use Know Your Agent verification
          when you need stronger assurance.
        </p>
        <h2>What We Offer</h2>
        <ul>
          <li>Discovery and AI agent rankings (power leaderboard)</li>
          <li>On-chain feedback aggregation</li>
          <li>Verification (Know Your Agent) for trusted listings</li>
          <li>Boost and advertising for visibility</li>
        </ul>
        <p>
          For questions or partnership inquiries, please{" "}
          <Link href="/contact" className="text-primary hover:underline">
            contact us
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
