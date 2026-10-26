import Link from "next/link";
import { PublicSiteContentShell } from "@/components/public-site/content-shell";
import type { PublicSiteSeoPage } from "@/lib/public-site-seo-pages";
import { getPublicSiteUrl } from "@/lib/site-url";
function JsonLd({ page }: { readonly page: PublicSiteSeoPage }) {
  const url = `${getPublicSiteUrl()}/${page.slug}`;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: page.metaTitle,
        description: page.description,
        isPartOf: { "@id": `${getPublicSiteUrl()}/#website` },
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        mainEntity: page.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })),
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
export function PublicSeoPage({ page }: { readonly page: PublicSiteSeoPage }) {
  return (
    <PublicSiteContentShell>
      <JsonLd page={page} />
      <main className="ar-public-container py-16 sm:py-20">
        <section className="mx-auto max-w-3xl text-center">
          <p className="ar-public-label mb-4">{page.eyebrow}</p>
          <h1 className="text-[clamp(2.25rem,6vw,5rem)] font-semibold leading-[0.95] tracking-[-0.06em] text-[var(--ar-text-primary)]">
            {page.title}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-[1.7] text-[var(--ar-text-secondary)] sm:text-[17px]">
            {page.description}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <Link href={page.primaryHref} className="ar-public-btn ar-public-btn-primary">
              {page.primaryCta}
            </Link>
            <Link href="/news" className="ar-public-btn">
              Read agent news
            </Link>
          </div>
        </section>
        <section className="mx-auto mt-14 grid max-w-5xl gap-4 md:grid-cols-2">
          {page.sections.map((section) => (
            <article key={section.title} className="ar-public-glass rounded-xl p-5 sm:p-6">
              <h2 className="text-xl font-semibold tracking-tight text-[var(--ar-text-primary)]">
                {section.title}
              </h2>
              <p className="mt-3 text-[13px] leading-[1.65] text-[var(--ar-text-secondary)]">
                {section.copy}
              </p>
              {section.bullets ? (
                <ul className="mt-4 space-y-2 text-[12px] text-[var(--ar-text-tertiary)]">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--ar-text-secondary)]" aria-hidden />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </section>
        <section className="mx-auto mt-14 max-w-3xl">
          <p className="ar-public-label mb-4">FAQ</p>
          <div className="space-y-3">
            {page.faqs.map((faq) => (
              <article key={faq.question} className="ar-public-glass rounded-xl p-5">
                <h2 className="text-base font-semibold text-[var(--ar-text-primary)]">{faq.question}</h2>
                <p className="mt-2 text-[13px] leading-[1.65] text-[var(--ar-text-secondary)]">{faq.answer}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </PublicSiteContentShell>
  );
}
