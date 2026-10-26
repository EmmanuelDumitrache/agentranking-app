export type OrbitSkillStatus = "LIVE" | "PENDING" | "NEW";
export type OrbitSkillFeasibility = "YES" | "PARTIAL" | "NO";
export type OrbitSkillPriority = 1 | 2 | 3;
export type OrbitSkill = {
  id: string;
  label: string;
  category: string;
  orbitStatus: OrbitSkillStatus;
  feasibility: OrbitSkillFeasibility;
  priority: OrbitSkillPriority;
  aliases: string[];
  searchTerms: string[];
  similarSkills: string[];
};
export const ORBIT_SKILLS = [
  {
    id: "call_agent",
    label: "Call Agent",
    category: "agent_economy",
    orbitStatus: "LIVE",
    feasibility: "YES",
    priority: 1,
    aliases: ["agent call", "agent endpoint", "callable agent", "run agent", "agent service"],
    searchTerms: ["agent", "endpoint", "service", "mcp", "a2a", "api", "call", "automation"],
    similarSkills: ["xpay_do", "deep_research", "token_info"],
  },
  {
    id: "xpay_do",
    label: "xPay / x402 Payment",
    category: "agent_economy",
    orbitStatus: "PENDING",
    feasibility: "YES",
    priority: 1,
    aliases: ["x402", "machine payment", "agent payment", "paid endpoint", "paid service"],
    searchTerms: ["x402", "xpay", "payment", "paid", "pricing", "wallet", "usdc", "checkout"],
    similarSkills: ["call_agent", "wallet_transfer", "token_swap"],
  },
  {
    id: "write_content",
    label: "Write Content",
    category: "content_creation",
    orbitStatus: "NEW",
    feasibility: "PARTIAL",
    priority: 1,
    aliases: ["copywriting", "blog writer", "content agent", "social post", "marketing copy"],
    searchTerms: ["write", "content", "copy", "blog", "article", "social", "tweet", "post", "marketing"],
    similarSkills: ["summarize_doc", "seo_research", "review_mining"],
  },
  {
    id: "summarize_doc",
    label: "Summarize Document",
    category: "research",
    orbitStatus: "NEW",
    feasibility: "PARTIAL",
    priority: 1,
    aliases: ["document summary", "summarizer", "summarize report", "digest"],
    searchTerms: ["summarize", "summary", "document", "report", "digest", "research", "analysis"],
    similarSkills: ["deep_research", "write_content", "seo_research"],
  },
  {
    id: "deep_research",
    label: "Deep Research",
    category: "research",
    orbitStatus: "NEW",
    feasibility: "YES",
    priority: 1,
    aliases: ["research agent", "market research", "analysis agent", "intelligence agent"],
    searchTerms: ["research", "analytics", "analysis", "intelligence", "data", "insight", "market", "report"],
    similarSkills: ["summarize_doc", "token_info", "seo_research"],
  },
  {
    id: "generate_image",
    label: "Generate Image",
    category: "content_creation",
    orbitStatus: "NEW",
    feasibility: "PARTIAL",
    priority: 1,
    aliases: ["image generation", "banner maker", "design agent", "creative agent"],
    searchTerms: ["image", "banner", "design", "creative", "generate image", "photo", "visual", "art"],
    similarSkills: ["write_content", "generate_video"],
  },
  {
    id: "generate_video",
    label: "Generate Video",
    category: "content_creation",
    orbitStatus: "NEW",
    feasibility: "PARTIAL",
    priority: 2,
    aliases: ["video generation", "video maker", "clip generator", "creative video"],
    searchTerms: ["video", "clip", "motion", "reel", "generate video", "creative", "media"],
    similarSkills: ["generate_image", "write_content"],
  },
  {
    id: "token_price",
    label: "Token Price",
    category: "finance_crypto",
    orbitStatus: "LIVE",
    feasibility: "YES",
    priority: 1,
    aliases: ["price feed", "crypto price", "market price", "token quote"],
    searchTerms: ["token price", "price", "quote", "market data", "oracle", "feed", "dex", "ticker"],
    similarSkills: ["token_info", "trending_tokens", "token_swap"],
  },
  {
    id: "token_info",
    label: "Token Info",
    category: "finance_crypto",
    orbitStatus: "LIVE",
    feasibility: "YES",
    priority: 1,
    aliases: ["token metadata", "token lookup", "coin info", "asset info"],
    searchTerms: ["token", "metadata", "coin", "asset", "info", "lookup", "contract", "mint", "market"],
    similarSkills: ["token_price", "trending_tokens", "deep_research"],
  },
  {
    id: "trending_tokens",
    label: "Trending Tokens",
    category: "finance_crypto",
    orbitStatus: "LIVE",
    feasibility: "YES",
    priority: 1,
    aliases: ["hot tokens", "token trends", "market momentum", "token discovery"],
    searchTerms: ["trending", "hot", "momentum", "token", "market", "sentiment", "launch", "memecoin"],
    similarSkills: ["token_info", "token_price", "review_mining"],
  },
  {
    id: "token_swap",
    label: "Token Swap",
    category: "finance_crypto",
    orbitStatus: "PENDING",
    feasibility: "YES",
    priority: 1,
    aliases: ["swap token", "dex swap", "trade token", "execute swap"],
    searchTerms: ["swap", "trade", "dex", "router", "execution", "trading", "sniper", "arbitrage"],
    similarSkills: ["token_price", "wallet_balance", "xpay_do"],
  },
  {
    id: "wallet_balance",
    label: "Wallet Balance",
    category: "finance_crypto",
    orbitStatus: "LIVE",
    feasibility: "YES",
    priority: 2,
    aliases: ["portfolio balance", "wallet holdings", "portfolio tracker", "account balance"],
    searchTerms: ["wallet", "balance", "portfolio", "holdings", "tracker", "analytics", "financials"],
    similarSkills: ["wallet_transfer", "token_info", "token_swap"],
  },
  {
    id: "wallet_transfer",
    label: "Wallet Transfer",
    category: "finance_crypto",
    orbitStatus: "PENDING",
    feasibility: "PARTIAL",
    priority: 2,
    aliases: ["send funds", "transfer tokens", "payment transfer", "wallet payment"],
    searchTerms: ["wallet", "transfer", "payment", "send", "funds", "x402", "m2m", "usdc"],
    similarSkills: ["wallet_balance", "xpay_do", "token_swap"],
  },
  {
    id: "lead_generate",
    label: "Lead Generate",
    category: "business_work",
    orbitStatus: "NEW",
    feasibility: "PARTIAL",
    priority: 2,
    aliases: ["lead generation", "sales leads", "prospecting", "business development"],
    searchTerms: ["lead", "sales", "prospect", "crm", "business", "outreach", "growth"],
    similarSkills: ["seo_research", "write_content", "review_mining"],
  },
  {
    id: "seo_research",
    label: "SEO Research",
    category: "business_work",
    orbitStatus: "NEW",
    feasibility: "PARTIAL",
    priority: 2,
    aliases: ["keyword research", "seo agent", "search research", "content seo"],
    searchTerms: ["seo", "keyword", "search", "ranking", "content", "traffic", "research"],
    similarSkills: ["write_content", "deep_research", "lead_generate"],
  },
  {
    id: "review_mining",
    label: "Review Mining",
    category: "business_work",
    orbitStatus: "NEW",
    feasibility: "PARTIAL",
    priority: 3,
    aliases: ["review analysis", "sentiment mining", "feedback mining", "customer insights"],
    searchTerms: ["review", "feedback", "sentiment", "social", "community", "analysis", "insight"],
    similarSkills: ["deep_research", "seo_research", "lead_generate"],
  },
] as const satisfies readonly OrbitSkill[];
export function getOrbitSkills(): OrbitSkill[] {
  return ORBIT_SKILLS.map((skill) => ({ ...skill, aliases: [...skill.aliases], searchTerms: [...skill.searchTerms], similarSkills: [...skill.similarSkills] }));
}
export function getOrbitSkillById(skillId: string): OrbitSkill | null {
  const normalized = skillId.trim().toLowerCase();
  const skill = ORBIT_SKILLS.find((item) => item.id === normalized);
  return skill
    ? { ...skill, aliases: [...skill.aliases], searchTerms: [...skill.searchTerms], similarSkills: [...skill.similarSkills] }
    : null;
}