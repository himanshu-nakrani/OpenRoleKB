import NextAuth from "next-auth";
import EmailProvider from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    EmailProvider({
      from: process.env.RESEND_FROM,
    }),
  ],
  session: { strategy: "database" },
  callbacks: {
    session({ session, user }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: user.id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          anonId: (user as any).anonId,
        },
      };
    },
  },
  pages: {
    signIn: "/",
    verifyRequest: "/",
    error: "/",
  },
});
