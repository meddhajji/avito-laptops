export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPOSITORY = process.env.PIPELINE_REPOSITORY ?? "meddhajji/avito-laptops";
const WORKFLOW = "avito-refresh.yml";

const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Starts the nightly pipeline on GitHub Actions.
 *
 * GitHub's own scheduler does not fire for this repository, so the trigger
 * comes from Vercel Cron (see vercel.json): it calls this route, which asks
 * GitHub to run the workflow. The pipeline itself still runs on GitHub Actions,
 * where its logs and history live.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` with cron requests, so
 * nobody else can start a run by visiting the URL.
 */
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const token = process.env.GITHUB_DISPATCH_TOKEN;
    if (!secret || !token) return json(503, { error: "Pipeline trigger is not configured." });
    if (request.headers.get("authorization") !== `Bearer ${secret}`) return json(401, { error: "Unauthorized." });

    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main" }),
    });

    if (!response.ok) {
        console.error("[cron] GitHub refused the dispatch:", response.status, (await response.text()).slice(0, 300));
        return json(502, { dispatched: false, github_status: response.status });
    }
    return json(200, { dispatched: true });
}
