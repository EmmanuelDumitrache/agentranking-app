import { CardSubnav } from "@/components/treasury/card-subnav";

export default function CardLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <div className="ui-page-stack ui-page-stack--wide">
      <CardSubnav />
      {children}
    </div>
  );
}
