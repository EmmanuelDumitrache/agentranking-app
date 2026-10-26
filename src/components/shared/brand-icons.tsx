import { forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

export const GoogleLogo: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(
  function GoogleLogo({ size = 24, absoluteStrokeWidth, ...props }, ref) {
    void absoluteStrokeWidth;
    return (
      <svg
        {...props}
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fill="#4285F4"
          d="M21.6 12.227c0-.709-.064-1.391-.182-2.045H12v3.873h5.382a4.603 4.603 0 0 1-1.995 3.018v2.509h3.227c1.891-1.741 2.986-4.309 2.986-7.355Z"
        />
        <path
          fill="#34A853"
          d="M12 22c2.7 0 4.964-.895 6.614-2.418l-3.227-2.509c-.895.6-2.041.955-3.387.955-2.605 0-4.809-1.759-5.6-4.123H3.064v2.591A9.997 9.997 0 0 0 12 22Z"
        />
        <path
          fill="#FBBC05"
          d="M6.4 13.905A6.018 6.018 0 0 1 6.086 12c0-.664.114-1.309.314-1.905V7.504H3.064A9.997 9.997 0 0 0 2 12c0 1.614.386 3.141 1.064 4.496L6.4 13.905Z"
        />
        <path
          fill="#EA4335"
          d="M12 5.973c1.468 0 2.786.504 3.823 1.491l2.864-2.864C16.959 2.991 14.695 2 12 2a9.997 9.997 0 0 0-8.936 5.504L6.4 10.095c.791-2.364 2.995-4.122 5.6-4.122Z"
        />
      </svg>
    );
  },
);

export const GithubLogo: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(
  function GithubLogo({ size = 24, absoluteStrokeWidth, ...props }, ref) {
    void absoluteStrokeWidth;
    return (
      <svg
        {...props}
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
      </svg>
    );
  },
);
