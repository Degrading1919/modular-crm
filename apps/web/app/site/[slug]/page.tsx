import PublicSite from "../../../components/PublicSite";

export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicSite slug={slug} loginUrl={new URL("/login", process.env.APP_BASE_URL ?? "http://localhost:3000").toString()} />;
}
