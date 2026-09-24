import PublicSite from "../../../components/PublicSite";

export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicSite slug={slug} />;
}
