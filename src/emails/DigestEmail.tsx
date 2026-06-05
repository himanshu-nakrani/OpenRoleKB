interface JobInfo {
  title: string;
  company: string;
  url: string;
}

export function generateDigestEmailHtml(
  rawQuery: string,
  jobCount: number,
  topJobs: JobInfo[],
  searchUrl: string
): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://openrolekb.example.com";
  
  const jobsHtml = topJobs.slice(0, 5).map(job => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6;">
        <div style="font-weight: 600; color: #111827; margin-bottom: 4px;">${escapeHtml(job.title)}</div>
        <div style="font-size: 14px; color: #6b7280;">${escapeHtml(job.company)}</div>
      </td>
    </tr>
  `).join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New jobs matching your search</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827;">
  <table role="presentation" width="100%" style="background-color: #f9fafb; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 512px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; padding: 24px;">
          <tr>
            <td>
              <h1 style="margin: 0 0 16px 0; font-size: 24px; font-weight: 700; color: #111827;">New jobs matching your search</h1>
              <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151; line-height: 1.5;">
                We found <strong>${jobCount} new ${jobCount === 1 ? "role" : "roles"}</strong> matching your saved search: 
                <span style="font-weight: 600; color: #111827;">"${escapeHtml(rawQuery)}"</span>.
              </p>

              <table role="presentation" width="100%" style="margin-bottom: 24px;">
                ${jobsHtml}
              </table>

              <table role="presentation" width="100%">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(searchUrl)}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-weight: 600; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 16px;">
                      View all ${jobCount} new roles
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 32px 0 0 0; font-size: 12px; color: #6b7280; text-align: center; line-height: 1.5;">
                You are receiving this email because you saved this search on OpenRoleKB. 
                <a href="${siteUrl}/account" style="color: #2563eb; text-decoration: underline;">Manage your saved searches</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
