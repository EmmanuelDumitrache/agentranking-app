/** Live X API refresh requires explicit opt-in (dev and production). */
export function isXPostsLiveFetchEnabled(): boolean {
  return (
    process.env.X_POSTS_LIVE_FETCH_ENABLED === "1" || process.env.X_POSTS_LIVE_FETCH_ENABLED === "true"
  );
}