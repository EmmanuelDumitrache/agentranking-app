"use client";
import Link from "next/link";
import type { PublicFooterColumn } from "@/lib/site-config";
import { TelegramLogo, XLogo } from "@/components/public-site/social-icons";
type Props = {
  /** Pass from a Server Component so SSR and hydration use identical columns. */
  readonly columns: readonly PublicFooterColumn[];
};
export function PublicSiteFooter({ columns }: Props) {
  const year = new Date().getFullYear();
  return (
    <footer className="ar-public-footer relative z-10">
      <div className="ui-public-site-container py-8 sm:py-10">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-6 lg:gap-x-8">
          <div className="col-span-2 lg:col-span-2">
            <Link href="/" className="text-[15px] font-semibold tracking-tight">
              AgentRanking
            </Link>
            <p className="ar-public-footer-lead mt-2 max-w-[260px] text-xs">
              The global launchpad and ranking index for AI agents.
            </p>
            <div className="mt-3 flex gap-2">
              <a
                href="https://x.com/agentranking"
                target="_blank"
                rel="noopener noreferrer"
                className="ar-public-footer-social"
                aria-label="X"
              >
                <XLogo className="h-3.5 w-3.5" />
              </a>
              <a
                href="https://t.me/agentrankingtg"
                target="_blank"
                rel="noopener noreferrer"
                className="ar-public-footer-social"
                aria-label="Telegram"
              >
                <TelegramLogo className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
          {columns.map((col) => (
            <div key={col.title} className="min-w-0">
              <p className="ar-public-footer-heading">{col.title}</p>
              <ul className="mt-2 space-y-1.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ar-public-footer-link"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className="ar-public-footer-link">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="ar-public-footer-bottom mt-8 flex flex-col gap-3 pt-5 sm:mt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="ar-public-footer-copyright text-center sm:text-left">© {year} AgentRanking. All rights reserved.</p>
          <p className="ar-public-footer-copyright flex items-center justify-center gap-1.5 sm:justify-start">
            The AI agent economy, powered by
            <svg width="14" height="11" viewBox="0 -2 398 310" fill="none" xmlns="http://www.w3.org/2000/svg" className="mx-0.5" aria-label="Solana">
              <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7Z" fill="url(#s-footer-a)" />
              <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8Z" fill="url(#s-footer-b)" />
              <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7Z" fill="url(#s-footer-c)" opacity="0.8" />
              <defs>
                <linearGradient id="s-footer-a" x1="292.8" y1="25.6" x2="48" y2="319.9" gradientUnits="userSpaceOnUse"><stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/></linearGradient>
                <linearGradient id="s-footer-b" x1="335.5" y1="161.3" x2="39.9" y2="357.5" gradientUnits="userSpaceOnUse"><stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/></linearGradient>
                <linearGradient id="s-footer-c" x1="314.2" y1="-39.3" x2="68.6" y2="254.9" gradientUnits="userSpaceOnUse"><stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/></linearGradient>
              </defs>
            </svg>
            Solana
          </p>
        </div>
      </div>
    </footer>
  );
}
