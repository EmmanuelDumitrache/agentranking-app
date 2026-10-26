/**
 * Lightweight live post embed via Twitter/X widget frame (real tweet, not a screenshot).
 */
type TweetIframeProps = {
  readonly tweetId: string;
};
export function TwitterTweetIframe({ tweetId }: TweetIframeProps) {
  const src = `https://platform.twitter.com/embed/Tweet.html?id=${encodeURIComponent(tweetId)}&theme=dark&dnt=true&widgetsVersion=2615f7e52b589%3A1687419081544`;
  return (
    <div className="not-prose my-6 flex justify-center rounded-xl border border-border bg-muted/40 p-3 sm:p-4">
      <iframe
        title={`Post on X · ${tweetId}`}
        src={src}
        className="h-[580px] w-full max-w-[550px] rounded-lg border border-border/60 bg-card shadow-sm sm:h-[620px]"
        sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-popups"
      />
    </div>
  );
}