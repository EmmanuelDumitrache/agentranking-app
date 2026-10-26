export default function AgentChatLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <div className="ui-focused-chat-layout">{children}</div>;
}