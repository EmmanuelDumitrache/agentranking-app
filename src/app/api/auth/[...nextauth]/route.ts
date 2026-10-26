import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureDevNextAuthUrl } from "@/lib/nextauth-url";
ensureDevNextAuthUrl();
const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };