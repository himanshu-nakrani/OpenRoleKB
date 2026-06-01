import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

const BG = "#0C0E16";
const SURFACE = "#14172A";
const INK = "#ECEBF5";
const INK_SOFT = "#A6A8C2";
const ACCENT = "#A78BFA";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const titleParam = searchParams.get("title");
  const subtitleParam = searchParams.get("subtitle");

  const title = (titleParam || "OpenRoleKB").slice(0, 80);
  const subtitle =
    (subtitleParam || "Find a role you'll love — described in plain English.").slice(0, 120);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "72px",
          background: BG,
          backgroundImage: `radial-gradient(ellipse 60% 40% at 50% -10%, rgba(167,139,250,0.28), transparent 70%), radial-gradient(ellipse 50% 40% at 100% 110%, rgba(167,139,250,0.22), transparent 70%)`,
          color: INK,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              background: `linear-gradient(135deg, ${ACCENT}, #5B3FE3)`,
              display: "flex",
            }}
          />
          <span>OpenRoleKB</span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            flex: 1,
            paddingTop: 96,
          }}
        >
          <div
            style={{
              fontSize: 76,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.025em",
              color: INK,
              maxWidth: 980,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 30,
              lineHeight: 1.3,
              color: INK_SOFT,
              marginTop: 28,
              maxWidth: 920,
            }}
          >
            {subtitle}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 56,
            paddingTop: 24,
            borderTop: `1px solid ${SURFACE}`,
            color: INK_SOFT,
            fontSize: 22,
          }}
        >
          <span>Neural search · AI ranked · Real ATS sources</span>
          <span style={{ color: ACCENT }}>openrolekb</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
