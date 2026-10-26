import { MEDUSA_PARTNER_SECTIONS } from "@/lib/medusa/partner-content";
export function MedusaPartnerDetailSections() {
  return (
    <>
      {MEDUSA_PARTNER_SECTIONS.map((section) => (
        <div key={section.title}>
          <h2 className="font-semibold text-lg mt-8 mb-3 text-foreground">{section.title}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-muted-foreground mb-3">
              {paragraph}
            </p>
          ))}
          {section.bullets && section.bullets.length > 0 ? (
            <ul className="list-disc ml-5 sm:ml-6 space-y-1 text-muted-foreground mb-4">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </>
  );
}